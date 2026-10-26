"""Qualify the same malformed fixture with the shipped Linux PDFium library.
Usage: python3 scripts/check-decoder-omissions-native.py [path/to/libpdfium.so]
This records API behavior, not a fidelity guarantee or a Tauri UI test.
"""
import ctypes as c
import hashlib
import json
from pathlib import Path
import sys
root = Path(__file__).resolve().parent.parent
library = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'src-tauri/binaries/linux-x64/libpdfium.so'
pdf = (root / 'scripts/fixtures/decoder-omissions/unsupported-xobject.pdf').read_bytes()
lib = c.CDLL(str(library))
def bind(name, result, *args):
    fn = getattr(lib, name)
    fn.restype, fn.argtypes = result, list(args)
    return fn
bind('FPDF_InitLibrary', None)()
load = bind('FPDF_LoadMemDocument', c.c_void_p, c.c_void_p, c.c_int, c.c_char_p)
page_load = bind('FPDF_LoadPage', c.c_void_p, c.c_void_p, c.c_int)
create = bind('FPDFBitmap_Create', c.c_void_p, c.c_int, c.c_int, c.c_int)
fill = bind('FPDFBitmap_FillRect', None, c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_int, c.c_ulong)
render = bind('FPDF_RenderPageBitmap', None, c.c_void_p, c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_int, c.c_int, c.c_int)
stride = bind('FPDFBitmap_GetStride', c.c_int, c.c_void_p)
buffer = bind('FPDFBitmap_GetBuffer', c.c_void_p, c.c_void_p)
close_page = bind('FPDF_ClosePage', None, c.c_void_p)
close_doc = bind('FPDF_CloseDocument', None, c.c_void_p)
destroy_bitmap = bind('FPDFBitmap_Destroy', None, c.c_void_p)
destroy = bind('FPDF_DestroyLibrary', None)
source = c.create_string_buffer(pdf)
doc = load(source, len(pdf), None)
assert doc, 'load failed'
page = bitmap = None
try:
    page = page_load(doc, 0)
    assert page
    bitmap = create(100, 100, 1)
    assert bitmap
    fill(bitmap, 0, 0, 100, 100, 0xffffffff)
    render(bitmap, page, 0, 0, 100, 100, 0, 0)
    pixels = c.string_at(buffer(bitmap), stride(bitmap) * 100)
    offset = 90 * stride(bitmap) + 10 * 4
    pixel = list(pixels[offset:offset + 4])
    assert pixel == [0, 0, 0, 255], pixel
    print(json.dumps({'library_sha256': hashlib.sha256(library.read_bytes()).hexdigest(),
        'fixture_sha256': hashlib.sha256(pdf).hexdigest(), 'known_rectangle_bgra': pixel,
        'render_api': 'void; no resource omission warning exposed'}, indent=2))
finally:
    if bitmap: destroy_bitmap(bitmap)
    if page: close_page(page)
    close_doc(doc)
    destroy()
