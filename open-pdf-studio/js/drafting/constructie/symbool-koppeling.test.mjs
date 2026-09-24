// De koppeling tussen het constructieplan en de rest van de applicatie: de
// symbolen die het plan aanroept moeten bestaan en de parameters die het
// meegeeft moeten die symbolen ook echt kennen. Hernoemt iemand een template,
// dan valt dat hier om — niet pas in een draaiende app.
import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultParams, getTemplate } from '../../symbols/registry.js';
import { ASSISTANT_SKILLS, SKILLS_SYSTEM_PROMPT } from '../../assistant-skills.js';
import { bouwConstructieplan } from './constructieplan.js';
import { ontleedProfiel } from './draagstructuur.js';

const VOLLEDIG = bouwConstructieplan({
  pagina: 1,
  oorsprong: { x: 100, y: 100 },
  veldenX: '2x5400', veldenY: '2x6000', schaal: '1:100',
  kolommen: { profiel: 'HE200B', peilMm: 3000 },
  balken: { profiel: '300x500', richting: 'beide', peilMm: 3000 },
  vloeren: { dikteMm: 260, peilMm: 3000 },
});

test('het proefplan komt zonder fout tot stand', () => {
  assert.equal(VOLLEDIG.ok, true);
});

test('elk symbool dat het plan aanroept bestaat in de bibliotheek', () => {
  const gebruikt = new Set(
    VOLLEDIG.annotaties
      .filter(a => a.type === 'parametricSymbol')
      .map(a => a.props.symbolId),
  );
  assert.ok(gebruikt.size >= 3);
  for (const id of gebruikt) {
    assert.ok(getTemplate(id), `onbekend symbool: ${id}`);
  }
});

test('elke meegegeven parameter staat in het parameterschema van zijn symbool', () => {
  for (const a of VOLLEDIG.annotaties) {
    if (a.type !== 'parametricSymbol') continue;
    const tpl = getTemplate(a.props.symbolId);
    const bekend = new Set(Object.keys(defaultParams(tpl)));
    for (const sleutel of Object.keys(a.props.params || {})) {
      assert.ok(bekend.has(sleutel),
        `${a.props.symbolId} kent de parameter '${sleutel}' niet`);
    }
  }
});

test('een keuzewaarde die het plan zet, staat ook in de keuzelijst', () => {
  const stramien = VOLLEDIG.annotaties.find(a => a.props.symbolId === 'stramien');
  const tpl = getTemplate('stramien');
  for (const sleutel of ['orientation', 'bollen']) {
    const veld = tpl.params.find(p => p.key === sleutel);
    const opties = veld.options.map(o => (typeof o === 'string' ? o : o.value));
    assert.ok(opties.includes(stramien.props.params[sleutel]),
      `${sleutel}=${stramien.props.params[sleutel]} staat niet in de keuzelijst`);
  }
});

test('elke stalen profielfamilie wijst naar een bestaand symbool met die maat', () => {
  for (const tekst of ['HE200B', 'HE 200 A', 'IPE 300', 'UNP 200', 'Koker 100x100x5', 'L 100x100x10']) {
    const profiel = ontleedProfiel(tekst);
    const tpl = getTemplate(profiel.symbolId);
    assert.ok(tpl, `${tekst}: onbekend symbool ${profiel.symbolId}`);
    const veld = tpl.params.find(p => p.key === 'maat');
    const opties = veld.options.map(o => (typeof o === 'string' ? o : o.value));
    assert.ok(opties.includes(profiel.maat), `${tekst}: maat "${profiel.maat}" staat niet in ${profiel.symbolId}`);
    const mm = tpl.realSizeMm({ ...defaultParams(tpl), maat: profiel.maat, aanzicht: 'doorsnede' });
    assert.ok(mm && mm.width > 0 && mm.height > 0, `${tekst}: geen werkelijke maat`);
  }
});

test('de vaardigheid staat als chip in het paneel', () => {
  const chip = ASSISTANT_SKILLS.find(s => s.id === 'structural-layout');
  assert.ok(chip, 'de chip structural-layout ontbreekt');
  assert.ok(chip.label && chip.hint && chip.invoke);
  assert.equal(chip.needsInput, true);
});

test('de systeeminstructie noemt de opdracht en de eenheid', () => {
  assert.match(SKILLS_SYSTEM_PROMPT, /app_structural_layout/);
  assert.match(SKILLS_SYSTEM_PROMPT, /MILLIMETERS/);
  assert.match(SKILLS_SYSTEM_PROMPT, /dryRun/);
});
