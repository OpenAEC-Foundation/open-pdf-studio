"""Vergelijkt door de app opgeslagen kopieën met hun originelen.

Draait na verify-opslag-rondgang.mjs. Controleert per bestandspaar,
onafhankelijk van de app (pypdf + pypdfium2):

  1. het opgeslagen bestand is leesbaar;
  2. paginatal gelijk;
  3. per pagina: MediaBox en /Rotate ongewijzigd;
  4. de pagina-INHOUD (render zonder annotaties) is pixel-gelijk gebleven;
  5. de annotatie-inkt van het origineel wordt door de opgeslagen versie op
     dezelfde plek gedekt (>= 80%) — een rotatie- of verschuivingsfout bij het
     wegschrijven laat die dekking instorten.

Gebruik:
    python scripts/verify-opslag-rondgang.py [werkmap] [origineel-map]
"""
import json
import os
import sys

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageChops
from pypdf import PdfReader

WERK = sys.argv[1] if len(sys.argv) > 1 else "opslag-rondgang"
BRON = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\rickd\Documents\GitHub\verification-files\PDF-bestanden"
KOPIE = os.path.join(WERK, "kopie")
SCHAAL = 0.4
DREMPEL_INHOUD = 0.99   # dice-overlap van de kale pagina-inhoud
DREMPEL_ANNOTS = 0.80   # dekking van de originele annotatie-inkt


def structuur(pad):
    r = PdfReader(pad)
    paginas = []
    for p in r.pages:
        paginas.append({
            "mediabox": [round(float(v), 2) for v in p.mediabox],
            "rotate": int(p.get("/Rotate", 0) or 0),
        })
    annots = r.pages[0].get("/Annots") if r.pages else None
    if annots is not None and hasattr(annots, "get_object"):
        annots = annots.get_object()  # pypdf geeft /Annots soms als referentie
    return {"paginas": paginas, "annots_p1": len(annots or [])}


def maskers(pad, pagina_index):
    doc = pdfium.PdfDocument(pad)
    pg = doc[pagina_index]
    met = pg.render(scale=SCHAAL, draw_annots=True).to_pil().convert("RGB")
    zonder = pg.render(scale=SCHAAL, draw_annots=False).to_pil().convert("RGB")
    inhoud = np.array(zonder.convert("L").point(lambda v: 0 if v > 200 else 255), dtype=bool)
    ann = np.array(
        ImageChops.difference(met, zonder).convert("L").point(lambda v: 255 if v > 24 else 0),
        dtype=bool,
    )
    return inhoud, ann


def dice(a, b):
    tot = a.sum() + b.sum()
    return 1.0 if tot == 0 else 2.0 * float((a & b).sum()) / tot


rapport = json.load(open(os.path.join(WERK, "rapport.json"), encoding="utf-8"))
regels = []

for rij in rapport:
    naam = rij["bestand"]
    orig_pad = os.path.join(BRON, naam)
    kopie_pad = os.path.join(KOPIE, naam)
    if not rij.get("opgeslagen"):
        regels.append((naam, "NIET OPGESLAGEN" if rij.get("openOk") else f"niet geopend: {rij.get('fout', '?')}"))
        continue
    try:
        so = structuur(orig_pad)
        sk = structuur(kopie_pad)
        problemen = []
        if len(so["paginas"]) != len(sk["paginas"]):
            problemen.append(f"paginatal {len(so['paginas'])} -> {len(sk['paginas'])}")
        else:
            for i, (po, pk) in enumerate(zip(so["paginas"], sk["paginas"])):
                if po["mediabox"] != pk["mediabox"]:
                    problemen.append(f"p{i + 1} MediaBox {po['mediabox']} -> {pk['mediabox']}")
                if po["rotate"] != pk["rotate"]:
                    problemen.append(f"p{i + 1} /Rotate {po['rotate']} -> {pk['rotate']}")
        # Inhoud + annotaties op pagina 1 en op de middelste pagina.
        te_checken = sorted({0, max(0, len(so["paginas"]) // 2)}) if not problemen else []
        for i in te_checken:
            io, ao = maskers(orig_pad, i)
            ik, ak = maskers(kopie_pad, i)
            if io.shape != ik.shape:
                problemen.append(f"p{i + 1} renderformaat wijkt af")
                continue
            d = dice(io, ik)
            if d < DREMPEL_INHOUD:
                problemen.append(f"p{i + 1} inhoud gewijzigd (dice {d * 100:.1f}%)")
            if ao.sum() > 500:  # alleen zinvol als er meetbare annotatie-inkt is
                dek = float((ao & ak).sum()) / ao.sum()
                if dek < DREMPEL_ANNOTS:
                    problemen.append(f"p{i + 1} annotaties verschoven/gedraaid (dekking {dek * 100:.1f}%)")
        regels.append((naam, "; ".join(problemen) if problemen else "GOED"))
    except Exception as fout:  # noqa: BLE001 - één kapot paar mag de test niet stoppen
        regels.append((naam, f"BESCHADIGD/onleesbaar: {str(fout)[:80]}"))

print(f'{"bestand":52}  oordeel')
print("-" * 100)
schade = []
for naam, oordeel in regels:
    print(f"{naam[:52]:52}  {oordeel}")
    if oordeel not in ("GOED",) and not oordeel.startswith("niet geopend") and oordeel != "NIET OPGESLAGEN":
        schade.append(naam)

n_goed = sum(1 for _, o in regels if o == "GOED")
print(f"\n{n_goed} goed, {len(schade)} met schade, "
      f"{sum(1 for _, o in regels if o == 'NIET OPGESLAGEN')} niet opgeslagen")
if schade:
    print("SCHADE bij:", ", ".join(schade))
sys.exit(1 if schade else 0)
