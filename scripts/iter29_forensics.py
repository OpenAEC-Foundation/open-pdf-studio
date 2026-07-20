"""Iter 29 - pixel forensics on Technische tekening p1.

Renders both reference (PyMuPDF) and app (open-pdf-render) and compares pixel-by-pixel.
"""
import subprocess
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from render_test.reference import render_with_pymupdf

RENDER_BIN = ROOT / "open-pdf-render" / "target" / "release" / "examples" / "render_page_literal.exe"

PDF = ROOT / "test pdf-bestanden" / "Originele bestanden" / "Technische tekening.pdf"
PAGE = 1
WIDTH = 2000

OUT_APP = ROOT / "_iter29_app.png"
OUT_REF = ROOT / "_iter29_ref.png"

# Render app
print(f"Rendering app: {PDF.name} p{PAGE}")
res = subprocess.run([str(RENDER_BIN), str(PDF), str(PAGE), str(WIDTH), str(OUT_APP)],
                    capture_output=True, text=True, timeout=120)
if res.returncode != 0:
    print(f"render failed: {res.stderr}")
    sys.exit(1)

print(f"Rendering reference: {PDF.name} p{PAGE}")
ref_img = render_with_pymupdf(PDF, PAGE, WIDTH)
ref_img.save(OUT_REF)

# Load and align
app_img = Image.open(OUT_APP).convert("RGBA")
bg = Image.new("RGB", app_img.size, (255,255,255))
bg.paste(app_img, mask=app_img.split()[3] if app_img.mode == "RGBA" else None)
app = np.array(bg)
ref = np.array(ref_img.convert("RGB"))

# Resize if dimensions don't match
if app.shape != ref.shape:
    print(f"Resizing: app {app.shape} ref {ref.shape}")
    if app.shape[0] != ref.shape[0] or app.shape[1] != ref.shape[1]:
        # Resize app to ref size
        bg2 = bg.resize((ref.shape[1], ref.shape[0]), Image.Resampling.LANCZOS)
        app = np.array(bg2)

print(f"\nApp: {app.shape}, Ref: {ref.shape}")

delta = np.abs(ref.astype(int) - app.astype(int)).sum(axis=2)

# Top 30 worst pixels
flat = delta.flatten()
top = np.argsort(flat)[-30:][::-1]
H, W = ref.shape[:2]
print(f'\nImage size: {W}×{H}')
print('Top 30 worst pixels:')
for idx in top:
    y, x = divmod(int(idx), W)
    print(f'  ({x:5d},{y:5d}) ref={tuple(ref[y,x])} app={tuple(app[y,x])} delta={flat[idx]}')

# Concentration analysis
mask = delta > 30
print(f'\nDiff pixels: {mask.sum()} ({mask.sum()*100/mask.size:.2f}%)')
row_sums = mask.sum(axis=1)
top_rows = np.argsort(row_sums)[-15:][::-1]
print('Top 15 rows by diff count:')
for r in top_rows:
    print(f'  y={r:4d}: {row_sums[r]:4d}')

col_sums = mask.sum(axis=0)
top_cols = np.argsort(col_sums)[-15:][::-1]
print('Top 15 cols by diff count:')
for c in top_cols:
    print(f'  x={c:4d}: {col_sums[c]:4d}')

# Color-bias signature (means)
if mask.any():
    masked_ref = ref[mask].mean(axis=0)
    masked_app = app[mask].mean(axis=0)
    print(f'Mean ref color in diff: {masked_ref}')
    print(f'Mean app color in diff: {masked_app}')

    # Per-pixel distribution
    print(f'\nDiff luminance distribution:')
    ref_lum = (ref[mask].astype(int) * [0.299, 0.587, 0.114]).sum(axis=1)
    app_lum = (app[mask].astype(int) * [0.299, 0.587, 0.114]).sum(axis=1)
    print(f'  ref lum: mean={ref_lum.mean():.1f}, min={ref_lum.min():.1f}, max={ref_lum.max():.1f}')
    print(f'  app lum: mean={app_lum.mean():.1f}, min={app_lum.min():.1f}, max={app_lum.max():.1f}')

# Save diff image
diff_norm = (delta / max(1, delta.max()) * 255).astype(np.uint8)
Image.fromarray(diff_norm).save(ROOT / "_iter29_diff.png")
print(f'\nSaved diff at: _iter29_diff.png')
