"""Iter-21 pixel-level microscopy on Text_pdf_gecombineerd_p8.

Mirrors the regression script: resize app -> ref size with LANCZOS, blur(sigma=1).
Then identify the worst-disagreement pixels.
"""
from PIL import Image, ImageFilter, ImageChops
import numpy as np
import sys

run_dir = r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\open-pdf-studio\test pdf-bestanden\render-regression-runs\2026-05-09_1249-182f1755'

ref_img = Image.open(f'{run_dir}/Text_pdf_gecombineerd_p8_ref.png').convert('RGB')
app_img = Image.open(f'{run_dir}/Text_pdf_gecombineerd_p8_app.png').convert('RGB')
print(f"ref: {ref_img.size}  app: {app_img.size}")

# Match the regression-test pipeline.
if app_img.size != ref_img.size:
    app_img = app_img.resize(ref_img.size, Image.LANCZOS)
    print(f"resized app -> {app_img.size}")

# Compare BOTH unblurred (raw) and blurred (regression-test mode).
def stats(label, ref, app, threshold):
    refn = np.array(ref, dtype=np.int32)
    appn = np.array(app, dtype=np.int32)
    delta = np.abs(refn - appn).sum(axis=2)
    H, W = delta.shape
    print(f"\n=== {label} ===")
    print(f"  Pixels diff>0:    {int((delta>0).sum()):>10}  ({(delta>0).sum()/(H*W)*100:6.2f}%)")
    print(f"  Pixels diff>10:   {int((delta>10).sum()):>10}  ({(delta>10).sum()/(H*W)*100:6.2f}%)")
    print(f"  Pixels diff>30:   {int((delta>30).sum()):>10}  ({(delta>30).sum()/(H*W)*100:6.2f}%)  <- threshold")
    print(f"  Pixels diff>90:   {int((delta>90).sum()):>10}  ({(delta>90).sum()/(H*W)*100:6.2f}%)")
    print(f"  Pixels diff>200:  {int((delta>200).sum()):>10}  ({(delta>200).sum()/(H*W)*100:6.2f}%)")
    print(f"  Pixels diff>500:  {int((delta>500).sum()):>10}  ({(delta>500).sum()/(H*W)*100:6.2f}%)")
    print(f"  Max delta:        {int(delta.max())}")
    return delta

# Unblurred
delta_raw = stats("RAW (no blur)", ref_img, app_img, 30)

# Blurred (regression mode)
ref_b = ref_img.filter(ImageFilter.GaussianBlur(1.0))
app_b = app_img.filter(ImageFilter.GaussianBlur(1.0))
delta_blur = stats("BLURRED (sigma=1.0)", ref_b, app_b, 30)

# Use blurred delta for "where does the regression test see failures?"
ref_arr = np.array(ref_img)
app_arr = np.array(app_img)
ref_b_arr = np.array(ref_b)
app_b_arr = np.array(app_b)
H, W = delta_blur.shape

# 30 worst BLURRED pixels (these are what cause the test fail)
flat = delta_blur.flatten()
top_idx = np.argsort(flat)[-30:][::-1]
print("\nTop 30 worst-blurred pixels (drives the >30 mask):")
for idx in top_idx:
    y, x = divmod(idx, W)
    print(f'  ({x:5d},{y:5d}) ref(blur)={tuple(int(v) for v in ref_b_arr[y,x])}  '
          f'app(blur)={tuple(int(v) for v in app_b_arr[y,x])}  delta_blur={int(flat[idx])}  '
          f'ref(raw)={tuple(int(v) for v in ref_arr[y,x])}  app(raw)={tuple(int(v) for v in app_arr[y,x])}')

# 5x5 raw neighborhoods around top 5
print("\n5x5 RAW neighborhoods around top 5 worst-blurred pixels (luminance):")
for idx in top_idx[:5]:
    y, x = divmod(idx, W)
    y0, y1 = max(0, y-2), min(H, y+3)
    x0, x1 = max(0, x-2), min(W, x+3)
    print(f'\n  Center=({x},{y}):')
    print(f'    ref:')
    for yy in range(y0, y1):
        row = [int(ref_arr[yy, xx].mean()) for xx in range(x0, x1)]
        print(f'      {row}')
    print(f'    app:')
    for yy in range(y0, y1):
        row = [int(app_arr[yy, xx].mean()) for xx in range(x0, x1)]
        print(f'      {row}')

# Spatial clustering
diff_mask = delta_blur > 30
tile = 32
nty = (H + tile - 1) // tile
ntx = (W + tile - 1) // tile
tile_counts = np.zeros((nty, ntx), dtype=int)
for ty in range(nty):
    for tx in range(ntx):
        tile_counts[ty, tx] = diff_mask[ty*tile:(ty+1)*tile, tx*tile:(tx+1)*tile].sum()
nonempty_tiles = int((tile_counts > 0).sum())
total_diff = int(tile_counts.sum())
print(f"\n=== Spatial clustering (tile=32px) ===")
print(f"  Non-empty tiles: {nonempty_tiles}/{nty*ntx}")
print(f"  Avg diff pixels per non-empty tile: {total_diff/max(1,nonempty_tiles):.1f}")
print(f"  Max diff pixels in one tile: {int(tile_counts.max())}")
print(f"  Tiles with >50% diff pixels: {int((tile_counts > tile*tile*0.5).sum())}")

# Top 5 hottest tiles (text region indicator)
top_tile_idx = np.argsort(tile_counts.flatten())[-5:][::-1]
print(f"\n  Top 5 hottest 32x32 tiles:")
for ti in top_tile_idx:
    ty, tx = divmod(ti, ntx)
    print(f'    tile ({tx*32},{ty*32}) -> ({(tx+1)*32},{(ty+1)*32}) : {int(tile_counts.flatten()[ti])} diff pixels')

# Subpixel-shift detection: for each top diff pixel, can we find ref-color in app within 2-px neighborhood?
print("\n=== Subpixel-shift heuristic (looking at top 200 diff pixels) ===")
shifts_h = 0
shifts_v = 0
shifts_diag = 0
not_found = 0
checked = 0
top200 = np.argsort(flat)[-200:][::-1]
for idx in top200:
    y, x = divmod(idx, W)
    if x < 2 or x > W-3 or y < 2 or y > H-3: continue
    checked += 1
    target = ref_arr[y, x].astype(int)
    # Check 5x5 neighborhood in app
    best_d = 999
    best_dx, best_dy = 0, 0
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            d = int(np.abs(app_arr[y+dy, x+dx].astype(int) - target).sum())
            if d < best_d:
                best_d = d
                best_dx, best_dy = dx, dy
    if best_d < 30:
        if best_dx == 0 and best_dy == 0:
            not_found += 1  # found in itself? shouldn't happen
        elif best_dy == 0 and abs(best_dx) <= 2:
            shifts_h += 1
        elif best_dx == 0 and abs(best_dy) <= 2:
            shifts_v += 1
        else:
            shifts_diag += 1
    else:
        not_found += 1

print(f"  Of top {checked} blurred-diff pixels:")
print(f"    Pure H-shift candidates (app value found at (x±k, y)): {shifts_h}")
print(f"    Pure V-shift candidates (app value found at (x, y±k)): {shifts_v}")
print(f"    Diagonal-shift candidates: {shifts_diag}")
print(f"    NOT found in 5x5 neighborhood (genuine intensity disagreement): {not_found}")

# Coverage / AA hypothesis: for each top diff pixel, what's the average luminance disagreement direction?
print("\n=== AA-coverage direction analysis ===")
top500 = np.argsort(flat)[-500:][::-1]
ref_brighter = 0
app_brighter = 0
for idx in top500:
    y, x = divmod(idx, W)
    rl = ref_arr[y, x].mean()
    al = app_arr[y, x].mean()
    if rl > al:
        ref_brighter += 1
    elif al > rl:
        app_brighter += 1
print(f"  Top 500 diff pixels:")
print(f"    REF brighter (text thinner/lighter in REF): {ref_brighter}")
print(f"    APP brighter (text thinner/lighter in APP): {app_brighter}")

# In-glyph vs edge classification: look at gradient magnitude in REF
print("\n=== Where do failures occur (in-glyph dark vs glyph edge vs background) ===")
top1000 = np.argsort(flat)[-1000:][::-1]
in_glyph = 0  # ref pixel is dark (<128)
on_edge = 0   # ref pixel is mid-tone (128-220)
on_bg = 0     # ref pixel is near-white (>220)
for idx in top1000:
    y, x = divmod(idx, W)
    l = ref_arr[y, x].mean()
    if l < 80: in_glyph += 1
    elif l < 220: on_edge += 1
    else: on_bg += 1
print(f"  Top 1000 diff pixels (by REF luminance):")
print(f"    Dark/in-glyph (ref<80):       {in_glyph}")
print(f"    Mid-tone/on-edge (80-220):    {on_edge}")
print(f"    Bright/near-bg (>220):        {on_bg}")
