"""Original synthetic qualification corpus, no third-party artwork/fonts.
Requires reportlab, pypdf, Pillow. Generated ICC profile is sRGB, not a press profile.
"""
from io import BytesIO
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import CMYKColorSep
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageCms
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject as D, NameObject as N, BooleanObject as B, ArrayObject as A, NumberObject as I, DecodedStreamObject, TextStringObject as T
out = BytesIO()
c = canvas.Canvas(out, pagesize=(300,200), invariant=1, pageCompression=0)
names=['K over cyan','Spot overprint','Isolated group','Knockout group','Soft mask image over text','ICC output intent','Nested forms']
for n,label in enumerate(names):
    c.setFillColorCMYK(0,0,0,1)
    c.drawString(25,165,label)
    c.drawString(25,30,'Unaffected searchable text')
    c.setFillColorCMYK(1,0,0,0);c.rect(25,55,160,85,fill=1,stroke=0)
    if n==1:
        c.setFillColor(CMYKColorSep(0,1,0,0,spotName='StudioSpot'))
        c.rect(35,60,110,65,fill=1,stroke=0)
    if n==4:
        c.setFillColorCMYK(0,0,0,1);c.drawString(30,95,'Text behind soft mask')
        im=Image.new('RGBA',(32,32),(255,0,0,100))
        c.drawImage(ImageReader(im),35,70,100,50,mask='auto')
    elif n==6:
        c.beginForm('Inner',0,0,300,200)
        c.setFillAlpha(.5);c.setFillColorCMYK(0,1,0,0);c.rect(75,70,120,60,fill=1,stroke=0)
        c.endForm()
        c.beginForm('Outer',0,0,300,200);c.doForm('Inner');c.endForm();c.doForm('Outer')
    else:
        c.saveState();c.setFillOverprint(True);c.setOverprintMask(True)
        c.setFillColorCMYK(0,0,0,1)
        if n in [2,3,5]:c.setFillAlpha(.5)
        c.rect(85,65,140,60,fill=1,stroke=0);c.restoreState()
    c.showPage()
c.save()
r=PdfReader(BytesIO(out.getvalue()));w=PdfWriter()
for n,p in enumerate(r.pages):
    p.cropbox.lower_left=(10,10);p.cropbox.upper_right=(290,190)
    p.trimbox.lower_left=(20,20);p.trimbox.upper_right=(280,180)
    page=w.add_page(p)
    if n in [2,3]:
        form=DecodedStreamObject();form.set_data(page.get_contents().get_data())
        form.update({N('/Type'):N('/XObject'),N('/Subtype'):N('/Form'),N('/BBox'):A([I(0),I(0),I(300),I(200)]),N('/Resources'):page['/Resources'],N('/Group'):D({N('/S'):N('/Transparency'),N('/CS'):N('/DeviceCMYK'),N('/I'):B(n==2),N('/K'):B(n==3)})})
        ref=w._add_object(form)
        page[N('/Resources')]=D({N('/XObject'):D({N('/Group'):ref})})
        content=DecodedStreamObject();content.set_data(b'/Group Do')
        page[N('/Contents')]=w._add_object(content)
profile=DecodedStreamObject();profile.set_data(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes());profile[N('/N')]=I(3)
w._root_object[N('/OutputIntents')]=A([D({N('/Type'):N('/OutputIntent'),N('/S'):N('/GTS_PDFX'),N('/OutputConditionIdentifier'):T('Synthetic sRGB; not PDF/X certified'),N('/DestOutputProfile'):w._add_object(profile)})])
w.write(Path(__file__).with_name('corpus.pdf'))
