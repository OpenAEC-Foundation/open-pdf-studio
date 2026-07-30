"""Controleert of de annotaties op dezelfde plek staan als in een onafhankelijke
referentie-render.

Achtergrond: bij pagina's met /Rotate is een terugkerende klacht dat de
annotaties gedraaid staan. Een screenshot alleen bewijst niets, want de app
maskeert een verkeerd ingelezen appearance-stream door hem bij het laden te
corrigeren. Deze controle vergelijkt daarom de annotatielaag van de app met de
annotatie-inkt die pypdfium2 zelf op de pagina zet.

Maat: welk deel van de referentie-annotatie-inkt de app op diezelfde plek
tekent. Correct is >= 80%. Ligt de dekking na 90 graden draaien duidelijk
hoger, dan staat de laag daadwerkelijk gedraaid.

Gebruik:
    python scripts/verify-annotatie-plaatsing.py [uitvoermap] [pdf-map]

De uitvoermap is die van verify-annotatie-plaatsing.mjs (standaard
annotatie-plaatsing). Per bestand komt er een verschilbeeld bij: rood is alleen
referentie, groen alleen app, blauw beide.
"""
import json
import os
import sys

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageChops

UIT = sys.argv[1] if len(sys.argv) > 1 else "annotatie-plaatsing"
MAP = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\rickd\Documents\GitHub\verification-files\PDF-bestanden"

DREMPEL_GOED = 0.80
DREMPEL_GEDRAAID = 0.15  # hoeveel beter de gedraaide variant moet passen
SCHAAL = 0.4


def referentiemasker(pad, slug):
    """Annotatie-inkt isoleren door met en zonder annotaties te renderen."""
    pagina = pdfium.PdfDocument(pad)[0]
    met = pagina.render(scale=SCHAAL, draw_annots=True).to_pil().convert("RGB")
    zonder = pagina.render(scale=SCHAAL, draw_annots=False).to_pil().convert("RGB")
    masker = ImageChops.difference(met, zonder).convert("L").point(lambda v: 255 if v > 24 else 0)
    masker.save(os.path.join(UIT, f"{slug}__ref.png"))
    return masker


def appmasker(rij, doelformaat):
    """De annotatielaag van de app uitsnijden op het paginavak en opschalen."""
    im = Image.open(rij["png"]).convert("RGBA")
    zoom, ox, oy = rij["zoom"], rij["ox"], rij["oy"]
    vak = (
        max(0, int(ox)),
        max(0, int(oy)),
        min(im.width, int(ox + rij["pageW"] * zoom)),
        min(im.height, int(oy + rij["pageH"] * zoom)),
    )
    if vak[2] - vak[0] < 5 or vak[3] - vak[1] < 5:
        return None
    laag = im.crop(vak).split()[3].point(lambda v: 255 if v > 40 else 0)
    return laag.resize(doelformaat, Image.BILINEAR).point(lambda v: 255 if v > 60 else 0)


def dekking(masker_a, masker_b):
    return float((masker_a & masker_b).sum()) / masker_a.sum() if masker_a.sum() else None


rapport = json.load(open(os.path.join(UIT, "rapport.json"), encoding="utf-8"))
regels = []

for rij in rapport:
    naam = rij["bestand"]
    if not rij.get("png") or not os.path.exists(rij["png"]):
        continue
    try:
        ref = referentiemasker(os.path.join(MAP, naam), rij["slug"])
        app = appmasker(rij, ref.size)
        if app is None:
            regels.append((naam, rij.get("appAnnots"), None, None, "paginavak buiten canvas"))
            continue
        a = np.array(ref, dtype=bool)
        b = np.array(app, dtype=bool)
        if not a.any():
            regels.append((naam, rij.get("appAnnots"), None, None, "geen referentie-inkt"))
            continue
        gedraaid = np.array(
            app.rotate(90, expand=True).resize(ref.size, Image.BILINEAR).point(lambda v: 255 if v > 60 else 0),
            dtype=bool,
        )
        regels.append((naam, rij.get("appAnnots"), dekking(a, b), dekking(a, gedraaid), None))

        verschil = np.zeros(a.shape + (3,), dtype=np.uint8)
        verschil[..., 0] = np.where(a & ~b, 255, 0)
        verschil[..., 1] = np.where(b & ~a, 255, 0)
        verschil[..., 2] = np.where(a & b, 200, 0)
        Image.fromarray(verschil).save(os.path.join(UIT, f"{rij['slug']}__vergelijk.png"))
    except Exception as fout:  # noqa: BLE001 - een onleesbaar bestand mag de sweep niet stoppen
        regels.append((naam, rij.get("appAnnots"), None, None, str(fout)[:70]))

print(f'{"bestand":50} {"annots":>6} {"dekking":>8} {"idem 90":>8}  oordeel')
print("-" * 96)
verdacht = []
for naam, aantal, d, d90, fout in regels:
    if fout:
        oordeel = f"niet meetbaar: {fout}"
    elif d >= DREMPEL_GOED:
        oordeel = "GOED"
    elif d90 and d90 > d + DREMPEL_GEDRAAID:
        oordeel = "GEDRAAID"
        verdacht.append(naam)
    else:
        oordeel = "AFWIJKEND"
        verdacht.append(naam)
    print(
        f"{naam[:50]:50} {str(aantal or '-'):>6} "
        f'{"-" if d is None else f"{d * 100:.1f}%":>8} '
        f'{"-" if d90 is None else f"{d90 * 100:.1f}%":>8}  {oordeel}'
    )

print()
print("aandacht nodig:", ", ".join(verdacht) if verdacht else "geen")
sys.exit(1 if verdacht else 0)
