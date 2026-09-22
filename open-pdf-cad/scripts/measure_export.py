#!/usr/bin/env python3
"""Meet duur en piekgeheugen van een export, uitgesplitst per fase.

Start `export_page` als kindproces, peilt elke 20 ms het werkgeheugen en leest
de fasewisselingen van stderr. Geeft het verslag van de export terug, aangevuld
met `wall_ms`, `peak_rss_mb` en `peak_rss_mb_per_phase`.

Gebruik:
  python measure_export.py <export_page.exe> <pdf> <pagina> <uitvoer> [opties voor export_page]
"""
import json
import subprocess
import sys
import threading
import time

import psutil


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    exe, rest = sys.argv[1], sys.argv[2:]
    started = time.perf_counter()
    proc = subprocess.Popen([exe, *rest], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    handle = psutil.Process(proc.pid)

    phase = ["start"]
    errors = []

    def read_phases():
        for raw in proc.stderr:
            line = raw.decode("utf-8", "replace").strip()
            if line.startswith("fase: "):
                phase[0] = line.split()[1].lower()
            elif line:
                errors.append(line)

    out_chunks = []
    readers = [
        threading.Thread(target=read_phases, daemon=True),
        threading.Thread(target=lambda: out_chunks.append(proc.stdout.read()), daemon=True),
    ]
    for reader in readers:
        reader.start()

    peaks = {}
    while proc.poll() is None:
        try:
            rss = handle.memory_info().rss
        except psutil.Error:
            break
        peaks[phase[0]] = max(peaks.get(phase[0], 0), rss)
        time.sleep(0.02)
    for reader in readers:
        reader.join(timeout=5)
    wall_ms = int((time.perf_counter() - started) * 1000)
    if proc.returncode != 0:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(proc.returncode)
    report = json.loads(b"".join(out_chunks).decode("utf-8"))
    report["wall_ms"] = wall_ms
    report["peak_rss_mb"] = round(max(peaks.values(), default=0) / 2**20, 1)
    report["peak_rss_mb_per_phase"] = {k: round(v / 2**20, 1) for k, v in peaks.items()}
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
