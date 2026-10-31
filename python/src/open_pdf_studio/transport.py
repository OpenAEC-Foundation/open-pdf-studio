"""JSON-RPC transports to the app's MCP server (stdlib only).

* :class:`HttpTransport` talks to the MCP server inside the app directly:
  ``POST http://127.0.0.1:<port>/mcp`` with one JSON-RPC message per request
  (the wire protocol of ``src-tauri/src/mcp_server.rs``).
* :class:`StdioTransport` speaks newline-delimited JSON-RPC to a child
  process, e.g. the stdio bridge ``node mcp-stdio/server.mjs`` or any other
  MCP stdio server.
"""

from __future__ import annotations

import json
import queue
import subprocess
import threading
import urllib.error
import urllib.request
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .errors import AppNotReachableError, ProtocolError


class Transport:
    """Sends a JSON-RPC message and returns the decoded response (or ``None``)."""

    def request(self, message: Dict[str, Any], *, timeout: Optional[float] = None) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    def notify(self, message: Dict[str, Any]) -> None:
        self.request(message)

    def close(self) -> None:
        pass


class HttpTransport(Transport):
    def __init__(self, endpoint: str, *, timeout: float = 120.0) -> None:
        self.endpoint = endpoint
        self.timeout = timeout
        # Never route 127.0.0.1 through an HTTP(S)_PROXY from the environment.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(self, message: Dict[str, Any], *, timeout: Optional[float] = None) -> Optional[Dict[str, Any]]:
        body = json.dumps(message).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint, data=body, method="POST", headers={"content-type": "application/json"}
        )
        try:
            with self._opener.open(req, timeout=timeout or self.timeout) as res:
                text = res.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            # The server answers a refused request with a JSON-RPC error body.
            text = e.read().decode("utf-8", "replace")
            if not text.strip():
                raise ProtocolError(f"HTTP {e.code} from {self.endpoint}") from None
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            raise AppNotReachableError(f"Open PDF Studio is not reachable at {self.endpoint}: {e}") from None
        if not text.strip():
            return None
        try:
            return json.loads(text)
        except ValueError:
            raise ProtocolError(f"invalid JSON from {self.endpoint}: {text[:200]!r}") from None


class StdioTransport(Transport):
    """Newline-delimited JSON-RPC over a child process' stdin/stdout."""

    def __init__(
        self,
        command: Sequence[str],
        *,
        env: Optional[Mapping[str, str]] = None,
        cwd: Optional[str] = None,
        timeout: float = 120.0,
    ) -> None:
        self.command = list(command)
        self.timeout = timeout
        try:
            self._proc = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=dict(env) if env is not None else None,
                cwd=cwd,
            )
        except OSError as e:
            raise AppNotReachableError(f"cannot start MCP stdio server {self.command!r}: {e}") from None
        self._lock = threading.Lock()
        self._waiting: Dict[Any, "queue.Queue[Dict[str, Any]]"] = {}
        self._stderr: List[str] = []
        self._eof = False
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self) -> None:
        assert self._proc.stdout is not None
        for raw in self._proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if isinstance(msg, dict) and "id" in msg:
                q = self._waiting.get(msg["id"])
                if q is not None:
                    q.put(msg)
        self._eof = True
        for q in list(self._waiting.values()):
            q.put({"__closed__": True})

    def _read_stderr(self) -> None:
        assert self._proc.stderr is not None
        for raw in self._proc.stderr:
            self._stderr.append(raw.decode("utf-8", "replace").rstrip())
            del self._stderr[:-50]

    @property
    def stderr_tail(self) -> str:
        return "\n".join(self._stderr)

    def _write(self, message: Dict[str, Any]) -> None:
        if self._eof or self._proc.poll() is not None or self._proc.stdin is None:
            raise AppNotReachableError(f"MCP stdio server exited ({self._proc.returncode}): {self.stderr_tail}")
        data = (json.dumps(message) + "\n").encode("utf-8")
        with self._lock:
            try:
                self._proc.stdin.write(data)
                self._proc.stdin.flush()
            except OSError as e:
                raise AppNotReachableError(f"MCP stdio server closed its input: {e}") from None

    def request(self, message: Dict[str, Any], *, timeout: Optional[float] = None) -> Optional[Dict[str, Any]]:
        if "id" not in message:
            self._write(message)
            return None
        q: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self._waiting[message["id"]] = q
        try:
            self._write(message)
            try:
                msg = q.get(timeout=timeout or self.timeout)
            except queue.Empty:
                raise AppNotReachableError(f"no answer to {message.get('method')} within {timeout or self.timeout}s") from None
        finally:
            self._waiting.pop(message["id"], None)
        if msg.get("__closed__"):
            raise AppNotReachableError(f"MCP stdio server exited: {self.stderr_tail}")
        return msg

    def notify(self, message: Dict[str, Any]) -> None:
        self._write(message)

    def close(self) -> None:
        proc = self._proc
        if proc.poll() is None:
            try:
                if proc.stdin:
                    proc.stdin.close()
                proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                proc.kill()
                proc.wait(timeout=5)
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass
