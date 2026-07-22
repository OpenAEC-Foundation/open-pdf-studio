"""Externe-engine-verificatie voor de opgeslagen stavenreeks.

Controleert de HARDE EIS uit docs/superpowers/specs/2026-07-22-stavenreeks-design.md:
de stavenreeks moet in ELKE andere PDF-editor (a) zichtbaar en (b) als EEN
object verplaatsbaar zijn.

Wat dit script doet met een door de app opgeslagen KOPIE:
  1. Annotatie-dict inspecteren (pikepdf): subtype /Stamp, /Rect, /AP /N met
     /BBox == /Rect-afmeting en /Matrix == identiteit, geen top-level /Rotate,
     custom OPS_SR*-parameters aanwezig, leesbare /Contents.
  2. Zichtbaarheid bewijzen in TWEE onafhankelijke engines: pypdfium2 en
     PyMuPDF renderen de pagina; er moet inkt staan binnen de /Rect en de
     pagina mag niet leeg zijn.
  3. Verplaatsbaarheid bewijzen: /Rect programmatisch verschuiven (zoals een
     andere editor doet), opnieuw renderen en aantonen dat de inkt is
     meegeschoven naar de nieuwe plek.

Gebruik:
    python scripts/verify-stavenreeks-roundtrip.py <kopie.pdf> [uitvoer-map]
"""

import sys
import os

# De Windows-console is standaard cp1252 en kan het ⌀-teken niet printen.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import pikepdf
import pypdfium2 as pdfium
import fitz  # PyMuPDF

FAIL = []
CHECKS = [0]


def check(name, cond, extra=""):
    CHECKS[0] += 1
    if cond:
        print(f"  ok   {name}")
    else:
        FAIL.append(name)
        print(f"  FAIL {name}" + (f" - {extra}" if extra else ""))


def ink_bbox(img, threshold=200):
    """Bounding box + pixelcount of alles wat donkerder is dan `threshold`.

    `img` is een PIL-afbeelding in RGB OP WITTE ACHTERGROND. Beide engines
    renderen zonder alfakanaal, anders telt een transparante (en dus als
    zwart opgeslagen) achtergrond mee als inkt.
    """
    gray = img.convert("L")
    mask = gray.point(lambda p: 255 if p < threshold else 0, mode="L")
    bbox = mask.getbbox()
    count = mask.histogram()[255]
    if bbox is None:
        return None, 0
    # getbbox levert rechts/onder EXCLUSIEF; maak er inclusieve grenzen van.
    return (bbox[0], bbox[1], bbox[2] - 1, bbox[3] - 1), count


def render_pdfium(path, page_index=0, scale=2.0):
    doc = pdfium.PdfDocument(path)
    page = doc[page_index]
    bitmap = page.render(scale=scale, draw_annots=True)
    return bitmap.to_pil().convert("RGB")


def render_mupdf(path, page_index=0, scale=2.0):
    doc = fitz.open(path)
    page = doc[page_index]
    # alpha=False -> witte achtergrond i.p.v. transparant (zie ink_bbox).
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), annots=True, alpha=False)
    from PIL import Image
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("RGB")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(path))
    os.makedirs(outdir, exist_ok=True)

    print(f"\nBestand: {path}")

    # ── 1. Annotatie-dict ────────────────────────────────────────────────
    print("\n1. Annotatie-dict (pikepdf)")
    pdf = pikepdf.open(path)
    page = pdf.pages[0]
    annots = page.get("/Annots", [])
    sr = None
    for a in annots:
        if str(a.get("/OPS_Subtype", "")) == "stavenreeks":
            sr = a
            break
    check("stavenreeks-annotatie gevonden", sr is not None)
    if sr is None:
        print("  (geen verdere controles mogelijk)")
        return 1

    check("subtype is /Stamp", str(sr.get("/Subtype")) == "/Stamp", str(sr.get("/Subtype")))
    rect = [float(v) for v in sr.get("/Rect")]
    check("/Rect heeft 4 getallen en positieve afmetingen",
          len(rect) == 4 and rect[2] > rect[0] and rect[3] > rect[1], str(rect))
    rw, rh = rect[2] - rect[0], rect[3] - rect[1]

    ap = sr.get("/AP")
    check("/AP aanwezig", ap is not None)
    n = ap.get("/N") if ap is not None else None
    check("/AP /N aanwezig (Form-XObject)", n is not None)
    if n is not None:
        check("/N is een Form-XObject", str(n.get("/Subtype")) == "/Form", str(n.get("/Subtype")))
        bbox = [float(v) for v in n.get("/BBox")]
        check("/BBox == /Rect-afmeting",
              abs((bbox[2] - bbox[0]) - rw) < 0.01 and abs((bbox[3] - bbox[1]) - rh) < 0.01,
              f"BBox {bbox} vs Rect {rw}x{rh}")
        check("/BBox begint in de oorsprong",
              abs(bbox[0]) < 1e-6 and abs(bbox[1]) < 1e-6, str(bbox))
        mtx = n.get("/Matrix")
        mtx = [float(v) for v in mtx] if mtx is not None else [1, 0, 0, 1, 0, 0]
        check("/Matrix is de IDENTITEIT", mtx == [1, 0, 0, 1, 0, 0], str(mtx))
        stream = bytes(n.read_bytes())
        check("appearance-stream is niet leeg", len(stream) > 50, f"{len(stream)} bytes")
        check("stream tekent lijnen (m/l/S)", b" m " in stream and b" l" in stream and b"S" in stream)
        check("stream tekent gevulde punten (c + f)", b" c" in stream and b"\nf\n" in stream)

    check("GEEN top-level /Rotate", "/Rotate" not in sr, str(sr.get("/Rotate")))

    for key in ("/OPS_SRCount", "/OPS_SRDiameter", "/OPS_SRBarLengthMm",
                "/OPS_SRLegDir", "/OPS_SRLegLength", "/OPS_SRLabelSide",
                "/OPS_SRGeom", "/OPS_SRRect"):
        check(f"custom key {key} aanwezig", key in sr)

    contents = sr.get("/Contents")
    ctext = str(contents) if contents is not None else ""
    check("/Contents bevat leesbare tekst", len(ctext) > 0, repr(ctext))
    print(f"       /Contents = {ctext!r}")
    print(f"       count={sr.get('/OPS_SRCount')} diameter={sr.get('/OPS_SRDiameter')} "
          f"legDir={sr.get('/OPS_SRLegDir')} labelSide={sr.get('/OPS_SRLabelSide')}")
    pdf.close()

    # ── 2. Zichtbaarheid in twee engines ─────────────────────────────────
    print("\n2. Zichtbaarheid (pypdfium2 + PyMuPDF)")
    scale = 2.0
    results = {}
    for engine, fn in (("pdfium", render_pdfium), ("mupdf", render_mupdf)):
        img = fn(path, 0, scale)
        w, h = img.size
        bbox, count = ink_bbox(img)
        results[engine] = (bbox, count, w, h)
        check(f"{engine}: pagina bevat inkt", count > 0, f"{count} pixels")
        png = os.path.join(outdir, f"stavenreeks-{engine}.png")
        img.save(png)
        print(f"       screenshot: {png}  (inkt-bbox={bbox}, {count} px)")

        # De inkt moet binnen de /Rect vallen (in pixels, y omgeklapt).
        if bbox:
            px0, py0 = rect[0] * scale, (h / scale - rect[3]) * scale
            px1, py1 = rect[2] * scale, (h / scale - rect[1]) * scale
            tol = 6
            inside = (bbox[0] >= px0 - tol and bbox[2] <= px1 + tol
                      and bbox[1] >= py0 - tol and bbox[3] <= py1 + tol)
            check(f"{engine}: inkt valt binnen /Rect", inside,
                  f"inkt {bbox} vs rect-px ({px0:.0f},{py0:.0f},{px1:.0f},{py1:.0f})")

    # Beide engines moeten ongeveer dezelfde plek tonen.
    b1, b2 = results["pdfium"][0], results["mupdf"][0]
    if b1 and b2:
        agree = all(abs(a - b) <= 8 for a, b in zip(b1, b2))
        check("beide engines tonen het element op dezelfde plek", agree, f"{b1} vs {b2}")

    # ── 3. Verplaatsbaarheid: /Rect verschuiven zoals een andere editor ──
    print("\n3. Verplaatsbaarheid (/Rect verschuiven met pikepdf)")
    DX, DY = 120.0, -90.0
    moved = os.path.join(outdir, "stavenreeks-verplaatst.pdf")
    pdf = pikepdf.open(path)
    pg = pdf.pages[0]
    for a in pg.get("/Annots", []):
        if str(a.get("/OPS_Subtype", "")) == "stavenreeks":
            r = [float(v) for v in a.get("/Rect")]
            a["/Rect"] = pikepdf.Array([r[0] + DX, r[1] + DY, r[2] + DX, r[3] + DY])
            break
    pdf.save(moved)
    pdf.close()
    print(f"       verplaatste kopie: {moved}  (dx={DX}, dy={DY})")

    for engine, fn in (("pdfium", render_pdfium), ("mupdf", render_mupdf)):
        img = fn(moved, 0, scale)
        bbox, count = ink_bbox(img)
        check(f"{engine}: verplaatst element nog steeds zichtbaar", count > 0, f"{count} px")
        png = os.path.join(outdir, f"stavenreeks-verplaatst-{engine}.png")
        img.save(png)
        old = results[engine][0]
        if bbox and old:
            # /Rect-verschuiving in PDF-punten -> pixels (y-as omgeklapt).
            exp_dx, exp_dy = DX * scale, -DY * scale
            got_dx, got_dy = bbox[0] - old[0], bbox[1] - old[1]
            ok = abs(got_dx - exp_dx) <= 6 and abs(got_dy - exp_dy) <= 6
            check(f"{engine}: inkt is meegeschoven met /Rect", ok,
                  f"verwacht ({exp_dx:.0f},{exp_dy:.0f}) kreeg ({got_dx:.0f},{got_dy:.0f})")
            # Vorm mag niet vervormen: zelfde breedte/hoogte als voor de move.
            ow, oh = old[2] - old[0], old[3] - old[1]
            nw, nh = bbox[2] - bbox[0], bbox[3] - bbox[1]
            check(f"{engine}: afmetingen ongewijzigd (geen vervorming)",
                  abs(nw - ow) <= 4 and abs(nh - oh) <= 4,
                  f"{ow}x{oh} -> {nw}x{nh}")
        print(f"       screenshot: {png}  (inkt-bbox={bbox})")

    print(f"\n{'GESLAAGD' if not FAIL else 'GEFAALD'}: {CHECKS[0] - len(FAIL)}/{CHECKS[0]} controles")
    if FAIL:
        for f_ in FAIL:
            print(f"  - {f_}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
