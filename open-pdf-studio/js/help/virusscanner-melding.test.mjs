// Eenmalige melding voor nieuwe gebruikers over een waarschuwing van een
// virusscanner (#761): wanneer hij vanzelf verschijnt en wanneer niet, met
// de opslag als nepper. Daarnaast: de bedrading in de app en de teksten.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
  OPSLAG_NAAM, NIEUW, GEZIEN, DIALOOG,
  statusNaStart, registreerStart, isAutomatisering, meldingBeleid,
  toonBijEersteStart, feedbackVoorinvulling,
} from './virusscanner-melding.js';
import { zetBeheerdVoorTest } from '../core/beheerd.js';

/** Een opslag in het geheugen, met een logboek van wat erin geschreven is. */
function nepOpslag(begin = {}) {
  const inhoud = new Map(Object.entries(begin));
  const geschreven = [];
  return {
    lees: (naam) => (inhoud.has(naam) ? inhoud.get(naam) : null),
    schrijf: (naam, waarde) => { inhoud.set(naam, String(waarde)); geschreven.push([naam, String(waarde)]); },
    geschreven,
    status: () => (inhoud.has(OPSLAG_NAAM) ? inhoud.get(OPSLAG_NAAM) : null),
  };
}

/** Eén start van de app: registreren en daarna de melding proberen. */
async function start(opslag, { voorkeurenBestonden, ...omgeving }) {
  const geopend = [];
  registreerStart({ inTauri: omgeving.inTauri ?? true, voorkeurenBestonden, lees: opslag.lees, schrijf: opslag.schrijf });
  const beleid = await toonBijEersteStart({
    inTauri: true, gehost: false, headless: false,
    ...omgeving,
    lees: opslag.lees, schrijf: opslag.schrijf,
    open: async () => { geopend.push(DIALOOG); },
  });
  return { beleid, getoond: geopend.length };
}

test.beforeEach(() => zetBeheerdVoorTest(false));
test.after(() => zetBeheerdVoorTest(null));

test('nieuwe installatie: zonder voorkeuren is de status nieuw, met voorkeuren gezien', () => {
  assert.equal(statusNaStart({ opgeslagen: null, voorkeurenBestonden: false }), NIEUW);
  assert.equal(statusNaStart({ opgeslagen: null, voorkeurenBestonden: true }), GEZIEN);
  // Niet te zeggen (laden mislukt): geen melding.
  assert.equal(statusNaStart({ opgeslagen: null, voorkeurenBestonden: null }), GEZIEN);
  assert.equal(statusNaStart({ opgeslagen: null, voorkeurenBestonden: undefined }), GEZIEN);
});

test('een bekende status blijft, wat de voorkeuren ook zeggen', () => {
  assert.equal(statusNaStart({ opgeslagen: GEZIEN, voorkeurenBestonden: false }), GEZIEN);
  assert.equal(statusNaStart({ opgeslagen: NIEUW, voorkeurenBestonden: true }), NIEUW);
  // Een onbekende waarde telt niet als status.
  assert.equal(statusNaStart({ opgeslagen: 'iets', voorkeurenBestonden: true }), GEZIEN);
});

test('registreerStart schrijft de status één keer, en in de webversie nooit', () => {
  const opslag = nepOpslag();
  assert.equal(registreerStart({ inTauri: true, voorkeurenBestonden: false, ...opslag }), NIEUW);
  assert.equal(registreerStart({ inTauri: true, voorkeurenBestonden: true, ...opslag }), NIEUW);
  assert.deepEqual(opslag.geschreven, [[OPSLAG_NAAM, NIEUW]]);

  const web = nepOpslag();
  assert.equal(registreerStart({ inTauri: false, voorkeurenBestonden: false, ...web }), null);
  assert.deepEqual(web.geschreven, []);
});

test('een volle opslag breekt de start niet', () => {
  const lees = () => null;
  const schrijf = () => { throw new Error('QuotaExceededError'); };
  assert.equal(registreerStart({ inTauri: true, voorkeurenBestonden: false, lees, schrijf }), NIEUW);
});

test('eerste start van een nieuwe installatie: de melding komt, één keer', async () => {
  const opslag = nepOpslag();
  const eerste = await start(opslag, { voorkeurenBestonden: false });
  assert.deepEqual(eerste, { beleid: { tonen: true, reden: 'eerste-start' }, getoond: 1 });
  assert.equal(opslag.status(), GEZIEN);
  // Tweede start: de voorkeuren staan er nu, en de status is gezien.
  const tweede = await start(opslag, { voorkeurenBestonden: true });
  assert.deepEqual(tweede, { beleid: { tonen: false, reden: 'geen-nieuwe-installatie' }, getoond: 0 });
});

test('bestaande gebruiker (had al voorkeuren): geen melding, ook niet na een update', async () => {
  const opslag = nepOpslag();
  for (let keer = 0; keer < 3; keer++) {
    const r = await start(opslag, { voorkeurenBestonden: true });
    assert.deepEqual(r, { beleid: { tonen: false, reden: 'geen-nieuwe-installatie' }, getoond: 0 });
  }
  assert.equal(opslag.status(), GEZIEN);
});

test('de app meteen gesloten bij de eerste start: de melding komt de keer daarna', async () => {
  const opslag = nepOpslag();
  registreerStart({ inTauri: true, voorkeurenBestonden: false, ...opslag });
  // Tweede start: de voorkeuren staan er inmiddels, de status is nog nieuw.
  const r = await start(opslag, { voorkeurenBestonden: true });
  assert.equal(r.getoond, 1);
  assert.equal(opslag.status(), GEZIEN);
});

test('beheerde modus: geen melding, en de status blijft staan', async () => {
  zetBeheerdVoorTest(true);
  const opslag = nepOpslag();
  const r = await start(opslag, { voorkeurenBestonden: false });
  assert.deepEqual(r, { beleid: { tonen: false, reden: 'beheerd' }, getoond: 0 });
  assert.equal(opslag.status(), NIEUW);
});

test('headless testinstantie: geen melding', async () => {
  const opslag = nepOpslag();
  const r = await start(opslag, { voorkeurenBestonden: false, headless: true });
  assert.deepEqual(r, { beleid: { tonen: false, reden: 'headless' }, getoond: 0 });
  assert.equal(opslag.status(), NIEUW);
});

test('headless volgt het teken dat de Rust-kant in het venster zet', async () => {
  const opslag = nepOpslag({ [OPSLAG_NAAM]: NIEUW });
  globalThis.__OPDS_HEADLESS__ = true;
  try {
    const r = await toonBijEersteStart({
      inTauri: true, gehost: false, lees: opslag.lees, schrijf: opslag.schrijf,
      open: async () => { throw new Error('mag niet openen'); },
    });
    assert.equal(r.reden, 'headless');
  } finally {
    delete globalThis.__OPDS_HEADLESS__;
  }
});

test('gestart voor automatisering (startvlag of omgeving): geen melding', async () => {
  for (const bron of ['startvlag', 'omgeving']) {
    const opslag = nepOpslag();
    const r = await start(opslag, { voorkeurenBestonden: false, mcpStatus: async () => ({ actief: true, poort: 9223, bron }) });
    assert.deepEqual(r, { beleid: { tonen: false, reden: 'automatisering' }, getoond: 0 }, bron);
  }
  assert.equal(isAutomatisering({ actief: true, bron: 'startvlag' }), true);
  assert.equal(isAutomatisering({ actief: true, bron: 'omgeving' }), true);
});

test('de AI-koppeling via de instelling is een gewone gebruiker: de melding komt', async () => {
  assert.equal(isAutomatisering({ actief: true, bron: 'instelling' }), false);
  assert.equal(isAutomatisering({ actief: false, bron: null }), false);
  assert.equal(isAutomatisering(null), false);
  const opslag = nepOpslag();
  const r = await start(opslag, { voorkeurenBestonden: false, mcpStatus: async () => ({ actief: true, poort: 9223, bron: 'instelling' }) });
  assert.equal(r.getoond, 1);
});

test('webversie en gastbouw: geen melding en niets in de opslag', async () => {
  const web = nepOpslag();
  const r = await start(web, { voorkeurenBestonden: false, inTauri: false });
  assert.deepEqual(r, { beleid: { tonen: false, reden: 'webversie' }, getoond: 0 });
  assert.deepEqual(web.geschreven, []);

  const gast = nepOpslag({ [OPSLAG_NAAM]: NIEUW });
  const g = await start(gast, { voorkeurenBestonden: false, gehost: true });
  assert.deepEqual(g.beleid, { tonen: false, reden: 'webversie' });
  assert.equal(g.getoond, 0);
});

test('mobiel en een tweede instantie (losgemaakt tabblad): geen melding', async () => {
  const mobiel = await start(nepOpslag(), { voorkeurenBestonden: false, mobiel: true });
  assert.deepEqual(mobiel, { beleid: { tonen: false, reden: 'mobiel' }, getoond: 0 });
  const tweede = await start(nepOpslag(), { voorkeurenBestonden: false, tweedeInstantie: true });
  assert.deepEqual(tweede, { beleid: { tonen: false, reden: 'tweede-instantie' }, getoond: 0 });
});

test('de beslisregel: alleen de eerste start op het bureaublad', () => {
  const goed = { status: NIEUW, inTauri: true };
  assert.deepEqual(meldingBeleid(goed), { tonen: true, reden: 'eerste-start' });
  const nee = [
    [{ inTauri: false }, 'webversie'],
    [{ gehost: true }, 'webversie'],
    [{ mobiel: true }, 'mobiel'],
    [{ headless: true }, 'headless'],
    [{ automatisering: true }, 'automatisering'],
    [{ beheerdToegestaan: false }, 'beheerd'],
    [{ tweedeInstantie: true }, 'tweede-instantie'],
    [{ status: GEZIEN }, 'geen-nieuwe-installatie'],
    [{ status: null }, 'geen-nieuwe-installatie'],
  ];
  for (const [anders, reden] of nee) {
    assert.deepEqual(meldingBeleid({ ...goed, ...anders }), { tonen: false, reden }, reden);
  }
});

test('de status is weggeschreven vóór het venster opent', async () => {
  const opslag = nepOpslag({ [OPSLAG_NAAM]: NIEUW });
  let statusBijOpenen = null;
  await toonBijEersteStart({
    inTauri: true, gehost: false, headless: false, lees: opslag.lees, schrijf: opslag.schrijf,
    open: async () => { statusBijOpenen = opslag.status(); },
  });
  assert.equal(statusBijOpenen, GEZIEN);
});

test('het feedbackvenster krijgt het onderwerp en de drie gevraagde gegevens', () => {
  const t = (sleutel) => `<${sleutel}>`;
  const v = feedbackVoorinvulling(t);
  assert.equal(v.category, 'general');
  assert.equal(v.hint, '<virusNotice.feedbackHint>');
  const regels = v.message.split('\n');
  assert.equal(regels[0], '<virusNotice.feedbackSubject>');
  assert.deepEqual(regels.slice(2, 5), [
    '<virusNotice.feedbackScanner>: ',
    '<virusNotice.feedbackDetection>: ',
    '<virusNotice.feedbackFile>: ',
  ]);
});

// ── Bedrading en teksten ──────────────────────────────────────────────────

// Windows checkt de bronnen uit met CRLF.
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = new URL('../i18n/locales/', import.meta.url);
const json = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8'));
const talen = readdirSync(LOCALES);
const SLEUTELS = [
  'title', 'menu', 'intro', 'signed', 'action', 'include', 'report',
  'feedbackSubject', 'feedbackScanner', 'feedbackDetection', 'feedbackFile', 'feedbackHint',
];

test('de app registreert de start na het laden van de voorkeuren en toont de melding daarna', () => {
  const main = bron('../main.js');
  const laden = main.indexOf('  await loadPreferences();\n  // In de werkplek');
  const registreren = main.indexOf('  registreerStart({ inTauri: isTauri(), voorkeurenBestonden: voorkeurenBestondenBijStart() });');
  const tonen = main.indexOf('toonBijEersteStart({');
  assert.ok(laden >= 0 && registreren > laden, 'registreerStart komt na loadPreferences');
  assert.ok(registreren - laden < 900, 'en meteen, niet pas na de start');
  assert.ok(tonen > registreren, 'de melding komt daarna');
  assert.match(main, /toonBijEersteStart\(\{\s*inTauri: true,\s*mobiel: mobile,\s*tweedeInstantie: !!rol\.tweede,\s*mcpStatus: mcp\.mcpStatus,/);
  // De voorkeuren onthouden alleen wat de eerste keer laden vond.
  assert.match(bron('../core/preferences.js'), /if \(_bestondenBijStart === null\) _bestondenBijStart = !!loaded;/);
});

test('de status gaat via de opslagmodule, niet rechtstreeks naar localStorage', () => {
  const code = bron('./virusscanner-melding.js');
  assert.match(code, /from '\.\.\/core\/opslag\.js'/);
  assert.doesNotMatch(code, /localStorage|sessionStorage/);
});

test('het venster staat in de DialogHost, opent het feedbackvenster en sluit met OK', () => {
  assert.ok(bron('../solid/components/DialogHost.jsx').includes(`'${DIALOOG}': VirusScannerDialog,`));
  const venster = bron('../solid/components/dialogs/VirusScannerDialog.jsx');
  assert.match(venster, /openDialog\('feedback', feedbackVoorinvulling\(t\)\)/);
  assert.match(venster, /onClick=\{close\}>\{tCommon\('ok'\)\}/);
  for (const k of ['title', 'intro', 'signed', 'action', 'include', 'report']) {
    assert.ok(venster.includes(`t('virusNotice.${k}')`), k);
  }
  const feedback = bron('../solid/components/dialogs/FeedbackDialog.jsx');
  assert.match(feedback, /vooraf\.category/);
  assert.match(feedback, /vooraf\.message/);
  assert.match(feedback, /vooraf\.hint/);
});

test('later te openen via Help en het app-menu, alleen in de app', () => {
  const help = bron('../solid/components/ribbon/HelpTab.jsx');
  assert.match(help, /\{isTauri\(\) && \(\s*<RibbonButton\s+id="ribbon-virus-warning"/);
  assert.match(help, /onClick=\{\(\) => openVirusscannerMelding\(\)\}/);
  const menu = bron('../solid/components/app-menu/AppMenu.jsx');
  assert.match(menu, /<Show when=\{isTauri\(\)\}><MenuItem id="menu-virus-warning"[^\n]*actionAndClose\(openVirusscannerMelding\)/);
});

test('alle 40 talen hebben de teksten, niet leeg', () => {
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const d = json(taal, 'dialogs').virusNotice;
    assert.ok(d, `${taal}: virusNotice ontbreekt`);
    assert.deepEqual(Object.keys(d).sort(), [...SLEUTELS].sort(), taal);
    for (const k of SLEUTELS) assert.ok(typeof d[k] === 'string' && d[k].trim(), `${taal} ${k} is leeg`);
    const h = json(taal, 'ribbon').help;
    for (const k of ['virusWarning', 'virusWarningTitle']) assert.ok(typeof h[k] === 'string' && h[k].trim(), `${taal} help.${k}`);
  }
});

test('Nederlands is echt vertaald', () => {
  const en = json('en', 'dialogs').virusNotice;
  const nl = json('nl', 'dialogs').virusNotice;
  for (const k of SLEUTELS) assert.notEqual(nl[k], en[k], k);
  assert.match(nl.action, /Laat je virusscanner gewoon aan staan/);
  assert.match(en.action, /Leave your virus scanner switched on/);
  assert.match(nl.signed, /digitaal ondertekend/);
  assert.match(en.signed, /digitally signed/);
});

test('de teksten vragen om scanner, detectie en bestandsnaam', () => {
  const en = json('en', 'dialogs').virusNotice;
  for (const k of ['include', 'feedbackHint']) {
    assert.match(en[k], /name of the virus scanner/, k);
    assert.match(en[k], /name of the detection/, k);
    assert.match(en[k], /file name/, k);
  }
});
