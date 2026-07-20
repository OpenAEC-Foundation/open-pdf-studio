import json, os
p = r'open-pdf-studio/test pdf-bestanden/render-regression-runs/2026-05-09_1249-182f1755/summary.json'
with open(p, encoding='utf-8') as f:
    data = json.load(f)
total = 0
passing = 0
worst = []
for entry in data['pdfs']:
    name = os.path.basename(entry['path'])
    for pg in entry['pages']:
        total += 1
        if pg['passed']:
            passing += 1
        else:
            worst.append((pg['diff_pct'], name, pg['index']))
    if '2885' in name:
        print(name + ':')
        for pg in entry['pages']:
            mark = 'PASS' if pg['passed'] else 'FAIL'
            print(f"  p{pg['index']:>3}  diff={pg['diff_pct']:>6.2f}%  {mark}")
print()
print(f'Total: {passing}/{total}')
print()
print('Worst 15 pages:')
worst.sort(reverse=True)
for d, n, i in worst[:15]:
    print(f'  {d:>6.2f}%  {n} p{i}')
