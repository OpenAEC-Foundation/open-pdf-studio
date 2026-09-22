#!/usr/bin/env python3
"""Exporteert een reeks verificatiepagina's naar DXF en DWG en controleert ze.

Per pagina:
  1. export naar DXF (export_page) en controle tegen MuPDF (verify_export.py);
  2. export naar DWG met dezelfde opties;
  3. beide bestanden teruglezen met de lezer van de schrijfbibliotheek
     (inspect_cad) en de aantallen per entiteittype vergelijken.

De verificatiebestanden worden alleen gelezen; alle uitvoer gaat naar --out.

Gebruik:
  python verify_batch.py --bin <map met export_page en inspect_cad>
                         --pdfs <map met verificatie-PDF's> --out <uitvoermap>
                         [--manifest <json>]

Welke pagina's dat zijn staat in een lokaal manifest dat niet in de repo komt
(standaard verify_batch.local.json naast dit script; voorbeeld van de vorm in
verify_batch.example.json). Ontbreekt het manifest, dan slaat het script over.
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

MANIFEST = os.path.join(HERE, "verify_batch.local.json")


def load_cases(path):
    """Leest de gevallen uit het lokale manifest (niet in de repo).

    Elk geval: {"pdf": bestandsnaam, "page": 1, "name": korte naam,
    "extra": [opties voor export_page], "scale": schaalnoemer}.
    Zie verify_batch.example.json voor de vorm.
    """
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    cases = []
    for item in data.get("cases", []):
        cases.append((item["pdf"], int(item.get("page", 1)), item["name"],
                      list(item.get("extra", [])), item.get("scale", 1)))
    return cases


def run(cmd):
    started = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True)
    ms = int((time.perf_counter() - started) * 1000)
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace"), ms


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", required=True)
    ap.add_argument("--pdfs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", help="alleen de case met deze korte naam")
    ap.add_argument("--manifest", default=MANIFEST)
    args = ap.parse_args()
    cases = load_cases(args.manifest)
    if cases is None:
        print(f"overgeslagen: geen manifest ({os.path.basename(args.manifest)}); "
              "zie verify_batch.example.json", file=sys.stderr)
        sys.exit(0)
    exe = os.path.join(args.bin, "export_page.exe" if os.name == "nt" else "export_page")
    inspect = os.path.join(args.bin, "inspect_cad.exe" if os.name == "nt" else "inspect_cad")
    os.makedirs(args.out, exist_ok=True)

    rows = []
    for pdf_name, page, name, extra, scale in cases:
        if args.only and args.only != name:
            continue
        pdf = os.path.join(args.pdfs, pdf_name)
        if not os.path.exists(pdf):
            print(f"overgeslagen (ontbreekt): {pdf_name}", file=sys.stderr)
            continue
        row = {"case": name, "pdf": pdf_name, "page": page}
        dxf = os.path.join(args.out, name + ".dxf")
        dwg = os.path.join(args.out, name + ".dwg")

        code, out, err, ms = run([exe, pdf, str(page), dxf, "--quiet", *extra])
        if code != 0:
            row["error"] = err.strip()
            rows.append(row)
            continue
        report = json.loads(out)
        row.update({
            "rotate": report["page_rotate"],
            "page_mm": [round(report["page_width"], 2), round(report["page_height"], 2)],
            "dxf_bytes": report["file_size"],
            "export_ms": report["extract_ms"] + report["build_ms"] + report["write_ms"],
            "objects": {k: report["extract"][k] for k in ("path_objects", "text_objects", "image_objects", "form_objects", "max_form_depth", "objects_with_ocg", "objects_clipped")},
            "entities": {k: report["convert"][k] for k in ("lines", "polylines", "splines", "hatches", "texts")},
            "layers": report["convert"]["layers"],
            "ocg_layers": report["convert"]["ocg_layers"],
            "linetypes": report["convert"]["linetypes"],
            "joined_pieces": report["convert"]["joined_pieces"],
            "skipped": {k: report["convert"][k] for k in ("skipped_images", "skipped_page_fills", "skipped_invisible_text", "skipped_degenerate_paths")},
        })

        verify_json = os.path.join(args.out, name + ".verify.json")
        code, out, err, _ = run([sys.executable, os.path.join(HERE, "verify_export.py"), pdf, str(page), dxf,
                                 "--scale", str(scale), "--texts", "--json", verify_json])
        if os.path.exists(verify_json):
            v = json.load(open(verify_json, encoding="utf-8"))
            row["tolerance"] = v["tolerance"]
            row["max_pdf_to_dxf"] = v["completeness"].get("max")
            row["max_dxf_to_pdf"] = v["no_noise"].get("max")
            row["over_tolerance"] = v["completeness"].get("over_tolerance", 0) + v["no_noise"].get("over_tolerance", 0)
            row["points_checked"] = v["completeness"].get("count", 0) + v["no_noise"].get("count", 0)
            row["text_insert_max"] = v.get("texts", {}).get("insert_max")
            row["text_over_tolerance"] = v.get("texts", {}).get("insert_over_tolerance")
            row["verify_ok"] = v["ok"]
        else:
            row["verify_error"] = (err or out).strip()[-400:]

        code, out, err, _ = run([exe, pdf, str(page), dwg, "--quiet", *extra])
        if code != 0:
            row["dwg_error"] = err.strip()
        else:
            row["dwg_bytes"] = json.loads(out)["file_size"]
            counts = {}
            for label, path in (("dxf", dxf), ("dwg", dwg)):
                code, out, err, _ = run([inspect, path, "--json"])
                if code == 0:
                    counts[label] = json.loads(out)["model_space"]["by_type"]
                else:
                    counts[label] = {"error": err.strip()[-300:]}
            row["readback_dxf"] = counts["dxf"]
            row["readback_dwg"] = counts["dwg"]
            row["readback_equal"] = counts["dxf"] == counts["dwg"] and "error" not in counts["dxf"]
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False))

    with open(os.path.join(args.out, "verify_batch.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    bad = [r["case"] for r in rows if not r.get("verify_ok") or not r.get("readback_equal")]
    print(f"\n{len(rows)} cases, niet in orde: {bad or 'geen'}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
