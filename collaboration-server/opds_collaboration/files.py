"""Immutable per-review S3 PDFs. Publish the SQLite binding only after upload."""
import base64
import hashlib
import uuid

from botocore.exceptions import BotoCoreError, ClientError

from .store import Conflict, Invalid

MAX_PDF_BYTES = 32 * 1024 * 1024


class StorageUnavailable(Exception):
    pass


class FileMissing(Exception):
    pass


def public_info(info):
    return {"sha256": info["sha256"], "size": info["size"]}


class S3Files:
    def __init__(self, client, bucket):
        self.client, self.bucket = client, bucket

    def put(self, data):
        digest = hashlib.sha256(data).digest()
        # An attempt gets a new key, never a filename or an existing key. A
        # failed/ambiguous operation may leave an unreferenced object; don't
        # delete it automatically because a SQL commit may have succeeded.
        key = "reviews/" + uuid.uuid4().hex + ".pdf"
        try:
            result = self.client.put_object(Bucket=self.bucket, Key=key, Body=data,
                ContentType="application/pdf", ContentLength=len(data),
                ChecksumSHA256=base64.b64encode(digest).decode("ascii"), IfNoneMatch="*")
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable() from exc
        etag = result.get("ETag")
        if not isinstance(etag, str) or not etag:
            raise StorageUnavailable()
        return {"bucket": self.bucket, "object_key": key, "sha256": digest.hex(),
                "size": len(data), "etag": etag, "version_id": result.get("VersionId")}

    def get(self, info):
        if info["bucket"] != self.bucket or not 0 < info["size"] <= MAX_PDF_BYTES:
            raise StorageUnavailable()
        params = {"Bucket": self.bucket, "Key": info["object_key"], "IfMatch": info["etag"]}
        if info["version_id"] is not None:
            params["VersionId"] = info["version_id"]
        body = None
        try:
            result = self.client.get_object(**params)
            body = result["Body"]
            if result.get("ContentLength") != info["size"]:
                raise StorageUnavailable()
            data = body.read(info["size"] + 1)
            if len(data) != info["size"] or hashlib.sha256(data).hexdigest() != info["sha256"]:
                raise StorageUnavailable()
            return data
        except (BotoCoreError, ClientError, OSError) as exc:
            raise StorageUnavailable() from exc
        finally:
            if body is not None:
                body.close()


class Documents:
    def __init__(self, store, objects):
        self.store, self.objects = store, objects

    def upload(self, token, doc, data):
        prior = self.store.file_info(token, doc, owner=True)
        if type(data) is not bytes or not 0 < len(data) <= MAX_PDF_BYTES or not data.startswith(b"%PDF-"):
            raise Invalid("expected PDF bytes (maximum 32 MiB)")
        # Header sniff only; the app must still parse/validate the PDF. This
        # service preserves bytes and never executes document content.
        if prior:
            if prior["sha256"] == hashlib.sha256(data).hexdigest() and prior["size"] == len(data):
                return public_info(prior)
            raise Conflict()
        info = self.objects.put(data)
        return public_info(self.store.bind_file(token, doc, info))

    def download(self, token, doc):
        info = self.store.file_info(token, doc)
        if info is None:
            raise FileMissing()
        data = self.objects.get(info)
        # Network I/O can take time: don't return bytes to a revoked/expired
        # session. The immutable binding must still be the same.
        if self.store.file_info(token, doc) != info:
            raise StorageUnavailable()
        return data
