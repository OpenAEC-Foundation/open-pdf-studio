"""Synthetic test glyphs and two TTC faces, generated with fonttools==4.60.1.
No third-party font data. Run from this directory to reproduce the fixtures.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTCollection


def face(family):
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(['.notdef', 'space', 'box'])
    fb.setupCharacterMap({32: 'space', 65: 'box', 0x65E5: 'box'})
    glyphs = {}
    for name in ['.notdef', 'space', 'box']:
        pen = TTGlyphPen(None)
        if name != 'space':
            pen.moveTo((100, 0))
            pen.lineTo((500, 0))
            pen.lineTo((500, 700))
            pen.lineTo((100, 700))
            pen.closePath()
        glyphs[name] = pen.glyph()
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({name: (600, 0) for name in glyphs})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular',
                      'uniqueFontIdentifier': family + '-Regular',
                      'fullName': family + ' Regular',
                      'psName': family.replace(' ', '').replace('日本語', 'JP') + '-Regular',
                      'version': 'Version 1.0'})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    fb.setupMaxp()
    fb.font['head'].created = fb.font['head'].modified = 2082844800
    fb.font.recalcTimestamp = False
    return fb.font

root = Path(__file__).parent
face('OPDS Installed Fixture').save(root / 'installed.ttf')
collection = TTCollection()
collection.fonts = [face('OPDS Collection One'), face('OPDS Collection 日本語')]
collection.save(root / 'collection.ttc')

# Long loca offsets may point at odd-length glyph records (as in BIZ UDGothic).
odd = face("OPDS Odd Glyphs")
odd["glyf"].padding = 0
odd.save(root / "odd-glyphs.ttf")
