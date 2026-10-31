"""Inspect actual raster output against the synthetic source and GS ink plates.
Usage: python3 scripts/check-print-flattening-output.py output.pdf [report.json]
Requires pypdf, Pillow and Ghostscript. Temporary plate files are removed.
"""
import hashlib,json,subprocess,sys,tempfile,time
from pathlib import Path
from pypdf import PdfReader
from PIL import Image
source=Path(__file__).parent/'fixtures/print-flattening/corpus.pdf'
output=Path(sys.argv[1])
def inspect(path):
    reader=PdfReader(path)
    return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,
        'output_intents':len(reader.trailer['/Root'].get('/OutputIntents',[])),
        'pages':[{'text':p.extract_text().strip(),'media_box':list(map(float,p.mediabox)),
            'crop_box':list(map(float,p.cropbox)),'trim_box':list(map(float,p.trimbox))} for p in reader.pages]}
def plates(path,directory):
    start=time.perf_counter()
    subprocess.run(['gs','-q','-dSAFER','-dBATCH','-dNOPAUSE','-sDEVICE=tiffsep','-r150',f'-sOutputFile={directory}/page-%d.tif',str(path)],check=True,capture_output=True)
    inks={}
    for f in sorted(Path(directory).glob('*(*).tif')):
        with Image.open(f) as im:
            histogram=im.convert('L').histogram()
            inks[f.name]={'ink_sum':sum((255-i)*n for i,n in enumerate(histogram)),'size':im.size}
    return {'seconds':time.perf_counter()-start,'plates':inks}
report={'source':inspect(source),'export':inspect(output),'reference_engine':subprocess.check_output(['gs','--version'],text=True).strip()}
with tempfile.TemporaryDirectory(prefix='opds-plates-') as temp:
    for key,path in [('source',source),('export',output)]:
        directory=Path(temp)/key;directory.mkdir()
        report[key]['separations']=plates(path,directory)
assert len(report['source']['pages'])==len(report['export']['pages'])==7
assert all('Unaffected searchable text' in p['text'] for p in report['source']['pages'])
assert all(not p['text'] for p in report['export']['pages'])
assert report['source']['output_intents']==1 and report['export']['output_intents']==0
assert any('StudioSpot' in name for name in report['source']['separations']['plates'])
assert not any('StudioSpot' in name for name in report['export']['separations']['plates'])
assert report['export']['pages'][0]['media_box']==[0.,0.,280.,180.]
if len(sys.argv)>2:Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':'NO-GO: raster export loses spot plate, text, output intent and original boxes','source_bytes':report['source']['bytes'],'export_bytes':report['export']['bytes'],'pages':7},indent=2))
