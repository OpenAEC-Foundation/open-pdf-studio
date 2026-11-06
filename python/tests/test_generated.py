"""The generated tool layer matches mcp-stdio/tools.json (one source of truth)."""

from __future__ import annotations

import inspect
import json
import os
import subprocess
import unittest

from helpers import REPO, TOOLS_JSON, node, read_text

import open_pdf_studio as ops
from open_pdf_studio._tools import NULL, TOOLS, ToolMethods


class Recorder(ToolMethods):
    def __init__(self):
        self.calls = []

    def _call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return {"ok": True}


@unittest.skipUnless(os.path.isfile(TOOLS_JSON), "needs the repository checkout (mcp-stdio/tools.json)")
class MatchesCatalogue(unittest.TestCase):
    def setUp(self):
        self.tools = json.loads(read_text(TOOLS_JSON))

    def test_every_tool_has_a_method_in_catalogue_order(self):
        self.assertEqual(list(TOOLS), [t["name"] for t in self.tools])
        for t in self.tools:
            meta = TOOLS[t["name"]]
            self.assertTrue(callable(getattr(ToolMethods, meta["method"])), t["name"])
            self.assertEqual(set(meta["params"].values()), set(t["inputSchema"].get("properties", {})), t["name"])
            self.assertEqual(list(meta["required"]), t["inputSchema"].get("required", []), t["name"])
            self.assertEqual(meta["read_only"], t["annotations"]["readOnlyHint"], t["name"])

    def test_required_parameters_are_positional_and_optional_keyword_only(self):
        for t in self.tools:
            meta = TOOLS[t["name"]]
            sig = inspect.signature(getattr(ToolMethods, meta["method"]))
            mcp_of = meta["params"]
            for name, p in list(sig.parameters.items())[1:]:
                required = mcp_of[name] in t["inputSchema"].get("required", [])
                kind = inspect.Parameter.POSITIONAL_OR_KEYWORD if required else inspect.Parameter.KEYWORD_ONLY
                self.assertEqual(p.kind, kind, f"{t['name']}.{name}")
                if not required:
                    self.assertIsNone(p.default)

    def test_docstrings_carry_the_tool_description(self):
        for t in self.tools:
            doc = getattr(ToolMethods, TOOLS[t["name"]]["method"]).__doc__
            self.assertIn(f"``{t['name']}``", doc)
            first_words = " ".join(t["description"].split()[:4])
            self.assertIn(first_words, " ".join(doc.split()))

    @unittest.skipUnless(node(), "node is not installed")
    def test_generated_file_is_up_to_date(self):
        script = os.path.join(REPO, "python", "scripts", "generate-tools.mjs")
        r = subprocess.run([node(), script, "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)


class ArgumentMapping(unittest.TestCase):
    def test_snake_case_arguments_become_the_mcp_names(self):
        rec = Recorder()
        rec.merge_pdf(["/a.pdf"], position="start")
        rec.new_blank_pdf(100, 200, pages=2)
        self.assertEqual(rec.calls[0], ("app_merge_pdf", {"filePaths": ["/a.pdf"], "position": "start"}))
        self.assertEqual(rec.calls[1], ("app_new_blank_pdf", {"widthPt": 100, "heightPt": 200, "pages": 2}))

    def test_none_leaves_an_argument_out_and_null_sends_json_null(self):
        rec = Recorder()
        rec.save_pdf()
        rec.close_tab(0, force=True, save=None)
        self.assertEqual(rec.calls[0], ("app_save_pdf", {}))
        self.assertEqual(rec.calls[1], ("app_close_tab", {"index": 0, "force": True}))
        meta = TOOLS["app_approval_routing"]
        self.assertIn("expires_at", meta["params"])
        rec.approval_routing("draft", expires_at=NULL)
        self.assertEqual(rec.calls[2], ("app_approval_routing", {"action": "draft", "expiresAt": None}))

    def test_missing_required_argument_is_a_type_error(self):
        with self.assertRaises(TypeError):
            Recorder().open_pdf()  # type: ignore[call-arg]

    def test_package_exports(self):
        self.assertIs(ops.TOOLS, TOOLS)
        self.assertTrue(issubclass(ops.Tools, ToolMethods))
        self.assertTrue(ops.__version__)


if __name__ == "__main__":
    unittest.main()
