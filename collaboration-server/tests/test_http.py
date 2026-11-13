"""Actual loopback HTTP clients plus adversarial WSGI boundary requests."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import io
import json
from pathlib import Path
from socketserver import ThreadingMixIn
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server
from wsgiref.validate import validator

from opds_collaboration.http import Application, HTTPError, LoginLimiter
from opds_collaboration.store import Store, MAX_EVENT_BYTES

PASSWORD = "correct horse battery"


class Server(ThreadingMixIn, WSGIServer):
    # Join request threads at server_close before temporary DB cleanup on Windows.
    daemon_threads = False


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "test.db"
        self.store = Store(self.path)
        self.alice = self.store.create_user("Alice", PASSWORD)
        self.bob = self.store.create_user("Bob", PASSWORD)
        self.app = Application(self.store, poll_interval=0.02)
        self.server = make_server("127.0.0.1", 0, validator(self.app), Server, QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02})
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.a = self.login("Alice")
        self.b = self.login("Bob")
        status, _, body = self.request("POST", "/v1/documents", self.a, {"title": "Drawing"})
        self.assertEqual(status, 201)
        self.doc = body["id"]
        self.url = "/v1/documents/" + self.doc

    def stop_server(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()

    def request(self, method, path, token=None, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            headers = dict(headers or {})
            if token:
                headers["Authorization"] = "Bearer " + token
            if body is not None:
                body = json.dumps(body).encode("utf-8")
                headers["Content-Type"] = "application/json"
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), json.loads(response.read())
        finally:
            connection.close()

    def login(self, name):
        status, headers, body = self.request("POST", "/v1/login", body={"name": name, "password": PASSWORD})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        return body["token"]

    def grant(self, role):
        status, _, _ = self.request("POST", self.url + "/members", self.a, {"userId": self.bob, "role": role})
        self.assertEqual(status, 200)

    @staticmethod
    def event(event_id="e1", op="create", base=None):
        return {"id": event_id, "ann": "ann1", "op": op, "base": base,
                "data": None if op == "delete" else {"id": "ann1", "type": "textbox", "page": 1, "text": event_id}}

    def waiting(self, executor, token, after=0):
        # Signal from the initial authenticated replay, so the test doesn't rely
        # on scheduling a fixed sleep before writing/revoking/expiring access.
        entered = threading.Event()
        original = self.store.replay
        def observed(*args, **kwargs):
            result = original(*args, **kwargs)
            entered.set()
            return result
        observer = patch.object(self.store, "replay", side_effect=observed)
        observer.start()
        self.addCleanup(observer.stop)
        future = executor.submit(self.request, "GET", self.url + f"/events?after={after}&wait=3", token)
        self.assertTrue(entered.wait(2))
        return future

    def test_two_clients_live_events_retry_conflict_and_reconnect(self):
        self.grant("editor")
        with ThreadPoolExecutor() as pool:
            future = self.waiting(pool, self.b)
            created = self.request("POST", self.url + "/events", self.a, self.event())
            self.assertEqual(created[0], 200)
            received = future.result(4)
        self.assertEqual(received[0], 200)
        self.assertEqual(received[2]["events"], [created[2]])
        self.assertEqual(self.request("POST", self.url + "/events", self.a, self.event())[2], created[2])
        edited = self.request("POST", self.url + "/events", self.b, self.event("e2", "edit", "e1"))
        self.assertEqual(edited[0], 200)
        stale = self.request("POST", self.url + "/events", self.a, self.event("stale", "edit", "e1"))
        self.assertEqual(stale[0], 409)
        self.assertEqual(stale[2]["current"], "e2")
        first = self.request("GET", self.url + "/events?limit=1", self.b)[2]
        second = self.request("GET", self.url + f'/events?after={first["cursor"]}', self.b)[2]
        self.assertTrue(first["hasMore"])
        self.assertEqual(second["events"], [edited[2]])
        self.assertEqual(self.request("GET", self.url, self.a)[2]["cursor"], 2)

    def test_long_poll_sees_independent_store_connection(self):
        self.grant("reader")
        with ThreadPoolExecutor() as pool:
            future = self.waiting(pool, self.b)
            Store(self.path).append(self.a, self.doc, self.event())
            self.assertEqual(future.result(4)[2]["cursor"], 1)

    def test_revocation_while_waiting_and_read_only_writer(self):
        self.grant("reader")
        self.assertEqual(self.request("POST", self.url + "/events", self.b, self.event())[0], 403)
        self.assertEqual(self.request("POST", self.url + "/members", self.b, {"userId": self.alice, "role": "reader"})[0], 403)
        with ThreadPoolExecutor() as pool:
            future = self.waiting(pool, self.b)
            self.grant(None)
            self.assertEqual(future.result(4)[0], 403)
        self.assertEqual(self.request("GET", self.url, self.b)[0], 403)
        self.assertTrue(self.app.waiters.acquire(False))
        self.app.waiters.release()

    def test_logout_and_expiry_while_waiting(self):
        self.grant("reader")
        with ThreadPoolExecutor() as pool:
            future = self.waiting(pool, self.b)
            self.assertEqual(self.request("POST", "/v1/logout", self.b, {})[0], 200)
            self.assertEqual(future.result(4)[0], 403)
        self.b = self.login("Bob")
        with ThreadPoolExecutor() as pool:
            future = self.waiting(pool, self.b)
            self.store.clock = lambda: time.time() + 9 * 3600
            self.assertEqual(future.result(4)[0], 403)

    def test_timeout_and_poll_capacity_are_bounded_and_released(self):
        self.app.waiters = threading.BoundedSemaphore(1)
        self.assertTrue(self.app.waiters.acquire(False))
        busy = self.request("GET", self.url + "/events?wait=1", self.a)
        self.assertEqual(busy[0], 503)
        self.assertEqual(busy[1]["Retry-After"], "1")
        self.app.waiters.release()
        start = time.monotonic()
        response = self.request("GET", self.url + "/events?wait=1", self.a)
        self.assertEqual(response[0], 200)
        self.assertEqual(response[2]["events"], [])
        self.assertGreaterEqual(time.monotonic() - start, 1)
        self.assertTrue(self.app.waiters.acquire(False))
        self.app.waiters.release()
        with patch.object(self.store, "replay", side_effect=[{"events": []}, sqlite3.OperationalError("secret DB path")]):
            self.assertEqual(self.request("GET", self.url + "/events?wait=1", self.a)[0], 503)
        self.assertTrue(self.app.waiters.acquire(False))
        self.app.waiters.release()

    def test_routes_auth_query_and_origin(self):
        self.assertEqual(self.request("GET", self.url)[0], 401)
        self.assertEqual(self.request("GET", self.url, headers={"Cookie": "token=" + self.a})[0], 401)
        for query in ("token=" + self.a, "after=-1", "after=1&after=1", "wait=26", "limit=101", "after=1", "after=1.5", "after=", "after=%FF"):
            with self.subTest(query=query):
                self.assertEqual(self.request("GET", self.url + "/events?" + query, self.a)[0], 400)
        self.assertEqual(self.request("GET", self.url, self.a, headers={"Origin": "https://untrusted.example"})[0], 403)
        self.assertEqual(self.request("POST", "/v1/users", body={})[0], 404)
        wrong_method = self.request("GET", "/v1/login")
        self.assertEqual(wrong_method[0], 405)
        self.assertEqual(wrong_method[1]["Allow"], "POST")
        self.assertEqual(self.request("GET", "/v1/documents/" + "0" * 32, self.a)[0], 403)
        for body in ({"userId": [], "role": "editor"}, {"userId": self.bob, "role": []}):
            self.assertEqual(self.request("POST", self.url + "/members", self.a, body)[0], 400)

    def test_login_failures_rate_limit_and_storage_errors(self):
        self.app.limiter = LoginLimiter(attempts=1)
        invalid = {"name": "missing", "password": PASSWORD}
        self.assertEqual(self.request("POST", "/v1/login", body=invalid)[0], 401)
        limited = self.request("POST", "/v1/login", body=invalid, headers={"X-Forwarded-For": "different"})
        self.assertEqual(limited[0], 429)
        self.assertEqual(limited[1]["Retry-After"], "60")
        with patch.object(self.store, "snapshot", side_effect=sqlite3.OperationalError("private path")):
            self.assertEqual(self.request("GET", self.url, self.a)[2], {"error": "storage unavailable"})
        with patch.object(self.store, "snapshot", side_effect=RuntimeError("secret token")):
            self.assertEqual(self.request("GET", self.url, self.a)[2], {"error": "internal error"})


class BoundaryTests(unittest.TestCase):
    def call(self, raw=b'{}', **overrides):
        env = {"REQUEST_METHOD": "POST", "PATH_INFO": "/v1/login", "QUERY_STRING": "",
               "CONTENT_LENGTH": str(len(raw)), "CONTENT_TYPE": "application/json", "wsgi.input": io.BytesIO(raw)}
        env.update(overrides)
        status = []
        body = Application(None)(env, lambda s, h: status.append(int(s.split()[0])))
        return status[0], json.loads(b"".join(body))

    def test_body_limit_precedes_read_and_ambiguous_encodings_rejected(self):
        class Unreadable:
            def read(self, n):
                raise AssertionError("oversized body was read")
        self.assertEqual(self.call(CONTENT_LENGTH=str(MAX_EVENT_BYTES + 1), **{"wsgi.input": Unreadable()})[0], 413)
        for length in ("", "-1", "1,2", "999999999999999999999999999999"):
            self.assertEqual(self.call(CONTENT_LENGTH=length)[0], 411)
        self.assertEqual(self.call(HTTP_TRANSFER_ENCODING="chunked")[0], 415)
        self.assertEqual(self.call(HTTP_CONTENT_ENCODING="gzip")[0], 415)
        self.assertEqual(self.call(CONTENT_TYPE="text/plain")[0], 415)
        self.assertEqual(self.call(CONTENT_LENGTH="20")[0], 400)

    def test_invalid_json_duplicates_unicode_depth_and_fields(self):
        for raw in (b'{"name":"a","name":"b","password":"x"}', b'NaN', b'[]', b'{', b'\xff',
                    b'[' * 1500 + b']' * 1500, b'{"name":NaN,"password":"x"}',
                    b'{"name":"a","password":"b","admin":true}'):
            with self.subTest(raw=raw[:80]):
                self.assertEqual(self.call(raw)[0], 400)

    def test_limiter_account_ip_capacity_and_expiry(self):
        now = [10]
        limiter = LoginLimiter(attempts=1, capacity=4, clock=lambda: now[0])
        limiter.check("ip1", "Álice")
        with self.assertRaises(HTTPError):
            limiter.check("ip2", " A\u0301LICE ")
        with self.assertRaises(HTTPError):
            limiter.check("ip1", "other")
        limiter.check("ip3", "Bob")
        with self.assertRaises(HTTPError):
            limiter.check("ip4", "Carol")
        self.assertEqual(len(limiter.entries), 4)
        now[0] += 61
        limiter.check("ip4", "Carol")
        self.assertEqual(len(limiter.entries), 2)
