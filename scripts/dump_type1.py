"""Dump the Type1 font file's PostScript ASCII section so we can see encoding+CharStrings."""
import pikepdf
import sys

path = r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\Tekst.pdf'
out_path = r'C:\Users\rickd\Documents\GitHub\open-pdf-studio\scripts\tekst_F1_fontfile.bin'

pdf = pikepdf.open(path)
fonts = pdf.pages[0].get('/Resources', {}).get('/Font', {})
f1 = fonts.get('/F1')
fd = f1.get('/FontDescriptor')
ff = fd.get('/FontFile')
data = ff.read_bytes()
with open(out_path, 'wb') as f:
    f.write(data)

print(f'Saved {len(data)} bytes to {out_path}')
print(f'Length1={ff.get("/Length1")} Length2={ff.get("/Length2")} Length3={ff.get("/Length3")}')

# The first Length1 bytes is ASCII PostScript header
ascii_part = data[:int(ff.get('/Length1'))]
text = ascii_part.decode('latin-1', errors='replace')
# Print encoding-related lines
print('=== Encoding section ===')
in_enc = False
for line in text.split('\n'):
    if '/Encoding' in line:
        in_enc = True
    if in_enc:
        print(line)
        if 'def' in line and 'put' not in line and 'array' not in line:
            # the trailing 'def' for the encoding array
            in_enc = False
            print('--- end encoding ---')

# Print the first 30 chars to see what's there
print()
print('=== Full ASCII header ===')
print(text)
