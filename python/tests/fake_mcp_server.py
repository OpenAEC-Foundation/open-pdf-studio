"""A fake Open PDF Studio MCP server for the tests (no app needed).

It speaks the same wire protocol as the app (``src-tauri/src/mcp_server.rs``):
JSON-RPC 2.0, ``initialize`` / ``tools/list`` / ``tools/call``, tool results as
one text block holding JSON, ``{"ok": false, "error"}`` for tool failures and
JSON-RPC ``-32602`` for unknown tools. It keeps a tiny in-memory model of tabs,
pages and annotations so the document wrappers can be tested end to end.

Modes:
  --http [PORT]   HTTP POST /mcp; prints "PORT <n>" on stdout when listening
  --stdio         newline-delimited JSON-RPC on stdin/stdout
  --mcp-server --mcp-port N   behave like the app binary (launcher tests)

Environment:
  FAKE_EXTRA_TOOLS   comma-separated tool names to advertise in addition
  FAKE_READY_DELAY   app mode: seconds before the WebView is "ready"
  FAKE_NO_MARKER     app mode: never print the WebView-ready log line
  FAKE_EXIT_EARLY    app mode: print an error and exit during startup
"""

from __future__ import annotations

import json
import os
import socketserver
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_tools():
    """TOOLS from the generated module, without importing the whole package."""
    import importlib.util

    path = os.path.join(os.path.dirname(HERE), "src", "open_pdf_studio", "_tools.py")
    if not os.path.isfile(path):  # tests run against an installed package
        import open_pdf_studio._tools as mod

        return mod.TOOLS
    spec = importlib.util.spec_from_file_location("_opds_tools", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.TOOLS


TOOLS = _load_tools()

READY = threading.Event()
LOCK = threading.Lock()


def tool_list():
    names = list(TOOLS) + [n for n in os.environ.get("FAKE_EXTRA_TOOLS", "").split(",") if n]
    out = []
    for name in names:
        meta = TOOLS.get(name, {"title": name, "read_only": False, "destructive": False, "params": {}, "required": ()})
        out.append({
            "name": name,
            "description": meta["title"],
            "inputSchema": {"type": "object", "properties": {mcp: {} for mcp in meta["params"].values()}, "required": list(meta["required"])},
            "annotations": {"title": meta["title"], "readOnlyHint": meta["read_only"], "destructiveHint": meta["destructive"], "openWorldHint": False},
        })
    return out


class Model:
    def __init__(self):
        self.tabs = []
        self.active = -1
        self.next_id = 1
        self.calls = []

    def doc(self):
        if self.active < 0 or self.active >= len(self.tabs):
            raise ToolFail("no active document")
        return self.tabs[self.active]

    def call(self, name, a):
        self.calls.append({"name": name, "arguments": a})
        if a.get("__fail__") == "iserror":
            return {"content": [{"type": "text", "text": "simulated failure"}], "isError": True}
        if a.get("__fail__") == "rpc":
            raise RpcFail(-32603, "timed out waiting for the WebView")
        handler = getattr(self, "t_" + name, None)
        try:
            payload = handler(a) if handler else {"ok": True, "tool": name, "arguments": a}
        except ToolFail as e:
            payload = {"ok": False, "error": str(e)}
        return {"content": [{"type": "text", "text": json.dumps(payload)}], "isError": False}

    # ── tools ──
    def t_app_open_pdf(self, a):
        path = a["path"]
        if path.lower().endswith((".dwg", ".dxf")):
            return {"ok": True, "dialog": "cad-import", "file_path": path}
        if not os.path.isfile(path):
            raise ToolFail(f"loadPDF: file not found: {path}")
        self.tabs.append({"path": path, "pages": 3, "annotations": [], "modified": False, "rotation": {}})
        self.active = len(self.tabs) - 1
        return {"ok": True, "tab_id": self.active, "page_count": 3, "file_path": path}

    def t_app_new_blank_pdf(self, a):
        pages = int(a.get("pages", 1))
        self.tabs.append({"path": None, "pages": pages, "annotations": [], "modified": True, "size": [a["widthPt"], a["heightPt"]], "rotation": {}})
        self.active = len(self.tabs) - 1
        return {"ok": True, "tabIndex": self.active, "fileName": "Untitled", "pageCount": pages}

    def t_app_list_tabs(self, a):
        return {"ok": True, "activeIndex": self.active, "tabs": [
            {"index": i, "filePath": t["path"], "modified": t["modified"], "pageCount": t["pages"], "active": i == self.active}
            for i, t in enumerate(self.tabs)]}

    def t_app_switch_tab(self, a):
        i = a["index"]
        if not 0 <= i < len(self.tabs):
            raise ToolFail(f"index out of range (have {len(self.tabs)} tabs)")
        self.active = i
        return {"ok": True, "activeIndex": i}

    def t_app_close_tab(self, a):
        i = a["index"]
        if not 0 <= i < len(self.tabs):
            raise ToolFail(f"index out of range (have {len(self.tabs)} tabs)")
        if self.tabs[i]["modified"] and not (a.get("force") or a.get("save")):
            raise ToolFail("document has unsaved changes")
        del self.tabs[i]
        self.active = min(self.active, len(self.tabs) - 1)
        return {"ok": True, "remainingTabs": len(self.tabs)}

    def t_app_get_page_count(self, a):
        d = self.doc()
        return {"ok": True, "pageCount": d["pages"], "currentPage": 1}

    def t_app_create_annotation(self, a):
        d = self.doc()
        ann = {"id": f"ann-{self.next_id}", "type": a["type"], "page": a.get("page", 1), "layer": a.get("layer"), **a["props"]}
        self.next_id += 1
        d["annotations"].append(ann)
        d["modified"] = True
        return {"ok": True, "id": ann["id"], "annotation": ann}

    def t_app_list_annotations(self, a):
        anns = [x for x in self.doc()["annotations"] if "page" not in a or x["page"] == a["page"]]
        return {"ok": True, "count": len(anns), "annotations": anns}

    def _find(self, ann_id):
        for x in self.doc()["annotations"]:
            if x["id"] == ann_id:
                return x
        raise ToolFail(f"annotation not found: {ann_id}")

    def t_app_get_annotation(self, a):
        return {"ok": True, "annotation": self._find(a["id"])}

    def t_app_update_annotation(self, a):
        self._find(a["id"]).update(a["props"])
        self.doc()["modified"] = True
        return {"ok": True, "id": a["id"]}

    def t_app_delete_annotation(self, a):
        d = self.doc()
        d["annotations"].remove(self._find(a["id"]))
        d["modified"] = True
        return {"ok": True}

    def t_app_save_pdf(self, a):
        d = self.doc()
        path = a.get("path") or d["path"]
        if not path:
            raise ToolFail("document has no saved file path - pass params.path")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"fake-pdf": True, "pages": d["pages"], "annotations": d["annotations"], "rotation": d["rotation"]}, f)
        d["path"], d["modified"] = path, False
        return {"ok": True, "path": path}

    def t_app_merge_pdf(self, a):
        d = self.doc()
        before = d["pages"]
        d["pages"] += len(a["filePaths"])
        d["modified"] = True
        return {"ok": True, "position": a.get("position", "end"), "mergedFiles": len(a["filePaths"]), "pagesBefore": before, "pagesAfter": d["pages"]}

    def t_app_capture_region(self, a):
        self.doc()
        data = b"\x89PNG fake" if a.get("format", "png") == "png" else b"\xff\xd8 fake"
        with open(a["path"], "wb") as f:
            f.write(data)
        return {"ok": True, "path": a["path"], "bytes": len(data)}

    def t_app_get_page_text(self, a):
        self.doc()
        return {"ok": True, "page": a.get("page", 1), "spans": [{"id": "s1", "text": "Hello", "bbox": [10, 10, 40, 20], "font": {"family": "Helvetica", "size": 12}}]}

    def t_app_rotate_pages(self, a):
        d = self.doc()
        for p in a["pages"]:
            d["rotation"][str(p)] = (d["rotation"].get(str(p), 0) + a["angle"]) % 360
        d["modified"] = True
        return {"ok": True, "pages": a["pages"], "angle": a["angle"]}


class ToolFail(Exception):
    pass


class RpcFail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


MODEL = Model()
KNOWN = None


def handle(msg, *, app_mode=False):
    global KNOWN
    if KNOWN is None:
        KNOWN = {t["name"] for t in tool_list()}
    if not isinstance(msg, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "batch not supported"}}
    mid = msg.get("id")
    method = msg.get("method")
    is_notification = "id" not in msg

    def ok(result):
        return None if is_notification else {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code, message):
        return None if is_notification else {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}

    if method == "initialize":
        return ok({"protocolVersion": "2025-03-26", "serverInfo": {"name": "open-pdf-studio", "version": "fake"}, "capabilities": {"tools": {"listChanged": False}}})
    if method in ("notifications/initialized", "initialized"):
        return ok({})
    if method == "tools/list":
        return ok({"tools": tool_list()})
    if method == "fake/state":
        env = {k: os.environ.get(k) for k in ("OPS_ENABLE_MCP", "OPDS_DETACHED", "OPDS_HEADLESS", "OPDS_DATA_DIR")}
        return ok({"argv": sys.argv[1:], "env": env, "calls": MODEL.calls, "tabs": MODEL.tabs, "pid": os.getpid()})
    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name", "")
        if name not in KNOWN:
            return err(-32602, f"tool '{name}' is not available in this Open PDF Studio configuration")
        if app_mode and not READY.is_set():
            time.sleep(0.2)
            return err(-32603, "timed out waiting for the WebView")
        try:
            with LOCK:
                return ok(MODEL.call(name, params.get("arguments") or {}))
        except RpcFail as e:
            return err(e.code, str(e))
    return err(-32601, f"method not found: {method}")


class _QuickHTTPServer(ThreadingHTTPServer):
    """HTTPServer.server_bind calls socket.getfqdn(), a reverse DNS lookup
    that can take ~30 s on CI runners (macOS); the fake does not need it."""

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port


def serve_http(port, *, app_mode=False, announce=True):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            if self.path != "/mcp":
                self.send_error(404)
                return
            body = self.rfile.read(int(self.headers.get("content-length", 0)))
            try:
                msg = json.loads(body)
            except ValueError:
                resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
            else:
                resp = handle(msg, app_mode=app_mode) or {"jsonrpc": "2.0", "id": None, "result": {}}
            data = json.dumps(resp).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = _QuickHTTPServer(("127.0.0.1", port), Handler)
    if announce:
        print(f"PORT {server.server_address[1]}", flush=True)
    return server


def serve_stdio():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        resp = handle(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()


def main(argv):
    if "--stdio" in argv:
        READY.set()
        serve_stdio()
        return 0
    if "--http" in argv:
        i = argv.index("--http")
        port = int(argv[i + 1]) if len(argv) > i + 1 and argv[i + 1].isdigit() else 0
        READY.set()
        serve_http(port).serve_forever()
        return 0
    if "--mcp-server" in argv:
        # Behave like the app binary started by open_pdf_studio.launch().
        port = int(argv[argv.index("--mcp-port") + 1]) if "--mcp-port" in argv else 9223
        if os.environ.get("FAKE_EXIT_EARLY"):
            print("fatal: simulated startup failure", file=sys.stderr, flush=True)
            return 3
        if os.environ.get("OPS_ENABLE_MCP") != "1":
            print("MCP server refused to start: release build without OPS_ENABLE_MCP=1", file=sys.stderr, flush=True)
            return 2
        server = serve_http(port, app_mode=True, announce=False)
        print(f"MCP server listening on http://127.0.0.1:{port}/mcp", file=sys.stderr, flush=True)

        def become_ready():
            time.sleep(float(os.environ.get("FAKE_READY_DELAY", "0.3")))
            READY.set()
            if not os.environ.get("FAKE_NO_MARKER"):
                print('[mcp-bridge] WebView ready, listening for: ["mcp:open-pdf"]', file=sys.stderr, flush=True)

        threading.Thread(target=become_ready, daemon=True).start()
        server.serve_forever()
        return 0
    print(__doc__, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
