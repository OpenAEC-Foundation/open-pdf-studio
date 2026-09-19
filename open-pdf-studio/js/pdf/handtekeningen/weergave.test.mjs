import assert from 'node:assert/strict';
import test from 'node:test';
import {
  statusSleutel, redenSleutel, lijstFoutRedenSleutel, tijdstempelStatusSleutel, ernst, ernstigste,
  heeftIntacteHandtekening, kanOndertekendeVersieTonen, formatTijd, heeftHandtekeningvelden,
} from './weergave.js';

const info = (code, extra = {}) => {
  const { reden, ...rest } = extra;
  return { status: reden ? { code, reden } : { code }, ...rest };
};

test('statussleutel per statuscode uit Rust', () => {
  assert.equal(statusSleutel(info('geldig')), 'signatureVerification.status.valid');
  assert.equal(statusSleutel(info('onbekend-certificaat')), 'signatureVerification.status.unknownCertificate');
  assert.equal(statusSleutel(info('gewijzigd-na-ondertekenen')), 'signatureVerification.status.modified');
  assert.equal(statusSleutel(info('ongeldige-handtekening')), 'signatureVerification.status.invalid');
  assert.equal(statusSleutel(info('niet-te-controleren')), 'signatureVerification.status.notVerifiable');
  assert.equal(statusSleutel(info('niet-ondertekend-veld')), 'signatureVerification.status.unsignedField');
  assert.equal(statusSleutel({}), 'signatureVerification.status.notVerifiable');
});

test('redensleutel: reden gaat voor uitleg', () => {
  assert.equal(redenSleutel(info('onbekend-certificaat', { reden: 'geen-keten' })), 'signatureVerification.reasons.noChain');
  assert.equal(redenSleutel(info('niet-te-controleren', { reden: 'verouderd-formaat' })), 'signatureVerification.reasons.legacyFormat');
  assert.equal(redenSleutel(info('geldig')), 'signatureVerification.explanation.valid');
  assert.equal(redenSleutel(info('gewijzigd-na-ondertekenen')), 'signatureVerification.explanation.modified');
  assert.equal(redenSleutel(info('ongeldige-handtekening')), 'signatureVerification.explanation.invalid');
  assert.equal(redenSleutel(info('niet-ondertekend-veld')), null);
  assert.equal(lijstFoutRedenSleutel({ code: 'pdf-onleesbaar', detail: 'x' }), 'signatureVerification.reasons.pdfUnreadable');
  assert.equal(lijstFoutRedenSleutel({ code: 'onleesbaar', detail: 'x' }), null);
});

test('tijdstempelstatus', () => {
  const ts = (uitkomst, vertrouwen) => ({ integriteit: { uitkomst }, vertrouwen: { uitkomst: vertrouwen } });
  assert.equal(tijdstempelStatusSleutel(ts('intact', 'vertrouwd')), 'signatureVerification.status.valid');
  assert.equal(tijdstempelStatusSleutel(ts('intact', 'niet-vertrouwd')), 'signatureVerification.status.unknownCertificate');
  assert.equal(tijdstempelStatusSleutel(ts('gewijzigd', 'niet-bepaald')), 'signatureVerification.status.modified');
  assert.equal(tijdstempelStatusSleutel(ts('ongeldig', 'niet-bepaald')), 'signatureVerification.status.invalid');
  assert.equal(tijdstempelStatusSleutel(ts('niet-te-controleren', 'niet-bepaald')), 'signatureVerification.status.notVerifiable');
});

test('ernst: geldig maar daarna gewijzigd is een waarschuwing', () => {
  assert.equal(ernst(info('geldig')), 'goed');
  assert.equal(ernst(info('geldig', { daarnaGewijzigd: true })), 'waarschuwing');
  assert.equal(ernst(info('onbekend-certificaat')), 'waarschuwing');
  assert.equal(ernst(info('niet-te-controleren')), 'waarschuwing');
  assert.equal(ernst(info('gewijzigd-na-ondertekenen')), 'fout');
  assert.equal(ernst(info('ongeldige-handtekening')), 'fout');
  assert.equal(ernst(info('niet-ondertekend-veld')), 'neutraal');
  assert.equal(ernstigste([info('geldig'), info('ongeldige-handtekening'), info('onbekend-certificaat')]), 'fout');
  assert.equal(ernstigste([]), 'neutraal');
});

test('intacte handtekening en ondertekende versie', () => {
  assert.equal(heeftIntacteHandtekening([{ integriteit: { uitkomst: 'gewijzigd' } }, { integriteit: null }]), false);
  assert.equal(heeftIntacteHandtekening([{ integriteit: { uitkomst: 'intact' } }]), true);
  assert.equal(heeftIntacteHandtekening(null), false);
  assert.equal(kanOndertekendeVersieTonen({ nummer: 0, daarnaGewijzigd: true }), true);
  assert.equal(kanOndertekendeVersieTonen({ nummer: 0, daarnaGewijzigd: false }), false);
  assert.equal(kanOndertekendeVersieTonen({ daarnaGewijzigd: true }), false);
});

test('tijd formatteren', () => {
  const tekst = formatTijd(1_537_049_437, 'en-GB', 'UTC');
  assert.match(tekst, /2018/);
  assert.match(tekst, /22:10/);
  assert.equal(formatTijd(null, 'nl'), null);
  assert.equal(formatTijd(Number.NaN, 'nl'), null);
});

test('handtekeningvelden via getFieldObjects', async () => {
  const doc = (velden) => ({ getFieldObjects: async () => velden });
  assert.equal(await heeftHandtekeningvelden(doc({ a: [{ type: 'text' }], H1: [{ type: 'signature' }] })), true);
  assert.equal(await heeftHandtekeningvelden(doc({ a: [{ type: 'text' }] })), false);
  assert.equal(await heeftHandtekeningvelden(doc(null)), false);
  assert.equal(await heeftHandtekeningvelden({ getFieldObjects: async () => { throw new Error('x'); } }), false);
  assert.equal(await heeftHandtekeningvelden(null), false);
});

test('niet ondertekend woordenboek en zwak algoritme', async () => {
  const { woordenboekNietOndertekend, heeftZwakAlgoritme } = await import('./weergave.js');
  assert.equal(woordenboekNietOndertekend({ soort: 'handtekening', woordenboekOndertekend: false }), true);
  assert.equal(woordenboekNietOndertekend({ soort: 'handtekening', woordenboekOndertekend: true }), false);
  assert.equal(woordenboekNietOndertekend({ soort: 'leeg-veld', woordenboekOndertekend: false }), false);
  assert.equal(woordenboekNietOndertekend({ soort: 'handtekening' }), false);
  assert.equal(woordenboekNietOndertekend(null), false);
  assert.equal(heeftZwakAlgoritme({ zwakAlgoritme: true }), true);
  assert.equal(heeftZwakAlgoritme({ zwakAlgoritme: false, tijdstempel: { zwakAlgoritme: true } }), true);
  assert.equal(heeftZwakAlgoritme({ zwakAlgoritme: false, tijdstempel: null }), false);
  assert.equal(heeftZwakAlgoritme(null), false);
});

test('getallen in de taal van de gebruiker', async () => {
  const { formatGetal } = await import('./weergave.js');
  assert.equal(formatGetal(1234567, 'nl'), '1.234.567');
  assert.equal(formatGetal(1234567, 'en'), '1,234,567');
  assert.equal(formatGetal(12, 'ar-u-nu-latn'), '12');
  assert.equal(formatGetal(null, 'nl'), '');
  assert.equal(formatGetal(Number.NaN, 'nl'), '');
  // Onbekende taalcode: geen fout, wel een getal.
  assert.match(formatGetal(1000, 'xx-onzin-!!'), /1.?000/);
});

test('delen samenvoegen met een verbinder uit de vertaling', async () => {
  const { voegSamen } = await import('./weergave.js');
  const verbind = (a, b) => `${a} | ${b}`;
  assert.equal(voegSamen(['a', 'b', 'c'], verbind), 'a | b | c');
  assert.equal(voegSamen(['a', '', null, 'c'], verbind), 'a | c');
  assert.equal(voegSamen(['a'], verbind), 'a');
  assert.equal(voegSamen([], verbind), '');
});

test('afgekapte lijst: melding en minstens een waarschuwing', async () => {
  const { lijstIsAfgekapt, balkErnst } = await import('./weergave.js');
  assert.equal(lijstIsAfgekapt([info('geldig', { lijstAfgekapt: false })]), false);
  assert.equal(lijstIsAfgekapt([info('geldig', { lijstAfgekapt: true }), info('geldig', { lijstAfgekapt: true })]), true);
  assert.equal(lijstIsAfgekapt([info('geldig')]), false);
  assert.equal(lijstIsAfgekapt(null), false);
  assert.equal(balkErnst('klaar', [info('geldig')]), 'goed');
  assert.equal(balkErnst('klaar', [info('geldig', { lijstAfgekapt: true })]), 'waarschuwing');
  assert.equal(balkErnst('klaar', [info('niet-ondertekend-veld', { lijstAfgekapt: true })]), 'waarschuwing');
  assert.equal(balkErnst('klaar', [info('ongeldige-handtekening', { lijstAfgekapt: true })]), 'fout');
  assert.equal(balkErnst('fout', []), 'waarschuwing');
  assert.equal(balkErnst('bezig', []), 'neutraal');
});

test('ondertekende versie: bereikEinde mee en gewijzigd-sinds-lijst herkennen', async () => {
  const { ondertekendeVersieArgumenten, isGewijzigdSindsLijst } = await import('./weergave.js');
  assert.deepEqual(ondertekendeVersieArgumenten('C:/a.pdf', { nummer: 1, bereikEinde: 5120 }),
    { pad: 'C:/a.pdf', nummer: 1, bereikEinde: 5120 });
  assert.deepEqual(ondertekendeVersieArgumenten('C:/a.pdf', { nummer: 0, bereikEinde: 0 }),
    { pad: 'C:/a.pdf', nummer: 0, bereikEinde: 0 });
  // Zonder bruikbaar bereik geen bereikEinde (Rust: Option<u64> = None).
  assert.deepEqual(ondertekendeVersieArgumenten('C:/a.pdf', { nummer: 2, bereikEinde: null }), { pad: 'C:/a.pdf', nummer: 2 });
  assert.deepEqual(ondertekendeVersieArgumenten('C:/a.pdf', { nummer: 2 }), { pad: 'C:/a.pdf', nummer: 2 });
  assert.deepEqual(ondertekendeVersieArgumenten('C:/a.pdf', { nummer: 2, bereikEinde: -1 }), { pad: 'C:/a.pdf', nummer: 2 });
  assert.deepEqual(ondertekendeVersieArgumenten('C:/a.pdf', { nummer: 2, bereikEinde: 1.5 }), { pad: 'C:/a.pdf', nummer: 2 });
  assert.equal(isGewijzigdSindsLijst({ code: 'gewijzigd-sinds-lijst' }), true);
  assert.equal(isGewijzigdSindsLijst({ code: 'onleesbaar', detail: 'x' }), false);
  assert.equal(isGewijzigdSindsLijst('gewijzigd-sinds-lijst'), false);
  assert.equal(isGewijzigdSindsLijst(null), false);
});

test('signalen: vertaling per code, onbekend valt terug op een neutrale tekst', async () => {
  const { SIGNALEN, signaalSleutel, signaalSleutels, tijdstempelSignaalSleutels } = await import('./weergave.js');
  for (const code of SIGNALEN) {
    assert.equal(signaalSleutel(code), `signatureVerification.signals.${code}`);
  }
  assert.equal(signaalSleutel('iets-nieuws'), 'signatureVerification.signals.unknown');
  assert.equal(signaalSleutel(undefined), 'signatureVerification.signals.unknown');
  assert.deepEqual(
    signaalSleutels({ signalen: ['gat-wijkt-af-van-contents', 'zoekbudget-op', 'x-1', 'x-2', 'zoekbudget-op'] }),
    [
      'signatureVerification.signals.gat-wijkt-af-van-contents',
      'signatureVerification.signals.zoekbudget-op',
      'signatureVerification.signals.unknown',
    ],
  );
  assert.deepEqual(signaalSleutels({}), []);
  assert.deepEqual(signaalSleutels({ signalen: 'zoekbudget-op' }), []);
  assert.deepEqual(tijdstempelSignaalSleutels({ tijdstempel: { signalen: ['zoekbudget-op'] } }),
    ['signatureVerification.signals.zoekbudget-op']);
  assert.deepEqual(tijdstempelSignaalSleutels({ tijdstempel: null }), []);
});

test('technisch detail: ruwe tekst en SubFilter, alleen als ze er zijn', async () => {
  const { technischDetail } = await import('./weergave.js');
  assert.deepEqual(technischDetail({ detail: 'messageDigest ontbreekt', subfilter: 'ETSI.CAdES.detached' }),
    ['messageDigest ontbreekt', 'SubFilter: ETSI.CAdES.detached']);
  assert.deepEqual(technischDetail({ detail: null, subfilter: null }), []);
  assert.deepEqual(technischDetail(null), []);
});

test('foutcodes met een eigen tekst', async () => {
  const { foutSleutel } = await import('./weergave.js');
  assert.equal(foutSleutel({ code: 'geen-handtekening' }), 'signatureVerification.errors.noSignature');
  assert.equal(foutSleutel({ code: 'onleesbaar', detail: 'os error 2' }), 'signatureVerification.errors.unreadable');
  assert.equal(foutSleutel({ code: 'gewijzigd-sinds-lijst' }), 'signatureVerification.errors.changedSinceList');
  assert.equal(foutSleutel({ code: 'pdf-onleesbaar', detail: 'x' }), 'signatureVerification.reasons.pdfUnreadable');
  assert.equal(foutSleutel({ code: 'toString' }), null);
  assert.equal(foutSleutel({ code: 'iets-anders' }), null);
  assert.equal(foutSleutel(null), null);
});

test('document gewijzigd in de app ten opzichte van schijf', async () => {
  const { wijktAfVanSchijf } = await import('./weergave.js');
  assert.equal(wijktAfVanSchijf({ modified: true }), true);
  assert.equal(wijktAfVanSchijf({ modified: false, saveTargetPath: 'a.pdf', _renderTemp: true }), false);
  assert.equal(wijktAfVanSchijf(null), false);
});

// Nep-vertaler: sleutel plus opties, zodat de opbouw zichtbaar is.
const v = (sleutel, o = {}) => {
  if (sleutel === 'format.joined') return `${o.first} — ${o.second}`;
  if (sleutel === 'format.withTime') return `${o.text}, ${o.time}`;
  if (sleutel === 'documentTimestampBy') return `DTS (${o.tsa})`;
  if (sleutel === 'documentTimestamp') return 'DTS';
  if (sleutel === 'changedAfterwards') return 'daarna gewijzigd';
  if (sleutel === 'unknownSigner') return 'onbekend';
  return sleutel;
};
const t = (sleutel) => sleutel.split('.').pop();

test('balkregel: status en "daarna gewijzigd" apart van naam en tijd (smalle balk kort de naam in)', async () => {
  const { balkRegelDelen } = await import('./weergave.js');
  const h = info('geldig', { daarnaGewijzigd: true, soort: 'handtekening', ondertekenaar: 'Jan', tijdUnix: 1_537_049_437 });
  const d = balkRegelDelen(h, { v, t, taal: 'en-GB' });
  assert.equal(d.status, 'valid — daarna gewijzigd');
  assert.match(d.rest, /^Jan, .*2018/);
  assert.equal(d.scheiding, ' — ');
  assert.equal(d.tekst, `${d.status} — ${d.rest}`);
  // Zonder naam en tijd alleen de status.
  const leeg = balkRegelDelen(info('niet-ondertekend-veld', { soort: 'leeg-veld', veldnaam: '' }), { v, t, taal: 'nl' });
  assert.deepEqual(leeg, { status: 'unsignedField', rest: '', scheiding: '', tekst: 'unsignedField' });
  // Opgegeven naam en tijd buiten het bereik worden gemarkeerd.
  const nietOndertekend = (_h, tekst) => `${tekst}*`;
  const opgegeven = balkRegelDelen(
    info('onbekend-certificaat', { soort: 'handtekening', opgegevenNaam: 'Piet', tijdUnix: 1_537_049_437, tijdBron: 'opgegeven' }),
    { v, t, taal: 'en-GB', nietOndertekend },
  );
  assert.match(opgegeven.rest, /^Piet\*, .*\*$/);
});

test('documenttijdstempel: dezelfde notatie in balk en detailvenster', async () => {
  const { balkRegelDelen, documenttijdstempelNaam } = await import('./weergave.js');
  const h = info('onbekend-certificaat', { soort: 'documenttijdstempel', ondertekenaar: 'TSA X' });
  assert.equal(documenttijdstempelNaam(h, v), 'DTS (TSA X)');
  assert.equal(balkRegelDelen(h, { v, t, taal: 'nl' }).rest, 'DTS (TSA X)');
  assert.equal(documenttijdstempelNaam({ soort: 'documenttijdstempel' }, v), 'DTS');
});

test('scheidingsteken volgt format.joined, met terugval', async () => {
  const { scheidingstekens } = await import('./weergave.js');
  assert.equal(scheidingstekens((s, o) => `${o.first} | ${o.second}`), ' | ');
  assert.equal(scheidingstekens((s, o) => `${o.second} ${o.first}`), ' — ');
});
