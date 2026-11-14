"""Operator lifecycle, backup, configuration and a real Waitress process."""
from contextlib import redirect_stdout, redirect_stderr
import http.client
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from opds_collaboration.__main__ import main
from opds_collaboration.runtime import Settings, run
from opds_collaboration.store import Store, Denied, Invalid


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = str(Path(self.temp.name) / 'review.db')

    def command(self, *args, password=''):
        out, err = io.StringIO(), io.StringIO()
        with patch('sys.stdin', io.StringIO(password)), redirect_stdout(out), redirect_stderr(err):
            result = main(['--database', self.db, *args])
        return result, out.getvalue(), err.getvalue()

    def test_local_user_lifecycle_and_password_reset_revokes_sessions(self):
        result, user, error = self.command('create-user', 'Alice', '--password-stdin', password='old long password\n')
        self.assertEqual(result, 0, error)
        user = user.strip()
        store = Store(self.db)
        token = store.login('Alice', 'old long password')
        doc = store.create_document(token, 'Review')
        self.assertEqual(self.command('disable-user', user)[0], 0)
        with self.assertRaises(Denied):
            store.snapshot(token, doc)
        self.assertEqual(self.command('enable-user', user)[0], 0)
        token = store.login('Alice', 'old long password')
        self.assertEqual(self.command('set-password', user, '--password-stdin', password='new long password\n')[0], 0)
        with self.assertRaises(Denied):
            store.snapshot(token, doc)
        with self.assertRaises(Denied):
            store.login('Alice', 'old long password')
        self.assertTrue(store.login('Alice', 'new long password'))
        result, users, _ = self.command('list-users')
        self.assertEqual(result, 0)
        self.assertEqual(users, user + '\tenabled\tAlice\n')
        self.assertNotIn('password', users)

    def test_password_input_is_explicit_and_validated(self):
        self.assertEqual(self.command('create-user', 'Alice', password='secret')[0], 2)
        self.assertEqual(self.command('create-user', 'Alice', '--password-stdin', password='short')[0], 2)
        self.assertEqual(Store(self.db).list_users(), [])
        with patch('sys.stdin.isatty', return_value=True), patch('getpass.getpass', side_effect=['one long password', 'different password']), redirect_stderr(io.StringIO()):
            self.assertEqual(main(['--database', self.db, 'create-user', 'Alice']), 2)

    def test_backup_includes_users_history_and_refuses_overwrite(self):
        self.command('create-user', 'Alice', '--password-stdin', password='long enough password')
        store = Store(self.db)
        token = store.login('Alice', 'long enough password')
        doc = store.create_document(token, 'Review')
        store.append(token, doc, {'id':'e', 'ann':'a', 'op':'create', 'base':None,
            'data':{'id':'a', 'page':1, 'type':'textbox'}})
        destination = str(Path(self.temp.name) / 'snapshot.backup')
        with store._connection():
            self.assertEqual(self.command('backup', destination)[0], 0)
        restored = Store(destination)
        self.assertEqual(restored.snapshot(token, doc), store.snapshot(token, doc))
        before = Path(destination).read_bytes()
        self.assertEqual(self.command('backup', destination)[0], 1)
        self.assertEqual(Path(destination).read_bytes(), before)
        if os.name != 'nt':
            self.assertEqual(Path(destination).stat().st_mode & 0o777, 0o600)

    def test_missing_database_does_not_create_backup_or_inventory(self):
        self.assertEqual(self.command('list-users')[0], 2)
        self.assertFalse(Path(self.db).exists())
        self.assertEqual(self.command('backup', str(Path(self.temp.name)/'backup'))[0], 2)


class ConfigurationTests(unittest.TestCase):
    def test_defaults_and_poll_headroom(self):
        settings = Settings.from_env({'OPDS_S3_BUCKET':'private-reviews'})
        self.assertEqual(settings.host, '127.0.0.1')
        self.assertEqual(settings.port, 8080)
        self.assertGreaterEqual(settings.threads-settings.waiters, 4)
        for override in ({'OPDS_MAX_WAITERS':'16'}, {'OPDS_PORT':'0'}, {'OPDS_PORT':'65536'},
                         {'OPDS_THREADS':'100'}, {'OPDS_THREADS':'abc'}, {'OPDS_DATABASE':''},
                         {'OPDS_S3_BUCKET':''}, {'OPDS_HOST':'host/path'}, {'OPDS_S3_REGION':'?'}):
            with self.subTest(override=override), self.assertRaises(Invalid):
                Settings.from_env({'OPDS_S3_BUCKET':'private-reviews', **override})

    def test_endpoints_reject_credentials_paths_and_malformed_ports(self):
        for endpoint in ('file:///data', 'https://user:secret@s3.example', 'https://s3.example/path',
                         'https://s3.example?secret=value', 'https://s3.example/#fragment',
                         'https://s3.example:99999', 'https://[broken'):
            with self.subTest(endpoint=endpoint), self.assertRaises(Invalid):
                Settings.from_env({'OPDS_S3_BUCKET':'private-reviews','OPDS_S3_ENDPOINT':endpoint})
        self.assertEqual(Settings.from_env({'OPDS_S3_BUCKET':'private-reviews','OPDS_S3_ENDPOINT':'http://127.0.0.1:9000'}).endpoint, 'http://127.0.0.1:9000')

    def test_server_limits_and_client_cleanup(self):
        settings = Settings.from_env({'OPDS_S3_BUCKET':'private-reviews'})
        client = Mock()
        with patch('opds_collaboration.runtime.build_app', return_value=(object(), client)), patch('opds_collaboration.runtime.serve', side_effect=OSError('bind failed')) as serve:
            with self.assertRaises(OSError):
                run(settings)
        self.assertEqual(serve.call_args.kwargs['max_request_body_size'], 32*1024*1024)
        self.assertFalse(serve.call_args.kwargs['expose_tracebacks'])
        self.assertIsNone(serve.call_args.kwargs['trusted_proxy'])
        client.close.assert_called_once()


class WaitressSmokeTests(unittest.TestCase):
    def test_real_server_start_login_and_body_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            path = str(Path(temp)/'review.db')
            Store(path).create_user('Alice', 'long enough password')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            env = {**os.environ, 'OPDS_DATABASE':path, 'OPDS_HOST':'127.0.0.1', 'OPDS_PORT':str(port),
                   'OPDS_S3_BUCKET':'private-reviews','OPDS_S3_ENDPOINT':'http://127.0.0.1:9',
                   'AWS_ACCESS_KEY_ID':'test','AWS_SECRET_ACCESS_KEY':'test','AWS_EC2_METADATA_DISABLED':'true'}
            child = subprocess.Popen([sys.executable,'-m','opds_collaboration','serve'], env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                for _ in range(100):
                    if child.poll() is not None:
                        self.fail('server exited: ' + child.stderr.read().decode())
                    try:
                        with socket.create_connection(('127.0.0.1',port), timeout=0.1):
                            break
                    except OSError:
                        time.sleep(0.05)
                else:
                    self.fail('server did not start')
                conn = http.client.HTTPConnection('127.0.0.1',port,timeout=5)
                try:
                    conn.request('POST','/v1/login',json.dumps({'name':'Alice','password':'long enough password'}),{'Content-Type':'application/json'})
                    response = conn.getresponse()
                    self.assertEqual(response.status,200)
                    self.assertEqual(len(json.loads(response.read())['token']),43)
                    conn.putrequest('POST','/v1/login')
                    conn.putheader('Content-Length',str(32*1024*1024+1))
                    conn.endheaders()
                    response=conn.getresponse()
                    self.assertEqual(response.status,413)
                    response.read()
                finally:
                    conn.close()
            finally:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
                child.stderr.close()
