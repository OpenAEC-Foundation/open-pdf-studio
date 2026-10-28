"""Open PDF Studio from Python.

A thin client over the MCP tools of the Open PDF Studio app: every PDF
operation runs in the app itself (one source of truth), this package only
starts or connects to it and calls its tools.

    import open_pdf_studio as ops

    with ops.launch() as app:              # own headless instance
        doc = app.open("plan.pdf")
        doc.annotations.add("box", page=1, x=40, y=40, width=200, height=80)
        doc.save("plan-marked.pdf")

    app = ops.connect()                    # the running app (port 9223)
    app.tools.get_page_count()             # any tool, generated from tools.json
"""

from __future__ import annotations

from ._tools import NULL, TOOLS
from .client import PROTOCOL_VERSION, Client, Tools, connect, connect_stdio, decode_result
from .document import Annotations, Document, Layers, Pages, default_app, set_default_app
from .errors import (
    AppLaunchError,
    AppNotFoundError,
    AppNotReachableError,
    InternalError,
    InvalidParamsError,
    InvalidRequestError,
    MethodNotFoundError,
    OpenPdfStudioError,
    ProtocolError,
    RpcError,
    ToolError,
    UnsupportedOperationError,
)
from .launcher import candidate_paths, find_app, launch

try:
    from importlib.metadata import PackageNotFoundError, version as _dist_version

    try:
        __version__ = _dist_version("open-pdf-studio")
    except PackageNotFoundError:  # running from a source checkout
        __version__ = "0.0.0+source"
except ImportError:  # pragma: no cover
    __version__ = "0.0.0+source"

__all__ = [
    "NULL",
    "TOOLS",
    "PROTOCOL_VERSION",
    "Client",
    "Tools",
    "Document",
    "Pages",
    "Annotations",
    "Layers",
    "connect",
    "connect_stdio",
    "launch",
    "find_app",
    "candidate_paths",
    "default_app",
    "set_default_app",
    "decode_result",
    "OpenPdfStudioError",
    "AppNotFoundError",
    "AppLaunchError",
    "AppNotReachableError",
    "ProtocolError",
    "RpcError",
    "InvalidRequestError",
    "MethodNotFoundError",
    "InvalidParamsError",
    "InternalError",
    "ToolError",
    "UnsupportedOperationError",
    "__version__",
]
