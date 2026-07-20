import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pikepdf
pdf = pikepdf.open(r'test pdf-bestanden/Originele bestanden/2885 Demo project.pdf')
page = pdf.pages[4]
res = page['/Resources']
form = res['/XObject']['/X8']
fonts = form['/Resources']['/Font']

for fname, font in fonts.items():
    print('===', fname, '===')
    print('Subtype:', font.get('/Subtype'))
    print('BaseFont:', font.get('/BaseFont'))
    print('Encoding:', font.get('/Encoding'))
    desc_fonts = font.get('/DescendantFonts', None)
    print('DescendantFonts:', desc_fonts is not None)
    tu = font.get('/ToUnicode', None)
    print('ToUnicode present:', tu is not None)
    if desc_fonts:
        for cidfont in desc_fonts:
            print('  CID Subtype:', cidfont.get('/Subtype'))
            print('  CID BaseFont:', cidfont.get('/BaseFont'))
            cidsi = cidfont.get('/CIDSystemInfo', {})
            print('  CIDSystemInfo:', dict(cidsi))
            print('  CIDToGIDMap:', cidfont.get('/CIDToGIDMap', 'none'))
            w = cidfont.get('/W', None)
            print('  W len:', len(w) if w else 'none')
            print('  DW:', cidfont.get('/DW', 'default'))
            fdesc = cidfont.get('/FontDescriptor', {})
            print('  FontDescriptor keys:', list(fdesc.keys()))
            for k in ('/FontFile', '/FontFile2', '/FontFile3'):
                if k in fdesc:
                    ff = fdesc[k]
                    print(f'    {k} length:', len(ff.read_bytes()))
                    print(f'    {k} subtype:', ff.get('/Subtype', 'none'))
    if tu:
        tu_bytes = tu.read_bytes()
        print('  ToUnicode CMap length:', len(tu_bytes))
        print(tu_bytes.decode('latin1')[:500])
    print()
