import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pdfDatum, foutMelding, isTijdstempelFout, weergaveRegels, vakNaarPdf, weergaveMaat, normaliseerKeuzes,
  STANDAARD_KEUZES, geldigeTijdstempelUrl,
} from './ondertekenen-regels.js';

const hier = dirname(fileURLToPath(import.meta.url));
const bron = (pad) => readFileSync(join(hier, pad), 'utf8').replace(/\r\n/g, '\n');

test('pdfDatum: lokale tijd met tijdzone in PDF-notatie', () => {
  const d = new Date(2026, 9, 27, 21, 30, 5);
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-])(\d{2})'(\d{2})'$/.exec(pdfDatum(d));
  assert.ok(m, pdfDatum(d));
  assert.deepEqual(m.slice(1, 7), ['2026', '10', '27', '21', '30', '05']);
  const verschil = -d.getTimezoneOffset();
  assert.equal(m[7], verschil >= 0 ? '+' : '-');
  assert.equal(Number(m[8]) * 60 + Number(m[9]), Math.abs(verschil));
});

test('foutMelding: bekende codes krijgen een eigen sleutel, de rest "intern"', () => {
  assert.deepEqual(foutMelding({ code: 'verkeerd-wachtwoord' }), {
    sleutel: 'digitalSign.errors.wrongPassword', opties: { detail: 'verkeerd-wachtwoord' },
  });
  assert.equal(foutMelding({ code: 'tijdstempel', detail: 'HTTP 500' }).opties.detail, 'HTTP 500');
  assert.equal(foutMelding({ code: 'onbekend-nieuw' }).sleutel, 'digitalSign.errors.internal');
  assert.equal(foutMelding('kapot').sleutel, 'digitalSign.errors.internal');
  assert.equal(foutMelding('kapot').opties.detail, 'kapot');
  assert.equal(foutMelding(null).sleutel, 'digitalSign.errors.internal');
  assert.equal(isTijdstempelFout({ code: 'tijdstempel' }), true);
  assert.equal(isTijdstempelFout({ code: 'intern' }), false);
  assert.equal(isTijdstempelFout('tijdstempel'), false);
});

test('weergaveRegels: naam altijd, datum/reden/plaats alleen als ze er zijn', () => {
  const v = (k, o) => `${k}:${Object.values(o || {}).join(',')}`;
  assert.deepEqual(weergaveRegels({ naam: 'A. Tekenaar', datum: '27-10-2026', reden: ' Akkoord ', plaats: '' }, v), [
    'signedBy:A. Tekenaar', 'dateLine:27-10-2026', 'reasonLine:Akkoord',
  ]);
  assert.deepEqual(weergaveRegels({ naam: 'B' }, v), ['signedBy:B']);
});

test('vakNaarPdf: hoeken gesorteerd, ook als de y-as omdraait', () => {
  // Pagina van 842 hoog zonder draaiing: pdf.js zet y om (y_pdf = 842 - y).
  const naarPdf = (x, y) => [x, 842 - y];
  assert.deepEqual(vakNaarPdf({ x: 100, y: 700, width: 200, height: 60 }, naarPdf), [100, 82, 300, 142]);
  // Gedraaid (90°): x en y wisselen.
  const gedraaid = (x, y) => [y, x];
  assert.deepEqual(vakNaarPdf({ x: 10, y: 20, width: 30, height: 40 }, gedraaid), [20, 10, 60, 40]);
});

test('weergaveMaat: ~4 px per punt, lange zijde hooguit 2400', () => {
  assert.deepEqual(weergaveMaat(200, 60), { breedte: 800, hoogte: 240, schaal: 4 });
  const groot = weergaveMaat(1200, 300);
  assert.equal(groot.breedte, 2400);
  assert.equal(groot.hoogte, 600);
  assert.ok(weergaveMaat(0.1, 0.1).breedte >= 1);
});

test('normaliseerKeuzes: alleen bekende velden met het goede type, nooit een wachtwoord', () => {
  assert.deepEqual(normaliseerKeuzes(null), { ...STANDAARD_KEUZES });
  const k = normaliseerKeuzes({
    p12: '/pad/naar/id.p12', wachtwoord: 'geheim', zichtbaar: false, afbeelding: 2,
    reden: 'Akkoord', subfilter: 'adbe.pkcs7.detached', tijdstempelUrl: 'https://tsa.example/tsr',
  });
  assert.equal(k.wachtwoord, undefined);
  assert.equal(k.p12, '/pad/naar/id.p12');
  assert.equal(k.zichtbaar, false);
  assert.equal(k.afbeelding, 2);
  assert.equal(k.subfilter, 'adbe.pkcs7.detached');
  assert.equal(normaliseerKeuzes({ subfilter: 'adbe.x509.rsa_sha1' }).subfilter, 'ETSI.CAdES.detached');
  assert.equal(normaliseerKeuzes({ afbeelding: 1.5 }).afbeelding, -1);
  assert.equal(normaliseerKeuzes({ zichtbaar: 'ja' }).zichtbaar, true);
});

test('geldigeTijdstempelUrl: leeg of http(s)', () => {
  assert.equal(geldigeTijdstempelUrl(''), true);
  assert.equal(geldigeTijdstempelUrl('  '), true);
  assert.equal(geldigeTijdstempelUrl('https://freetsa.org/tsr'), true);
  assert.equal(geldigeTijdstempelUrl('http://tsa.example:8080/'), true);
  assert.equal(geldigeTijdstempelUrl('file:///etc/passwd'), false);
  assert.equal(geldigeTijdstempelUrl('geen url'), false);
});

test('bedrading: knop, dialoog, Tauri-commando en optienamen passen bij Rust', () => {
  const lint = bron('../../solid/components/ribbon/CommentTab.jsx');
  assert.match(lint, /id="btn-digital-sign"/);
  assert.match(lint, /startDigitaalOndertekenen/);
  assert.match(bron('../../solid/components/DialogHost.jsx'), /'digital-sign': DigitaalOndertekenenDialog/);
  const lib = bron('../../../src-tauri/src/lib.rs');
  for (const cmd of ['pdf_sign', 'pdf_certificate_info', 'pdf_signature_list', 'pdf_signed_revision']) {
    assert.match(lib, new RegExp(`handtekening::${cmd},`), cmd);
  }
  // De JS-opties (camelCase) horen bij de serde-namen van Ondertekenopties en ZichtbaarVeld.
  const rust = bron('../../../../open-pdf-signatures/src/onderteken.rs');
  assert.match(rust, /pub struct ZichtbaarVeld \{[^}]*pub pagina: u32,[^}]*pub rechthoek: \[f64; 4\],[^}]*pub weergave_base64:/s);
  assert.match(rust, /#\[serde\(rename = "ETSI\.CAdES\.detached"\)\]/);
  assert.match(rust, /#\[serde\(rename = "adbe\.pkcs7\.detached"\)\]/);
  const flow = bron('./ondertekenen.js');
  assert.match(flow, /zichtbaar = \{ pagina: keuze\.page, rechthoek, weergaveBase64 \}/);
  assert.match(flow, /invoke\('pdf_sign', args\)/);
  assert.match(bron('../../../src-tauri/src/handtekening.rs'), /pub async fn pdf_sign\([^)]*bron: String,[^)]*doel: String,[^)]*p12: String,[^)]*wachtwoord: String,[^)]*opties: Ondertekenopties,[^)]*tijdstempel_url: Option<String>,/s);
});
