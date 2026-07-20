import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pikepdf, re
from collections import Counter
pdf = pikepdf.open(r'test pdf-bestanden/Originele bestanden/2885 Demo project.pdf')
page = pdf.pages[4]
content = page.Contents
raw = b''.join(c.read_bytes() for c in (content if isinstance(content, list) else [content]))
print('Page content stream (' + str(len(raw)) + ' bytes):')
print(raw[:2000].decode('latin1', errors='replace'))
print('---')
ops = re.findall(rb"\b([a-zA-Z][a-zA-Z\*']{0,5})\b", raw)
print('Op counts:', Counter(ops).most_common(20))

print()
print('=== Form X8 ===')
res = page['/Resources']
xobj = res['/XObject']
form = xobj['/X8']
print('BBox:', form.get('/BBox'))
print('Matrix:', form.get('/Matrix', None))
print('Group:', dict(form.get('/Group', {})))
fres = form.get('/Resources', {})
print('Form Resources keys:', list(fres.keys()))

# Form fonts
ffonts = fres.get('/Font', {})
print('Form Fonts:')
for k, v in ffonts.items():
    sub = v.get('/Subtype', '?')
    base = v.get('/BaseFont', '?')
    enc = v.get('/Encoding', '?')
    fdesc = v.get('/FontDescriptor', {})
    embedded = ('/FontFile' in fdesc) or ('/FontFile2' in fdesc) or ('/FontFile3' in fdesc) if hasattr(fdesc, 'get') else False
    tounicode = '/ToUnicode' in v
    descs = v.get('/DescendantFonts', None)
    print(f'  {k}: {sub} {base} enc={enc} embedded={embedded} ToUnicode={tounicode} desc={descs is not None}')

# Form xobjects
fxobj = fres.get('/XObject', {})
print('Form XObjects:')
for k, v in fxobj.items():
    sub = v.get('/Subtype', '?')
    if sub == '/Image':
        print(f'  {k}: Image {v.get("/Width")}x{v.get("/Height")} cs={v.get("/ColorSpace","?")} smask={"/SMask" in v}')
    elif sub == '/Form':
        grp = v.get('/Group', None)
        print(f'  {k}: Form bbox={v.get("/BBox")} group={dict(grp) if grp else None}')
    else:
        print(f'  {k}: {sub}')

# Form gstate / CS
fgs = fres.get('/ExtGState', {})
print('Form ExtGState:')
for k, v in fgs.items():
    print(f'  {k}:', dict(v))
fcs = fres.get('/ColorSpace', {})
print('Form ColorSpace:')
for k, v in fcs.items():
    print(f'  {k}: {v}')

# Form content stream
fcontent = form.read_bytes()
print()
print('Form content stream length:', len(fcontent))
print('--- first 800 bytes ---')
print(fcontent[:800].decode('latin1', errors='replace'))
print()
print('--- last 800 bytes ---')
print(fcontent[-800:].decode('latin1', errors='replace'))
print()
fops = re.findall(rb"\b([a-zA-Z][a-zA-Z\*']{0,5})\b", fcontent)
print('Form op counts:', Counter(fops).most_common(25))
