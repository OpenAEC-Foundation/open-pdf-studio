"""Iter 29 - quick pikepdf signature inspection of near-threshold pages.

For each candidate, extract:
- Resources used (fonts, color spaces, ext-gstates, patterns, shadings)
- Unusual operators in content stream
- Specific feature signatures
"""
import pikepdf
import re
import sys
from pathlib import Path

BASE = Path(r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden')

# Candidate pages (0-indexed in pages[], 1-indexed in user terms)
CANDIDATES = [
    ('Text pdf gecombineerd.pdf', 6),  # p7 (0-idx 6) - 3.43%
    ('Text pdf gecombineerd.pdf', 14), # p15 - 2.82%
    ('Text pdf gecombineerd.pdf', 21), # p22 - 2.98%
    ('Zware vector PDF.pdf', 5),       # p6 - 2.97%
    ('Technische tekening.pdf', 1),    # p2 - 2.89%
    ('Tekst.pdf', 2),                  # p3 - 2.82%
]

INTERESTING_OPS = ['gs', 'cs', 'CS', 'scn', 'SCN', 'sh', 'BI', 'ID', 'EI',
                   'Tr', 'Tw', 'Tz', 'Tc', 'BMC', 'EMC', 'MP', 'DP', 'BDC']

def get_content_stream(page):
    """Concat all content streams as bytes."""
    cs = page.Contents
    if isinstance(cs, pikepdf.Array):
        data = b''
        for ref in cs:
            data += ref.read_bytes()
        return data
    elif isinstance(cs, pikepdf.Stream):
        return cs.read_bytes()
    return b''

def inspect(pdf_name, page_idx):
    print(f'\n{"="*60}')
    print(f'  {pdf_name} page index={page_idx} (page {page_idx+1})')
    print('='*60)
    pdf = pikepdf.open(BASE / pdf_name)
    if page_idx >= len(pdf.pages):
        print('  page out of range')
        return
    page = pdf.pages[page_idx]
    res = page.Resources if '/Resources' in page else {}

    # Fonts
    fonts = res.get('/Font', {})
    print(f'\n  Fonts: {len(fonts)}')
    for name, font in fonts.items():
        try:
            ft = font.get('/Subtype', '?')
            be = font.get('/BaseFont', '?')
            enc = font.get('/Encoding', None)
            has_diff = False
            if enc and isinstance(enc, pikepdf.Dictionary):
                if '/Differences' in enc:
                    has_diff = True
            tu_or_cmap = '/ToUnicode' in font or (isinstance(enc, pikepdf.Name) and 'CMap' in str(enc))
            print(f'    {name}: {ft} {be} differences={has_diff}')
        except Exception as e:
            print(f'    {name}: ERR {e}')

    # Color spaces
    cs = res.get('/ColorSpace', {})
    if cs:
        print(f'\n  ColorSpaces: {len(cs)}')
        for name, c in cs.items():
            try:
                if isinstance(c, pikepdf.Array):
                    kind = str(c[0])
                else:
                    kind = str(c)
                print(f'    {name}: {kind}')
            except Exception as e:
                print(f'    {name}: ERR {e}')

    # Patterns
    pat = res.get('/Pattern', {})
    if pat:
        print(f'\n  Patterns: {len(pat)}')
        for name, p in pat.items():
            print(f'    {name}: PatternType={p.get("/PatternType","?")}')

    # Shadings
    sh = res.get('/Shading', {})
    if sh:
        print(f'\n  Shadings: {len(sh)}')
        for name, s in sh.items():
            print(f'    {name}: ShadingType={s.get("/ShadingType","?")}')

    # ExtGState
    egs = res.get('/ExtGState', {})
    if egs:
        print(f'\n  ExtGState: {len(egs)}')
        for name, g in egs.items():
            keys = list(g.keys())
            interesting = [k for k in keys if k not in ('/Type', '/CA', '/ca', '/LW',
                                                       '/LC', '/LJ', '/ML', '/D')]
            print(f'    {name}: keys={keys[:8]}{"..." if len(keys)>8 else ""} interesting={interesting}')

    # XObjects (forms, images)
    xo = res.get('/XObject', {})
    if xo:
        print(f'\n  XObject: {len(xo)}')
        forms = sum(1 for x in xo.values() if x.get('/Subtype') == '/Form')
        imgs = sum(1 for x in xo.values() if x.get('/Subtype') == '/Image')
        print(f'    forms={forms}, images={imgs}')

    # Content stream operators
    try:
        data = get_content_stream(page)
        print(f'\n  Content stream: {len(data)} bytes')
        text = data.decode('latin-1', errors='ignore')
        op_counts = {}
        for op in INTERESTING_OPS:
            n = len(re.findall(r'(?<![A-Za-z0-9*])' + re.escape(op) + r'(?![A-Za-z0-9])', text))
            if n:
                op_counts[op] = n
        print(f'  Interesting ops: {op_counts}')
        # Look for inline images
        if 'BI' in op_counts:
            print('    !! has inline images')
        if 'sh' in op_counts:
            print('    !! has shadings')
        if 'BMC' in op_counts or 'BDC' in op_counts:
            print('    !! has marked content')
    except Exception as e:
        print(f'  content stream ERR: {e}')

    pdf.close()

for pdf_name, page_idx in CANDIDATES:
    try:
        inspect(pdf_name, page_idx)
    except Exception as e:
        print(f'\nFAILED on {pdf_name} p{page_idx+1}: {e}')
