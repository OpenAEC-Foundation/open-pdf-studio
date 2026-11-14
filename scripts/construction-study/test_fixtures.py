"""Validate committed PDF bytes independently with pypdf, not generator metadata."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'fixtures/construction-study'


def operations(page, operator):
    return [list(map(float, args)) for args, op in page.get_contents().operations if op == operator]


class FixturesTest(unittest.TestCase):
    def test_manifest_hashes_pages_and_geometry(self):
        manifest = json.loads((FIXTURES / 'manifest.json').read_text())
        for entry in manifest['files']:
            data = (FIXTURES / entry['path']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])
            pdf = PdfReader(FIXTURES / entry['path'])
            self.assertEqual(len(pdf.pages), entry['pages'])
            for page in pdf.pages:
                self.assertAlmostEqual(float(page.mediabox.width), 420 * 72 / 25.4, places=3)
                self.assertAlmostEqual(float(page.mediabox.height), 297 * 72 / 25.4, places=3)
                self.assertEqual(page.cropbox, page.mediabox)
                self.assertEqual(page.rotation, 0)
        self.assertEqual(manifest['count']['initial'], {'A': 6, 'B': 4})
        self.assertEqual(manifest['count']['final'], {'A': 4, 'B': 5})
        self.assertEqual(manifest['count']['finalTotal'], 9)
        self.assertEqual(manifest['measure']['roomAreaM2'], 24.44)

    def test_physical_lengths_and_area(self):
        page = PdfReader(FIXTURES / 'measure-count.pdf').pages[0]
        lines = []
        start = None
        for args, op in page.get_contents().operations:
            if op == b'm':
                start = list(map(float, args))
            elif op == b'l' and start is not None:
                lines.append((start, list(map(float, args))))
        for y, expected_mm in [(600, 5000), (490, 7500)]:
            start, end = next((a, b) for a, b in lines if a == [450, y] and b[1] == y)
            self.assertAlmostEqual((end[0] - start[0]) / 72 * 25.4 * 50, expected_mm, places=2)
        room = next(r for r in operations(page, b're') if r[:2] == [70, 230])
        width, height = [v / 72 * 25.4 * 50 for v in room[2:]]
        self.assertAlmostEqual(width, 4700, places=2)
        self.assertAlmostEqual(height, 5200, places=2)
        self.assertAlmostEqual(width * height / 1e6, 24.44, places=4)

    def test_count_objects_and_labels(self):
        page = PdfReader(FIXTURES / 'measure-count.pdf').pages[0]
        self.assertEqual(sum(r[2:] == [24, 24] for r in operations(page, b're')), 4)
        self.assertEqual(len(operations(page, b'c')), 24)  # Four cubic arcs per circle.
        lines = page.extract_text().splitlines()
        for name in ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4']:
            self.assertEqual(lines.count(name), 1)

    def test_revisions_shift_insert_and_exact_changes(self):
        a = PdfReader(FIXTURES / 'revision-a.pdf')
        b = PdfReader(FIXTURES / 'revision-b.pdf')
        self.assertEqual([p.extract_text().splitlines()[0].split(' | ')[0] for p in a.pages], ['S01', 'S02'])
        self.assertEqual([p.extract_text().splitlines()[0].split(' | ')[0] for p in b.pages], ['S01', 'S03', 'S02'])
        self.assertEqual(a.pages[1].get_contents().get_data(), b.pages[2].get_contents().get_data())
        self.assertIn([1, 0, 0, 1, 12, -8], operations(b.pages[0], b'cm'))
        old_rects = set(map(tuple, operations(a.pages[0], b're')))
        new_rects = set(map(tuple, operations(b.pages[0], b're')))
        self.assertEqual(old_rects - new_rects, {(400, 300, 40, 40)})
        self.assertEqual(new_rects - old_rects, {(370, 515, 70, 10)})
        self.assertEqual(operations(a.pages[0], b'm'), [[300, 220]])
        self.assertEqual(operations(a.pages[0], b'l'), [[300, 520]])
        self.assertEqual(operations(b.pages[0], b'm'), [[320, 220]])
        self.assertEqual(operations(b.pages[0], b'l'), [[320, 520]])

    def test_deterministic_regeneration(self):
        with tempfile.TemporaryDirectory() as output:
            subprocess.run([sys.executable, str(ROOT / 'scripts/construction-study/generate.py'), '--output', output], check=True)
            for filename in ['revision-a.pdf', 'revision-b.pdf', 'measure-count.pdf', 'manifest.json']:
                self.assertEqual((FIXTURES / filename).read_bytes(), (Path(output) / filename).read_bytes(), filename)


if __name__ == '__main__':
    unittest.main()
