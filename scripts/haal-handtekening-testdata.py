"""Haalt het testcorpus voor digitale handtekeningen op, vastgepind op commit.

Leest scripts/handtekening-testdata.json, downloadt ontbrekende bestanden van
raw.githubusercontent.com en controleert elk bestand op SHA-256. Bestanden van
derden komen niet in de repo: ze landen in testdata/handtekeningen/ (genegeerd).

Gebruik:
    python scripts/haal-handtekening-testdata.py              # ophalen + controleren
    python scripts/haal-handtekening-testdata.py --controleer # alleen controleren
Exit 0 als alles aanwezig en ongewijzigd is, anders 1.
"""
import hashlib
import json
import os
import sys
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO, "scripts", "handtekening-testdata.json")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    alleen_controleren = "--controleer" in sys.argv
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    doel = os.path.join(REPO, manifest["doel"])
    aanwezig, opgehaald, fouten = 0, 0, []
    for naam, bron in manifest["bronnen"].items():
        map_ = os.path.join(doel, naam)
        os.makedirs(map_, exist_ok=True)
        for f in bron["bestanden"]:
            pad = os.path.join(map_, f["bestand"])
            if os.path.exists(pad):
                with open(pad, "rb") as h:
                    if sha256(h.read()) == f["sha256"]:
                        aanwezig += 1
                        continue
                if alleen_controleren:
                    fouten.append(f"{naam}/{f['bestand']}: SHA-256 wijkt af")
                    continue
            elif alleen_controleren:
                fouten.append(f"{naam}/{f['bestand']}: ontbreekt")
                continue
            url = (f"https://raw.githubusercontent.com/{bron['repo']}/{bron['commit']}/"
                   f"{bron['pad']}/{f['bestand']}")
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    data = r.read()
            except Exception as e:  # netwerk: melden, niet crashen
                fouten.append(f"{naam}/{f['bestand']}: ophalen mislukt ({e})")
                continue
            if sha256(data) != f["sha256"]:
                fouten.append(f"{naam}/{f['bestand']}: SHA-256 van download wijkt af")
                continue
            with open(pad, "wb") as h:
                h.write(data)
            opgehaald += 1
    print(f"{aanwezig} aanwezig, {opgehaald} opgehaald, {len(fouten)} fout")
    for f in fouten:
        print("  FOUT", f)
    return 1 if fouten else 0


if __name__ == "__main__":
    sys.exit(main())
