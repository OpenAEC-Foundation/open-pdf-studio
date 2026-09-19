# Proef voor de schaal uit de printdialoog, deel 3 van 3 (zie
# scripts/print-schaal-proef.mjs): meet in elke PDF waar de inhoud op het vel
# staat en vergelijkt dat met de verwachting.
#
#   python scripts/meet-print-schaal-proef.py [map] [--bron]
#
# Zonder --bron de uitvoer van de virtuele pdf-printer (uit-*.pdf), met --bron
# de tijdelijke print-PDF's zelf (bron-*.pdf). Vereist PyMuPDF en numpy.
#
# De verwachte plekken staan hier los uitgerekend, niet uit de code die getest
# wordt: A4 = 210 x 297 mm, A3 = 297 x 420 mm, gecentreerd = (vel - pagina) / 2.
# Gemeten: de omhullende van de donkere pixels (de rand van de bronpagina) op
# 600 dpi, en de omhullende van de geplaatste afbeeldingen.

import os
import pathlib
import sys

import fitz  # PyMuPDF
import numpy as np

MM_PER_PT = 25.4 / 72
TOLERANTIE_MM = 0.5
DPI = 600

S_PASSEND = min(297 / 210, 420 / 297)  # A4 passend op A3
# naam: (vel b, vel h, x, y, b, h) in mm, van de inhoud op het vel
VERWACHT = {
    'a4-a3-werkelijk': (297, 420, 43.5, 61.5, 210, 297),
    'a4-a3-schaal-50': (297, 420, 96, 135.75, 105, 148.5),
    'a4-a3-schaal-10': (297, 420, 138, 195.15, 21, 29.7),
    'a4-a3-passend': (297, 420, (297 - 210 * S_PASSEND) / 2, 0, 210 * S_PASSEND, 420),
    'a4-a3-schaal-50-linksboven': (297, 420, 0, 0, 105, 148.5),
    'a4-liggend-a3-werkelijk': (420, 297, 61.5, 43.5, 297, 210),
    # A2 op A3 op ware grootte: alleen de binnenrand (op 50 ; 50 mm) valt op het vel.
    'a2-a3-werkelijk-afgesneden': (297, 420, 50, 50, 197, 320),
    # Onbekend papier: de oude weg, de printer past de A4 in het A3-vel.
    'a4-onbekend-papier': (297, 420, (297 - 210 * S_PASSEND) / 2, 0, 210 * S_PASSEND, 420),
}
# De tijdelijke print-PDF bij onbekend papier is de pagina zelf.
VERWACHT_BRON = dict(VERWACHT, **{'a4-onbekend-papier': (210, 297, 0, 0, 210, 297)})


def donker_mm(pagina):
    pix = pagina.get_pixmap(dpi=DPI, colorspace=fitz.csGRAY, alpha=False)
    beeld = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, : pix.width]
    rijen = np.where((beeld < 128).any(axis=1))[0]
    kolommen = np.where((beeld < 128).any(axis=0))[0]
    if len(rijen) == 0:
        return None
    px = 25.4 / DPI
    x0, x1 = kolommen[0], kolommen[-1] + 1
    y0, y1 = rijen[0], rijen[-1] + 1
    return (x0 * px, y0 * px, (x1 - x0) * px, (y1 - y0) * px)


def afbeeldingen_mm(pagina):
    kaders = [fitz.Rect(i['bbox']) for i in pagina.get_image_info()]
    if not kaders:
        return None
    r = kaders[0]
    for k in kaders[1:]:
        r |= k
    r &= pagina.rect
    return (r.x0 * MM_PER_PT, r.y0 * MM_PER_PT, r.width * MM_PER_PT, r.height * MM_PER_PT), len(kaders)


def tekst(r):
    return '(%7.2f ; %7.2f) %7.2f x %7.2f' % r if r else '-'


def main():
    argumenten = [a for a in sys.argv[1:] if not a.startswith('--')]
    bron = '--bron' in sys.argv
    standaard = pathlib.Path(os.environ.get('TEMP', '/tmp')) / 'opds-printschaal-probe'
    map_ = pathlib.Path(argumenten[0]) if argumenten else standaard
    verwacht_per_naam = VERWACHT_BRON if bron else VERWACHT
    fouten = 0
    print('%-28s %-15s %-44s %-44s %s' % ('geval', 'vel (mm)', 'inhoud gemeten (x ; y) b x h mm',
                                          'verwacht', 'afwijking'))
    for naam, verwacht in verwacht_per_naam.items():
        pad = map_ / (('bron-' if bron else 'uit-') + naam + '.pdf')
        if not pad.exists():
            print('%-28s ONTBREEKT: %s' % (naam, pad))
            fouten += 1
            continue
        with fitz.open(pad) as doc:
            pagina = doc[0]
            vel = (pagina.rect.width * MM_PER_PT, pagina.rect.height * MM_PER_PT)
            gemeten = donker_mm(pagina)
            beelden = afbeeldingen_mm(pagina)
            aantal = len(doc)
        vel_afwijking = max(abs(vel[0] - verwacht[0]), abs(vel[1] - verwacht[1]))
        afwijking = max(abs(g - v) for g, v in zip(gemeten, verwacht[2:])) if gemeten else float('inf')
        ok = aantal == 1 and vel_afwijking <= TOLERANTIE_MM and afwijking <= TOLERANTIE_MM
        fouten += 0 if ok else 1
        print('%-28s %6.1f x %6.1f  %-44s %-44s %.2f mm %s' % (
            naam, vel[0], vel[1], tekst(gemeten), tekst(verwacht[2:]), afwijking, 'OK' if ok else 'FOUT'))
        if beelden:
            print('%-28s %-15s afbeelding(en): %s (%d stuk)' % ('', '', tekst(beelden[0]), beelden[1]))
    print('\n%d afwijking(en) groter dan %.1f mm' % (fouten, TOLERANTIE_MM))
    return 1 if fouten else 0


if __name__ == '__main__':
    sys.exit(main())
