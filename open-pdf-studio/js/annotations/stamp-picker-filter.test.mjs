// Ingebouwde stempels verbergen (#998): de regel (voorkeur uit/aan x met/zonder
// eigen stempels), met de echte sjabloonbibliotheek, en de bedrading van elke
// plek waar stempels gekozen worden. De kiezer zelf is JSX en draait hier
// niet; daarom voor de bedrading een broncontrole.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { stempelKiezerInhoud, heeftEigenStempels, isEigenSjabloon } from './stamp-picker-filter.js';
import { BUILT_IN_STAMPS } from './stamp-defaults.js';
import { createStampTemplateStore, joinPath, SHARED_FILE_NAME } from './stamp-template-store.js';
import { BUILTIN_DYNAMIC_TEMPLATES } from './dynamic-stamp.js';

const APP = new URL('../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, APP), 'utf8');

function geheugenBackend({ folder = '' } = {}) {
  const files = new Map();
  const b = {
    personal: null,
    async loadPersonal() { return b.personal; },
    async savePersonal(text) { b.personal = text; },
    async readShared(f) { return files.get(joinPath(f, SHARED_FILE_NAME)) ?? null; },
    async writeShared(f, text) { files.set(joinPath(f, SHARED_FILE_NAME), text); },
    getSharedFolder() { return folder; },
    setSharedFolder(p) { folder = p; },
    user() { return 'anna'; },
  };
  return b;
}

const sjabloon = (name) => ({ name, lines: [{ text: `${name} {date}` }] });

async function bibliotheek({ persoonlijk = [], gedeeld = [] } = {}) {
  const store = createStampTemplateStore(geheugenBackend({ folder: gedeeld.length ? '/share' : '' }));
  await store.load();
  for (const t of persoonlijk) await store.savePersonal(sjabloon(t));
  for (const t of gedeeld) await store.saveShared(sjabloon(t));
  return store.list();
}

// --- de regel -------------------------------------------------------------

test('voorkeur uit: alles, zonder hint, met en zonder eigen stempels', async () => {
  for (const templates of [await bibliotheek(), await bibliotheek({ persoonlijk: ['Mijn'] })]) {
    const r = stempelKiezerInhoud({ hideBuiltIn: false, builtInStamps: BUILT_IN_STAMPS, templates });
    assert.deepEqual(r.builtInStamps, BUILT_IN_STAMPS);
    assert.deepEqual(r.templates, templates);
    assert.equal(r.verborgen, false);
    assert.equal(r.hintGeenEigen, false);
  }
  // Ontbrekende of niet-booleaanse voorkeur telt als uit.
  const templates = await bibliotheek({ persoonlijk: ['Mijn'] });
  for (const hideBuiltIn of [undefined, 'true', 1, null]) {
    const r = stempelKiezerInhoud({ hideBuiltIn, builtInStamps: BUILT_IN_STAMPS, templates });
    assert.equal(r.builtInStamps.length, BUILT_IN_STAMPS.length, String(hideBuiltIn));
  }
});

test('voorkeur aan + eigen stempels: alleen eigen stempels', async () => {
  const templates = await bibliotheek({ persoonlijk: ['Mijn', 'Gekeurd'] });
  const r = stempelKiezerInhoud({ hideBuiltIn: true, builtInStamps: BUILT_IN_STAMPS, templates });
  assert.deepEqual(r.builtInStamps, []);
  assert.deepEqual(r.templates.map((t) => t.name), ['Mijn', 'Gekeurd']);
  assert.ok(r.templates.every((t) => t.scope === 'personal'));
  assert.equal(r.verborgen, true);
  assert.equal(r.hintGeenEigen, false);
});

test('voorkeur aan, geen eigen stempels: toch alles, met hint', async () => {
  const templates = await bibliotheek();
  assert.ok(templates.length >= BUILTIN_DYNAMIC_TEMPLATES.length);
  const r = stempelKiezerInhoud({ hideBuiltIn: true, builtInStamps: BUILT_IN_STAMPS, templates });
  assert.deepEqual(r.builtInStamps, BUILT_IN_STAMPS);
  assert.deepEqual(r.templates, templates);
  assert.equal(r.verborgen, false);
  assert.equal(r.hintGeenEigen, true);
});

test('gedeelde en geïmporteerde sjablonen tellen als eigen stempels', async () => {
  const gedeeld = await bibliotheek({ gedeeld: ['Kantoor'] });
  const r = stempelKiezerInhoud({ hideBuiltIn: true, builtInStamps: BUILT_IN_STAMPS, templates: gedeeld });
  assert.deepEqual(r.templates.map((t) => [t.name, t.scope]), [['Kantoor', 'shared']]);
  assert.equal(r.verborgen, true);

  const store = createStampTemplateStore(geheugenBackend());
  await store.load();
  const set = store.exportSet([BUILTIN_DYNAMIC_TEMPLATES[0].id]);
  await store.importSet(set);
  const r2 = stempelKiezerInhoud({ hideBuiltIn: true, builtInStamps: BUILT_IN_STAMPS, templates: store.list() });
  assert.equal(r2.templates.length, 1);
  assert.equal(r2.templates[0].scope, 'personal');
});

test('aan, bibliotheek nog niet geladen: niets tonen (geen flits), geen hint', () => {
  const r = stempelKiezerInhoud({ hideBuiltIn: true, builtInStamps: BUILT_IN_STAMPS, templates: [], geladen: false });
  assert.deepEqual(r.builtInStamps, []);
  assert.deepEqual(r.templates, []);
  assert.equal(r.wacht, true);
  assert.equal(r.hintGeenEigen, false);
  // Uit: laden doet er niet toe.
  const uit = stempelKiezerInhoud({ hideBuiltIn: false, builtInStamps: BUILT_IN_STAMPS, templates: [], geladen: false });
  assert.equal(uit.builtInStamps.length, BUILT_IN_STAMPS.length);
  assert.equal(uit.wacht, false);
});

test('hulpfuncties en geen mutatie van de invoer', () => {
  assert.equal(isEigenSjabloon({ scope: 'builtin' }), false);
  assert.equal(isEigenSjabloon({ scope: 'personal' }), true);
  assert.equal(isEigenSjabloon(null), false);
  assert.equal(heeftEigenStempels(undefined), false);
  assert.equal(heeftEigenStempels([{ scope: 'builtin' }]), false);
  const ingebouwd = [...BUILT_IN_STAMPS];
  const templates = [{ scope: 'builtin', name: 'a' }, { scope: 'personal', name: 'b' }];
  stempelKiezerInhoud({ hideBuiltIn: true, builtInStamps: ingebouwd, templates });
  assert.equal(ingebouwd.length, BUILT_IN_STAMPS.length);
  assert.equal(templates.length, 2);
});

// --- bedrading ------------------------------------------------------------

test('de stempelkiezer toont wat de regel teruggeeft, met de voorkeur uit de state', () => {
  const kiezer = lees('js/solid/components/dialogs/StampPickerDialog.jsx');
  assert.match(kiezer, /import \{ stempelKiezerInhoud \} from '..\/..\/..\/annotations\/stamp-picker-filter.js'/);
  assert.match(kiezer, /hideBuiltIn: state\.preferences\?\.hideBuiltInStamps === true/);
  assert.match(kiezer, /builtInStamps: BUILT_IN_STAMPS/);
  assert.match(kiezer, /templates: templates\(\)/);
  assert.match(kiezer, /geladen: loaded\(\)/);
  // Beide lijsten komen uit de regel, nergens rechtstreeks.
  assert.match(kiezer, /<For each=\{content\(\)\.builtInStamps\}>/);
  assert.match(kiezer, /<For each=\{content\(\)\.templates\}>/);
  assert.doesNotMatch(kiezer, /<For each=\{BUILT_IN_STAMPS\}>/);
  assert.doesNotMatch(kiezer, /<For each=\{templates\(\)\}>/);
  assert.match(kiezer, /content\(\)\.hintGeenEigen[\s\S]*stampPicker\.hideBuiltInNoOwn/);
  assert.match(kiezer, /content\(\)\.verborgen[\s\S]*stampPicker\.builtInHidden/);
});

test('lintknop en gereedschapspalet komen bij dezelfde kiezer uit', () => {
  // Lintknop en palet zetten het stempelgereedschap; dat opent de kiezer.
  assert.match(lees('js/solid/components/ribbon/CommentTab.jsx'), /id="tool-stamp"[\s\S]*?onClick=\{\(\) => setTool\('stamp'\)\}/);
  assert.match(lees('js/solid/components/ToolPalette.jsx'), /\{ tool: 'stamp', key: 'comment\.stamp'/);
  const gereedschap = lees('js/tools/tools/text-tool.js');
  assert.match(gereedschap, /export const stampTool = \{[\s\S]*?ctx\.showStampPicker\(ctx\.x, ctx\.y\)/);
  assert.match(lees('js/annotations/stamps.js'), /export function showStampPicker\(x, y\) \{\s*openDialog\('stamp-picker'/);
  assert.match(lees('js/solid/components/DialogHost.jsx'), /'stamp-picker': StampPickerDialog/);
  // Geen tweede plek die de ingebouwde stempels of sjablonen zelf opsomt.
  const bronnen = [];
  const loop = (dir) => {
    for (const e of readdirSync(new URL(dir, APP), { withFileTypes: true })) {
      const pad = `${dir}${e.name}`;
      if (e.isDirectory()) loop(`${pad}/`);
      else if (/\.(js|jsx|ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) bronnen.push(pad);
    }
  };
  loop('js/');
  const opsommers = bronnen.filter((p) => /BUILT_IN_STAMPS\.map|each=\{BUILT_IN_STAMPS\}|stampTemplates\(\)/.test(lees(p)));
  assert.deepEqual(opsommers.sort(), [
    'js/annotations/stamp-template-backend.js',
    'js/solid/components/dialogs/StampPickerDialog.jsx',
    'js/solid/components/dialogs/StampTemplatesDialog.jsx',
  ]);
});

test('voorkeur: standaard uit, in het type en als vinkje in Voorkeuren', () => {
  assert.match(lees('js/core/constants.ts'), /\n\s*hideBuiltInStamps: false,/);
  assert.match(lees('js/types/preferences.ts'), /\n\s*hideBuiltInStamps: boolean;/);
  const tab = lees('js/solid/components/preferences/AnnotationsTab.jsx');
  assert.match(tab, /checked=\{p\.hideBuiltInStamps\[0\]\(\)\} onChange=\{e => p\.hideBuiltInStamps\[1\]\(e\.target\.checked\)\}/);
  assert.match(tab, /t\('annotations\.hideBuiltInStamps'\)/);
  assert.match(tab, /t\('annotations\.hideBuiltInStampsHint'\)/);
});

test('teksten in alle talen, nl en en echt vertaald', () => {
  const LOCALES = new URL('js/i18n/locales/', APP);
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const tekst = (taal) => {
    const p = JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, LOCALES), 'utf8'));
    const d = JSON.parse(readFileSync(new URL(`${taal}/dialogs.json`, LOCALES), 'utf8'));
    return [
      p.annotations?.stamps, p.annotations?.hideBuiltInStamps, p.annotations?.hideBuiltInStampsHint,
      d.stampPicker?.builtInHidden, d.stampPicker?.hideBuiltInNoOwn,
    ];
  };
  const en = tekst('en');
  for (const taal of talen) {
    const t = tekst(taal);
    for (const s of t) assert.ok(typeof s === 'string' && s.trim(), `${taal}: lege tekst`);
    if (taal !== 'en') assert.notEqual(t[2], en[2], `${taal}: hint is Engels`);
  }
  assert.equal(tekst('nl')[1], 'Ingebouwde stempels verbergen als ik eigen stempels heb');
});
