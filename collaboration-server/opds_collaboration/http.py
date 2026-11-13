"""Bounded JSON/long-poll WSGI adapter. Deployment and file storage are separate.

Use a production WSGI server behind TLS with request/read timeouts. No public
account provisioning, cookies, query-string tokens or cross-origin API access.
"""
from collections import deque
import hashlib
from http import HTTPStatus
import json
import re
import sqlite3
import threading
import time
import unicodedata
from urllib.parse import parse_qsl

from .store import Conflict, Denied, Invalid, MAX_EVENT_BYTES
from .files import FileMissing, StorageUnavailable, MAX_PDF_BYTES


class HTTPError(Exception):
    def __init__(self, status, message, *, headers=()):
        self.status, self.body = status, {"error": message}
        self.headers = list(headers)


class LoginLimiter:
    """Per-process, bounded IP AND account budgets; forwarding headers ignored."""
    def __init__(self, *, attempts=10, window=60, capacity=10000, clock=time.monotonic):
        self.attempts, self.window, self.capacity, self.clock = attempts, window, capacity, clock
        self.entries = {}
        self.lock = threading.Lock()

    def check(self, address, name):
        name = unicodedata.normalize("NFC", name).strip().casefold()
        keys = ["ip:" + address, "user:" + name]
        keys = [hashlib.sha256(k.encode("utf-8", errors="replace")).digest() for k in keys]
        now = self.clock()
        with self.lock:
            for key, attempts in list(self.entries.items()):
                while attempts and attempts[0] <= now - self.window:
                    attempts.popleft()
                if not attempts:
                    del self.entries[key]
            missing = sum(key not in self.entries for key in keys)
            if len(self.entries) + missing > self.capacity or any(
                    len(self.entries.get(key, ())) >= self.attempts for key in keys):
                raise HTTPError(429, "login rate exceeded")
            for key in keys:
                self.entries.setdefault(key, deque()).append(now)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Invalid("duplicate JSON key")
        result[key] = value
    return result


def _constant(value):
    raise Invalid("non-finite JSON number")


def _raw_body(env, maximum, content_type):
    length = env.get("CONTENT_LENGTH", "")
    if not re.fullmatch(r"[0-9]{1,10}", length):
        raise HTTPError(411, "valid Content-Length required")
    length = int(length)
    if length > maximum:
        raise HTTPError(413, "request too large")
    if env.get("HTTP_TRANSFER_ENCODING") or env.get("HTTP_CONTENT_ENCODING"):
        raise HTTPError(415, "encoded request bodies unsupported")
    if env.get("CONTENT_TYPE", "").lower() != content_type:
        raise HTTPError(415, content_type + " required")
    raw = env["wsgi.input"].read(length)
    if len(raw) != length:
        raise Invalid("incomplete request body")
    return raw


def _body(env, keys):
    raw = _raw_body(env, MAX_EVENT_BYTES, "application/json")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_object, parse_constant=_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise Invalid("invalid JSON body") from exc
    if type(value) is not dict or set(value) != set(keys):
        raise Invalid("unexpected request fields")
    return value


def _query(env, allowed=(), *, document_cursor=False):
    query = env.get("QUERY_STRING", "")
    # Python 3.10 treats an empty query as a malformed field in strict mode.
    # An absent query is valid; retain strict parsing for nonempty input.
    if not query:
        return {}
    if len(query) > 1024:
        raise Invalid("query too long")
    try:
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=True, max_num_fields=3)
    except ValueError as exc:
        raise Invalid("invalid query") from exc
    result = {}
    for key, value in pairs:
        if key not in allowed or key in result:
            raise Invalid("unexpected query fields")
        if document_cursor and key == "after":
            if not re.fullmatch(r"[a-f0-9]{32}", value):
                raise Invalid("invalid document cursor")
            result[key] = value
            continue
        if not re.fullmatch(r"[0-9]{1,16}", value):
            raise Invalid("query values must be unsigned integers")
        result[key] = int(value)
    return result


class Application:
    def __init__(self, store, *, files=None, limiter=None, max_waiters=32, poll_interval=0.25):
        if max_waiters < 1 or not 0 < poll_interval <= 1:
            raise ValueError("invalid polling configuration")
        self.store = store
        self.files = files
        self.limiter = limiter if limiter is not None else LoginLimiter()
        self.waiters = threading.BoundedSemaphore(max_waiters)
        self.poll_interval = poll_interval

    def __call__(self, env, start_response):
        extra_headers = []
        try:
            status, body = self.dispatch(env)
        except HTTPError as exc:
            status, body = exc.status, exc.body
            extra_headers = exc.headers
        except Denied:
            status, body = 403, {"error": "access denied"}
        except Invalid as exc:
            status, body = 400, {"error": str(exc)}
        except Conflict as exc:
            status, body = 409, {"error": "conflicting event", "current": exc.current}
        except FileMissing:
            status, body = 404, {"error": "PDF not uploaded"}
        except (sqlite3.OperationalError, StorageUnavailable):
            status, body = 503, {"error": "storage unavailable"}
        except Exception:
            # Never expose SQL, file paths, request bodies or credentials.
            status, body = 500, {"error": "internal error"}
        binary = type(body) is bytes
        data = body if binary else json.dumps(body, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("utf-8")
        headers = [("Content-Type", "application/pdf" if binary else "application/json"), ("Content-Length", str(len(data))),
                   ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")] + extra_headers
        if binary:
            headers.append(("Content-Disposition", 'attachment; filename="document.pdf"'))
        if status in (429, 503):
            headers.append(("Retry-After", "60" if status == 429 else "1"))
        if status == 401:
            headers.append(("WWW-Authenticate", "Bearer"))
        start_response(f"{status} {HTTPStatus(status).phrase}", headers)
        return [data]

    def dispatch(self, env):
        # No CORS until an explicit trusted-origin deployment policy exists.
        if env.get("HTTP_ORIGIN"):
            raise HTTPError(403, "cross-origin requests unsupported")
        path, method = env.get("PATH_INFO", ""), env.get("REQUEST_METHOD", "")
        match = re.fullmatch(r"/v1/documents/([a-f0-9]{32})(?:/(events|members|members-by-name|pdf))?", path)
        routes = {"/v1/login": "POST", "/v1/logout": "POST", "/v1/documents": "GET POST"}
        allowed = routes.get(path)
        if match:
            allowed = "GET" if match[2] is None else ({"events": "GET POST", "pdf": "GET PUT", "members": "POST", "members-by-name": "POST"}[match[2]])
        if allowed is None:
            raise HTTPError(404, "endpoint unavailable")
        if method not in allowed.split():
            raise HTTPError(405, "method unsupported", headers=[("Allow", ", ".join(allowed.split()))])
        inventory = path == "/v1/documents" and method == "GET"
        if inventory:
            query = _query(env, ("after", "limit"), document_cursor=True)
        else:
            event_query = match and match[2] == "events" and method == "GET"
            query = _query(env, ("after", "limit", "wait") if event_query else ())
        if path == "/v1/login":
            body = _body(env, ("name", "password"))
            if not isinstance(body["name"], str) or len(body["name"]) > 128:
                raise Invalid("invalid name")
            self.limiter.check(env.get("REMOTE_ADDR", "unknown"), body["name"])
            try:
                return 200, {"token": self.store.login(body["name"], body["password"])}
            except Denied as exc:
                raise HTTPError(401, "invalid credentials") from exc
        auth = env.get("HTTP_AUTHORIZATION", "")
        if not re.fullmatch(r"Bearer [A-Za-z0-9_-]{43}", auth):
            raise HTTPError(401, "bearer session required")
        token = auth[7:]
        if path == "/v1/logout":
            _body(env, ())
            self.store.logout(token)
            return 200, {"ok": True}
        if inventory:
            return 200, self.store.list_documents(token, after=query.get("after", ""), limit=query.get("limit", 100))
        if path == "/v1/documents":
            body = _body(env, ("title",))
            return 201, {"id": self.store.create_document(token, body["title"])}
        doc, action = match.groups()
        if action == "pdf":
            if self.files is None:
                raise HTTPError(503, "PDF storage not configured")
            # Reject unauthorized uploads before reading their request body.
            self.store.file_info(token, doc, owner=method == "PUT")
            if method == "GET":
                return 200, self.files.download(token, doc)
            data = _raw_body(env, MAX_PDF_BYTES, "application/pdf")
            return 200, self.files.upload(token, doc, data)
        if action is None:
            return 200, self.store.snapshot(token, doc)
        if action == "members-by-name":
            body = _body(env, ("name", "role"))
            user_id = self.store.grant_by_name(token, doc, body["name"], body["role"])
            return 200, {"ok": True, "userId": user_id}
        if action == "members":
            body = _body(env, ("userId", "role"))
            if not isinstance(body["userId"], str) or not re.fullmatch(r"[a-f0-9]{32}", body["userId"]):
                raise Invalid("invalid user identifier")
            self.store.grant(token, doc, body["userId"], body["role"])
            return 200, {"ok": True}
        if method == "POST":
            return 200, self.store.append(token, doc, _body(env, ("id", "ann", "op", "base", "data")))
        after, limit, wait = query.get("after", 0), query.get("limit", 100), query.get("wait", 0)
        if not 0 <= wait <= 25 or not 1 <= limit <= 100:
            raise Invalid("wait must be 0..25 and limit 1..100")
        result = self.store.replay(token, doc, after=after, limit=limit)
        if result["events"] or wait == 0:
            return 200, result
        if not self.waiters.acquire(blocking=False):
            raise HTTPError(503, "poll capacity reached")
        try:
            deadline = time.monotonic() + wait
            while True:
                time.sleep(min(self.poll_interval, max(0, deadline - time.monotonic())))
                # Fresh transaction rechecks session/ACL on every poll, including
                # timeout; writes from other processes become visible as well.
                result = self.store.replay(token, doc, after=after, limit=limit)
                if result["events"] or time.monotonic() >= deadline:
                    return 200, result
        finally:
            self.waiters.release()
