// Een door open-pdf-signatures ondertekend proefbestand (fixtures/, gemaakt met
// `cargo test -p open-pdf-signatures -- --ignored schrijf_node_fixtures`,
// wegwerpcertificaat) gelezen door onafhankelijke code: MuPDF (structuur,
// incrementele versies, wijzigingsgeschiedenis, weergave) en node:crypto
// (digest over het bytebereik tegen messageDigest in de CMS). MuPDF in wasm
// heeft geen API om een handtekening cryptografisch te controleren; dat doen
// OpenSSL en Poppler in de cargo-tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mupdf from 'mupdf';

const hier = dirname(fileURLToPath(import.meta.url));
const bron = readFileSync(join(hier, 'fixtures/bron.pdf'));
const ondertekend = readFileSync(join(hier, 'fixtures/ondertekend.pdf'));

function open(bytes) {
  return mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
}

function bytebereik(bytes) {
  const tekst = bytes.toString('latin1');
  const m = [...tekst.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].pop();
  assert.ok(m, 'geen /ByteRange');
  return m.slice(1, 5).map(Number);
}

/** Minimale DER-lezer: [tag, inhoud, totale lengte] van het element op `p`. */
function tlv(buf, p) {
  const tag = buf[p];
  let len = buf[p + 1];
  let kop = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + 2 + i];
    kop += n;
  }
  return { tag, inhoud: buf.subarray(p + kop, p + kop + len), totaal: kop + len };
}

/** De waarde van het attribuut messageDigest (1.2.840.113549.1.9.4) in de CMS. */
function messageDigest(cms) {
  const oid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
  const p = cms.indexOf(oid);
  assert.ok(p > 0, 'messageDigest ontbreekt');
  const set = tlv(cms, p + oid.length);
  assert.equal(set.tag, 0x31);
  const octet = tlv(set.inhoud, 0);
  assert.equal(octet.tag, 0x04);
  return Buffer.from(octet.inhoud);
}

test('MuPDF: geen herstel nodig, twee versies, wijzigingsgeschiedenis in orde', () => {
  const doc = open(ondertekend);
  assert.equal(doc.wasRepaired(), false);
  assert.equal(doc.countVersions(), 2, 'bron + één incrementele toevoeging');
  assert.equal(doc.validateChangeHistory(), 0);
});

test('MuPDF: handtekeningveld op pagina 1, de eigen annotatie is er nog', () => {
  const doc = open(ondertekend);
  const pagina = doc.loadPage(0);
  const velden = pagina.getWidgets();
  assert.equal(velden.length, 1);
  assert.equal(velden[0].getFieldType(), 'signature');
  assert.equal(velden[0].getName(), 'Signature1');
  // Rechthoek [300 50 500 110] in PDF-ruimte; MuPDF meet van boven (842 hoog).
  assert.deepEqual(velden[0].getRect().map(Math.round), [300, 732, 500, 792]);
  assert.deepEqual(pagina.getAnnotations().map((a) => a.getType()), ['Square']);
  // Zelfde annotatie als in de bron.
  const bronAnnots = open(bron).loadPage(0).getAnnotations();
  assert.equal(bronAnnots.length, 1);
  assert.equal(bronAnnots[0].getContents(), pagina.getAnnotations()[0].getContents());
});

test('MuPDF: de zichtbare weergave wordt getekend', () => {
  const pagina = open(ondertekend).loadPage(0);
  const pix = pagina.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth();
  const px = pix.getPixels();
  // Ergens in het veld (x 300..500, y 732..792 van boven) staan blauwe pixels.
  let blauw = 0;
  for (let y = 735; y < 790; y++) {
    for (let x = 305; x < 495; x++) {
      const i = (y * w + x) * 3;
      if (px[i + 2] > 120 && px[i] < 80 && px[i + 1] < 80) blauw++;
    }
  }
  assert.ok(blauw > 100, `te weinig gekleurde pixels in de handtekening: ${blauw}`);
});

test('node:crypto: SHA-256 over het bytebereik is de messageDigest van de CMS', () => {
  const [s1, l1, s2, l2] = bytebereik(ondertekend);
  assert.equal(s1, 0);
  assert.equal(s2 + l2, ondertekend.length);
  assert.equal(ondertekend[l1], 0x3c); // '<'
  assert.equal(ondertekend[s2 - 1], 0x3e); // '>'
  const hex = ondertekend.subarray(l1 + 1, s2 - 1).toString('latin1');
  const cms = Buffer.from(hex, 'hex');
  const digest = createHash('sha256').update(ondertekend.subarray(0, l1)).update(ondertekend.subarray(s2)).digest();
  assert.deepEqual(messageDigest(cms), digest);
  // De bron staat ongewijzigd vooraan: incrementeel ondertekend.
  assert.ok(ondertekend.subarray(0, bron.length).equals(bron));
});

test('node:crypto: een gewijzigde byte past niet meer bij de messageDigest', () => {
  const vervalst = Buffer.from(ondertekend);
  const p = vervalst.indexOf('Hallo wereld');
  vervalst[p] = 0x4a;
  const [, l1, s2] = bytebereik(vervalst);
  const cms = Buffer.from(vervalst.subarray(l1 + 1, s2 - 1).toString('latin1'), 'hex');
  const digest = createHash('sha256').update(vervalst.subarray(0, l1)).update(vervalst.subarray(s2)).digest();
  assert.notDeepEqual(messageDigest(cms), digest);
});
