"""Exceptions raised by the Open PDF Studio client."""

from __future__ import annotations

from typing import Any, Optional


class OpenPdfStudioError(Exception):
    """Base class of every error this library raises."""


class AppNotFoundError(OpenPdfStudioError):
    """No Open PDF Studio executable was found to launch."""


class AppLaunchError(OpenPdfStudioError):
    """The app was started but did not become ready (or exited early)."""

    def __init__(self, message: str, *, output: str = "") -> None:
        super().__init__(f"{message}\n--- app output ---\n{output}" if output else message)
        self.output = output


class AppNotReachableError(OpenPdfStudioError):
    """The MCP endpoint of the app could not be reached."""


class ProtocolError(OpenPdfStudioError):
    """The server answered with something that is not valid JSON-RPC / MCP."""


class RpcError(OpenPdfStudioError):
    """A JSON-RPC error response (``{"error": {"code", "message"}}``)."""

    code: int = 0

    def __init__(self, message: str, *, code: Optional[int] = None, data: Any = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code
        self.data = data


class InvalidRequestError(RpcError):
    """JSON-RPC -32600, e.g. a request from a non-local origin."""

    code = -32600


class MethodNotFoundError(RpcError):
    """JSON-RPC -32601: the server does not know the method."""

    code = -32601


class InvalidParamsError(RpcError):
    """JSON-RPC -32602: unknown tool, or missing / invalid arguments."""

    code = -32602


class InternalError(RpcError):
    """JSON-RPC -32603: the app failed, e.g. the WebView did not answer in time."""

    code = -32603


class ToolError(OpenPdfStudioError):
    """A tool ran but reported a failure (``isError`` or ``{"ok": false}``).

    ``result`` holds the decoded tool payload (usually a ``dict`` with an
    ``error`` field and tool-specific details).
    """

    def __init__(self, tool: str, message: str, result: Any = None) -> None:
        super().__init__(f"{tool}: {message}")
        self.tool = tool
        self.result = result


class UnsupportedOperationError(OpenPdfStudioError):
    """The connected app has no MCP tool for this operation (yet)."""


_BY_CODE = {cls.code: cls for cls in (InvalidRequestError, MethodNotFoundError, InvalidParamsError, InternalError)}


def rpc_error_from(error: Any) -> RpcError:
    """Map a JSON-RPC ``error`` object to the matching exception."""
    if not isinstance(error, dict):
        return RpcError(str(error))
    code = error.get("code")
    message = str(error.get("message", "JSON-RPC error"))
    cls = _BY_CODE.get(code, RpcError) if isinstance(code, int) else RpcError
    return cls(message, code=code if isinstance(code, int) else None, data=error.get("data"))
