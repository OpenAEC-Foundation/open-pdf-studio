// Begrens de synchrone XRef-parser van pdf-lib 1.17.1 (#1093).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Zelfstandige functies worden in de gekwalificeerde dependency ingevoegd.
function initializeXRef(rawStream) {
  this.alreadyParsed = false;
  this.dict = rawStream.dict;
  this.context = this.dict.context;
  const invalid = () => { throw new Error('Invalid or oversized XRef layout'); };
  const integer = (n) => Number.isSafeInteger(n) && n >= 0;
  const size = this.dict.lookup(PDFName.of('Size'), PDFNumber).asNumber();
  if (!integer(size)) invalid();
  const widths = this.dict.lookup(PDFName.of('W'), PDFArray);
  if (widths.size() !== 3) invalid();
  this.byteWidths = [0, 1, 2].map((i) => widths.lookup(i, PDFNumber).asNumber());
  if (this.byteWidths.some((w) => !integer(w) || w > 8)) invalid();
  const index = this.dict.lookup(PDFName.of('Index'));
  this.subsections = [];
  let entries = 0;
  const add = (firstObjectNumber, length) => {
    if (!integer(firstObjectNumber) || !integer(length) || firstObjectNumber > size - length) invalid();
    entries += length;
    // Ook /W [0 0 0] mag geen onbegrensde allocatielus veroorzaken.
    if (entries > 1000000) invalid();
    this.subsections.push({ firstObjectNumber, length });
  };
  if (index !== undefined) {
    if (!(index instanceof PDFArray) || index.size() % 2 || index.size() > 2000000) invalid();
    for (let i = 0; i < index.size(); i += 2) {
      add(index.lookup(i, PDFNumber).asNumber(), index.lookup(i + 1, PDFNumber).asNumber());
    }
  } else {
    add(0, size);
  }
  const required = entries * this.byteWidths.reduce((a, b) => a + b, 0);
  // Maximaal 16 MiB veldlezingen per stream, naast maximaal 1 miljoen records.
  if (required > 16 * 1024 * 1024) invalid();
  this.bytes = ByteStream.fromPDFRawStream(rawStream);
  if (required > this.bytes.length - this.bytes.offset()) {
    throw new Error('Truncated XRef stream');
  }
}
function readXRefField(bytes, width) {
  let value = 0;
  for (let i = 0; i < width; i++) {
    if (bytes.done()) throw new Error('Truncated XRef stream');
    value = value * 256 + bytes.next();
    if (!Number.isSafeInteger(value)) throw new Error('XRef field exceeds safe integer precision');
  }
  return value;
}

const hashes = {'PDFParser': '9b5f5cca51c6ed6456c2743229fee2961a5108585073d4779bf75de137feba88', 'PDFXRefStreamParser': 'da4193954e502cf67d3c82adf311714453ef66f73775c4a5ceeef225c5d3b9ba'};
const pattern = /[\\/]pdf-lib[\\/]es[\\/]core[\\/]parser[\\/](PDFParser|PDFXRefStreamParser)\.js$/;
export function patchXRefBounds(source, name) {
  if (!hashes[name] || createHash('sha256').update(source).digest('hex') !== hashes[name]) {
    throw new Error(`Unqualified pdf-lib ${name} source: revalidate XRef bounds before upgrading`);
  }
  if (name === 'PDFParser') {
    // De algemene invalid-object-herstelroute mag deze fout niet verbergen.
    return source.replace('PDFXRefStreamParser.forStream(object).parseIntoContext();', `try {
      PDFXRefStreamParser.forStream(object).parseIntoContext();
    } catch (error) {
      var xrefError = new Error('Invalid PDF XRef stream: ' + error.message);
      xrefError.name = 'InvalidXRefStreamError';
      throw xrefError;
    }`).replace('e_1 = _a.sent();', `e_1 = _a.sent();
    if (e_1 && e_1.name === 'InvalidXRefStreamError') throw e_1;`);
  }
  const start = source.indexOf('        this.alreadyParsed = false;');
  const end = source.indexOf('    PDFXRefStreamParser.prototype.parseIntoContext');
  let code = source.slice(0, start) + '        initializeXRef.call(this, rawStream);\n    }\n' + source.slice(end);
  for (const [field, width] of [['type', 'typeFieldWidth'], ['offset', 'offsetFieldWidth'], ['generationNumber', 'genFieldWidth']]) {
    const loop = `var ${field} = 0;
                for (var idx = 0, len = ${width}; idx < len; idx++) {
                    ${field} = (${field} << 8) | this.bytes.next();
                }`;
    code = code.replace(loop, `var ${field} = readXRefField(this.bytes, ${width});`);
  }
  return `${initializeXRef.toString()}\n${readXRefField.toString()}\n${code}`;
}
export function pdfLibXRefEsbuild() {
  return { name: 'opds-pdf-lib-xref-bounds', setup(build) {
    build.onLoad({ filter: pattern }, ({ path }) => ({
      contents: patchXRefBounds(readFileSync(path, 'utf8'), path.match(pattern)[1]), loader: 'js',
    }));
  } };
}
export function pdfLibXRefBounds() {
  return {
    name: 'opds-pdf-lib-xref-bounds', enforce: 'pre',
    config() { return { optimizeDeps: { esbuildOptions: { plugins: [pdfLibXRefEsbuild()] } } }; },
    transform(source, id) {
      const match = id.match(pattern);
      return match ? { code: patchXRefBounds(source, match[1]), map: null } : null;
    },
  };
}
