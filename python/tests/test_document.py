"""Document wrappers: tabs, annotations, pages, save and export."""

from __future__ import annotations

import json
import os
import unittest

from helpers import FakeServerCase

import open_pdf_studio as ops
from open_pdf_studio import Document


class DocumentWorkflow(FakeServerCase):
    def test_open_annotate_save(self):
        doc = self.app.open(self.make_pdf("a.pdf"))
        self.assertEqual(doc.page_count, 3)
        ann = doc.annotations.add("box", page=1, x=10, y=20, width=100, height=50, strokeColor="#ff0000")
        self.assertTrue(ann.startswith("ann-"))
        self.assertEqual(len(doc.annotations), 1)
        doc.annotations.update(ann, strokeColor="#0000ff")
        self.assertEqual(doc.annotations.get(ann)["strokeColor"], "#0000ff")
        out = os.path.join(self.tmp, "out.pdf")
        doc.save(out)
        self.assertEqual(doc.path, out)
        with open(out, encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual(saved["annotations"][0]["x"], 10)
        call = [c for c in self.state()["calls"] if c["name"] == "app_create_annotation"][0]
        self.assertEqual(call["arguments"], {"type": "box", "page": 1, "props": {"x": 10, "y": 20, "width": 100, "height": 50, "strokeColor": "#ff0000"}})

    def test_each_call_activates_its_own_tab(self):
        a = self.app.open(self.make_pdf("a.pdf"))
        b = self.app.open(self.make_pdf("b.pdf"))
        self.assertEqual((a.tab_index, b.tab_index), (0, 1))
        a.annotations.add("comment", x=5, y=5, text="on a")
        b.annotations.add("comment", x=5, y=5, text="on b")
        tabs = self.state()["tabs"]
        self.assertEqual([t["annotations"][0]["text"] for t in tabs], ["on a", "on b"])
        self.assertEqual(self.app.documents, (a, b))

    def test_closing_shifts_the_tabs_after_it(self):
        a = self.app.open(self.make_pdf("a.pdf"))
        b = self.app.open(self.make_pdf("b.pdf"))
        c = self.app.open(self.make_pdf("c.pdf"))
        a.annotations.add("comment", x=1, y=1)
        with self.assertRaisesRegex(ops.ToolError, "unsaved"):
            a.close()
        a.close(force=True)
        self.assertTrue(a.closed)
        self.assertEqual((b.tab_index, c.tab_index), (0, 1))
        c.annotations.add("comment", x=1, y=1, text="c")
        self.assertEqual(self.state()["tabs"][1]["annotations"][0]["text"], "c")
        with self.assertRaises(ops.OpenPdfStudioError):
            a.page_count

    def test_context_manager_closes_the_tab(self):
        with self.app.open(self.make_pdf("a.pdf")) as doc:
            doc.annotations.add("comment", x=1, y=1)
        self.assertTrue(doc.closed)
        self.assertEqual(self.state()["tabs"], [])

    def test_new_document_merge_text_and_export(self):
        doc = self.app.new_document(pages=2)
        self.assertEqual(doc.page_count, 2)
        res = doc.pages.merge([self.make_pdf("x.pdf")], position="end")
        self.assertEqual(res["pagesAfter"], 3)
        self.assertEqual(len(doc.pages), 3)
        self.assertEqual(doc.text(page=1)["spans"][0]["text"], "Hello")
        png = os.path.join(self.tmp, "p1.png")
        doc.export_image(png, page=1, dpi=300)
        jpg = os.path.join(self.tmp, "p1.jpg")
        doc.export_image(jpg, page=1, dpi=72)
        calls = [c["arguments"] for c in self.state()["calls"] if c["name"] == "app_capture_region"]
        self.assertEqual((calls[0]["format"], calls[0]["dpi"]), ("png", 300))
        self.assertEqual(calls[1]["format"], "jpeg")
        self.assertTrue(os.path.getsize(png) > 0)

    def test_page_operations_without_a_tool_are_unsupported(self):
        doc = self.app.open(self.make_pdf("a.pdf"))
        with self.assertRaisesRegex(ops.UnsupportedOperationError, "app_rotate_pages"):
            doc.pages.rotate([1], 90)
        with self.assertRaises(ops.UnsupportedOperationError):
            doc.pages.delete([2])

    def test_cad_file_needs_a_dialog(self):
        with self.assertRaisesRegex(ops.UnsupportedOperationError, "cad-import"):
            self.app.open(os.path.join(self.tmp, "plan.dwg"))

    def test_document_open_uses_the_default_app(self):
        ops.set_default_app(self.app)
        self.addCleanup(ops.set_default_app, None)
        doc = Document.open(self.make_pdf("a.pdf"))
        self.assertIs(doc.client, self.app)
        self.assertIs(ops.default_app(), self.app)

    def test_document_tools_activate_first(self):
        a = self.app.open(self.make_pdf("a.pdf"))
        self.app.open(self.make_pdf("b.pdf"))
        self.assertEqual(a.tools.get_page_count()["pageCount"], 3)
        self.assertEqual(self.app.tools.list_tabs()["activeIndex"], 0)


class PageToolsWhenAdvertised(FakeServerCase):
    """Once the app advertises a page tool, the wrapper uses it (no library change)."""

    extra_env = {"FAKE_EXTRA_TOOLS": "app_rotate_pages"}

    def test_rotate_calls_the_tool(self):
        doc = self.app.open(self.make_pdf("a.pdf"))
        doc.pages.rotate([1, 3], 90)
        out = os.path.join(self.tmp, "r.pdf")
        doc.save(out)
        with open(out, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["rotation"], {"1": 90, "3": 90})


if __name__ == "__main__":
    unittest.main()
