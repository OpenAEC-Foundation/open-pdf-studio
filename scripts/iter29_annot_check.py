"""Check PDF annotations on Technische tekening p1 (page index 1, 0-indexed)."""
import pikepdf
from pathlib import Path

PDF = Path(r"C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\Technische tekening.pdf")

pdf = pikepdf.open(PDF)
page = pdf.pages[1]

print("=" * 60)
print(f"Page 2 (index 1) annotations")
print("=" * 60)

if "/Annots" in page:
    annots = page.Annots
    print(f"\n  Number of annotations: {len(annots)}")
    for i, annot in enumerate(annots):
        try:
            ftype = annot.get("/Subtype", "?")
            rect = annot.get("/Rect", "?")
            ap = annot.get("/AP", None)
            contents = annot.get("/Contents", "")
            has_n = ap and "/N" in ap if ap else False
            print(f"  [{i}] Subtype={ftype} Rect={rect} hasAP/N={has_n} contents={str(contents)[:50]!r}")
        except Exception as e:
            print(f"  [{i}] ERR: {e}")
else:
    print("  No /Annots on this page")

# Check all pages
print("\n  Annotation summary across all pages:")
for i, p in enumerate(pdf.pages):
    if "/Annots" in p:
        annots = p.Annots
        types = {}
        for a in annots:
            t = str(a.get("/Subtype", "?"))
            types[t] = types.get(t, 0) + 1
        print(f"    p{i+1}: {len(annots)} annots, types={types}")

pdf.close()

# Compare with other PDFs that fail
print("\n" + "="*60)
print("Other PDFs with annotations:")
print("="*60)
PDF_DIR = Path(r"C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden")
for pdf_path in PDF_DIR.glob("*.pdf"):
    try:
        pdf = pikepdf.open(pdf_path)
        annot_pages = 0
        total = 0
        types = {}
        for p in pdf.pages:
            if "/Annots" in p:
                annot_pages += 1
                for a in p.Annots:
                    total += 1
                    t = str(a.get("/Subtype", "?"))
                    types[t] = types.get(t, 0) + 1
        if annot_pages:
            print(f"  {pdf_path.name}: {annot_pages} pages, {total} annots, types={types}")
        pdf.close()
    except Exception as e:
        print(f"  {pdf_path.name}: ERR {e}")
