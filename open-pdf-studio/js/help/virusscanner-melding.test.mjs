// Uitleg over een waarschuwing van een virusscanner (#761): één keer in de
// release-notes, met de opslag als nepper. Daarnaast: de bedrading in de app
// en de teksten.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
  OPSLAG_NAAM, GEZIEN, DIALOOG,
  hoortInReleasenotes, neemInReleasenotes, feedbackVoorinvulling,
} from './virusscanner-melding.js';

/** Een opslag in het geheugen, met een logboek van wat erin geschreven is. */
function nepOpslag(begin = {}) {
  const inhoud = new Map(Object.entries(begin));
  const geschreven = [];
  return {
    lees: (naam) => (inhoud.has(naam) ? inhoud.get(naam) : null),
    schrijf: (naam, waarde) => { inhoud.set(naam, String(waarde)); geschreven.push([naam, String(waarde)]); },
    geschreven,
  };
}

test('de eerste keer dat de release-notes openen staat de uitleg erbij, daarna niet meer', () => {
  const o = nepOpslag();
  assert.equal(neemInReleasenotes({ inTauri: true, gehost: false, lees: o.lees, schrijf: o.schrijf }), true);
  assert.deepEqual(o.geschreven, [[OPSLAG_NAAM, GEZIEN]]);
  assert.equal(neemInReleasenotes({ inTauri: true, gehost: false, lees: o.lees, schrijf: o.schrijf }), false);
  assert.equal(o.geschreven.length, 1);
});

test('webversie en gastbouw: geen uitleg en niets in de opslag', () => {
  const o = nepOpslag();
  assert.equal(neemInReleasenotes({ inTauri: false, gehost: false, lees: o.lees, schrijf: o.schrijf }), false);
  assert.equal(neemInReleasenotes({ inTauri: true, gehost: true, lees: o.lees, schrijf: o.schrijf }), false);
  assert.equal(o.geschreven.length, 0);
});

test('de beslisregel: alleen in de app en alleen als hij er nog niet gestaan heeft', () => {
  assert.equal(hoortInReleasenotes({ inTauri: true, opgeslagen: null }), true);
  assert.equal(hoortInReleasenotes({ inTauri: true, opgeslagen: 'nieuw' }), true);
  assert.equal(hoortInReleasenotes({ inTauri: true, opgeslagen: GEZIEN }), false);
  assert.equal(hoortInReleasenotes({ inTauri: false, opgeslagen: null }), false);
  assert.equal(hoortInReleasenotes({ inTauri: true, gehost: true, opgeslagen: null }), false);
});

test('een volle opslag breekt het venster niet: de uitleg komt dan nog een keer', () => {
  const o = nepOpslag();
  const vol = () => { throw new Error('vol'); };
  assert.equal(neemInReleasenotes({ inTauri: true, gehost: false, lees: o.lees, schrijf: vol }), true);
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

test('de app toont bij de start geen eigen venster meer; de uitleg staat in de release-notes', () => {
  const main = bron('../main.js');
  assert.doesNotMatch(main, /virusscanner-melding|toonBijEersteStart|registreerStart/);
  const wn = bron('../solid/components/dialogs/WhatsNewDialog.jsx');
  assert.match(wn, /const virusUitleg = neemInReleasenotes\(\{ inTauri: isTauri\(\) \}\);/);
  assert.match(wn, /<Show when=\{virusUitleg\}>\s*<section class="wn-virus-notice"/);
  for (const k of ['title', 'intro', 'signed', 'action', 'include', 'report']) {
    assert.ok(wn.includes(`tDialogs('virusNotice.${k}')`), k);
  }
  assert.match(wn, /openDialog\('feedback', feedbackVoorinvulling\(tDialogs\)\)/);
  // Het blok staat boven de releases.
  assert.ok(wn.indexOf('wn-virus-notice') < wn.indexOf('<For each={parsed()}>'));
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
