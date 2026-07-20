import json, os, glob
runs = sorted(glob.glob('test pdf-bestanden/render-regression-runs/2026-05-09_1626-*'))
p = os.path.join(runs[-1], 'summary.json')
with open(p, encoding='utf-8') as f:
    data = json.load(f)
total = 0
passing = 0
worst = []
print('PDF totals:')
for entry in data['pdfs']:
    name = os.path.basename(entry['path'])
    pdf_pass = 0
    pdf_total = 0
    for pg in entry['pages']:
        total += 1
        pdf_total += 1
        if pg['passed']:
            passing += 1
            pdf_pass += 1
        worst.append((pg['diff_pct'], name, pg['index'], pg['passed']))
    print(f'  {name}: {pdf_pass}/{pdf_total}')
print()
print(f'Total: {passing}/{total}')
print()
print('Worst 15 pages:')
worst.sort(reverse=True)
for d, n, i, ok in worst[:15]:
    mark = 'PASS' if ok else 'FAIL'
    print(f'  {d:>6.2f}%  {mark}  {n} p{i}')
