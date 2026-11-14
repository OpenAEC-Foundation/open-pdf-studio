"""The isolated S3 probe must not confuse HTTP liveness with S3 readiness."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, EndpointConnectionError, ReadTimeoutError
from botocore.stub import Stubber

sys.path.insert(0, str(Path(__file__).resolve().parent))
import objectstore_integration as probe


class ObjectstoreReadinessTests(unittest.TestCase):
    def setUp(self):
        self.process = Mock()
        self.process.poll.return_value = None
        self.addCleanup(patch.stopall)
        patch.object(probe.subprocess, 'Popen', return_value=self.process).start()
        # Reproduce the CI race: HTTP liveness is already green while S3 is not.
        connection = Mock()
        connection.getresponse.return_value.status = 200
        patch.object(probe.http.client, 'HTTPConnection', return_value=connection).start()
        self.sleep = patch.object(probe.time, 'sleep').start()
        self.client = boto3.client('s3', endpoint_url='http://127.0.0.1:1',
            aws_access_key_id='test', aws_secret_access_key='test', region_name='us-east-1',
            config=Config(retries={'total_max_attempts': 1}))
        self.addCleanup(self.client.close)
        patch.object(probe.boto3, 'client', return_value=self.client).start()
        self.close = patch.object(self.client, 'close', wraps=self.client.close).start()

    def test_live_but_uninitialized_waits_before_creating_bucket(self):
        with Stubber(self.client) as stub:
            stub.add_client_error('list_buckets', service_error_code='XMinioServerNotInitialized', http_status_code=503)
            stub.add_response('list_buckets', {'Buckets': []}, {})
            stub.add_response('create_bucket', {}, {'Bucket': 'test-bucket'})
            with probe.objectstore('test-minio', Path('test-data'), 'test', 'test') as (client, _):
                client.create_bucket(Bucket='test-bucket')
            stub.assert_no_pending_responses()
        self.sleep.assert_called_once()
        self.process.terminate.assert_called_once()
        self.close.assert_called_once()

    def test_connection_and_read_timeout_only_delay_startup(self):
        errors = [EndpointConnectionError(endpoint_url='http://127.0.0.1:1'),
                  ReadTimeoutError(endpoint_url='http://127.0.0.1:1')]
        with patch.object(self.client, 'list_buckets', side_effect=[*errors, {}]) as ready:
            with probe.objectstore('test-minio', Path('test-data'), 'test', 'test'):
                self.assertEqual(ready.call_count, 3)
        self.assertEqual(self.sleep.call_count, 2)

    def test_authentication_and_unexpected_service_errors_fail_immediately(self):
        for code in ['AccessDenied', 'InvalidAccessKeyId', 'InternalError']:
            with self.subTest(code=code), Stubber(self.client) as stub:
                stub.add_client_error('list_buckets', service_error_code=code, http_status_code=403)
                with self.assertRaises(ClientError) as caught:
                    with probe.objectstore('test-minio', Path('test-data'), 'test', 'test'):
                        self.fail('unready store was yielded')
                self.assertEqual(caught.exception.response['Error']['Code'], code)
                stub.assert_no_pending_responses()
        self.sleep.assert_not_called()
        self.assertEqual(self.process.terminate.call_count, 3)
        self.assertEqual(self.close.call_count, 3)

    def test_deadline_counts_request_time_and_cleans_up(self):
        clock = [0.0]
        def not_ready():
            clock[0] += 7
            raise ClientError({'Error': {'Code': 'XMinioServerNotInitialized'}}, 'ListBuckets')
        with patch.object(probe.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(self.client, 'list_buckets', side_effect=not_ready) as ready:
            with self.assertRaisesRegex(AssertionError, 'readiness deadline exceeded'):
                with probe.objectstore('test-minio', Path('test-data'), 'test', 'test'):
                    self.fail('unready store was yielded')
            self.assertEqual(ready.call_count, 3)
        self.process.terminate.assert_called_once()
        self.close.assert_called_once()

    def test_child_exit_fails_before_s3_probe_and_closes_client(self):
        self.process.poll.return_value = 1
        with patch.object(self.client, 'list_buckets') as ready:
            with self.assertRaisesRegex(AssertionError, 'test child exited'):
                with probe.objectstore('test-minio', Path('test-data'), 'test', 'test'):
                    self.fail('dead child was yielded')
            ready.assert_not_called()
        self.process.terminate.assert_not_called()
        self.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
