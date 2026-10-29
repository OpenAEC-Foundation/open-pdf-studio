import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASSISTANT_SKILLS, ASSISTANT_SKILL_GROUPS, SKILL_NEED_KEYS, SKILLS_SYSTEM_PROMPT, buildSystemPrompt, languageInstruction,
  skillGroupKey, skillKeys, skillMessage,
} from './assistant-skills.js';

// De assistent volgt de app-taal (#452, punt 4): elke tekst die de gebruiker
// ziet staat in de locales (common.assistant), in alle 40 talen echt vertaald;
// de systeeminstructie noemt de app-taal; de instructies voor het model zelf
// blijven in één taal (Engels).
const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, 'i18n/locales');
const TALEN = readdirSync(LOCALES);
const lees = (taal) => JSON.parse(readFileSync(join(LOCALES, taal, 'common.json'), 'utf8'));
const blok = (taal) => lees(taal).assistant || {};
const PANEEL = readFileSync(join(HIER, 'solid/components/AssistantPanel.jsx'), 'utf8');
const SKILLS_BRON = readFileSync(join(HIER, 'assistant-skills.js'), 'utf8');

// Alle bladeren van een genest object als 'a.b.c' -> tekst.
function platte(obj, voor = '') {
  return Object.entries(obj).flatMap(([k, v]) => (
    v && typeof v === 'object' ? platte(v, `${voor}${k}.`) : [[`${voor}${k}`, v]]
  ));
}
const opPad = (obj, pad) => pad.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

test('alle 40 talen hebben dezelfde assistent-sleutels als het Engels, geen lege', () => {
  assert.equal(TALEN.length, 40);
  const en = Object.fromEntries(platte(blok('en')));
  assert.ok(Object.keys(en).length >= 30);
  for (const taal of TALEN) {
    const b = Object.fromEntries(platte(blok(taal)));
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), taal);
    for (const [sleutel, tekst] of Object.entries(b)) {
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} assistant.${sleutel} is leeg`);
    }
    assert.ok(b.greeting.includes('**{{title}}**'), `${taal} greeting houdt {{title}} vet`);
    assert.ok(b.errorInvalidKey.includes('🔑'), `${taal} errorInvalidKey noemt het 🔑-knopje`);
    assert.ok(b.keyPlaceholder.endsWith('sk-ant-…'), `${taal} keyPlaceholder`);
  }
});

test('geen taal neemt de Engelse assistent-tekst over', () => {
  // Merknaam en een woord dat in sommige talen echt hetzelfde is.
  const MAG_GELIJK = new Set(['viaClaude', 'detail']);
  const en = Object.fromEntries(platte(blok('en')));
  const gekopieerd = [];
  for (const taal of TALEN) {
    if (taal === 'en') continue;
    const b = Object.fromEntries(platte(blok(taal)));
    for (const [sleutel, tekst] of Object.entries(en)) {
      if (!MAG_GELIJK.has(sleutel) && b[sleutel] === tekst) gekopieerd.push(`${taal} ${sleutel}: ${tekst}`);
    }
  }
  assert.deepEqual(gekopieerd, []);
});

test('elke vaardigheid heeft naam, uitleg en tekst in alle talen; geen losse sleutels', () => {
  const ids = ASSISTANT_SKILLS.map((s) => s.id).sort();
  for (const taal of TALEN) {
    const common = lees(taal);
    assert.deepEqual(Object.keys(common.assistant.skills).sort(), ids, `${taal}: vaardigheden`);
    for (const skill of ASSISTANT_SKILLS) {
      for (const [veld, pad] of Object.entries(skillKeys(skill))) {
        const tekst = opPad(common, pad);
        assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} ${pad} (${veld})`);
      }
      // Een vaardigheid die nog invoer vraagt, zet een voorvoegsel in het
      // invoervak: dat eindigt op een dubbele punt.
      if (skill.needsInput) {
        assert.match(opPad(common, skillKeys(skill).prompt), /[:：]\s?$/, `${taal} ${skill.id}.prompt`);
      }
    }
  }
});

// De groepen en de meldingen van de poortjes (#452): elke groep heeft een
// naam, elke melding die skillBlocker/skillInputProblem kan geven bestaat, in
// alle talen; need.page houdt {{max}} en need.scale noemt de vertaalde naam
// van "Check the scale".
test('elke vaardigheidsgroep en elke melding staat in alle talen', () => {
  const NEED = SKILL_NEED_KEYS.map((k) => k.replace(/^assistant\.need\./, '')).sort();
  for (const taal of TALEN) {
    const common = lees(taal);
    assert.deepEqual(Object.keys(common.assistant.groups).sort(), ASSISTANT_SKILL_GROUPS.map((g) => g.id).sort(), `${taal}: groepen`);
    for (const g of ASSISTANT_SKILL_GROUPS) assert.ok(String(opPad(common, skillGroupKey(g)) || '').trim(), `${taal} ${g.id}`);
    assert.deepEqual(Object.keys(common.assistant.need).sort(), NEED, `${taal}: meldingen`);
    for (const k of SKILL_NEED_KEYS) assert.ok(String(opPad(common, k) || '').trim(), `${taal} ${k}`);
    assert.ok(common.assistant.need.page.includes('{{max}}'), `${taal} need.page houdt {{max}}`);
    assert.ok(common.assistant.need.scale.includes(common.assistant.skills['check-scale'].label), `${taal} need.scale noemt de vaardigheid`);
  }
});

test('een vaardigheid is data: id, teken en een Engelse instructie, geen teksten', () => {
  for (const skill of ASSISTANT_SKILLS) {
    assert.ok(skill.id && skill.icon && skill.invoke, skill.id);
    assert.equal('label' in skill, false, `${skill.id}: label hoort in de locales`);
    assert.equal('hint' in skill, false, `${skill.id}: hint hoort in de locales`);
  }
});

test('elke assistent-sleutel die het paneel gebruikt bestaat in het Engels', () => {
  const en = lees('en');
  const gebruikt = [...PANEEL.matchAll(/\bt\('([A-Za-z.]+)'/g)].map((m) => m[1]);
  assert.ok(gebruikt.filter((k) => k.startsWith('assistant.')).length >= 15, 'het paneel haalt zijn teksten uit de locales');
  for (const sleutel of gebruikt) assert.ok(typeof opPad(en, sleutel) === 'string', `common.${sleutel}`);
  assert.ok(PANEEL.includes('t(skillKeys(skill).label)'));
  assert.ok(PANEEL.includes('t(skillKeys(skill).hint)'));
  assert.ok(PANEEL.includes('t(skillKeys(skill).prompt)'));
});

// Woorden die in Nederlandse zinnen voorkomen en niet in Engelse code of tekst.
const NEDERLANDS = [
  'de', 'het', 'een', 'van', 'niet', 'je', 'jij', 'naar', 'voor', 'wordt', 'zijn', 'deze', 'dit', 'geen',
  'ook', 'maar', 'wat', 'bij', 'uit', 'met', 'op', 'te', 'er', 'als', 'dan', 'kan', 'ik', 'hallo', 'vraag',
  'tekening', 'deur', 'deuren', 'vertaal', 'teken', 'herken', 'sleutel', 'opslaan', 'denken', 'verbonden',
  'fout', 'onbekende', 'ongeldige', 'verbinding', 'mislukt', 'geopend', 'geopende', 'gebruiker', 'assistent',
  'antwoord', 'iets', 'werkt', 'samen', 'constructie', 'plattegrond', 'stramien', 'kolommen', 'balken',
];
// Toegestaan: het patroon dat de Nederlandse fouttekst van een oudere AI-brug
// herkent (geen tekst die de gebruiker ziet) en de importregels (module- en
// functienamen, geen tekst).
const TOEGESTAAN = [/\|onbereikbaar\|/, /^import .*$/gm];

function nederlandseWoorden(bron) {
  let tekst = bron;
  for (const re of TOEGESTAAN) tekst = tekst.replace(re, '|');
  // Symbool-id's en parameternamen van de app staan tussen aanhalingstekens
  // in de instructie ("stramien", params label/orientation): dat zijn
  // namen, geen zinnen.
  tekst = tekst.replace(/"[a-zA-Z-]+"/g, '""');
  const woorden = NEDERLANDS.join('|');
  return [...tekst.matchAll(new RegExp(`\\b(${woorden})\\b`, 'gi'))].map((m) => m[1]);
}

test('geen hard-gecodeerd Nederlands meer in het paneel en de vaardigheden', () => {
  assert.deepEqual(nederlandseWoorden(PANEEL), [], 'AssistantPanel.jsx');
  assert.deepEqual(nederlandseWoorden(SKILLS_BRON), [], 'assistant-skills.js');
  // De wachter werkt: de oude teksten zouden vallen.
  assert.ok(nederlandseWoorden("placeholder=\"Vraag iets over deze PDF…\"").length >= 3);
  assert.ok(nederlandseWoorden("'Antwoord in het Nederlands, bondig en praktisch.'").length >= 2);
});

test('de systeeminstructie noemt de app-taal en de taalcode', () => {
  const ja = buildSystemPrompt({ code: 'ja', englishName: 'Japanese', nativeName: '日本語' });
  assert.match(ja, /Always answer the user in Japanese/);
  assert.ok(ja.includes('"ja"'));
  assert.ok(ja.includes('日本語'));
  assert.ok(ja.endsWith(SKILLS_SYSTEM_PROMPT), 'de vaardigheden-instructie blijft gelijk');
  assert.ok(!/Antwoord in het Nederlands/.test(ja), 'het antwoord is niet meer vast Nederlands');

  const nl = buildSystemPrompt({ code: 'nl', englishName: 'Dutch', nativeName: 'Nederlands' });
  assert.match(nl, /Always answer the user in Dutch/);
  // Wisselt de taal, dan wisselt alleen de taalregel.
  assert.equal(nl.replace(languageInstruction({ code: 'nl', englishName: 'Dutch', nativeName: 'Nederlands' }), ''),
    ja.replace(languageInstruction({ code: 'ja', englishName: 'Japanese', nativeName: '日本語' }), ''));
  // Zonder naam valt de instructie terug op de taalnaam uit Intl.
  assert.match(buildSystemPrompt({ code: 'de' }), /answer the user in German/);
});

test('elke taal van de app heeft een Engelse naam voor de instructie', () => {
  const config = readFileSync(join(HIER, 'i18n/config.js'), 'utf8');
  const namen = Object.fromEntries([...config.matchAll(/\{ code: '([a-z]+)', name: '([^']+)', englishName: '([^']+)'/g)]
    .map((m) => [m[1], { nativeName: m[2], englishName: m[3] }]));
  for (const taal of TALEN) {
    assert.ok(namen[taal], `${taal} staat in LANGUAGES`);
    const prompt = buildSystemPrompt({ code: taal, ...namen[taal] });
    assert.ok(prompt.includes(`answer the user in ${namen[taal].englishName}`), taal);
    assert.ok(prompt.includes(`"${taal}"`), taal);
  }
});

test('het paneel leest de taal per vraag en stuurt de vaste instructie van een chip', () => {
  assert.ok(PANEEL.includes('buildSystemPrompt(currentLanguage(language()))'));
  assert.ok(!PANEEL.includes('SKILLS_SYSTEM_PROMPT'), 'geen eigen kopie van de instructie');
  assert.ok(PANEEL.includes('modelText(m)'), 'het model krijgt de instructie, de chat de vertaalde tekst');
});

test('een chip toont de vertaalde tekst en geeft het model de vaste instructie', () => {
  const vertaal = ASSISTANT_SKILLS.find((s) => s.id === 'translate');
  assert.deepEqual(skillMessage(vertaal, 'Vertaal de tekst van het geopende document.'),
    { shown: 'Vertaal de tekst van het geopende document.', model: vertaal.invoke });

  const teken = ASSISTANT_SKILLS.find((s) => s.id === 'draw');
  assert.deepEqual(skillMessage(teken, '図面に描いてください：', '図面に描いてください：赤い円'),
    { shown: '図面に描いてください：赤い円', model: `${teken.invoke}赤い円` });
  assert.deepEqual(skillMessage(teken, 'Teken op de tekening: ', 'Teken op de tekening: een rode cirkel'),
    { shown: 'Teken op de tekening: een rode cirkel', model: `${teken.invoke}een rode cirkel` });
  // Heeft de gebruiker het voorvoegsel weggehaald, dan gaat de tekst zoals getypt.
  assert.deepEqual(skillMessage(teken, 'Teken op de tekening: ', 'Zet een wolk om de trap'),
    { shown: 'Zet een wolk om de trap', model: 'Zet een wolk om de trap' });
});
