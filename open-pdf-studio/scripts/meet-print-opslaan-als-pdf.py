# Proef voor het doel "Opslaan als PDF" in de printdialoog, deel 2 van 2 (zie
# scripts/print-opslaan-als-pdf-proef.mjs): meet met PyMuPDF wat er in elke
# print-PDF staat.
#
#   python scripts/meet-print-opslaan-als-pdf.py [map]
#
# Per bestand:
#   - het vel ligt zoals gevraagd (MediaBox breder dan hoog = liggend), /Rotate 0;
#   - de tekst is tekst gebleven (get_text vindt de woorden) en staat zoals de
#     app de bronpagina toont (dus met haar /Rotate), of een kwartslag linksom
#     als de pagina haaks op een handmatig gekozen vel stond;
#   - het beeld is dat van de getoonde bronpagina (vergeleken op 36 dpi, bij een
#     vel van dezelfde maat als de pagina);
#   - de lijnen zijn lijnen gebleven (get_drawings vindt paden);
#   - er staat geen paginavullende afbeelding in (de gerasterde printopdracht
#     heeft er precies één die het hele vel bedekt).

import json
import os
import pathlib
import sys

import fitz  # PyMuPDF
import numpy as np

MM_PER_PT = 25.4 / 72
# naam: (vel breedte, vel hoogte) in mm
VERWACHT_VEL = {
    'a2-liggend-auto': (594, 420),
    'a2-rotate90-auto': (594, 420),
    'a2-staand-op-liggend-vel': (594, 420),
    'a2-op-a0l': (1399, 841),
    'a2-op-a3-werkelijk': (420, 297),
    'a2-liggend-met-markering': (594, 420),
}
WOORDEN = ['PLATTEGROND', 'BEGANE', 'GROND', 'schaal']


def richtingen(pagina):
    """Schrijfrichtingen van de tekstregels, in de coördinaten van de getoonde pagina."""
    return {tuple(round(v, 3) + 0.0 for v in regel['dir'])
            for blok in pagina.get_text('dict')['blocks'] if blok['type'] == 0
            for regel in blok['lines']}


def linksom(richting):
    """Een kwartslag linksom op het scherm (y omlaag): (x, y) -> (y, -x)."""
    return (richting[1] + 0.0, -richting[0] + 0.0)


def getoond(richting, rotate):
    """PyMuPDF geeft de schrijfrichting in de ongedraaide pagina; /Rotate draait met de klok mee."""
    for _ in range((rotate // 90) % 4):
        richting = (-richting[1] + 0.0, richting[0] + 0.0)
    return richting


def grijs(pagina, dpi=36):
    pix = pagina.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, : pix.width]


def meet(pad, naam, met_markering, gedraaid):
    fouten = []
    doc = fitz.open(pad)
    bron = fitz.open(str(pad).replace('.pdf', '.bron.pdf'))[0]
    if doc.page_count != 1:
        fouten.append(f'{doc.page_count} pagina\'s')
    pagina = doc[0]
    b, h = pagina.mediabox.width * MM_PER_PT, pagina.mediabox.height * MM_PER_PT
    vb, vh = VERWACHT_VEL[naam]
    if abs(b - vb) > 0.5 or abs(h - vh) > 0.5:
        fouten.append(f'vel {b:.1f} x {h:.1f} mm, verwacht {vb} x {vh}')
    if not b > h:
        fouten.append('het vel ligt niet (niet breder dan hoog)')
    if pagina.rotation != 0:
        fouten.append(f'/Rotate {pagina.rotation}')

    tekst = pagina.get_text()
    # Afgesneden op ware grootte valt de titel buiten het vel; de tekst staat er dan nog wel in.
    ontbreekt = [w for w in WOORDEN if w not in tekst]
    if ontbreekt and naam != 'a2-op-a3-werkelijk':
        fouten.append(f'tekst ontbreekt: {ontbreekt}')
    # De tekst staat zoals de app de bronpagina toont; haaks op het vel een kwartslag linksom.
    verwacht = {getoond(r, bron.rotation) for r in richtingen(bron)}
    verwacht = {linksom(r) if gedraaid else r for r in verwacht}
    if naam != 'a2-op-a3-werkelijk' and richtingen(pagina) != verwacht:
        fouten.append(f'tekst staat {richtingen(pagina)}, verwacht {verwacht}')

    # Hetzelfde beeld als de getoonde bronpagina (alleen bij een vel van de paginamaat).
    verschil = None
    if naam in ('a2-liggend-auto', 'a2-rotate90-auto', 'a2-staand-op-liggend-vel'):
        a, b_ = grijs(pagina), grijs(bron)
        if gedraaid:
            b_ = np.rot90(b_)  # een kwartslag linksom
        rijen, kolommen = min(a.shape[0], b_.shape[0]), min(a.shape[1], b_.shape[1])
        if abs(a.shape[0] - b_.shape[0]) > 1 or abs(a.shape[1] - b_.shape[1]) > 1:
            fouten.append(f'beeld {a.shape} tegenover bron {b_.shape}')
        verschil = float((np.abs(a[:rijen, :kolommen].astype(int) - b_[:rijen, :kolommen].astype(int)) > 96).mean())
        if verschil > 0.01:
            fouten.append(f'beeld wijkt af van de getoonde bron: {verschil:.2%} van de pixels')

    paden = pagina.get_drawings()
    if len(paden) < 10:
        fouten.append(f'maar {len(paden)} vectorpaden')

    vel_opp = pagina.rect.width * pagina.rect.height
    beelden = pagina.get_image_info()
    grootste = max((fitz.Rect(i['bbox']).get_area() / vel_opp for i in beelden), default=0.0)
    if grootste > 0.5:
        fouten.append(f'afbeelding bedekt {grootste:.0%} van het vel')
    if met_markering and not beelden:
        fouten.append('de markering ontbreekt')
    if not met_markering and beelden:
        fouten.append(f'{len(beelden)} afbeelding(en) zonder markering')

    print(f'{naam:30} vel {b:6.1f} x {h:6.1f} mm  /Rotate {pagina.rotation}  tekst {"ja" if not ontbreekt else "deels"}'
          f' ({len(tekst.split())} woorden)  paden {len(paden):3}  afbeeldingen {len(beelden)}'
          f' (grootste {grootste:.1%} van het vel)'
          f'{"" if verschil is None else f"  beeldverschil {verschil:.2%}"}'
          f'  {"OK" if not fouten else "FOUT: " + "; ".join(fouten)}')
    return fouten


def main():
    map_ = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                        else os.path.join(os.environ.get('TEMP', '/tmp'), 'opds-print-als-pdf-proef'))
    lijst = json.loads((map_ / 'proef.json').read_text(encoding='utf-8'))
    fouten = 0
    for geval in lijst:
        fouten += len(meet(map_ / f"{geval['naam']}.pdf", geval['naam'], geval['markering'], geval['gedraaid']))
    print(f'\n{len(lijst)} print-PDF\'s gemeten, {fouten} afwijking(en)')
    sys.exit(1 if fouten else 0)


if __name__ == '__main__':
    main()
