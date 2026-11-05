"""Client over HTTP (the app's own transport) and over stdio, against the fake server."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from unittest import mock

from helpers import BRIDGE, FAKE, TOOLS_JSON, FakeHttpServer, FakeServerCase, node

import open_pdf_studio as ops
from open_pdf_studio import decode_result
from open_pdf_studio.launcher import free_port


class HttpClient(FakeServerCase):
    def test_handshake_and_tool_list(self):
        self.assertEqual(self.app.server_info["serverInfo"]["name"], "open-pdf-studio")
        names = [t["name"] for t in self.app.list_tools()]
        self.assertEqual(names, list(ops.TOOLS))
        self.assertTrue(self.app.has_tool("app_open_pdf"))
        self.assertFalse(self.app.has_tool("app_rotate_pages"))

    def test_generated_method_round_trip(self):
        res = self.app.tools.set_zoom(1.5)
        self.assertEqual(res, {"ok": True, "tool": "app_set_zoom", "arguments": {"scale": 1.5}})

    def test_ok_false_raises_tool_error_with_payload(self):
        with self.assertRaises(ops.ToolError) as cm:
            self.app.tools.open_pdf(os.path.join(self.tmp, "missing.pdf"))
        self.assertEqual(cm.exception.tool, "app_open_pdf")
        self.assertIn("file not found", str(cm.exception))
        self.assertFalse(cm.exception.result["ok"])

    def test_is_error_raises_tool_error(self):
        with self.assertRaisesRegex(ops.ToolError, "simulated failure"):
            self.app.call_tool("app_zoom_in", {"__fail__": "iserror"})

    def test_raw_result_is_not_decoded(self):
        raw = self.app.call_tool("app_zoom_in", {"__fail__": "iserror"}, raw=True)
        self.assertTrue(raw["isError"])

    def test_json_rpc_errors_map_to_exceptions(self):
        with self.assertRaises(ops.InternalError) as cm:
            self.app.call_tool("app_zoom_in", {"__fail__": "rpc"})
        self.assertEqual(cm.exception.code, -32603)
        with self.assertRaisesRegex(ops.InvalidParamsError, "not available"):
            self.app.call_tool("app_does_not_exist")
        with self.assertRaises(ops.MethodNotFoundError):
            self.app.request("resources/list")

    def test_errors_share_one_base_class(self):
        for cls in (ops.ToolError, ops.InvalidParamsError, ops.AppNotReachableError, ops.AppLaunchError, ops.UnsupportedOperationError):
            self.assertTrue(issubclass(cls, ops.OpenPdfStudioError), cls)


class Connection(unittest.TestCase):
    def test_nothing_listening_raises_app_not_reachable(self):
        with self.assertRaises(ops.AppNotReachableError):
            ops.connect(free_port(), timeout=5)

    def test_port_comes_from_ops_mcp_port(self):
        server = FakeHttpServer()
        self.addCleanup(server.stop)
        with mock.patch.dict(os.environ, {"OPS_MCP_PORT": str(server.port)}):
            with ops.connect(timeout=10) as app:
                self.assertIn(str(server.port), app.transport.endpoint)
                self.assertEqual(app.tools.zoom_out()["tool"], "app_zoom_out")

    def test_http_proxy_from_the_environment_is_ignored(self):
        server = FakeHttpServer()
        self.addCleanup(server.stop)
        with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:9", "http_proxy": "http://127.0.0.1:9", "NO_PROXY": "", "no_proxy": ""}):
            with ops.connect(server.port, timeout=10) as app:
                self.assertTrue(app.tools.zoom_in()["ok"])


class DecodeResult(unittest.TestCase):
    def test_single_json_text_block(self):
        self.assertEqual(decode_result("t", {"content": [{"type": "text", "text": '{"ok": true, "n": 1}'}]}), {"ok": True, "n": 1})

    def test_plain_text_and_several_blocks(self):
        self.assertEqual(decode_result("t", {"content": [{"type": "text", "text": "hello"}]}), "hello")
        image = {"type": "image", "data": "AAAA", "mimeType": "image/png"}
        out = decode_result("t", {"content": [{"type": "text", "text": "{\"ok\": true}"}, image]})
        self.assertEqual(out, [{"ok": True}, image])

    def test_malformed_result(self):
        with self.assertRaises(ops.ProtocolError):
            decode_result("t", "nope")


class StdioClient(unittest.TestCase):
    def test_fake_stdio_server(self):
        with ops.connect_stdio([sys.executable, FAKE, "--stdio"], timeout=20) as app:
            self.assertEqual(len(app.list_tools()), len(ops.TOOLS))
            self.assertEqual(app.tools.go_to_page(2)["arguments"], {"page": 2})
            with self.assertRaises(ops.InvalidParamsError):
                app.call_tool("app_nope")
            with self.assertRaises(ops.ToolError):
                app.tools.get_page_count()  # no document open

    def test_server_that_cannot_start(self):
        with self.assertRaises(ops.AppNotReachableError):
            ops.connect_stdio([os.path.join(os.path.dirname(FAKE), "does-not-exist")])

    def test_server_that_exits(self):
        with self.assertRaises(ops.AppNotReachableError):
            ops.connect_stdio([sys.executable, "-c", "import sys; sys.exit(0)"], timeout=10)


@unittest.skipUnless(node() and os.path.isfile(BRIDGE), "needs node and the repository's mcp-stdio bridge")
class ThroughTheRealStdioBridge(unittest.TestCase):
    """mcp-stdio/server.mjs proxies stdio to the app's HTTP endpoint: same results."""

    def bridge_env(self, port):
        env = dict(os.environ)
        env["OPS_MCP_PORT"] = str(port)
        return env

    def test_proxies_to_the_app(self):
        server = FakeHttpServer()
        self.addCleanup(server.stop)
        with ops.connect_stdio([node(), BRIDGE], env=self.bridge_env(server.port), timeout=20) as app:
            self.assertEqual(len(app.list_tools()), len(ops.TOOLS))
            self.assertEqual(app.tools.set_zoom(2)["arguments"], {"scale": 2})
            with self.assertRaises(ops.ToolError):
                app.tools.get_page_count()

    def test_without_app_the_bridge_answers_from_tools_json(self):
        with ops.connect_stdio([node(), BRIDGE], env=self.bridge_env(free_port()), timeout=20) as app:
            with open(TOOLS_JSON, encoding="utf-8") as f:
                expected = [t["name"] for t in json.load(f)]
            self.assertEqual([t["name"] for t in app.list_tools()], expected)
            with self.assertRaisesRegex(ops.ToolError, "not reachable"):
                app.tools.list_tabs()


if __name__ == "__main__":
    unittest.main()
