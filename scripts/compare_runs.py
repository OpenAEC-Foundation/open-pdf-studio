"""Compare two render-regression run summaries.

Usage: compare_runs.py <old_run_dir> <new_run_dir>
"""
import json
import os
import sys

old_run = sys.argv[1]
new_run = sys.argv[2]
old = json.load(open(f'test pdf-bestanden/render-regression-runs/{old_run}/summary.json'))
new = json.load(open(f'test pdf-bestanden/render-regression-runs/{new_run}/summary.json'))

old_map = {}
for pdf in old['pdfs']:
    name = os.path.basename(pdf['path'])
    for p in pdf['pages']:
        old_map[(name, p['index'])] = (p['diff_pct'], p['passed'])

new_map = {}
for pdf in new['pdfs']:
    name = os.path.basename(pdf['path'])
    for p in pdf['pages']:
        new_map[(name, p['index'])] = (p['diff_pct'], p['passed'])

print('PASS->FAIL regressions:')
for k, (od, op) in old_map.items():
    if k in new_map:
        nd, np_ = new_map[k]
        if op and not np_:
            print(f'  {k}: {od:.3f}% -> {nd:.3f}%')

print('\nFAIL->PASS wins:')
for k, (od, op) in old_map.items():
    if k in new_map:
        nd, np_ = new_map[k]
        if not op and np_:
            print(f'  {k}: {od:.3f}% -> {nd:.3f}%')

print('\nLargest improvements (delta < -0.3):')
for k, (od, op) in old_map.items():
    if k in new_map:
        nd, np_ = new_map[k]
        delta = nd - od
        if delta < -0.3:
            print(f'  {k}: {od:.3f}% -> {nd:.3f}% (delta {delta:+.3f})')

print('\nLargest regressions (delta > 0.3):')
for k, (od, op) in old_map.items():
    if k in new_map:
        nd, np_ = new_map[k]
        delta = nd - od
        if delta > 0.3:
            print(f'  {k}: {od:.3f}% -> {nd:.3f}% (delta {delta:+.3f})')

delta_sum = 0
delta_n = 0
for k, (od, op) in old_map.items():
    if k in new_map:
        nd, _ = new_map[k]
        delta_sum += (nd - od)
        delta_n += 1
print(f'\nOverall avg delta: {delta_sum / delta_n:+.4f}')

old_pass = sum(1 for v in old_map.values() if v[1])
new_pass = sum(1 for v in new_map.values() if v[1])
print(f'Pass count: {old_pass} -> {new_pass}')
