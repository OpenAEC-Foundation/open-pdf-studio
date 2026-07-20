"""Inspect XObjects (images) in Tekst.pdf"""
import pikepdf

path = r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\Tekst.pdf'
pdf = pikepdf.open(path)
for i, page in enumerate(pdf.pages[:1]):
    res = page.get('/Resources', {})
    xobjs = res.get('/XObject', {})
    print(f'=== Page {i} XObjects ===')
    for k, v in (xobjs.items() if hasattr(xobjs, 'items') else []):
        print(f'  {k}: subtype={v.get("/Subtype")} type={v.get("/Type")}')
        if v.get('/Subtype') == '/Image':
            print(f'    Width={v.get("/Width")} Height={v.get("/Height")}')
            print(f'    BPC={v.get("/BitsPerComponent")} CS={v.get("/ColorSpace")} Filter={v.get("/Filter")}')
        elif v.get('/Subtype') == '/Form':
            bbox = v.get('/BBox')
            print(f'    BBox={bbox}')
            mat = v.get('/Matrix')
            print(f'    Matrix={mat}')

# Check the F1 font's CharStrings/encoding more carefully
print()
print('=== F1 Type1 font detail ===')
page0 = pdf.pages[0]
fonts = page0.get('/Resources', {}).get('/Font', {})
f1 = fonts.get('/F1')
if f1:
    print(f'BaseFont: {f1.get("/BaseFont")}')
    print(f'Encoding: {f1.get("/Encoding")}')
    enc = f1.get('/Encoding')
    if enc:
        print(f'  Encoding type: {type(enc).__name__}')
        if hasattr(enc, 'get'):
            print(f'  BaseEncoding: {enc.get("/BaseEncoding")}')
            diffs = enc.get('/Differences')
            if diffs:
                print(f'  Differences: {list(diffs)[:30]}...')
    fd = f1.get('/FontDescriptor')
    if fd:
        ff = fd.get('/FontFile')
        if ff:
            ff_dict = ff
            ff_data = ff.read_bytes()
            print(f'  FontFile length: {len(ff_data)}')
            print(f'  FontFile1 dict: Length1={ff_dict.get("/Length1")} Length2={ff_dict.get("/Length2")} Length3={ff_dict.get("/Length3")}')
            # Show first 300 bytes (the ASCII header of Type1)
            print(f'  Header preview: {ff_data[:400]!r}')
    cm = f1.get('/ToUnicode')
    if cm:
        cm_data = cm.read_bytes()
        print(f'  ToUnicode CMap length: {len(cm_data)}')
        print(f'  ToUnicode preview: {cm_data[:600].decode("latin-1", errors="replace")!r}')
    widths = f1.get('/Widths')
    if widths:
        print(f'  Widths: {list(widths)[:20]}')

print()
print('=== F2 TrueType font detail ===')
f2 = fonts.get('/F2')
if f2:
    print(f'BaseFont: {f2.get("/BaseFont")}')
    print(f'Encoding: {f2.get("/Encoding")}')
    fd = f2.get('/FontDescriptor')
    if fd:
        ff2 = fd.get('/FontFile2')
        if ff2:
            data = ff2.read_bytes()
            print(f'  FontFile2 length: {len(data)}')
            print(f'  Length1={ff2.get("/Length1")}')
            # Detect TTF magic
            print(f'  First bytes: {data[:8].hex()}')
    widths = f2.get('/Widths')
    if widths:
        print(f'  Widths: {list(widths)[:5]}')
    cm = f2.get('/ToUnicode')
    if cm:
        print(f'  ToUnicode preview: {cm.read_bytes()[:400].decode("latin-1", errors="replace")!r}')
