"""Shared helpers: start the fake MCP server, locate the repo."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PYTHON_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(PYTHON_DIR)
FAKE = os.path.join(HERE, "fake_mcp_server.py")
TOOLS_JSON = os.path.join(REPO, "mcp-stdio", "tools.json")
BRIDGE = os.path.join(REPO, "mcp-stdio", "server.mjs")

sys.path.insert(0, os.path.join(PYTHON_DIR, "src"))


def read_text(path: str) -> str:
    """Read a text file with LF line endings (a Windows checkout may have CRLF)."""
    with open(path, encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


class FakeHttpServer:
    """The fake MCP server in its own process, speaking HTTP like the app."""

    def __init__(self, extra_env=None):
        env = dict(os.environ)
        env.update(extra_env or {})
        self.proc = subprocess.Popen(
            [sys.executable, FAKE, "--http", "0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env
        )
        line = self.proc.stdout.readline().decode().strip()
        if not line.startswith("PORT "):
            self.stop()
            raise RuntimeError(f"fake server did not start: {line!r} {self.proc.stderr.read()!r}")
        self.port = int(line.split()[1])
        self.endpoint = f"http://127.0.0.1:{self.port}/mcp"

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=10)
        for s in (self.proc.stdout, self.proc.stderr):
            s.close()


class FakeServerCase(unittest.TestCase):
    """A test case with a fresh fake HTTP server and a connected client."""

    extra_env: dict = {}

    def setUp(self):
        import open_pdf_studio as ops

        self.server = FakeHttpServer(self.extra_env)
        self.addCleanup(self.server.stop)
        self.app = ops.connect(self.server.port, timeout=20)
        self.addCleanup(self.app.close)
        self.tmp = tempfile.mkdtemp(prefix="opds-py-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def make_pdf(self, name: str) -> str:
        path = os.path.join(self.tmp, name)
        with open(path, "wb") as f:
            f.write(b"%PDF-1.7\n%fake\n")
        return path

    def state(self):
        return self.app.request("fake/state")


def node() -> str:
    return shutil.which("node") or ""
