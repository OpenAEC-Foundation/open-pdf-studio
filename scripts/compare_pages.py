"""Per-page comparison."""
import json
import os

def load(p):
    with open(p) as f:
        return json.load(f)

before = load(r'C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/test pdf-bestanden/render-regression-runs/2026-05-09_1249-182f1755/summary.json')
after = load(r'C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/render-regression-runs3/2026-05-09_1340-7227b503/summary.json')

bef_map = {os.path.basename(pdf['path']): {p['index']: p['diff_pct'] for p in pdf['pages']} for pdf in before['pdfs']}
aft_map = {os.path.basename(pdf['path']): {p['index']: p['diff_pct'] for p in pdf['pages']} for pdf in after['pdfs']}

print('Pages where my fix made things WORSE (>1% regression):')
for name, pages in aft_map.items():
    if name not in bef_map: continue
    for idx, after_pct in pages.items():
        before_pct = bef_map[name].get(idx)
        if before_pct is None: continue
        delta = after_pct - before_pct
        if delta > 1.0:
            print(f'  {name} p{idx}: {before_pct:.2f}% -> {after_pct:.2f}%  (+{delta:.2f}%)')

print()
print('Pages where my fix made things BETTER (>5% improvement):')
for name, pages in aft_map.items():
    if name not in bef_map: continue
    for idx, after_pct in pages.items():
        before_pct = bef_map[name].get(idx)
        if before_pct is None: continue
        delta = before_pct - after_pct
        if delta > 5.0:
            print(f'  {name} p{idx}: {before_pct:.2f}% -> {after_pct:.2f}%  (-{delta:.2f}%)')
