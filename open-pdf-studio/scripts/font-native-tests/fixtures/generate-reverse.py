"""Own geometric font fixture for GSUB 8; fonttools==4.60.1, no external glyphs."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString

fb = FontBuilder(1000, isTTF=True)
names = ['.notdef', 'space', 'A', 'B', 'C', 'D', 'alt', 'mark']
fb.setupGlyphOrder(names)
fb.setupCharacterMap({32:'space',65:'A',66:'B',67:'C',68:'D',0x301:'mark'})
glyphs = {}
for i, name in enumerate(names):
    pen = TTGlyphPen(None)
    if name != 'space':
        pen.moveTo((50,0)); pen.lineTo((100+i*50,0)); pen.lineTo((100+i*50,500+i*20)); pen.closePath()
    glyphs[name] = pen.glyph()
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({n:(0 if n=='mark' else 600,0) for n in names})
fb.setupHorizontalHeader(ascent=800,descent=-200)
fb.setupNameTable({'familyName':'OPDS Reverse Fixture','styleName':'Regular','uniqueFontIdentifier':'OPDS-Reverse','fullName':'OPDS Reverse Fixture','psName':'OPDS-Reverse','version':'Version 1.0'})
fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200)
fb.setupPost();fb.setupMaxp()
addOpenTypeFeaturesFromString(fb.font, '''
languagesystem DFLT dflt;
languagesystem latn dflt;
table GDEF { GlyphClassDef [A B C D alt], [], [mark], []; } GDEF;
feature calt { rsub A B C' D by alt; } calt;
feature ss01 { rsub A' A by B; } ss01;
feature ss02 { rsub A' by alt; } ss02;
feature ss03 { lookupflag IgnoreMarks; rsub A B' C by alt; } ss03;
feature ss04 { lookup EXT useExtension { rsub A' A by B; } EXT; } ss04;
feature ss05 { sub D by C; } ss05;
''')
fb.font['head'].created = fb.font['head'].modified = 2082844800
fb.font.recalcTimestamp=False
fb.font.save(Path(__file__).with_name('reverse-substitution.ttf'))
