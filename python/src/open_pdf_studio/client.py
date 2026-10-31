"""MCP client: JSON-RPC handshake, tool calls and result decoding."""

from __future__ import annotations

import itertools
import json
import os
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, Union

from ._tools import TOOLS, ToolMethods
from .errors import ProtocolError, ToolError, UnsupportedOperationError, rpc_error_from
from .transport import HttpTransport, StdioTransport, Transport

if TYPE_CHECKING:  # pragma: no cover
    from .document import Document
    from .launcher import AppProcess

PROTOCOL_VERSION = "2025-03-26"
DEFAULT_PORT = 9223


def decode_result(tool: str, result: Any) -> Any:
    """Turn an MCP ``tools/call`` result into a Python value.

    The app answers with one text block whose text is a JSON document
    (``{"ok": true, ...}``); that document is returned as a ``dict``. A result
    with ``isError`` or ``"ok": false`` raises :class:`ToolError`. Results with
    several blocks (for example an image) come back as a list of blocks, text
    blocks decoded when they hold JSON.
    """
    if not isinstance(result, dict) or not isinstance(result.get("content", []), list):
        raise ProtocolError(f"{tool}: malformed tools/call result: {result!r:.200}")
    blocks: List[Any] = []
    for block in result.get("content", []):
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text", "")
            try:
                blocks.append(json.loads(text))
            except (TypeError, ValueError):
                blocks.append(text)
        else:
            blocks.append(block)
    value: Any = blocks[0] if len(blocks) == 1 else blocks
    if result.get("isError"):
        raise ToolError(tool, _message(value), value)
    if isinstance(value, dict) and value.get("ok") is False:
        raise ToolError(tool, _message(value), value)
    return value


def _message(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("error") or value.get("message") or json.dumps(value)[:500])
    if isinstance(value, list):
        return "; ".join(_message(v) for v in value) or "tool failed"
    return str(value) or "tool failed"


class Tools(ToolMethods):
    """The generated tool methods, bound to a :class:`Client`."""

    __slots__ = ("_client",)

    def __init__(self, client: "Client") -> None:
        self._client = client

    def _call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        return self._client.call_tool(name, arguments)


class Client:
    """A connection to one Open PDF Studio MCP server.

    Use :func:`connect` (running app), :func:`launch` (own headless instance)
    or :func:`connect_stdio` (any MCP stdio server) instead of constructing
    this directly. Every tool of the app is available as a typed method on
    :attr:`tools`; :meth:`call_tool` calls any tool by name, including tools
    contributed by extensions at runtime.
    """

    def __init__(self, transport: Transport, *, process: Optional["AppProcess"] = None, timeout: float = 120.0) -> None:
        self.transport = transport
        self.process = process
        self.timeout = timeout
        self.tools = Tools(self)
        self.server_info: Dict[str, Any] = {}
        self._ids = itertools.count(1)
        self._tool_names: Optional[set] = None
        self._documents: List["Document"] = []
        self._closed = False

    # ── JSON-RPC ──────────────────────────────────────────────────────────
    def request(self, method: str, params: Optional[Dict[str, Any]] = None, *, timeout: Optional[float] = None) -> Any:
        msg: Dict[str, Any] = {"jsonrpc": "2.0", "id": next(self._ids), "method": method}
        if params is not None:
            msg["params"] = params
        response = self.transport.request(msg, timeout=timeout or self.timeout)
        if not isinstance(response, dict):
            raise ProtocolError(f"{method}: no JSON-RPC response")
        if "error" in response and response["error"] is not None:
            raise rpc_error_from(response["error"])
        if "result" not in response:
            raise ProtocolError(f"{method}: response without result: {response!r:.200}")
        return response["result"]

    def initialize(self) -> Dict[str, Any]:
        """MCP handshake; :func:`connect` and :func:`launch` call this for you."""
        result = self.request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "open-pdf-studio-python", "version": _version()},
            },
        )
        self.server_info = result if isinstance(result, dict) else {}
        try:
            self.transport.notify({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception:  # the notification is a courtesy; servers may ignore it
            pass
        return self.server_info

    # ── Tools ─────────────────────────────────────────────────────────────
    def list_tools(self) -> List[Dict[str, Any]]:
        """The tools the connected app advertises right now (``tools/list``)."""
        result = self.request("tools/list")
        tools = result.get("tools", []) if isinstance(result, dict) else []
        self._tool_names = {t.get("name") for t in tools if isinstance(t, dict)}
        return tools

    def has_tool(self, name: str) -> bool:
        if self._tool_names is None:
            self.list_tools()
        return name in (self._tool_names or set())

    def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None, *, raw: bool = False, timeout: Optional[float] = None) -> Any:
        """Call a tool by its MCP name and return the decoded result.

        ``raw=True`` returns the MCP result object (``content`` + ``isError``)
        without decoding or raising :class:`ToolError`.
        """
        result = self.request("tools/call", {"name": name, "arguments": arguments or {}}, timeout=timeout)
        return result if raw else decode_result(name, result)

    def require_tool(self, name: str, what: str) -> None:
        if not self.has_tool(name):
            raise UnsupportedOperationError(
                f"{what} needs the MCP tool '{name}', which this Open PDF Studio does not offer yet "
                "(see docs/python-library.md, 'Missing tools')."
            )

    # ── Documents ─────────────────────────────────────────────────────────
    def open(self, path: Union[str, "os.PathLike[str]"]) -> "Document":
        """Open a PDF in a new tab and return it as a :class:`Document`."""
        from .document import Document

        return Document._open(self, os.fspath(path))

    def new_document(self, width_pt: float = 595.276, height_pt: float = 841.89, pages: int = 1) -> "Document":
        """Create a blank PDF (default one A4 page) in a new tab."""
        from .document import Document

        return Document._new(self, width_pt, height_pt, pages)

    @property
    def documents(self) -> Sequence["Document"]:
        """The documents opened through this client that are still open."""
        return tuple(self._documents)

    # ── Lifetime ──────────────────────────────────────────────────────────
    def close(self) -> None:
        """Close the connection; stops the app if this client launched it."""
        if self._closed:
            return
        self._closed = True
        try:
            self.transport.close()
        finally:
            if self.process is not None:
                self.process.stop()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        target = getattr(self.transport, "endpoint", None) or getattr(self.transport, "command", None)
        return f"<open_pdf_studio.Client {target!r}>"


def _version() -> str:
    from . import __version__

    return __version__


def connect(port: Optional[int] = None, *, host: str = "127.0.0.1", timeout: float = 120.0) -> Client:
    """Connect to a running Open PDF Studio (Settings > General > AI link (MCP)).

    The port defaults to ``OPS_MCP_PORT`` or 9223, as for the stdio bridge.
    """
    if port is None:
        port = int(os.environ.get("OPS_MCP_PORT") or os.environ.get("MCP_PORT") or DEFAULT_PORT)
    client = Client(HttpTransport(f"http://{host}:{port}/mcp", timeout=timeout), timeout=timeout)
    client.initialize()
    return client


def connect_stdio(command: Sequence[str], *, env: Optional[Dict[str, str]] = None, cwd: Optional[str] = None, timeout: float = 120.0) -> Client:
    """Connect to an MCP server over stdio, e.g. ``["node", "mcp-stdio/server.mjs"]``."""
    client = Client(StdioTransport(command, env=env, cwd=cwd, timeout=timeout), timeout=timeout)
    try:
        client.initialize()
    except BaseException:
        client.close()
        raise
    return client


__all__ = ["Client", "Tools", "connect", "connect_stdio", "decode_result", "TOOLS", "PROTOCOL_VERSION"]
