"""Operator configuration and bounded single-process Waitress deployment."""
from dataclasses import dataclass
import os
import re
from urllib.parse import urlsplit

import boto3
from botocore.config import Config
from waitress import serve

from .files import Documents, S3Files, MAX_PDF_BYTES
from .http import Application
from .store import Invalid, Store


def _integer(env, name, default, minimum, maximum):
    value = env.get(name, str(default))
    if not re.fullmatch(r"[0-9]{1,6}", value) or not minimum <= int(value) <= maximum:
        raise Invalid("invalid " + name)
    return int(value)


@dataclass(frozen=True)
class Settings:
    database: str
    bucket: str
    endpoint: str | None
    region: str
    host: str
    port: int
    threads: int
    waiters: int

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        database = env.get("OPDS_DATABASE", "review.db")
        bucket = env.get("OPDS_S3_BUCKET", "")
        region = env.get("OPDS_S3_REGION", "us-east-1")
        host = env.get("OPDS_HOST", "127.0.0.1")
        endpoint = env.get("OPDS_S3_ENDPOINT") or None
        if not database.strip() or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
            raise Invalid("OPDS_DATABASE and a valid OPDS_S3_BUCKET are required")
        if not re.fullmatch(r"[a-z0-9-]{1,64}", region) or not re.fullmatch(r"[A-Za-z0-9.:-]{1,253}", host):
            raise Invalid("invalid region or bind host")
        if endpoint:
            try:
                url = urlsplit(endpoint)
                port = url.port
            except ValueError as exc:
                raise Invalid("invalid OPDS_S3_ENDPOINT") from exc
            if (url.scheme not in ("http", "https") or not url.hostname or url.username is not None
                    or url.password is not None or url.path not in ("", "/") or url.query or url.fragment
                    or (port is not None and not 1 <= port <= 65535)):
                raise Invalid("invalid OPDS_S3_ENDPOINT")
        threads = _integer(env, "OPDS_THREADS", 16, 4, 64)
        waiters = _integer(env, "OPDS_MAX_WAITERS", 8, 1, 60)
        if waiters > threads - 4:
            raise Invalid("OPDS_THREADS must reserve at least four threads outside long polls")
        return cls(database, bucket, endpoint, region, host,
                   _integer(env, "OPDS_PORT", 8080, 1, 65535), threads, waiters)


def build_app(settings):
    # Credentials come only from the SDK's operator-controlled provider chain.
    client = boto3.client("s3", endpoint_url=settings.endpoint, region_name=settings.region,
        config=Config(connect_timeout=5, read_timeout=30,
                      retries={"mode": "standard", "total_max_attempts": 3},
                      s3={"addressing_style": "path"}))
    try:
        store = Store(settings.database)
        return Application(store, files=Documents(store, S3Files(client, settings.bucket)),
                           max_waiters=settings.waiters), client
    except BaseException:
        client.close()
        raise


def run(settings):
    app, client = build_app(settings)
    try:
        serve(app, host=settings.host, port=settings.port, threads=settings.threads,
              connection_limit=64, backlog=64, channel_timeout=60, cleanup_interval=10,
              max_request_body_size=MAX_PDF_BYTES, max_request_header_size=16384,
              inbuf_overflow=512 * 1024, outbuf_overflow=1024 * 1024,
              expose_tracebacks=False, clear_untrusted_proxy_headers=True,
              trusted_proxy=None)
    finally:
        client.close()
