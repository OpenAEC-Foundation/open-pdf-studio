"""Transactional identities, document access and annotation events for #1067.

No network listener is exposed. create_user/set_disabled are local operator
methods; transports must not expose them as unauthenticated endpoints.
Every document operation authenticates its session inside the same transaction
as the access check and read/write. Client-supplied authors/clocks are rejected.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import unicodedata
import uuid

ITERATIONS = 600_000
SESSION_SECONDS = 8 * 60 * 60
MAX_EVENT_BYTES = 1024 * 1024
ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")


class Invalid(ValueError):
    pass


class Denied(PermissionError):
    pass


class Conflict(Exception):
    """A retry changed its payload, or an annotation has a newer revision."""
    def __init__(self, current=None):
        super().__init__("conflicting event")
        self.current = current


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
 salt BLOB NOT NULL, password_hash BLOB NOT NULL, disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
 document_id TEXT NOT NULL REFERENCES documents(id),
 user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('reader','editor')),
 PRIMARY KEY(document_id,user_id)
);
CREATE TABLE IF NOT EXISTS events (
 document_id TEXT NOT NULL REFERENCES documents(id), revision INTEGER NOT NULL,
 id TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id), request TEXT NOT NULL,
 event TEXT NOT NULL, PRIMARY KEY(document_id,revision), UNIQUE(document_id,id)
);
CREATE TABLE IF NOT EXISTS document_files (
 document_id TEXT PRIMARY KEY REFERENCES documents(id),
 bucket TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size > 0), etag TEXT NOT NULL, version_id TEXT
);
CREATE TABLE IF NOT EXISTS heads (
 document_id TEXT NOT NULL REFERENCES documents(id), ann TEXT NOT NULL,
 event_id TEXT NOT NULL, data TEXT, PRIMARY KEY(document_id,ann)
);
"""


def _name(value):
    if not isinstance(value, str):
        raise Invalid("name must be text")
    value = unicodedata.normalize("NFC", value).strip()
    if not 1 <= len(value) <= 128 or any(ord(c) < 32 for c in value):
        raise Invalid("invalid name")
    try:
        value.encode("utf-8")
    except UnicodeError as exc:
        raise Invalid("invalid name encoding") from exc
    return value, value.casefold()


def _password(value):
    try:
        encoded = value.encode("utf-8") if isinstance(value, str) else b""
    except UnicodeError as exc:
        raise Invalid("invalid password encoding") from exc
    if not 12 <= len(encoded) <= 1024:
        raise Invalid("password must contain 12 to 1024 UTF-8 bytes")
    return encoded


def _derive(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password, salt, ITERATIONS)


def _identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise Invalid("invalid event or annotation identifier")
    return value


def _json(value):
    # Only actual JSON data, bounded before SQL insertion. No NaN, Infinity,
    # Python objects or excessive nesting that can break replay in JS clients.
    def check(item, depth=0):
        if depth > 32:
            raise Invalid("snapshot too deeply nested")
        if item is None or type(item) in (str, bool, int):
            if type(item) is int and abs(item) > 2**53 - 1:
                raise Invalid("integer outside JavaScript safe range")
            return
        if type(item) is float and math.isfinite(item):
            return
        if type(item) is list:
            for child in item:
                check(child, depth + 1)
            return
        if type(item) is dict and all(type(k) is str for k in item):
            if {"__proto__", "constructor", "prototype"}.intersection(item):
                raise Invalid("unsafe JavaScript object key")
            for child in item.values():
                check(child, depth + 1)
            return
        raise Invalid("snapshot must be finite JSON data")
    check(value)
    try:
        result = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        if len(result.encode("utf-8")) > MAX_EVENT_BYTES:
            raise Invalid("snapshot too large")
        return result
    except (ValueError, UnicodeError) as exc:
        raise Invalid("invalid JSON snapshot") from exc


class Store:
    def __init__(self, path, *, clock=time.time):
        self.path = str(Path(path))
        self.clock = clock
        # New databases contain credentials; preserve existing file permissions.
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2):
                raise Invalid("unsupported database schema version")
            # One atomic migration; executescript commits any prior transaction.
            db.executescript("BEGIN IMMEDIATE;" + SCHEMA + "PRAGMA user_version=2; COMMIT;")

    @contextmanager
    def _connection(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def _tx(self, *, write=False):
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def create_user(self, name, password):
        """Local operator provisioning only; no public self-registration."""
        name, key = _name(name)
        salt = secrets.token_bytes(32)
        digest = _derive(_password(password), salt)
        user = uuid.uuid4().hex
        with self._tx(write=True) as db:
            try:
                db.execute("INSERT INTO users(id,name,name_key,salt,password_hash) VALUES(?,?,?,?,?)",
                           (user, name, key, salt, digest))
            except sqlite3.IntegrityError as exc:
                raise Invalid("user already exists") from exc
        return user

    def set_disabled(self, user, disabled):
        """Local operator action; disabling immediately invalidates all sessions."""
        if type(disabled) is not bool:
            raise Invalid("disabled must be boolean")
        with self._tx(write=True) as db:
            if db.execute("UPDATE users SET disabled=? WHERE id=?", (disabled, user)).rowcount != 1:
                raise Invalid("unknown user")
            if disabled:
                db.execute("DELETE FROM sessions WHERE user_id=?", (user,))

    def login(self, name, password):
        try:
            _, key = _name(name)
            encoded = _password(password)
        except (Invalid, UnicodeError) as exc:
            raise Denied("invalid credentials") from exc
        with self._tx() as db:
            user = db.execute("SELECT * FROM users WHERE name_key=?", (key,)).fetchone()
        # Unknown names still incur a password derivation. Network transports
        # must additionally rate-limit attempts before invoking this method.
        digest = _derive(encoded, user["salt"] if user else b"\0" * 32)
        if not user or not secrets.compare_digest(digest, user["password_hash"]) or user["disabled"]:
            raise Denied("invalid credentials")
        token = secrets.token_urlsafe(32)
        with self._tx(write=True) as db:
            if db.execute("SELECT disabled FROM users WHERE id=?", (user["id"],)).fetchone()[0]:
                raise Denied("invalid credentials")
            db.execute("DELETE FROM sessions WHERE expires<=?", (int(self.clock()),))
            db.execute("INSERT INTO sessions VALUES(?,?,?)",
                       (self._token_hash(token), user["id"], int(self.clock()) + SESSION_SECONDS))
        return token

    @staticmethod
    def _token_hash(token):
        if not isinstance(token, str) or not 1 <= len(token) <= 128 or not token.isascii():
            raise Denied("invalid session")
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def logout(self, token):
        with self._tx(write=True) as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (self._token_hash(token),))

    def _user(self, db, token):
        user = db.execute("""SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id
                             WHERE s.token_hash=? AND s.expires>? AND u.disabled=0""",
                          (self._token_hash(token), int(self.clock()))).fetchone()
        if not user:
            raise Denied("invalid session")
        return user

    @staticmethod
    def _access(db, user, doc, *, write=False, owner=False):
        row = db.execute("""SELECT d.*,m.role FROM documents d LEFT JOIN members m
                            ON m.document_id=d.id AND m.user_id=? WHERE d.id=?""", (user["id"], doc)).fetchone()
        if not row or (row["owner_id"] != user["id"] and
                       (owner or row["role"] is None or (write and row["role"] != "editor"))):
            raise Denied("document unavailable")
        return row

    def create_document(self, token, title):
        """Create a review identity. File uploads/storage are a later layer."""
        title, _ = _name(title)
        doc = uuid.uuid4().hex
        with self._tx(write=True) as db:
            user = self._user(db, token)
            db.execute("INSERT INTO documents(id,owner_id,title) VALUES(?,?,?)", (doc, user["id"], title))
        return doc

    def grant(self, token, doc, user_id, role):
        """Owner grants reader/editor access; None revokes membership."""
        if role not in (None, "reader", "editor"):
            raise Invalid("invalid role")
        with self._tx(write=True) as db:
            user = self._user(db, token)
            document = self._access(db, user, doc, owner=True)
            if user_id == document["owner_id"]:
                raise Invalid("owner role cannot be changed")
            if not db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone():
                raise Invalid("unknown user")
            if role is None:
                db.execute("DELETE FROM members WHERE document_id=? AND user_id=?", (doc, user_id))
            else:
                db.execute("INSERT INTO members VALUES(?,?,?) ON CONFLICT(document_id,user_id) DO UPDATE SET role=excluded.role",
                           (doc, user_id, role))

    def append(self, token, doc, request):
        """Commit one event or return its identical prior result on retry.

        A stale base is rejected, never silently overwriting a colleague. A
        deletion remains as a tombstone; an explicit edit of that base restores
        it. Accepted event shape matches shared-review-core's v1 envelope;
        revision is an additional per-document reconnect cursor.
        """
        if type(request) is not dict or set(request) != {"id", "ann", "op", "base", "data"}:
            raise Invalid("expected id, ann, op, base and data")
        event_id, ann = _identifier(request["id"]), _identifier(request["ann"])
        base, op, data = request["base"], request["op"], request["data"]
        if op not in ("create", "edit", "delete"):
            raise Invalid("invalid operation")
        if op == "create":
            if base is not None:
                raise Invalid("create must have no base")
        else:
            _identifier(base)
        if op == "delete":
            if data is not None:
                raise Invalid("delete must have no snapshot")
        elif type(data) is not dict or data.get("id") != ann or not isinstance(data.get("type"), str) or not data["type"] or type(data.get("page")) is not int or data["page"] < 1:
            raise Invalid("snapshot needs matching id, type and positive page")
        payload = _json(request)
        # Work on a detached snapshot: caller mutation must not change what is
        # stored after the idempotency payload was computed.
        data = json.loads(payload)["data"]
        with self._tx(write=True) as db:
            user = self._user(db, token)
            document = self._access(db, user, doc, write=True)
            prior = db.execute("SELECT actor,request,event FROM events WHERE document_id=? AND id=?", (doc, event_id)).fetchone()
            if prior:
                if prior["actor"] != user["id"] or prior["request"] != payload:
                    raise Conflict()
                return json.loads(prior["event"])
            current = db.execute("SELECT event_id FROM heads WHERE document_id=? AND ann=?", (doc, ann)).fetchone()
            current_id = current[0] if current else None
            if (op == "create" and current is not None) or (op != "create" and (current is None or base != current_id)):
                raise Conflict(current_id)
            revision = document["revision"] + 1
            event = {"v": 1, "id": event_id, "uk": user["id"], "user": user["name"],
                     "seq": revision, "clock": revision, "at": datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                     "op": op, "ann": ann, "base": base, "data": data, "revision": revision}
            db.execute("INSERT INTO events VALUES(?,?,?,?,?,?)", (doc, revision, event_id, user["id"], payload, _json(event)))
            db.execute("INSERT INTO heads VALUES(?,?,?,?) ON CONFLICT(document_id,ann) DO UPDATE SET event_id=excluded.event_id,data=excluded.data",
                       (doc, ann, event_id, _json(data) if data is not None else None))
            db.execute("UPDATE documents SET revision=? WHERE id=?", (revision, doc))
            return event

    def replay(self, token, doc, *, after=0, limit=100):
        if type(after) is not int or not 0 <= after <= 2**53 - 1 or type(limit) is not int or not 1 <= limit <= 1000:
            raise Invalid("invalid replay cursor or limit")
        with self._tx() as db:
            user = self._user(db, token)
            document = self._access(db, user, doc)
            if after > document["revision"]:
                raise Invalid("cursor is ahead of document")
            rows = db.execute("SELECT event FROM events WHERE document_id=? AND revision>? ORDER BY revision LIMIT ?", (doc, after, limit)).fetchall()
            events = [json.loads(row[0]) for row in rows]
            cursor = events[-1]["revision"] if events else after
            return {"events": events, "cursor": cursor, "head": document["revision"], "hasMore": cursor < document["revision"]}

    def snapshot(self, token, doc):
        with self._tx() as db:
            user = self._user(db, token)
            document = self._access(db, user, doc)
            rows = db.execute("SELECT ann,event_id,data FROM heads WHERE document_id=? ORDER BY ann", (doc,)).fetchall()
            return {"cursor": document["revision"], "annotations": [
                {"id": row["ann"], "base": row["event_id"], "data": json.loads(row["data"]) if row["data"] is not None else None}
                for row in rows]}

    def file_info(self, token, doc, *, owner=False):
        """Private storage binding. Always recheck access, even for an absent file."""
        with self._tx() as db:
            user = self._user(db, token)
            document = self._access(db, user, doc, owner=owner)
            row = db.execute("SELECT * FROM document_files WHERE document_id=?", (doc,)).fetchone()
            if owner and row is None and document["revision"] != 0:
                raise Conflict()
            return dict(row) if row else None

    def bind_file(self, token, doc, info):
        """Publish one uploaded PDF after rechecking owner/session in a write txn.

        Reviews with events cannot acquire a new base PDF. A different PDF needs
        a new document/review identity; no API replaces an existing binding.
        """
        fields = {"bucket", "object_key", "sha256", "size", "etag", "version_id"}
        if type(info) is not dict or set(info) != fields:
            raise Invalid("invalid storage binding")
        if type(info["size"]) is not int or info["size"] <= 0:
            raise Invalid("invalid file size")
        for field in ("bucket", "object_key", "etag"):
            if not isinstance(info[field], str) or not 1 <= len(info[field]) <= 1024:
                raise Invalid("invalid storage metadata")
        if not isinstance(info["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", info["sha256"]):
            raise Invalid("invalid file digest")
        if info["version_id"] is not None and (not isinstance(info["version_id"], str) or not 1 <= len(info["version_id"]) <= 1024):
            raise Invalid("invalid object version")
        with self._tx(write=True) as db:
            user = self._user(db, token)
            document = self._access(db, user, doc, owner=True)
            prior = db.execute("SELECT * FROM document_files WHERE document_id=?", (doc,)).fetchone()
            if prior:
                if prior["sha256"] == info["sha256"] and prior["size"] == info["size"]:
                    return dict(prior)
                raise Conflict()
            if document["revision"] != 0:
                raise Conflict()
            db.execute("INSERT INTO document_files VALUES(?,?,?,?,?,?,?)",
                       (doc, info["bucket"], info["object_key"], info["sha256"], info["size"], info["etag"], info["version_id"]))
            return {"document_id": doc, **info}
