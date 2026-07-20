import json, os, glob
# Compare iter-7 (this run) vs iter-6 baseline
new_p = os.path.join(sorted(glob.glob('test pdf-bestanden/render-regression-runs/2026-05-09_1626-*'))[-1], 'summary.json')
old_p = 'test pdf-bestanden/render-regression-runs/2026-05-09_1600-80da0486/summary.json'

with open(new_p, encoding='utf-8') as f:
    new = json.load(f)
with open(old_p, encoding='utf-8') as f:
    old = json.load(f)

new_lookup = {}
for e in new['pdfs']:
    name = os.path.basename(e['path'])
    for pg in e['pages']:
        new_lookup[(name, pg['index'])] = pg

old_lookup = {}
for e in old['pdfs']:
    name = os.path.basename(e['path'])
    for pg in e['pages']:
        old_lookup[(name, pg['index'])] = pg

# Find pages that regressed
regressions = []
improvements = []
for k, oldpg in old_lookup.items():
    newpg = new_lookup.get(k)
    if newpg is None:
        continue
    delta = newpg['diff_pct'] - oldpg['diff_pct']
    if oldpg['passed'] and not newpg['passed']:
        regressions.append((delta, k, oldpg['diff_pct'], newpg['diff_pct']))
    if not oldpg['passed'] and newpg['passed']:
        improvements.append((delta, k, oldpg['diff_pct'], newpg['diff_pct']))

print('PASS -> FAIL regressions:')
for d, k, o, n in sorted(regressions):
    print(f'  {k[0]} p{k[1]}: {o:.2f}% -> {n:.2f}% (D{d:+.2f})')
print()
print('FAIL -> PASS improvements:')
for d, k, o, n in sorted(improvements):
    print(f'  {k[0]} p{k[1]}: {o:.2f}% -> {n:.2f}% (D{d:+.2f})')

# Average diff change per PDF
print()
print('Average diff change per PDF:')
by_pdf = {}
for k, newpg in new_lookup.items():
    oldpg = old_lookup.get(k)
    if oldpg:
        by_pdf.setdefault(k[0], []).append(newpg['diff_pct'] - oldpg['diff_pct'])
for name, deltas in by_pdf.items():
    print(f'  {name}: avg D {sum(deltas)/len(deltas):+.2f}pp ({len(deltas)} pages)')
