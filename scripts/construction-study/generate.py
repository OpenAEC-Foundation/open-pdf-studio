"""Create original, deterministic drawing fixtures for issue #942."""
import argparse
import hashlib
import json
from pathlib import Path

import reportlab
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[2]
PT_PER_MM = 72 / 25.4
SCALE = PT_PER_MM / 50


def label(c, x, y, text, size=12):
    c.setFont('StudySans', size)
    c.drawString(x, y, text)


def sheet(c, identifier, title):
    c.setLineWidth(1)
    c.rect(30, 30, 1130, 780)
    label(c, 50, 780, identifier + ' | ' + title, 18)
    label(c, 50, 755, 'Synthetic study drawing - no real project data', 11)
    label(c, 50, 50, 'Open PDF Studio study #942 | Original fixture | LGPL-3.0 license | A3 landscape', 10)


def new_pdf(path):
    c = canvas.Canvas(str(path), pagesize=landscape(A3), invariant=1, pageCompression=0)
    c.setTitle('Construction workflow study fixture')
    c.setAuthor('Open PDF Studio contributors')
    return c


def plan(c, revised=False):
    sheet(c, 'S01', 'Plan')
    c.saveState()
    if revised:
        c.translate(12, -8)
    c.rect(100, 220, 420, 300)
    c.line(320 if revised else 300, 220, 320 if revised else 300, 520)
    c.rect(170, 515, 70, 10)
    if revised:
        c.rect(370, 515, 70, 10)
    else:
        c.rect(400, 300, 40, 40)
    label(c, 150, 370, 'ROOM 01')
    label(c, 370, 370, 'ROOM 02')
    c.restoreState()
    label(c, 650, 500, 'Window = narrow rectangle on outer wall')
    label(c, 650, 475, 'Equipment = square inside room')
    c.showPage()


def section(c):
    sheet(c, 'S02', 'Section')
    c.rect(100, 220, 650, 240)
    c.line(100, 340, 750, 340)
    label(c, 120, 480, 'SECTION A-A')
    c.showPage()


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    font = ROOT / "open-pdf-studio/public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf"
    pdfmetrics.registerFont(TTFont("StudySans", str(font)))
    c = new_pdf(output / 'revision-a.pdf')
    plan(c)
    section(c)
    c.save()
    c = new_pdf(output / 'revision-b.pdf')
    plan(c, True)
    sheet(c, 'S03', 'New detail sheet')
    c.rect(100, 250, 260, 180)
    label(c, 100, 460, 'ADDED DETAIL D-01')
    c.showPage()
    section(c)
    c.save()
    c = new_pdf(output / 'measure-count.pdf')
    sheet(c, 'M01', 'Calibration, room area and object groups')
    label(c, 70, 620, 'ROOM R1: measure width, height and area')
    c.rect(70, 230, 4700 * SCALE, 5200 * SCALE)
    label(c, 170, 370, 'R1', 18)
    for y, length, title in [(600, 5000, 'CALIBRATION: 5000 mm'), (490, 7500, 'CHECK: independent length')]:
        c.line(450, y, 450 + length * SCALE, y)
        for x in [450, 450 + length * SCALE]:
            c.line(x, y - 8, x, y + 8)
        label(c, 450, y + 22, title)
    label(c, 450, 400, 'Group A = circles; group B = squares')
    for i in range(6):
        x, y = 480 + (i % 3) * 100, 320 - (i // 3) * 90
        c.circle(x, y, 12)
        label(c, x + 20, y - 4, f'A{i + 1}')
    for i in range(4):
        x, y = 830 + (i % 2) * 100, 320 - (i // 2) * 90
        c.rect(x - 12, y - 12, 24, 24)
        label(c, x + 20, y - 4, f'B{i + 1}')
    label(c, 450, 130, 'Count all symbols, delete A6, then reassign A2 to group B.')
    c.showPage()
    c.save()
    manifest = {
        'schemaVersion': 1, 'license': 'LGPL-3.0 (repository LICENSE.md); embedded Liberation Sans under SIL OFL 1.1',
        'provenance': 'Original synthetic vector drawings; no external drawings or images.',
        'font': {'path': str(font.relative_to(ROOT)), 'sha256': hashlib.sha256(font.read_bytes()).hexdigest(), 'license': 'LICENSE_LIBERATION'},
        'generator': {'path': 'scripts/construction-study/generate.py', 'reportlab': reportlab.Version},
        'coordinates': 'PDF points, bottom-left origin, unrotated A3 landscape; CropBox = MediaBox',
        'files': [{'path': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'pages': n}
                  for p, n in [(output / 'revision-a.pdf', 2), (output / 'revision-b.pdf', 3), (output / 'measure-count.pdf', 1)]],
        'compare': {
            'pagePairs': [{'a': 1, 'b': 1, 'sheet': 'S01'}, {'a': 2, 'b': 3, 'sheet': 'S02'}],
            'insertedSheets': [{'b': 2, 'sheet': 'S03'}],
            'planTranslationPoints': [12, -8],
            'changesBeforeTranslation': [
                {'id': 'C1', 'kind': 'partition moved', 'old': [300, 220, 300, 520], 'new': [320, 220, 320, 520]},
                {'id': 'C2', 'kind': 'window added', 'rect': [370, 515, 70, 10]},
                {'id': 'C3', 'kind': 'equipment removed', 'rect': [400, 300, 40, 40]}],
            'unchangedSheet': 'S02; stream identical despite page index change'},
        'measure': {'scale': '1:50', 'calibrationMm': 5000, 'checkMm': 7500,
                    'roomWidthMm': 4700, 'roomHeightMm': 5200, 'roomAreaM2': 24.44,
                    'lengthToleranceMm': 10, 'areaToleranceM2': 0.1},
        'count': {'initial': {'A': 6, 'B': 4}, 'delete': 'A6', 'reassign': {'id': 'A2', 'from': 'A', 'to': 'B'},
                  'final': {'A': 4, 'B': 5}, 'finalTotal': 9},
        'studyStatus': 'NOT_RUN: fixture verification is not product workflow validation'
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'fixtures/construction-study')
    generate(parser.parse_args().output)
