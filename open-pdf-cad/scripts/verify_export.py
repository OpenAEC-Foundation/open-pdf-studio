#!/usr/bin/env python3
"""Onafhankelijke controle van een DXF-export tegen de bron-PDF.

De referentie komt uit MuPDF (PyMuPDF `page.get_drawings()`): een andere
PDF-interpreter dan PDFium, met een eigen afhandeling van /Rotate en de
paginabox. De DXF wordt gelezen met ezdxf, dus ook het teruglezen is
onafhankelijk van de schrijver.

Twee metingen, beide in tekeneenheden (mm in de uitvoer):

  A. volledigheid  - elk eindpunt uit de PDF ligt op een DXF-segment;
  B. geen ruis     - elk DXF-hoekpunt ligt op een PDF-segment (krommen in de
                     referentie fijn bemonsterd).

De grens is de acceptatie-eis uit issue #400: 0,1 mm op papier (maal de
schaalnoemer bij export op ware grootte).

Gebruik:
  python verify_export.py <pdf> <pagina> <dxf> [--scale N] [--tolerance 0.1]
                          [--json uit.json] [--texts]
"""
import argparse
import json
import math
import sys

import ezdxf
import fitz  # PyMuPDF
import numpy as np
from shapely import STRtree, LineString, Point as ShPoint

MM_PER_PT = 25.4 / 72.0


def reference_geometry(page, scale, skip_page_fills=True):
    """Eindpunten en segmenten uit MuPDF, omgezet naar uitvoer-mm (y omhoog)."""
    rot = page.rotation_matrix  # onbewerkte paginaruimte -> weergegeven pagina
    height = page.rect.height
    k = MM_PER_PT * scale

    def out(p):
        q = fitz.Point(p) * rot
        return (q.x * k, (height - q.y) * k)

    endpoints, segments = [], []
    counts = {"paths": 0, "stroked": 0, "filled": 0, "items": 0, "zero_length": 0, "page_fills": 0}
    page_rect = page.rect
    for path in page.get_drawings():
        if skip_page_fills and path["type"] == "f":
            # Zelfde regel als de export: een vulling die minstens 95% van de
            # paginabreedte en -hoogte beslaat is paginagrond en wordt overgeslagen.
            r = fitz.Rect(path["rect"]) * rot
            r.normalize()
            r &= page_rect
            if r.width >= 0.95 * page_rect.width and r.height >= 0.95 * page_rect.height:
                counts["page_fills"] += 1
                continue
        counts["paths"] += 1
        counts["stroked"] += path["type"] in ("s", "fs")
        counts["filled"] += path["type"] in ("f", "fs")
        for item in path["items"]:
            counts["items"] += 1
            kind = item[0]
            if kind == "l":
                a, b = out(item[1]), out(item[2])
                if a == b:
                    # Lijn zonder lengte: tekent hooguit een stip. De export
                    # slaat die over en telt ze als ontaard pad.
                    counts["zero_length"] += 1
                    continue
                endpoints += [a, b]
                segments.append((a, b))
            elif kind == "re":
                r = item[1]
                corners = [out(c) for c in (r.tl, r.tr, r.br, r.bl)]
                endpoints += corners
                segments += list(zip(corners, corners[1:] + corners[:1]))
            elif kind == "qu":
                q = item[1]
                corners = [out(c) for c in (q.ul, q.ur, q.lr, q.ll)]
                endpoints += corners
                segments += list(zip(corners, corners[1:] + corners[:1]))
            elif kind == "c":
                p0, p1, p2, p3 = (out(p) for p in item[1:5])
                endpoints += [p0, p3]
                previous = p0
                for i in range(1, 65):
                    t = i / 64.0
                    mt = 1 - t
                    x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
                    y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
                    segments.append((previous, (x, y)))
                    previous = (x, y)
    return endpoints, segments, counts


def dxf_geometry(path):
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    vertices, segments, counts = [], [], {}
    for e in msp:
        kind = e.dxftype()
        counts[kind] = counts.get(kind, 0) + 1
        if kind == "LINE":
            a = (e.dxf.start.x, e.dxf.start.y)
            b = (e.dxf.end.x, e.dxf.end.y)
            vertices += [a, b]
            segments.append((a, b))
        elif kind == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
            vertices += pts
            segments += list(zip(pts, pts[1:]))
            if e.closed and len(pts) > 2:
                segments.append((pts[-1], pts[0]))
        elif kind == "HATCH":
            for boundary in e.paths:
                pts = [(v[0], v[1]) for v in getattr(boundary, "vertices", [])]
                vertices += pts
                if len(pts) > 1:
                    segments += list(zip(pts, pts[1:] + pts[:1]))
        elif kind == "SPLINE":
            pts = [(p[0], p[1]) for p in e.control_points]
            # Alleen de Bézier-eindpunten (elke derde) liggen op de kromme.
            vertices += pts[::3]
            flat = [(p.x, p.y) for p in e.flattening(0.001)]
            segments += list(zip(flat, flat[1:]))
    layers = [layer.dxf.name for layer in doc.layers]
    return vertices, segments, counts, layers, doc


def distances(points, segments):
    """Afstand van elk punt tot het dichtstbijzijnde segment."""
    if not points or not segments:
        return np.array([])
    lines = [LineString(s) if s[0] != s[1] else ShPoint(s[0]) for s in segments]
    tree = STRtree(lines)
    pts = [ShPoint(p) for p in points]
    _, dist = tree.query_nearest(pts, return_distance=True, all_matches=False)
    return np.asarray(dist)


def summarize(name, dist, tolerance):
    if dist.size == 0:
        return {"name": name, "count": 0}
    over = int((dist > tolerance).sum())
    return {
        "name": name,
        "count": int(dist.size),
        "max": float(dist.max()),
        "p999": float(np.percentile(dist, 99.9)),
        "mean": float(dist.mean()),
        "over_tolerance": over,
    }


def compare_texts(page, doc, scale, tolerance):
    """Tekst: het invoegpunt van elke TEXT moet samenvallen met de
    basislijn-oorsprong van een teken in MuPDF dat gelijk is aan het eerste
    teken van die tekst. (MuPDF voegt aangrenzende tekstobjecten samen tot één
    span, dus vergelijken per span zou schijnfouten geven.) Hoogte wordt
    vergeleken met de lettergrootte, de hoek met de schrijfrichting."""
    rot = page.rotation_matrix
    height = page.rect.height
    k = MM_PER_PT * scale
    chars = []
    for block in page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in block.get("lines", []):
            dx, dy = line["dir"]
            d = fitz.Point(dx, dy) * fitz.Matrix(rot.a, rot.b, rot.c, rot.d, 0, 0)
            angle = math.degrees(math.atan2(-d.y, d.x)) % 360
            for span in line["spans"]:
                for ch in span["chars"]:
                    origin = fitz.Point(ch["origin"]) * rot
                    chars.append(((origin.x * k, (height - origin.y) * k), ch["c"], span["size"] * k, angle))
    texts = [e for e in doc.modelspace() if e.dxftype() == "TEXT"]
    if not texts or not chars:
        return {"dxf_texts": len(texts), "pdf_chars": len(chars)}
    tree = STRtree([ShPoint(c[0]) for c in chars])
    pos, ratio, ang, wrong_char = [], [], [], 0
    for t in texts:
        p = ShPoint(t.dxf.insert.x, t.dxf.insert.y)
        char = chars[tree.nearest(p)]
        pos.append(p.distance(ShPoint(char[0])))
        wrong_char += char[1] != t.dxf.text[:1]
        ratio.append(t.dxf.height / char[2])
        ang.append(abs((t.dxf.rotation - char[3] + 180) % 360 - 180))
    pos, ratio, ang = np.array(pos), np.array(ratio), np.array(ang)
    return {
        "dxf_texts": len(texts),
        "pdf_chars": len(chars),
        "insert_max": float(pos.max()),
        "insert_over_tolerance": int((pos > tolerance).sum()),
        "first_char_mismatch": int(wrong_char),
        "height_ratio_min": float(ratio.min()),
        "height_ratio_median": float(np.median(ratio)),
        "height_ratio_max": float(ratio.max()),
        "angle_max_deg": float(ang.max()),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("page", type=int, help="1-gebaseerd")
    ap.add_argument("dxf")
    ap.add_argument("--scale", type=float, default=1.0, help="schaalnoemer N van 1:N")
    ap.add_argument("--tolerance", type=float, default=0.1, help="mm op papier")
    ap.add_argument("--json")
    ap.add_argument("--texts", action="store_true")
    ap.add_argument("--keep-page-fills", action="store_true",
                    help="paginavullende vlakken in de referentie laten staan (export met --keep-page-fills)")
    ap.add_argument("--keep-annotations", action="store_true",
                    help="annotaties in de referentie laten staan")
    args = ap.parse_args()

    tolerance = args.tolerance * args.scale
    page = fitz.open(args.pdf)[args.page - 1]
    annotations = 0
    if not args.keep_annotations:
        # MuPDF tekent annotaties mee; de export leest alleen de pagina-inhoud.
        # Verwijderen gebeurt in het geheugen, het bestand blijft onaangeroerd.
        for annot in list(page.annots() or []):
            page.delete_annot(annot)
            annotations += 1
        # Formuliervelden zijn ook annotaties, maar staan in een eigen lijst.
        for widget in list(page.widgets() or []):
            page.delete_widget(widget)
            annotations += 1
    ref_points, ref_segments, ref_counts = reference_geometry(page, args.scale, not args.keep_page_fills)
    dxf_vertices, dxf_segments, dxf_counts, layers, doc = dxf_geometry(args.dxf)

    a = summarize("pdf-eindpunt -> dxf-segment", distances(ref_points, dxf_segments), tolerance)
    b = summarize("dxf-hoekpunt -> pdf-segment", distances(dxf_vertices, ref_segments), tolerance)
    result = {
        "pdf": args.pdf,
        "page": args.page,
        "rotation": page.rotation,
        "mediabox": list(page.mediabox),
        "scale": args.scale,
        "tolerance": tolerance,
        "annotations_removed_from_reference": annotations,
        "reference": ref_counts,
        "dxf_entities": dxf_counts,
        "dxf_layers": len(layers),
        "dxfversion": doc.dxfversion,
        "insunits": doc.header.get("$INSUNITS"),
        "completeness": a,
        "no_noise": b,
    }
    if args.texts:
        result["texts"] = compare_texts(page, doc, args.scale, tolerance)
    ok = a.get("over_tolerance", 0) == 0 and b.get("over_tolerance", 0) == 0
    if args.texts:
        ok = ok and result["texts"].get("insert_over_tolerance", 0) == 0
    result["ok"] = ok
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
