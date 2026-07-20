"""Quick summary of a render-regression run."""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
d = json.loads(path.read_text())
total_pgs = 0
total_pass = 0
for pdf in d["pdfs"]:
    name = pdf["path"].split("\\")[-1]
    pgs = pdf["pages"]
    pcts = [p["diff_pct"] for p in pgs]
    pass_n = sum(1 for p in pgs if p["passed"])
    total_pgs += len(pgs)
    total_pass += pass_n
    print(f"{name[:50]:50} {len(pgs):3} pgs  pass={pass_n:2}  avg={sum(pcts)/len(pcts):5.2f}  worst={max(pcts):6.2f}")
print(f"\nTOTAL: {total_pgs} pages, {total_pass} pass\n")

# show worst offenders for cluster
print("--- Cluster details ---")
for pdf in d["pdfs"]:
    name = pdf["path"].split("\\")[-1]
    if "Text pdf gecombineerd" in name or "rapport-constructie" in name:
        print(name)
        for p in sorted(pdf["pages"], key=lambda p: -p["diff_pct"])[:8]:
            print(f"  p{p['index']:2}  {p['diff_pct']:6.2f}%  {'PASS' if p['passed'] else 'FAIL'}")
