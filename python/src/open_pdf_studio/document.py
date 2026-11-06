"""Document-level wrappers over the generated tools.

The app works on tabs: every tool acts on the active document. A
:class:`Document` remembers its tab and activates it before each call, so
several documents can be edited from one script. Everything here is a thin
composition of MCP tools; the PDF work itself happens in the app.
"""

from __future__ import annotations

import atexit
import os
import threading
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Sequence, Union

from .errors import OpenPdfStudioError, ToolError, UnsupportedOperationError

if TYPE_CHECKING:  # pragma: no cover
    from .client import Client

PathLike = Union[str, "os.PathLike[str]"]

_default_lock = threading.Lock()
_default_app: Optional["Client"] = None


def default_app() -> "Client":
    """The client :meth:`Document.open` uses when no ``app`` is given.

    Launches one headless instance on first use (stopped at interpreter exit).
    Use :func:`set_default_app` to use a running app or a custom launch.
    """
    global _default_app
    with _default_lock:
        if _default_app is None or _default_app._closed:
            from .launcher import launch

            _default_app = launch()
            atexit.register(_default_app.close)
        return _default_app


def set_default_app(client: Optional["Client"]) -> None:
    global _default_app
    with _default_lock:
        _default_app = client


class Document:
    """One open PDF (one tab) in the app."""

    def __init__(self, client: "Client", tab_index: int, *, path: Optional[str] = None, page_count: Optional[int] = None) -> None:
        self.client = client
        self.tab_index = tab_index
        self.path = path
        self._page_count = page_count
        self.closed = False
        self.pages = Pages(self)
        self.annotations = Annotations(self)
        self.layers = Layers(self)

    # ── Construction ──────────────────────────────────────────────────────
    @classmethod
    def open(cls, path: PathLike, *, app: Optional["Client"] = None) -> "Document":
        """Open ``path`` in ``app`` (default: :func:`default_app`)."""
        return cls._open(app or default_app(), os.fspath(path))

    @classmethod
    def new(cls, width_pt: float = 595.276, height_pt: float = 841.89, pages: int = 1, *, app: Optional["Client"] = None) -> "Document":
        """A blank PDF (default one A4 page) in a new tab."""
        return cls._new(app or default_app(), width_pt, height_pt, pages)

    @classmethod
    def _open(cls, client: "Client", path: str) -> "Document":
        res = client.tools.open_pdf(os.path.abspath(path))
        if isinstance(res, dict) and res.get("dialog"):
            raise UnsupportedOperationError(
                f"opening {path!r} needs the app's {res['dialog']} dialog, which a script cannot answer"
            )
        doc = cls(client, int(res.get("tab_id", 0)), path=res.get("file_path", path), page_count=res.get("page_count"))
        client._documents.append(doc)
        return doc

    @classmethod
    def _new(cls, client: "Client", width_pt: float, height_pt: float, pages: int) -> "Document":
        res = client.tools.new_blank_pdf(width_pt, height_pt, pages=pages)
        doc = cls(client, int(res.get("tabIndex", 0)), path=None, page_count=res.get("pageCount"))
        client._documents.append(doc)
        return doc

    # ── Helpers ───────────────────────────────────────────────────────────
    def activate(self) -> "Document":
        """Make this document the active tab (done before every call)."""
        if self.closed:
            raise OpenPdfStudioError("the document is closed")
        self.client.tools.switch_tab(self.tab_index)
        return self

    def _call(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
        self.activate()
        return self.client.call_tool(name, {k: v for k, v in (arguments or {}).items() if v is not None})

    @property
    def tools(self):
        """The generated tool methods, with this document activated first."""
        self.activate()
        return self.client.tools

    # ── Information ───────────────────────────────────────────────────────
    @property
    def page_count(self) -> int:
        res = self._call("app_get_page_count")
        self._page_count = int(res.get("pageCount", 0))
        return self._page_count

    def text(self, page: Optional[int] = None) -> Dict[str, Any]:
        """Page text with span ids, boxes and fonts (``app_get_page_text``)."""
        return self._call("app_get_page_text", {"page": page})

    def replace_text(self, span_id: str, expected_text: str, new_text: str, *, color: Optional[str] = None) -> Dict[str, Any]:
        return self._call("app_replace_text", {"spanId": span_id, "expectedText": expected_text, "newText": new_text, "color": color})

    # ── Output ────────────────────────────────────────────────────────────
    def save(self, path: Optional[PathLike] = None) -> Dict[str, Any]:
        """Save with all annotations; without ``path`` the file is saved in place."""
        target = os.path.abspath(os.fspath(path)) if path is not None else None
        res = self._call("app_save_pdf", {"path": target})
        if target:
            self.path = res.get("path", target) if isinstance(res, dict) else target
        return res

    def export_image(self, path: PathLike, *, page: Optional[int] = None, dpi: float = 150, format: Optional[str] = None, quality: Optional[int] = None, **region: float) -> Dict[str, Any]:
        """Render a page (or ``x``/``y``/``width``/``height`` region) to PNG or JPEG."""
        target = os.path.abspath(os.fspath(path))
        if format is None:
            format = "jpeg" if target.lower().endswith((".jpg", ".jpeg")) else "png"
        return self._call("app_capture_region", {"path": target, "page": page, "dpi": dpi, "format": format, "quality": quality, **region})

    def export_cad(self, path: PathLike, **options: Any) -> Dict[str, Any]:
        """Export to DXF/DWG (``app_export_cad``; options as in the tool schema)."""
        return self._call("app_export_cad", {"path": os.path.abspath(os.fspath(path)), **options})

    def print_to_pdf(self, path: PathLike, **options: Any) -> Dict[str, Any]:
        """Print to a PDF file with the app's print pipeline (``app_print_to_pdf``)."""
        return self._call("app_print_to_pdf", {"path": os.path.abspath(os.fspath(path)), **options})

    # ── Editing ───────────────────────────────────────────────────────────
    def undo(self) -> Any:
        return self._call("app_undo")

    def redo(self) -> Any:
        return self._call("app_redo")

    def close(self, *, save: bool = False, force: bool = False) -> None:
        """Close the tab. Unsaved changes need ``save=True`` or ``force=True``."""
        if self.closed:
            return
        self._call("app_close_tab", {"index": self.tab_index, "save": save or None, "force": force or None})
        self.closed = True
        docs = self.client._documents
        if self in docs:
            docs.remove(self)
        for other in docs:
            if other.tab_index > self.tab_index:
                other.tab_index -= 1

    def __enter__(self) -> "Document":
        return self

    def __exit__(self, *exc: Any) -> None:
        if not self.closed and not self.client._closed:
            try:
                self.close(force=True)
            except OpenPdfStudioError:
                pass

    def __repr__(self) -> str:
        state = "closed" if self.closed else f"tab {self.tab_index}"
        return f"<open_pdf_studio.Document {self.path or 'untitled'!r} ({state})>"


class _Part:
    def __init__(self, doc: Document) -> None:
        self._doc = doc


# Page operations without an MCP tool today. Each wrapper calls the tool
# named here as soon as the connected app advertises it (proposed contract in
# docs/python-library.md); until then it raises UnsupportedOperationError.
_PAGE_TOOLS = {
    "rotate": "app_rotate_pages",
    "delete": "app_delete_pages",
    "insert_blank": "app_insert_blank_pages",
    "extract": "app_extract_pages",
    "reorder": "app_reorder_pages",
}


class Pages(_Part):
    """Page-level operations of a document."""

    def __len__(self) -> int:
        return self._doc.page_count

    def merge(self, paths: Iterable[PathLike], *, position: Optional[str] = None) -> Dict[str, Any]:
        """Insert the pages of other PDFs (``position``: end, start or after)."""
        files = [os.path.abspath(os.fspath(p)) for p in paths]
        return self._doc._call("app_merge_pdf", {"filePaths": files, "position": position})

    def _future(self, op: str, arguments: Dict[str, Any]) -> Any:
        tool = _PAGE_TOOLS[op]
        self._doc.client.require_tool(tool, f"pages.{op}()")
        return self._doc._call(tool, arguments)

    def rotate(self, pages: Sequence[int], angle: int) -> Any:
        """Rotate 1-based ``pages`` by ``angle`` (90, 180 or 270)."""
        return self._future("rotate", {"pages": list(pages), "angle": angle})

    def delete(self, pages: Sequence[int]) -> Any:
        return self._future("delete", {"pages": list(pages)})

    def insert_blank(self, after: int, count: int = 1, *, width_pt: Optional[float] = None, height_pt: Optional[float] = None) -> Any:
        return self._future("insert_blank", {"after": after, "count": count, "widthPt": width_pt, "heightPt": height_pt})

    def extract(self, pages: Sequence[int], path: PathLike) -> Any:
        return self._future("extract", {"pages": list(pages), "outputPath": os.path.abspath(os.fspath(path))})

    def reorder(self, order: Sequence[int]) -> Any:
        return self._future("reorder", {"order": list(order)})


class Annotations(_Part):
    """Annotations of a document (all types the app's tools can draw)."""

    def add(self, type: str, *, page: Optional[int] = None, layer: Optional[str] = None, **props: Any) -> str:
        """Create an annotation; geometry and style go in ``props`` (app points).

        Example: ``doc.annotations.add("box", page=1, x=50, y=50, width=200,
        height=100, strokeColor="#ff0000")``. Returns the new annotation id.
        """
        res = self._doc._call("app_create_annotation", {"type": type, "page": page, "layer": layer, "props": props})
        return res.get("id") if isinstance(res, dict) else res

    def list(self, *, page: Optional[int] = None, layer: Optional[str] = None) -> List[Dict[str, Any]]:
        res = self._doc._call("app_list_annotations", {"page": page, "layer": layer})
        return res.get("annotations", []) if isinstance(res, dict) else res

    def get(self, id: str) -> Dict[str, Any]:
        res = self._doc._call("app_get_annotation", {"id": id})
        return res.get("annotation", res) if isinstance(res, dict) else res

    def update(self, id: str, *, layer: Optional[str] = None, **props: Any) -> Any:
        return self._doc._call("app_update_annotation", {"id": id, "layer": layer, "props": props})

    def delete(self, id: str) -> Any:
        return self._doc._call("app_delete_annotation", {"id": id})

    def __iter__(self):
        return iter(self.list())

    def __len__(self) -> int:
        return len(self.list())


class Layers(_Part):
    """Markup layers (``app_list_layers`` / ``app_create_layer`` / ``app_set_layer``)."""

    def list(self) -> Any:
        res = self._doc._call("app_list_layers")
        return res.get("layers", res) if isinstance(res, dict) else res

    def create(self, name: str, **options: Any) -> Any:
        return self._doc._call("app_create_layer", {"name": name, **options})

    def set(self, layer: str, **changes: Any) -> Any:
        return self._doc._call("app_set_layer", {"layer": layer, **changes})


__all__ = ["Document", "Pages", "Annotations", "Layers", "default_app", "set_default_app", "ToolError"]
