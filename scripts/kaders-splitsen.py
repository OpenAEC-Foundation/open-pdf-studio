#!/usr/bin/env python
"""Splits de meegeleverde grootformaat-kaders in een KAAL kader + een losse
ONDERHOEK.

Aanleiding: het titelblok zat in het kader-PDF ingebakken, waardoor je het
niet kon vervangen door je eigen bedrijfsonderhoek. Na deze omzetting is:

  * kaders/grootformaat_<formaat>_<richting>.pdf  — alleen achtergrond + rand
  * onderhoeken/openaec.pdf                       — het titelblok als los vel

De applicatie zet de twee bij het aanmaken van een document weer samen; wie
een eigen onderhoek uploadt, krijgt die op dezelfde plek.

De maatvoering komt uit het bestaande A1-kader en volgt de NEN-conventie:
10 mm kadermarge, onderhoek 190 x 110 mm tegen de rechteronderhoek.

Gebruik:  python scripts/kaders-splitsen.py [--dry-run]
"""
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from reportlab.pdfgen import canvas as rl
from reportlab.lib.colors import Color

WORTEL = Path(__file__).resolve().parents[1]
KADERS = WORTEL / 'open-pdf-studio' / 'src-tauri' / 'resources' / 'kaders'
ONDERHOEKEN = WORTEL / 'open-pdf-studio' / 'src-tauri' / 'resources' / 'onderhoeken'

MM = 72 / 25.4
MARGE = 10 * MM              # 28,3465 pt — kadermarge, uit het origineel
ONDERHOEK_B = 190 * MM       # 538,58 pt
ONDERHOEK_H = 110 * MM       # 311,81 pt

# Kleuren uit het origineel (content-stream van grootformaat_a1_liggend.pdf)
ACHTERGROND = Color(0.980392, 0.980392, 0.976471)   # #FAFAF9
LIJN = Color(0.211765, 0.211765, 0.243137)          # #36363E
LIJNDIKTE = 1


def onderhoek_uitsnijden(bron: Path, doel: Path, dry: bool) -> None:
    """Snijd het titelblok rechtsonder uit een bestaand kader."""
    r = PdfReader(str(bron))
    p = r.pages[0]
    mb = p.mediabox
    breedte, hoogte = float(mb.width), float(mb.height)
    x0 = breedte - MARGE - ONDERHOEK_B
    y0 = MARGE
    doos = RectangleObject((x0, y0, x0 + ONDERHOEK_B, y0 + ONDERHOEK_H))
    p.mediabox = doos
    p.cropbox = doos
    print(f'  onderhoek uit {bron.name}: {ONDERHOEK_B:.1f} x {ONDERHOEK_H:.1f} pt @ ({x0:.1f}, {y0:.1f})')
    if dry:
        return
    w = PdfWriter()
    w.add_page(p)
    doel.parent.mkdir(parents=True, exist_ok=True)
    with open(doel, 'wb') as f:
        w.write(f)


def kaal_kader(doel: Path, breedte: float, hoogte: float, dry: bool) -> None:
    """Achtergrondvlak + kaderrand, verder niets."""
    print(f'  kaal kader {doel.name}: {breedte:.1f} x {hoogte:.1f} pt')
    if dry:
        return
    c = rl.Canvas(str(doel), pagesize=(breedte, hoogte))
    c.setTitle(doel.stem)
    c.setFillColor(ACHTERGROND)
    c.rect(0, 0, breedte, hoogte, fill=1, stroke=0)
    c.setStrokeColor(LIJN)
    c.setLineWidth(LIJNDIKTE)
    c.rect(MARGE, MARGE, breedte - 2 * MARGE, hoogte - 2 * MARGE, fill=0, stroke=1)
    c.showPage()
    c.save()


def main() -> int:
    dry = '--dry-run' in sys.argv
    if not KADERS.is_dir():
        print('kadersmap niet gevonden:', KADERS)
        return 1

    groot = sorted(KADERS.glob('grootformaat_*.pdf'))
    if not groot:
        print('geen grootformaat-kaders gevonden')
        return 1

    # De onderhoek komt uit het A1-liggend kader (het referentieformaat);
    # alle grootformaat-kaders dragen hetzelfde titelblok.
    bron = next((p for p in groot if 'a1_liggend' in p.name), groot[0])
    print('Onderhoek uitsnijden')
    onderhoek_uitsnijden(bron, ONDERHOEKEN / 'openaec.pdf', dry)

    print('Kale kaders schrijven')
    for pad in groot:
        r = PdfReader(str(pad))
        mb = r.pages[0].mediabox
        kaal_kader(pad, float(mb.width), float(mb.height), dry)

    print('\nKlaar.' if not dry else '\nProefdraai — er is niets geschreven.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
