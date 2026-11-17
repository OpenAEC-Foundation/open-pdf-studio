// Alle / andere tabbladen sluiten (#1156): volgorde, stoppen en aan/uit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { kanAllesSluiten, kanAndereSluiten, sluitPlan, voerSluitPlanUit } from './tabs-sluiten-model.js';
import { CORE_COMMANDS } from '../../core/keybindings/default-commands.js';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

// Een nagebootst closeTab: zelfde uitkomsten als het echte sluiten van één
// tabblad. `antwoord` is de keuze in de vraag bij een gewijzigd document.
function maakApp(docs, actief = 0) {
  const app = { documenten: [...docs], actief: docs[actief] ?? null, log: [], vragen: [] };
  app.sluitDocument = async (doc) => {
    app.log.push(`sluit ${doc.naam}`);
    if (doc.modified) {
      app.vragen.push(doc.naam);
      if (doc.antwoord === 'cancel') return false;
      if (doc.antwoord === 'save' && doc.opslaanLukt === false) return false;
    }
    app.documenten = app.documenten.filter((d) => d !== doc);
    if (app.actief === doc) app.actief = app.documenten[0] ?? null;
    return true;
  };
  return app;
}
const doc = (naam, extra = {}) => ({ naam, ...extra });
const namen = (lijst) => lijst.map((d) => d.naam);
const stappen = (plan) => plan.map((s) => (s.soort === 'document' ? s.doc.naam : s.soort === 'weergave' ? `${s.doc.naam}:${s.weergave}` : 'vergelijking'));

test('aan/uit: alles sluiten zonder tabbladen uit, andere sluiten met één tabblad uit', () => {
  assert.equal(kanAllesSluiten({ aantalTabItems: 0 }), false);
  assert.equal(kanAllesSluiten({ aantalTabItems: 1 }), true);
  assert.equal(kanAllesSluiten({ aantalTabItems: 0, vergelijkActief: true }), true);
  assert.equal(kanAllesSluiten(), false);
  assert.equal(kanAndereSluiten({ aantalTabItems: 0 }), false);
  assert.equal(kanAndereSluiten({ aantalTabItems: 1 }), false);
  assert.equal(kanAndereSluiten({ aantalTabItems: 2 }), true);
  // Het vergelijkingstabblad en een tweede tabblad van hetzelfde document tellen mee.
  assert.equal(kanAndereSluiten({ aantalTabItems: 1, vergelijkActief: true }), true);
});

test('alles sluiten: tabvolgorde, het actieve document als laatste, dan de vergelijking', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => doc(n));
  assert.deepEqual(stappen(sluitPlan({ documenten: [a, b, c, d], actieveIndex: 1 })), ['a', 'c', 'd', 'b']);
  assert.deepEqual(stappen(sluitPlan({ documenten: [a, b], actieveIndex: -1 })), ['a', 'b']);
  assert.deepEqual(stappen(sluitPlan({ documenten: [a, b], actieveIndex: 0, vergelijkActief: true })), ['b', 'a', 'vergelijking']);
  assert.deepEqual(sluitPlan({ documenten: [], actieveIndex: -1 }), []);
});

test('alles sluiten sluit elk document, ook met meer tabbladen, langs het ene sluitpad', async () => {
  const docs = [doc('a'), doc('b', { weergaven: ['w1', 'w2'] }), doc('c')];
  const app = maakApp(docs, 2);
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 2 }), app);
  assert.deepEqual(app.log, ['sluit a', 'sluit b', 'sluit c']);
  assert.deepEqual(uit, { gesloten: 3, gestopt: false, bij: null });
  assert.deepEqual(app.documenten, []);
});

test('elk gewijzigd document krijgt zijn eigen vraag; opslaan en niet opslaan gaan door', async () => {
  const docs = [
    doc('a', { modified: true, antwoord: 'save', opslaanLukt: true }),
    doc('b'),
    doc('c', { modified: true, antwoord: 'dontsave' }),
  ];
  const app = maakApp(docs, 0);
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 0 }), app);
  assert.deepEqual(app.vragen, ['c', 'a']);
  assert.equal(uit.gesloten, 3);
  assert.equal(uit.gestopt, false);
});

test('annuleren stopt: dat document en de volgende blijven open, de eerdere blijven dicht', async () => {
  const docs = [doc('a'), doc('b', { modified: true, antwoord: 'cancel' }), doc('c', { modified: true, antwoord: 'dontsave' }), doc('d')];
  const app = maakApp(docs, 3);
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 3 }), app);
  assert.deepEqual(app.log, ['sluit a', 'sluit b']);
  assert.deepEqual(app.vragen, ['b'], 'na annuleren komt er geen vraag meer');
  assert.deepEqual(namen(app.documenten), ['b', 'c', 'd']);
  assert.equal(uit.gesloten, 1);
  assert.equal(uit.gestopt, true);
  assert.equal(uit.bij.doc, docs[1]);
});

test('mislukt of afgebroken opslaan stopt de rest; het document blijft open', async () => {
  const docs = [doc('a', { modified: true, antwoord: 'save', opslaanLukt: false }), doc('b'), doc('c')];
  const app = maakApp(docs, 2);
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 2 }), app);
  assert.deepEqual(app.log, ['sluit a']);
  assert.deepEqual(namen(app.documenten), ['a', 'b', 'c']);
  assert.deepEqual({ gesloten: uit.gesloten, gestopt: uit.gestopt }, { gesloten: 0, gestopt: true });
});

test('een fout bij het sluiten stopt de rest ook', async () => {
  const docs = [doc('a'), doc('b'), doc('c')];
  const log = [];
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 2 }), {
    sluitDocument: async (d) => { log.push(d.naam); if (d.naam === 'b') throw new Error('stuk'); return true; },
  });
  assert.deepEqual(log, ['a', 'b']);
  assert.equal(uit.gestopt, true);
  assert.equal(uit.gesloten, 1);
});

test('alleen een echte true telt als gesloten', async () => {
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: [doc('a'), doc('b')], actieveIndex: 0 }), { sluitDocument: () => undefined });
  assert.deepEqual({ gesloten: uit.gesloten, gestopt: uit.gestopt }, { gesloten: 0, gestopt: true });
});

test('andere sluiten: het aangeklikte tabblad blijft en ligt daarna voor', async () => {
  const docs = [doc('a'), doc('b'), doc('c'), doc('d')];
  const app = maakApp(docs, 0);
  const plan = sluitPlan({ documenten: docs, actieveIndex: 0, behoud: { doc: docs[2], weergave: null } });
  assert.deepEqual(stappen(plan), ['a', 'b', 'd']);
  const uit = await voerSluitPlanUit(plan, {
    ...app,
    maakActief: () => { app.log.push('actief c'); app.actief = docs[2]; return true; },
    naAfloop: () => { app.log.push('klaar'); },
  });
  assert.deepEqual(app.log, ['actief c', 'sluit a', 'sluit b', 'sluit d', 'klaar'], 'eerst naar voren, dan sluiten');
  assert.deepEqual(namen(app.documenten), ['c']);
  assert.equal(app.actief, docs[2]);
  assert.equal(uit.gesloten, 3);
});

test('andere sluiten: annuleren laat de rest open, het aangeklikte tabblad blijft actief', async () => {
  const docs = [doc('a'), doc('b', { modified: true, antwoord: 'cancel' }), doc('c'), doc('d')];
  const app = maakApp(docs, 3);
  let naAfloop = null;
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 3, behoud: { doc: docs[2], weergave: null } }), {
    ...app,
    maakActief: () => { app.actief = docs[2]; return true; },
    naAfloop: (u) => { naAfloop = u; },
  });
  assert.deepEqual(namen(app.documenten), ['b', 'c', 'd']);
  assert.equal(app.actief, docs[2]);
  assert.equal(uit.gestopt, true);
  assert.equal(naAfloop, uit, 'ook na een stop komt het tabblad dat blijft weer voor');
});

test('andere sluiten: lukt naar voren halen niet, dan gaat er niets dicht', async () => {
  const docs = [doc('a'), doc('b')];
  const app = maakApp(docs, 0);
  const uit = await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 0, behoud: { doc: docs[1], weergave: null } }), { ...app, maakActief: () => false });
  assert.deepEqual(app.log, []);
  assert.deepEqual(uit, { gesloten: 0, gestopt: true, bij: null });
});

test('andere sluiten bij een document met meer tabbladen: de andere weergaven eerst, dan de documenten, dan de vergelijking', async () => {
  const b = doc('b', { weergaven: ['w1', 'w2', 'w3'] });
  const docs = [doc('a'), b, doc('c')];
  const weergavenVan = (d) => d.weergaven || [];
  const plan = sluitPlan({ documenten: docs, actieveIndex: 0, weergavenVan, behoud: { doc: b, weergave: 'w2' }, vergelijkActief: true });
  assert.deepEqual(stappen(plan), ['b:w1', 'b:w3', 'a', 'c', 'vergelijking']);
  const log = [];
  const uit = await voerSluitPlanUit(plan, {
    sluitDocument: (d) => { log.push(d.naam); return true; },
    sluitWeergave: (d, w) => { log.push(`${d.naam}:${w}`); return true; },
    sluitVergelijking: () => { log.push('vergelijking'); },
  });
  assert.deepEqual(log, ['b:w1', 'b:w3', 'a', 'c', 'vergelijking']);
  assert.equal(uit.gesloten, 5);
  // Een document dat intussen dicht is: niets te doen.
  assert.deepEqual(sluitPlan({ documenten: docs, actieveIndex: 0, behoud: { doc: doc('weg'), weergave: null } }), []);
});

test('de vergelijking gaat pas dicht als alle documenten dicht zijn', async () => {
  const docs = [doc('a', { modified: true, antwoord: 'cancel' }), doc('b')];
  const app = maakApp(docs, 1);
  let vergelijkingDicht = false;
  await voerSluitPlanUit(sluitPlan({ documenten: docs, actieveIndex: 1, vergelijkActief: true }), { ...app, sluitVergelijking: () => { vergelijkingDicht = true; } });
  assert.equal(vergelijkingDicht, false);
});

test('bedrading: het sluiten loopt door het bestaande pad voor één tabblad', () => {
  const bron = lees('./tabs-sluiten.js');
  assert.match(bron, /const \{ closeTab \} = await import\('\.\/tabs\.js'\);\s*return closeTab\(index\);/);
  assert.match(bron, /sluitTabItem\(index, weergave\)/);
  assert.match(bron, /voerSluitPlanUit\(plan,/);
  // Geen eigen sluiten: het venster niet, de documentenlijst niet, geen eigen vraag.
  for (const verboden of ['state.documents.splice', 'closeWindow', 'close_window_by_label', 'dialog.message', 'confirm(', 'savePDF']) {
    assert.ok(!bron.includes(verboden), `tabs-sluiten.js mag ${verboden} niet zelf doen`);
  }
});

test('bedrading: tabmenu, Bestand-menu en sneltoetsenlijst', () => {
  const tabs = lees('../../solid/components/DocumentTabs.jsx');
  assert.match(tabs, /tCommon\('tabs\.closeOtherTabs'\)/);
  assert.match(tabs, /tCommon\('tabs\.closeAllTabs'\)/);
  assert.match(tabs, /if \(!andereSluitenAan\(\)\) return;/);
  assert.match(tabs, /if \(!allesSluitenAan\(\)\) return;/);
  const menu = lees('../../solid/components/app-menu/AppMenu.jsx');
  assert.match(menu, /id="menu-close-all"[^\n]*label=\{t\('closeAll'\)\}[^\n]*sneltoetsVoor\('file\.closeAll'\)[^\n]*disabled=\{!kanAllesSluiten\(/);
  const opdracht = CORE_COMMANDS.find((c) => c.id === 'file.closeAll');
  assert.ok(opdracht, 'file.closeAll staat in het register');
  assert.equal(opdracht.category, 'file');
  assert.equal(opdracht.defaults, undefined, 'geen standaardtoets');
  assert.equal(opdracht.labelKey, 'common:tabs.closeAllTabs');
  assert.match(lees('../../tools/keyboard-handlers.js'), /id === 'file\.closeAll'[\s\S]{0,200}sluitAlleTabs\(\)/);
});

test('vertalingen: de drie teksten staan in elke taal', () => {
  const map = new URL('../../i18n/locales/', import.meta.url);
  const talen = readdirSync(map);
  assert.ok(talen.length >= 2);
  for (const taal of talen) {
    const common = JSON.parse(lees(`../../i18n/locales/${taal}/common.json`));
    const appMenu = JSON.parse(lees(`../../i18n/locales/${taal}/appMenu.json`));
    for (const tekst of [common.tabs?.closeOtherTabs, common.tabs?.closeAllTabs, appMenu.closeAll]) {
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal}: tekst ontbreekt`);
    }
  }
  const nl = JSON.parse(lees('../../i18n/locales/nl/common.json')).tabs;
  assert.equal(nl.closeOtherTabs, 'Andere tabs sluiten');
  assert.equal(nl.closeAllTabs, 'Alle tabs sluiten');
  const en = JSON.parse(lees('../../i18n/locales/en/common.json')).tabs;
  assert.equal(en.closeOtherTabs, 'Close other tabs');
  assert.equal(en.closeAllTabs, 'Close all tabs');
});
