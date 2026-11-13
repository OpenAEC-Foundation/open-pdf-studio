"""Durable PDF binding, failure boundaries and real SDK request contracts."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import io
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch

import boto3
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber

from opds_collaboration.files import Documents, S3Files, StorageUnavailable, FileMissing, MAX_PDF_BYTES
from opds_collaboration.store import Store, Denied, Conflict, Invalid

PDF = b'%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'


class MemoryObjects:
    def __init__(self):
        self.values = {}
        self.hook = lambda: None

    def put(self, data):
        key = uuid.uuid4().hex
        self.values[key] = data
        self.hook()
        return {"bucket": "test", "object_key": key, "sha256": hashlib.sha256(data).hexdigest(),
                "size": len(data), "etag": '"etag"', "version_id": None}

    def get(self, info):
        self.hook()
        return self.values[info['object_key']]


class DocumentFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'test.db'
        self.store = Store(self.path)
        self.owner = self.store.create_user('Owner', 'long enough password')
        self.reader = self.store.create_user('Reader', 'long enough password')
        self.a = self.store.login('Owner', 'long enough password')
        self.b = self.store.login('Reader', 'long enough password')
        self.doc = self.store.create_document(self.a, 'Drawing')
        self.objects = MemoryObjects()
        self.files = Documents(self.store, self.objects)

    def test_immutable_binding_retry_restart_and_read_permissions(self):
        result = self.files.upload(self.a, self.doc, PDF)
        self.assertEqual(result, {'sha256': hashlib.sha256(PDF).hexdigest(), 'size': len(PDF)})
        self.assertEqual(self.files.upload(self.a, self.doc, PDF), result)
        self.assertEqual(len(self.objects.values), 1)
        with self.assertRaises(Conflict):
            self.files.upload(self.a, self.doc, PDF + b'changed')
        with self.assertRaises(Denied):
            self.files.download(self.b, self.doc)
        self.store.grant(self.a, self.doc, self.reader, 'reader')
        self.assertEqual(Documents(Store(self.path), self.objects).download(self.b, self.doc), PDF)
        with self.assertRaises(Denied):
            self.files.upload(self.b, self.doc, PDF)
        self.store.grant(self.a, self.doc, self.reader, None)
        with self.assertRaises(Denied):
            self.files.download(self.b, self.doc)

    def test_failed_put_and_failed_sql_never_publish_binding(self):
        with patch.object(self.objects, 'put', side_effect=StorageUnavailable):
            with self.assertRaises(StorageUnavailable):
                self.files.upload(self.a, self.doc, PDF)
        self.assertIsNone(self.store.file_info(self.a, self.doc))
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TRIGGER fail_file BEFORE INSERT ON document_files BEGIN SELECT RAISE(ABORT,'injected'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.files.upload(self.a, self.doc, PDF)
        self.assertIsNone(self.store.file_info(self.a, self.doc))
        self.assertEqual(len(self.objects.values), 1)  # orphan is not a usable document
        with self.assertRaises(FileMissing):
            self.files.download(self.a, self.doc)

    def test_session_revoked_during_upload_cannot_publish(self):
        self.objects.hook = lambda: self.store.logout(self.a)
        with self.assertRaises(Denied):
            self.files.upload(self.a, self.doc, PDF)
        token = self.store.login('Owner', 'long enough password')
        self.assertIsNone(self.store.file_info(token, self.doc))

    def test_reader_revoked_during_download_gets_no_bytes(self):
        self.files.upload(self.a, self.doc, PDF)
        self.store.grant(self.a, self.doc, self.reader, 'reader')
        self.objects.hook = lambda: self.store.grant(self.a, self.doc, self.reader, None)
        with self.assertRaises(Denied):
            self.files.download(self.b, self.doc)

    def test_annotated_review_cannot_acquire_different_base_pdf(self):
        self.store.append(self.a, self.doc, {'id': 'e', 'ann': 'a', 'op': 'create', 'base': None,
            'data': {'id': 'a', 'type': 'textbox', 'page': 1}})
        with self.assertRaises(Conflict):
            self.files.upload(self.a, self.doc, PDF)
        self.assertEqual(self.objects.values, {})

    def test_annotation_during_upload_prevents_late_binding(self):
        self.objects.hook = lambda: self.store.append(self.a, self.doc, {'id': 'e', 'ann': 'a', 'op': 'create', 'base': None,
            'data': {'id': 'a', 'type': 'textbox', 'page': 1}})
        with self.assertRaises(Conflict):
            self.files.upload(self.a, self.doc, PDF)
        self.assertIsNone(self.store.file_info(self.a, self.doc))

    def test_concurrent_different_uploads_publish_only_one(self):
        barrier = threading.Barrier(2)
        original = self.objects.put
        def put(data):
            value = original(data)
            barrier.wait(timeout=3)
            return value
        def upload(data):
            try:
                return self.files.upload(self.a, self.doc, data)
            except Conflict:
                return None
        with patch.object(self.objects, 'put', side_effect=put), ThreadPoolExecutor() as pool:
            results = list(pool.map(upload, [PDF, PDF + b'changed']))
        accepted = [r for r in results if r is not None]
        self.assertEqual(len(accepted), 1)
        data = self.files.download(self.a, self.doc)
        self.assertEqual(hashlib.sha256(data).hexdigest(), accepted[0]['sha256'])

    def test_concurrent_identical_uploads_share_binding(self):
        barrier = threading.Barrier(2)
        original = self.objects.put
        def put(data):
            value = original(data)
            barrier.wait(timeout=3)
            return value
        with patch.object(self.objects, 'put', side_effect=put), ThreadPoolExecutor() as pool:
            results = list(pool.map(lambda _: self.files.upload(self.a, self.doc, PDF), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.files.download(self.a, self.doc), PDF)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM document_files').fetchone()[0], 1)

    def test_invalid_pdf_unauthorized_and_missing_do_not_access_objects(self):
        for data in (b'', b'not PDF', PDF + b' ' * MAX_PDF_BYTES):
            with self.assertRaises(Invalid):
                self.files.upload(self.a, self.doc, data)
        with self.assertRaises(Denied):
            self.files.upload(self.b, self.doc, PDF)
        with self.assertRaises(FileMissing):
            self.files.download(self.a, self.doc)
        self.assertEqual(self.objects.values, {})

    def test_schema_one_migrates_without_changing_review_or_credentials(self):
        self.store.append(self.a, self.doc, {'id': 'e', 'ann': 'a', 'op': 'create', 'base': None,
            'data': {'id': 'a', 'type': 'textbox', 'page': 1}})
        before = self.store.snapshot(self.a, self.doc)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('DROP TABLE document_files')
            db.execute('PRAGMA user_version=1')
        migrated = Store(self.path)
        self.assertEqual(migrated.snapshot(self.a, self.doc), before)
        self.assertIsNone(migrated.file_info(self.a, self.doc))
        self.assertTrue(migrated.login('Owner', 'long enough password'))
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 2)


def client():
    # Explicit dummy credentials and region: tests never use ambient AWS config.
    return boto3.client('s3', region_name='us-east-1', aws_access_key_id='test',
                        aws_secret_access_key='test', endpoint_url='https://s3.invalid')


class S3ContractTests(unittest.TestCase):
    def setUp(self):
        self.client = client()
        self.addCleanup(self.client.close)
        self.stub = Stubber(self.client)
        self.stub.activate()
        self.addCleanup(self.stub.deactivate)
        self.objects = S3Files(self.client, 'test-bucket')
        self.info = {'bucket': 'test-bucket', 'object_key': 'reviews/key.pdf', 'size': len(PDF),
                     'sha256': hashlib.sha256(PDF).hexdigest(), 'etag': '"etag"', 'version_id': 'version-1'}

    def test_put_is_conditional_checksummed_and_pins_version(self):
        self.stub.add_response('put_object', {'ETag': '"etag"', 'VersionId': 'v1'}, {
            'Bucket': 'test-bucket', 'Key': ANY, 'Body': PDF, 'ContentType': 'application/pdf',
            'ContentLength': len(PDF), 'ChecksumSHA256': base64.b64encode(hashlib.sha256(PDF).digest()).decode(), 'IfNoneMatch': '*'})
        info = self.objects.put(PDF)
        self.assertEqual(info['version_id'], 'v1')
        self.assertEqual(info['sha256'], self.info['sha256'])
        self.assertRegex(info['object_key'], r'^reviews/[a-f0-9]{32}\.pdf$')
        self.stub.assert_no_pending_responses()

    def test_get_checks_version_etag_length_digest_and_closes_stream(self):
        for data in (PDF, PDF[:-1] + b'x', PDF[:-1], PDF + b'x'):
            raw = io.BytesIO(data)
            stream = StreamingBody(raw, len(data))
            self.stub.add_response('get_object', {'Body': stream, 'ContentLength': len(PDF)}, {
                'Bucket': 'test-bucket', 'Key': self.info['object_key'], 'VersionId': 'version-1', 'IfMatch': '"etag"'})
            if data == PDF:
                self.assertEqual(self.objects.get(self.info), PDF)
            else:
                with self.assertRaises(StorageUnavailable):
                    self.objects.get(self.info)
            self.assertTrue(raw.closed)
        self.stub.assert_no_pending_responses()

    def test_missing_version_unversioned_and_invalid_length(self):
        info = {**self.info, 'version_id': None}
        raw = io.BytesIO(PDF)
        self.stub.add_response('get_object', {'Body': StreamingBody(raw, len(PDF)), 'ContentLength': len(PDF)+1}, {
            'Bucket': 'test-bucket', 'Key': info['object_key'], 'IfMatch': '"etag"'})
        with self.assertRaises(StorageUnavailable):
            self.objects.get(info)
        self.assertTrue(raw.closed)
        with self.assertRaises(StorageUnavailable):
            self.objects.get({**info, 'bucket': 'other-bucket'})
        self.stub.assert_no_pending_responses()

    def test_s3_errors_do_not_fall_back_to_unconditional_requests(self):
        self.stub.add_client_error('put_object', 'PreconditionFailed', http_status_code=412)
        with self.assertRaises(StorageUnavailable):
            self.objects.put(PDF)
        self.stub.add_client_error('get_object', 'NoSuchVersion', http_status_code=404)
        with self.assertRaises(StorageUnavailable):
            self.objects.get(self.info)
        self.stub.assert_no_pending_responses()
