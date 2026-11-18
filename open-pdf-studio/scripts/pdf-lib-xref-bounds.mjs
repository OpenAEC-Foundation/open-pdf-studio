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

// Welke xref-stromen gebruikt het document werkelijk? Volgt de keten vanaf de
// laatste `startxref` over /Prev en /XRefStm en geeft de beginposities van de
// xref-stromen daarin. `null` als de keten niet zeker te volgen is: dan geldt
// elke /Type /XRef-stroom als gebruikt, zoals voorheen (#1093).
//
// Een ontsleutelde werkkopie heeft een gewone xref-tabel, maar draagt de
// xref-stroom van de bron mee als los object met een te korte inhoud. Die
// stroom is geen kruisverwijzing van dit bestand en mag het laden niet laten
// mislukken; een afgeknotte stroom die wel in de keten zit, blijft een fout.
function actieveXRefStromen(bytes) {
  const lengte = bytes.length;
  const VENSTER = 65536;
  const isWit = (b) => b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
  const tekst = (van, tot) => {
    let s = '';
    for (let i = van, eind = Math.min(tot, lengte); i < eind; i++) s += String.fromCharCode(bytes[i]);
    return s;
  };
  // Zelfde overslaan als de parser: witruimte en commentaar tot het regeleinde.
  const naWit = (p) => {
    while (p < lengte) {
      if (isWit(bytes[p])) p++;
      else if (bytes[p] === 37) { while (p < lengte && bytes[p] !== 10 && bytes[p] !== 13) p++; }
      else break;
    }
    return p;
  };
  const zoek = (woord, van, tot) => {
    const eerste = woord.charCodeAt(0);
    const eind = Math.min(tot, lengte) - woord.length;
    for (let p = bytes.indexOf(eerste, van); p >= 0 && p <= eind; p = bytes.indexOf(eerste, p + 1)) {
      let i = 1;
      while (i < woord.length && bytes[p + i] === woord.charCodeAt(i)) i++;
      if (i === woord.length) return p;
    }
    return -1;
  };
  const getal = (s, sleutel) => {
    const m = new RegExp('/' + sleutel + '\\s*(\\d{1,15})(?![\\d.])').exec(s);
    return m ? Number(m[1]) : undefined;
  };
  const staart = tekst(Math.max(0, lengte - 2048), lengte);
  const laatste = staart.lastIndexOf('startxref');
  const begin = laatste < 0 ? null : /^startxref\s+(\d{1,15})/.exec(staart.slice(laatste));
  if (!begin) return null;
  const actief = new Set();
  const gezien = new Set();
  const wachtrij = [Number(begin[1])];
  while (wachtrij.length) {
    const offset = wachtrij.pop();
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= lengte) return null;
    if (gezien.has(offset)) return null;
    gezien.add(offset);
    if (gezien.size > 4096) return null;
    const p = naWit(offset);
    let kop;
    if (tekst(p, p + 4) === 'xref' && isWit(bytes[p + 4])) {
      // Een xref-tabel bevat geen letter t: de eerste treffer is de trailer.
      const trailer = zoek('trailer', p + 4, lengte);
      if (trailer < 0) return null;
      const eind = zoek('startxref', trailer, trailer + VENSTER);
      if (eind < 0) return null;
      kop = tekst(trailer, eind);
      const stroom = getal(kop, 'XRefStm');
      if (stroom !== undefined) wachtrij.push(stroom);
    } else if (/^\d{1,10}\s+\d{1,5}\s+obj(?![a-zA-Z])/.test(tekst(p, p + 32))) {
      const stream = zoek('stream', p, p + VENSTER);
      if (stream < 0) return null;
      kop = tekst(p, stream);
      if (kop.indexOf('endobj') >= 0 || !/\/Type\s*\/XRef(?![a-zA-Z])/.test(kop)) return null;
      actief.add(p);
    } else {
      return null;
    }
    const vorige = getal(kop, 'Prev');
    if (vorige !== undefined) wachtrij.push(vorige);
  }
  return actief;
}

const hashes = {'PDFParser': '9b5f5cca51c6ed6456c2743229fee2961a5108585073d4779bf75de137feba88', 'PDFXRefStreamParser': 'da4193954e502cf67d3c82adf311714453ef66f73775c4a5ceeef225c5d3b9ba'};
const pattern = /[\\/]pdf-lib[\\/]es[\\/]core[\\/]parser[\\/](PDFParser|PDFXRefStreamParser)\.js$/;
export function patchXRefBounds(source, name) {
  if (!hashes[name] || createHash('sha256').update(source).digest('hex') !== hashes[name]) {
    throw new Error(`Unqualified pdf-lib ${name} source: revalidate XRef bounds before upgrading`);
  }
  if (name === 'PDFParser') {
    const vervang = (tekst, zoek, nieuw) => {
      // Elke plek moet precies één keer bestaan; anders past de patch niet meer.
      const aantal = typeof zoek === 'string' ? tekst.split(zoek).length - 1 : (tekst.match(new RegExp(zoek.source, 'g')) || []).length;
      if (aantal !== 1) throw new Error(`Unqualified pdf-lib ${name} source: patch point missing`);
      return tekst.replace(zoek, () => nieuw);
    };
    let code = source;
    // De beginpositie van het object, om een xref-stroom met de keten te vergelijken.
    code = vervang(code, /ref = this\.parseIndirectObjectHeader\(\);(\s+this\.skipWhitespaceAndComments\(\);\s+object = this\.parseObject\(\);)/,
      `this.skipWhitespaceAndComments();
                        this.opdsObjectBegin = this.bytes.offset();
                        ref = this.parseIndirectObjectHeader();
                        this.skipWhitespaceAndComments();
                        object = this.parseObject();`);
    // De algemene invalid-object-herstelroute mag deze fout niet verbergen.
    code = vervang(code, 'PDFXRefStreamParser.forStream(object).parseIntoContext();', `if (this.opdsActieveXRef === undefined) this.opdsActieveXRef = actieveXRefStromen(this.bytes.bytes);
      if (this.opdsActieveXRef && !this.opdsActieveXRef.has(this.opdsObjectBegin)) {
        // Niet in de xref-keten: geen kruisverwijzing van dit bestand.
        console.warn('Skipping XRef stream object outside the cross-reference chain: ' + ref);
      } else try {
        PDFXRefStreamParser.forStream(object).parseIntoContext();
      } catch (error) {
        var xrefError = new Error('Invalid PDF XRef stream: ' + error.message);
        xrefError.name = 'InvalidXRefStreamError';
        throw xrefError;
      }`);
    code = vervang(code, 'e_1 = _a.sent();', `e_1 = _a.sent();
    if (e_1 && e_1.name === 'InvalidXRefStreamError') throw e_1;`);
    return `${actieveXRefStromen.toString()}\n${code}`;
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
