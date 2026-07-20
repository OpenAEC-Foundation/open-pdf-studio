"""Quick inspection of Tekst.pdf to understand fonts and content."""
import pikepdf
import sys

path = r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\Tekst.pdf'
pdf = pikepdf.open(path)
print(f'Number of pages: {len(pdf.pages)}')
print(f'PDF version: {pdf.pdf_version}')
print()

for i, page in enumerate(pdf.pages):
    print(f'=== Page {i} ===')
    res = page.get('/Resources', {})
    fonts = res.get('/Font', {}) if res else {}
    print(f'  MediaBox: {page.get("/MediaBox")}')
    print(f'  CropBox: {page.get("/CropBox", "(inherited)")}')
    print(f'  Rotate: {page.get("/Rotate", 0)}')
    items = list(fonts.items()) if hasattr(fonts, 'items') else []
    print(f'  {len(items)} font(s):')
    for k, v in items:
        subtype = v.get("/Subtype")
        basefont = v.get("/BaseFont")
        encoding = v.get("/Encoding")
        firstchar = v.get('/FirstChar')
        lastchar = v.get('/LastChar')
        print(f'    {k}: subtype={subtype} basefont={basefont}')
        print(f'        encoding={encoding} firstchar={firstchar} lastchar={lastchar}')
        fd = v.get('/FontDescriptor')
        if fd:
            print(f'        FontDescriptor: FF1={bool(fd.get("/FontFile"))} FF2={bool(fd.get("/FontFile2"))} FF3={bool(fd.get("/FontFile3"))}')
            print(f'        Flags={fd.get("/Flags")} ItalicAngle={fd.get("/ItalicAngle")} Ascent={fd.get("/Ascent")} Descent={fd.get("/Descent")}')
        if subtype == '/Type0':
            df = v.get('/DescendantFonts')
            if df:
                print(f'        DescendantFonts:')
                for dfi in df:
                    print(f'          subtype={dfi.get("/Subtype")} basefont={dfi.get("/BaseFont")}')
                    cidsi = dfi.get('/CIDSystemInfo')
                    if cidsi:
                        print(f'          CIDSystemInfo: Registry={cidsi.get("/Registry")} Ordering={cidsi.get("/Ordering")} Supplement={cidsi.get("/Supplement")}')
                    dfd = dfi.get('/FontDescriptor')
                    if dfd:
                        print(f'          DescFont FontDescriptor: FF1={bool(dfd.get("/FontFile"))} FF2={bool(dfd.get("/FontFile2"))} FF3={bool(dfd.get("/FontFile3"))}')

    # Get content stream
    try:
        cs = page.get('/Contents')
        if cs:
            if isinstance(cs, pikepdf.Array):
                stream_bytes = b''.join(s.read_bytes() for s in cs)
            else:
                stream_bytes = cs.read_bytes()
            print(f'  Content stream length: {len(stream_bytes)} bytes')
            # Print first 500 bytes
            preview = stream_bytes[:800].decode('latin-1', errors='replace')
            print(f'  Content preview:')
            for line in preview.split('\n')[:30]:
                print(f'    {line!r}')
    except Exception as e:
        print(f'  ERROR reading content: {e}')
    print()
