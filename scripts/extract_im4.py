"""Save the Im4 JPEG to disk so we can inspect it."""
import pikepdf
path = r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\Tekst.pdf'
out = r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\scripts\tekst_im4.jpg'
pdf = pikepdf.open(path)
page = pdf.pages[0]
xobj = page.get('/Resources', {}).get('/XObject', {})
im4 = xobj.get('/Im4')
data = im4.read_raw_bytes()
with open(out, 'wb') as f: f.write(data)
print(f'wrote {len(data)} bytes to {out}')
