"""Controleert een PDF die uit de DWG/DXF-import komt.

Leest met MuPDF (PyMuPDF) — een andere PDF-lezer dan de app gebruikt — de
paginamaat, de lagen (OCG's), de meetschaal (`/VP` + `/Measure`) en het
getekende werk, en maakt er een afbeelding van om naar te kijken.

    python verify_import.py <bestand.pdf> [--png <uit.png>] [--dpi 100] [--json]
"""
import json
import sys

import fitz


def measure_info(page):
    """Viewports met meetschaal uit de pagina zelf."""
    out = []
    vp = page.get_contents() and None  # alleen om te laten zien dat we de ruwe pagina lezen
    doc = page.parent
    page_dict = doc.xref_object(page.xref, compressed=False)
    if "/VP" not in page_dict:
        return out
    # MuPDF geeft geen ontlede /VP; lees de ruwe tekst van de pagina-object.
    import re

    for match in re.finditer(r"/BBox\s*\[([^\]]*)\].*?/C\s*([0-9.eE+-]+).*?/U\s*\(([^)]*)\)", page_dict, re.S):
        bbox = [float(v) for v in match.group(1).split()]
        out.append({"bbox": bbox, "c": float(match.group(2)), "unit": match.group(3)})
    for match in re.finditer(r"/R\s*\(([^)]*)\)", page_dict):
        if out:
            out[-1].setdefault("ratio", match.group(1))
    return out


def report(path, png=None, dpi=100):
    doc = fitz.open(path)
    info = {"path": path, "pages": [], "layers": [], "damaged": bool(doc.is_repaired)}
    try:
        layers = doc.layer_ui_configs()
        info["layers"] = [{"text": l["text"], "on": l["on"]} for l in layers]
    except Exception as error:  # pragma: no cover - alleen informatief
        info["layers_error"] = str(error)
    for number, page in enumerate(doc):
        drawings = page.get_drawings()
        text = page.get_text("text")
        item_counts = {}
        for drawing in drawings:
            for item in drawing["items"]:
                item_counts[item[0]] = item_counts.get(item[0], 0) + 1
        info["pages"].append(
            {
                "page": number + 1,
                "width_mm": round(page.rect.width * 25.4 / 72, 2),
                "height_mm": round(page.rect.height * 25.4 / 72, 2),
                "drawings": len(drawings),
                "items": item_counts,
                "characters": len(text.strip()),
                "text_sample": " | ".join(t for t in text.splitlines() if t.strip())[:160],
                "measures": measure_info(page),
            }
        )
        if png and number == 0:
            page.get_pixmap(dpi=dpi).save(png)
    doc.close()
    return info


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    path = args[0]
    png = None
    dpi = 100
    if "--png" in args:
        png = args[args.index("--png") + 1]
    if "--dpi" in args:
        dpi = int(args[args.index("--dpi") + 1])
    info = report(path, png, dpi)
    if "--json" in args:
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0
    page = info["pages"][0] if info["pages"] else {}
    print(f"{path}: {len(info['pages'])} pagina's, {len(info['layers'])} lagen")
    for p in info["pages"]:
        print(
            f"  pagina {p['page']}: {p['width_mm']} × {p['height_mm']} mm, {p['drawings']} tekenobjecten, "
            f"{p['characters']} tekens, meetschaal {p['measures']}"
        )
    if info["layers"]:
        print("  lagen:", ", ".join(f"{l['text']}{'' if l['on'] else ' (uit)'}" for l in info["layers"][:12]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
