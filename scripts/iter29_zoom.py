"""Zoom into annotation areas to verify rendering."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

# Load both
ref = Image.open(ROOT / "_iter29_ref.png")
app = Image.open(ROOT / "_iter29_test.png").convert("RGBA")
bg = Image.new("RGB", app.size, (255,255,255))
bg.paste(app, mask=app.split()[3] if app.mode == "RGBA" else None)
app = bg

# Crop to right-bottom area where the annotations are
# Annot Rect range: x=815-1506 (PDF), y=1431-2084 (PDF)
# Page: 2384x1684 pt (post-rotation maybe), scale=0.84
# pixel_x = (pdf_x - x0) * scale, pixel_y = (h - pdf_y) * scale (Y flipped)
# But Technische tekening is rotated 90° (landscape), let me just visually crop

W, H = app.size  # 2000, 1413
# Look at right side of image where most of the annotations are
crop_box = (W*3//5, 0, W, H*3//5)  # right ~half, top ~half
ref_crop = ref.crop(crop_box)
app_crop = app.crop(crop_box)

# Side-by-side
combo = Image.new("RGB", (ref_crop.width * 2 + 10, ref_crop.height), (200, 200, 200))
combo.paste(ref_crop, (0, 0))
combo.paste(app_crop, (ref_crop.width + 10, 0))
combo.save(ROOT / "_iter29_combo.png")
print(f"Saved combo at {ROOT / '_iter29_combo.png'}")
print(f"Ref left, App right. Crop: {crop_box}")
