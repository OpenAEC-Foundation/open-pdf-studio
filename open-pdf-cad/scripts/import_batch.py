"""Importeert een lijst DWG/DXF-bestanden en controleert elke PDF.

    python import_batch.py <lijst.txt> <uitmap> [--exe pad] [--dpi 90] [extra opties voor import_drawing]

De lijst bevat één pad per regel (regels met # worden overgeslagen). Per
bestand komt er een PDF en een PNG in de uitmap, en aan het eind een
samenvatting als JSON (`samenvatting.json`) met paginamaat, lagen, meetschaal
en de aantallen uit de omzetting.
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify_import  # noqa: E402


def safe_name(path):
    base = os.path.splitext(os.path.basename(path))[0]
    return "".join(c if c.isalnum() or c in "-_ " else "_" for c in base)[:60].strip()


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2
    listing, out_dir = args[0], args[1]
    extra = []
    exe = os.environ.get("IMPORT_EXE", "import_drawing.exe")
    dpi = 90
    i = 2
    while i < len(args):
        if args[i] == "--exe":
            i += 1
            exe = args[i]
        elif args[i] == "--dpi":
            i += 1
            dpi = int(args[i])
        else:
            extra.append(args[i])
        i += 1
    os.makedirs(out_dir, exist_ok=True)
    files = [line.strip() for line in open(listing, encoding="utf-8") if line.strip() and not line.startswith("#")]
    summary = []
    for path in files:
        name = safe_name(path)
        pdf = os.path.join(out_dir, name + ".pdf")
        png = os.path.join(out_dir, name + ".png")
        started = time.time()
        run = subprocess.run([exe, path, pdf, "--json"] + extra, capture_output=True, text=True)
        entry = {"file": path, "pdf": pdf, "ms": int((time.time() - started) * 1000)}
        if run.returncode != 0:
            entry["error"] = (run.stderr or run.stdout).strip()[:400]
            summary.append(entry)
            print(f"FOUT {name}: {entry['error'][:120]}")
            continue
        try:
            entry["import"] = json.loads(run.stdout)
        except json.JSONDecodeError:
            entry["import_output"] = run.stdout[-400:]
        try:
            entry["pdf_check"] = verify_import.report(pdf, png, dpi)
        except Exception as error:  # pragma: no cover - alleen rapportage
            entry["pdf_error"] = str(error)
        summary.append(entry)
        page = (entry.get("pdf_check", {}).get("pages") or [{}])[0]
        pages = entry.get("import", {}).get("pages") or [{}]
        print(
            f"{name}: {len(entry.get('pdf_check', {}).get('pages', []))} pagina('s) "
            f"{page.get('width_mm')}×{page.get('height_mm')} mm, schaal {pages[0].get('scaleText')}, "
            f"{page.get('drawings')} tekenobjecten, {page.get('characters')} tekens, "
            f"{len(entry.get('pdf_check', {}).get('layers', []))} lagen, {entry['ms']} ms"
        )
    with open(os.path.join(out_dir, "samenvatting.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    failed = [s for s in summary if "error" in s]
    print(f"\n{len(summary) - len(failed)} van {len(summary)} geslaagd")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
