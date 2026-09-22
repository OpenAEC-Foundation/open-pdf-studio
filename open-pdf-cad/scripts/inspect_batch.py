#!/usr/bin/env python3
"""Leesproef over een map met DWG- en DXF-bestanden.

Draait `inspect_cad --json` op elk bestand (alleen lezen), met een tijdslimiet
per bestand, en vat samen wat de lezer oplevert: geslaagd of niet, versie,
leestijd, entiteiten, en welke gegevens voor een importvenster bruikbaar zijn
(eenheden, grenzen, lagenstatus, layouts met papiermaat, viewports, externe
verwijzingen, lettertypen).

Gebruik:
  python inspect_batch.py --bin <map met inspect_cad> --out <uit.json> <map of bestand> [...]
                          [--limit N] [--timeout 60]
"""
import argparse
import collections
import json
import os
import subprocess
import sys
import time


def gather(paths, limit):
    files = []
    for root in paths:
        if os.path.isfile(root):
            files.append(root)
            continue
        found = []
        for base, _dirs, names in os.walk(root):
            for name in names:
                if name.lower().endswith((".dwg", ".dxf")):
                    found.append(os.path.join(base, name))
        found.sort()
        if limit and len(found) > limit:
            step = len(found) / limit
            found = [found[int(i * step)] for i in range(limit)]
        files += found
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bin", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0, help="hoogste aantal bestanden per map (gelijkmatig gekozen)")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--summary-only", action="store_true", help="alleen --out opnieuw samenvatten, niets lezen")
    ap.add_argument("paths", nargs="*")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    exe = os.path.join(args.bin, "inspect_cad.exe" if os.name == "nt" else "inspect_cad")

    if args.summary_only:
        with open(args.out, encoding="utf-8") as f:
            summarize(json.load(f))
        return

    rows = []
    for path in gather(args.paths, args.limit):
        row = {"file": path, "ext": os.path.splitext(path)[1].lower(), "bytes": os.path.getsize(path)}
        started = time.perf_counter()
        try:
            proc = subprocess.run([exe, path, "--json"], capture_output=True, timeout=args.timeout)
            row["wall_ms"] = int((time.perf_counter() - started) * 1000)
            if proc.returncode == 0:
                row["ok"] = True
                row["report"] = json.loads(proc.stdout.decode("utf-8", "replace"))
            else:
                row["ok"] = False
                row["exit"] = proc.returncode
                row["error"] = proc.stderr.decode("utf-8", "replace").strip()[-300:]
        except subprocess.TimeoutExpired:
            row["ok"] = False
            row["error"] = f"tijdslimiet van {args.timeout} s overschreden"
        rows.append(row)
        status = "ok " if row["ok"] else "FOUT"
        print(f"{status} {row.get('wall_ms', 0):6d} ms  {path}", file=sys.stderr)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    summarize(rows)


def summarize(rows):
    ok = [r for r in rows if r["ok"]]
    print(f"bestanden: {len(rows)}, gelezen: {len(ok)}, mislukt: {len(rows) - len(ok)}")
    for ext in (".dwg", ".dxf"):
        subset = [r for r in rows if r["ext"] == ext]
        good = [r for r in subset if r["ok"]]
        print(f"  {ext}: {len(good)}/{len(subset)} gelezen")
    versions = collections.Counter((r["ext"], r["report"]["version"]) for r in ok)
    print("versies:", dict(sorted((f"{e} {v}", n) for (e, v), n in versions.items())))

    def share(label, predicate):
        n = sum(1 for r in ok if predicate(r["report"]))
        print(f"  {label}: {n}/{len(ok)}")

    print("gegevens die het bestand levert:")
    share("$INSUNITS gezet (≠ 0)", lambda r: r["insunits"] != 0)
    share("extents in de kop bruikbaar", lambda r: r["header_extents"] is not None)
    share("limits in de kop bruikbaar", lambda r: r["header_limits"] is not None)
    share("berekende extents beschikbaar", lambda r: r["computed_extents"] is not None)
    share("kop-extents ≈ berekend (5%)", lambda r: r["header_extents"] and r["computed_extents"] and
          abs(r["header_extents"]["width"] - r["computed_extents"]["width"]) <= 0.05 * max(r["computed_extents"]["width"], 1e-9) and
          abs(r["header_extents"]["height"] - r["computed_extents"]["height"]) <= 0.05 * max(r["computed_extents"]["height"], 1e-9))
    share("lagen uit of bevroren aanwezig", lambda r: any(l["off"] or l["frozen"] for l in r["layers"]))
    share("papierruimte-layout met inhoud", lambda r: any(l["entities"] > 0 and l["name"].lower() != "model" for l in r["layouts"]))
    share("layout met papiermaat", lambda r: any(l["paper_width_mm"] > 0 for l in r["layouts"] if l["name"].lower() != "model"))
    share("viewports in papierruimte", lambda r: len(r["viewports"]) > 0)
    share("INSERT in modelruimte", lambda r: r["insert_count"] > 0)
    share("geneste blokken (diepte > 1)", lambda r: r["max_insert_nesting"] > 1)
    share("externe verwijzingen", lambda r: len(r["xref_blocks"]) > 0)
    share("afbeeldingen", lambda r: len(r["image_files"]) > 0)
    share("grote coördinaten (> 1e5)", lambda r: r["computed_extents"] and max(abs(r["computed_extents"]["min"][0]), abs(r["computed_extents"]["max"][0]), abs(r["computed_extents"]["min"][1]), abs(r["computed_extents"]["max"][1])) > 1e5)
    share("herstelde leesfouten", lambda r: r["recovered_errors"] > 0)
    share("records overgeslagen", lambda r: r["skipped_records"] > 0)

    totals = collections.Counter()
    for r in ok:
        for space in ("model_space", "paper_space", "in_blocks"):
            for kind, n in r["report"][space]["by_type"].items():
                totals[kind] += n
    print("entiteiten over alle bestanden:", dict(totals.most_common()))
    fonts = collections.Counter()
    for r in ok:
        for _name, font_file, _ttf, _shape in r["report"]["text_styles"]:
            fonts[font_file.lower() or "(leeg)"] += 1
    print("lettertypebestanden in tekststijlen:", dict(fonts.most_common(15)))
    slow = sorted(ok, key=lambda r: -r["report"]["read_ms"])[:5]
    print("traagste:", [(os.path.basename(r["file"]), r["bytes"] // 1024, r["report"]["read_ms"]) for r in slow])
    for r in rows:
        if not r["ok"]:
            print("MISLUKT:", r["file"], "→", r.get("error", "")[:200])


if __name__ == "__main__":
    main()
