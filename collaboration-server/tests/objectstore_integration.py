"""Real, isolated S3 qualification. Accepts a local MinIO binary, never an endpoint.

All credentials, ports, buckets and data directories belong to this invocation.
Only child processes started here are stopped. No ambient AWS credentials used.
"""
from contextlib import contextmanager, closing
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from opds_collaboration.__main__ import backup
from opds_collaboration.files import S3Files, StorageUnavailable
from opds_collaboration.store import Store


def pdf():
    """A complete one-page PDF with an xref table, not just a header stub."""
    data = b'%PDF-1.4\n'
    offsets = [0]
    objects = [b'<</Type /Catalog /Pages 2 0 R>>',
               b'<</Type /Pages /Kids [3 0 R] /Count 1>>',
               b'<</Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <<>>>>']
    for i, body in enumerate(objects, 1):
        offsets.append(len(data))
        data += str(i).encode() + b' 0 obj\n' + body + b'\nendobj\n'
    xref = len(data)
    data += b'xref\n0 4\n0000000000 65535 f \n'
    data += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return data + b'trailer\n<</Size 4 /Root 1 0 R>>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@contextmanager
def child(args, env, ready):
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(args, env=env, stdout=log, stderr=log)
        try:
            for _ in range(200):
                if process.poll() is not None:
                    log.seek(0)
                    raise AssertionError('test child exited: ' + log.read().decode(errors='replace'))
                try:
                    if ready():
                        break
                except (OSError, http.client.HTTPException):
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError('test child readiness deadline exceeded')
            yield
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def request(port_number, method, path, data=None, token=None, binary=False):
    headers = {'Content-Type': 'application/pdf' if binary else 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    conn = http.client.HTTPConnection('127.0.0.1', port_number, timeout=5)
    try:
        body = data if binary or data is None else json.dumps(data)
        conn.request(method, path, body, headers)
        response = conn.getresponse()
        raw = response.read()
        return response.status, raw if response.getheader('Content-Type', '').startswith('application/pdf') else json.loads(raw or b'{}')
    finally:
        conn.close()


@contextmanager
def objectstore(binary, directory, access, secret):
    api, console = port(), port()
    env = {**os.environ, 'MINIO_ROOT_USER': access, 'MINIO_ROOT_PASSWORD': secret,
           'MINIO_BROWSER': 'off', 'MINIO_UPDATE': 'off'}
    def ready():
        conn = http.client.HTTPConnection('127.0.0.1', api, timeout=1)
        try:
            conn.request('GET', '/minio/health/live')
            response = conn.getresponse()
            response.read()
            return response.status == 200
        finally:
            conn.close()
    with child([binary, 'server', str(directory), '--address', f'127.0.0.1:{api}',
                '--console-address', f'127.0.0.1:{console}'], env, ready):
        client = boto3.client('s3', endpoint_url=f'http://127.0.0.1:{api}',
            aws_access_key_id=access, aws_secret_access_key=secret, region_name='us-east-1',
            config=Config(connect_timeout=2, read_timeout=5, retries={'total_max_attempts': 1},
                          s3={'addressing_style': 'path'}))
        try:
            yield client, f'http://127.0.0.1:{api}'
        finally:
            client.close()


@contextmanager
def server(database, endpoint, bucket, access, secret):
    api = port()
    env = {**os.environ, 'OPDS_DATABASE': str(database), 'OPDS_HOST': '127.0.0.1',
           'OPDS_PORT': str(api), 'OPDS_S3_BUCKET': bucket, 'OPDS_S3_ENDPOINT': endpoint,
           'OPDS_S3_REGION': 'us-east-1', 'AWS_ACCESS_KEY_ID': access,
           'AWS_SECRET_ACCESS_KEY': secret, 'AWS_EC2_METADATA_DISABLED': 'true',
           'PYTHONPATH': str(Path(__file__).resolve().parents[1])}
    # Do not accidentally use an ambient session token with test credentials.
    env.pop('AWS_SESSION_TOKEN', None)
    with child([sys.executable, '-m', 'opds_collaboration', 'serve'], env,
               lambda: request(api, 'GET', '/v1/login')[0] == 405):
        yield api


def expect_error(operation, *codes):
    try:
        operation()
    except ClientError as exc:
        assert exc.response['Error']['Code'] in codes, exc.response['Error']['Code']
    else:
        raise AssertionError('S3 accepted a request which must fail')


def main(binary, native_probe=None):
    binary = str(Path(binary).resolve(strict=True))
    access, secret = 'opds-test-' + secrets.token_hex(8), secrets.token_urlsafe(32)
    data = pdf()
    with tempfile.TemporaryDirectory(prefix='opds-s3-test-') as temporary:
        root = Path(temporary)
        database, storage = root/'review.db', root/'objects'
        store = Store(database)
        store.create_user('Owner', 'owner test password')
        reader = store.create_user('Reader', 'reader test password')
        bucket = 'reviews-' + secrets.token_hex(8)
        with objectstore(binary, storage, access, secret) as (s3, endpoint):
            s3.create_bucket(Bucket=bucket)
            s3.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={'Status': 'Enabled'})
            objects = S3Files(s3, bucket)
            info = objects.put(data)
            assert info['version_id'] and info['version_id'] != 'null'
            assert objects.get(info) == data
            expect_error(lambda: s3.put_object(Bucket=bucket, Key=info['object_key'], Body=data,
                         IfNoneMatch='*'), 'PreconditionFailed')
            expect_error(lambda: s3.put_object(Bucket=bucket, Key='bad-checksum.pdf', Body=data,
                         ChecksumSHA256=base64.b64encode(b'\0'*32).decode()), 'BadDigest', 'XAmzContentChecksumMismatch')
            # An out-of-band replacement must not change the version read by the service.
            s3.put_object(Bucket=bucket, Key=info['object_key'], Body=data+b'changed')
            assert objects.get(info) == data
            s3.delete_object(Bucket=bucket, Key=info['object_key'], VersionId=info['version_id'])
            try:
                objects.get(info)
            except StorageUnavailable:
                pass
            else:
                raise AssertionError('missing pinned version was served')
            unversioned = bucket+'-plain'
            s3.create_bucket(Bucket=unversioned)
            plain = S3Files(s3, unversioned)
            original = plain.put(data)
            assert original['version_id'] is None and plain.get(original) == data
            s3.put_object(Bucket=unversioned, Key=original['object_key'], Body=data+b'changed')
            try:
                plain.get(original)
            except StorageUnavailable:
                pass
            else:
                raise AssertionError('changed unversioned object was served')
            print('PASS: real S3 checksum rejection, conditional writes, pinned versions and changed/missing object rejection')
            with server(database, endpoint, bucket, access, secret) as api:
                status, result = request(api, 'POST', '/v1/login', {'name':'Owner','password':'owner test password'})
                assert status == 200
                a = result['token']
                status, result = request(api, 'POST', '/v1/login', {'name':'Reader','password':'reader test password'})
                assert status == 200
                b = result['token']
                status, result = request(api, 'POST', '/v1/documents', {'title':'S3 roundtrip'}, a)
                assert status == 201
                doc = result['id']; url = '/v1/documents/'+doc
                assert request(api, 'POST', url+'/members', {'userId':reader,'role':'reader'}, a)[0] == 200
                # An S3 success followed by a failed SQL binding leaves an orphan,
                # never a downloadable document. Do not silently delete the object.
                status, failed_doc = request(api, 'POST', '/v1/documents', {'title':'Failed binding'}, a)
                assert status == 201
                count = len(s3.list_object_versions(Bucket=bucket).get('Versions', []))
                with closing(sqlite3.connect(database)) as db, db:
                    db.execute("CREATE TRIGGER fail_binding BEFORE INSERT ON document_files BEGIN SELECT RAISE(ABORT,'test failure'); END")
                try:
                    assert request(api, 'PUT', '/v1/documents/'+failed_doc['id']+'/pdf', data, a, True) == (500, {'error':'internal error'})
                    assert request(api, 'GET', '/v1/documents/'+failed_doc['id']+'/pdf', token=a)[0] == 404
                    assert len(s3.list_object_versions(Bucket=bucket)['Versions']) == count+1
                finally:
                    with closing(sqlite3.connect(database)) as db, db:
                        db.execute('DROP TRIGGER fail_binding')
                before = s3.list_object_versions(Bucket=bucket).get('Versions', [])
                status, metadata = request(api, 'PUT', url+'/pdf', data, a, True)
                assert status == 200 and metadata == {'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)}
                assert request(api, 'PUT', url+'/pdf', data, a, True) == (200, metadata)
                assert len(s3.list_object_versions(Bucket=bucket)['Versions']) == len(before)+1
                assert request(api, 'PUT', url+'/pdf', data+b'changed', a, True)[0] == 409
                assert request(api, 'PUT', url+'/pdf', data, b, True)[0] == 403
                assert request(api, 'GET', url+'/pdf', token=b) == (200, data)
                event = {'id':'e','ann':'a','op':'create','base':None,'data':{'id':'a','page':1,'type':'textbox','text':'Shared review'}}
                assert request(api, 'POST', url+'/events', event, a)[0] == 200
                snapshot = request(api, 'GET', url, token=b)
                assert snapshot[0] == 200 and snapshot[1]['cursor'] == 1
                assert request(api, 'POST', url+'/members', {'userId':reader,'role':None}, a)[0] == 200
                assert request(api, 'GET', url+'/pdf', token=b)[0] == 403
                assert request(api, 'POST', url+'/members', {'userId':reader,'role':'reader'}, a)[0] == 200
                if native_probe:
                    config = {'server':f'http://127.0.0.1:{api}', 'ownerPassword':'owner test password',
                              'readerPassword':'reader test password', 'readerId':reader, 'pdf':list(data)}
                    result = subprocess.run([str(Path(native_probe).resolve(strict=True))],
                        input=json.dumps(config), text=True, capture_output=True, timeout=60)
                    assert result.returncode == 0, result.stderr
                    print(result.stdout.strip())
            # Both writers stopped for an offline joint backup. Version IDs and keys
            # are retained by the objectstore's own data snapshot, not recreated via PUT.
            backup(Store(database), root/'database.backup')
        shutil.copytree(storage, root/'objects.backup')
        shutil.copy2(root/'database.backup', root/'restored.db')
        shutil.copytree(root/'objects.backup', root/'restored-objects')
        with objectstore(binary, root/'restored-objects', access, secret) as (_, endpoint):
            with server(root/'restored.db', endpoint, bucket, access, secret) as api:
                assert request(api, 'GET', url, token=b) == snapshot
                assert request(api, 'GET', url+'/pdf', token=b) == (200, data)
                assert request(api, 'POST', '/v1/login', {'name':'Owner','password':'owner test password'})[0] == 200
        print('PASS: two-client HTTP PDF roundtrip, idempotency, failed-SQL orphan isolation, immutable binding, ACL and joint offline SQLite/S3 restore')


if __name__ == '__main__':
    if len(sys.argv) not in (2, 3):
        raise SystemExit('usage: objectstore_integration.py LOCAL_MINIO_BINARY [NATIVE_PROBE]')
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
