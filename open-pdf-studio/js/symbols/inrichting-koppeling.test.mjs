// Inrichting (#478): de koppelingen rond de pure modules. De rekenregels zelf
// staan in anker.test.mjs, sanitair.test.mjs en keuken.test.mjs; hier wordt
// getoetst dat de app-kant ze ook echt aanroept (die modules zijn niet los in
// node te laden) en dat de knoppen van de lijstbewerker een en- en nl-tekst
// hebben.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const lees = (rel) => readFileSync(path.join(hier, rel), 'utf8');

const LIJST_SLEUTELS = ['listNew', 'listAdd', 'listRemove', 'listSwap', 'listEmpty'];

test('lijstbewerker: elke knoptekst bestaat in en en nl, en de bewerker gebruikt precies die sleutels', () => {
  const en = JSON.parse(lees('../i18n/locales/en/properties.json')).parametricSymbol;
  const nl = JSON.parse(lees('../i18n/locales/nl/properties.json')).parametricSymbol;
  for (const k of LIJST_SLEUTELS) {
    assert.ok(typeof en[k] === 'string' && en[k].trim(), `en: ${k}`);
    assert.ok(typeof nl[k] === 'string' && nl[k].trim(), `nl: ${k}`);
    assert.notEqual(nl[k], en[k], `nl ${k} is vertaald`);
  }
  const bron = lees('../solid/components/properties-panel/ParamListEditor.jsx');
  const gebruikt = new Set([...bron.matchAll(/t\('parametricSymbol\.(\w+)'\)/g)].map((m) => m[1]));
  assert.deepEqual([...gebruikt].sort(), [...LIJST_SLEUTELS].sort());
});

test('eigenschappenpaneel: een lijst-parameter krijgt de lijstbewerker', () => {
  const sectie = lees('../solid/components/properties-panel/ParametricSymbolSection.jsx');
  assert.match(sectie, /import ParamListEditor from '\.\/ParamListEditor\.jsx'/);
  assert.match(sectie, /p\.type !== 'list'/);
  // Een lijst mag niet als store-proxy in de annotatie belanden.
  assert.match(sectie, /JSON\.parse\(JSON\.stringify\(annotProps\.params/);
  const store = lees('../solid/stores/parametricSymbolStore.js');
  assert.match(store, /def\.type === 'list'/);
  assert.match(store, /normalizeListParam\(def, raw, result\)/);
});

test('maat en grepen: real-size kiest het vaste punt van het template, grepen zetten de maat terug', () => {
  const rs = lees('real-size.js');
  assert.match(rs, /maatAnkerVoor\(tpl, ann\.params, anchor\)/);
  assert.match(rs, /vakNaMaatwijziging\(/);
  const tr = lees('../annotations/transforms.js');
  assert.match(tr, /tpl\?\.paramsUitMaat/);
  assert.match(tr, /paramsUitMaat\(originalAnn\.params/);
});

test('MCP: anchor bij aanmaken, samenvoegen en werkelijke maat bij bijwerken', () => {
  const brug = lees('../mcp-bridge.js');
  assert.match(brug, /ankerArgument\(p\.anchor\)/);
  assert.match(brug, /vakUitAnker\(/);
  assert.match(brug, /reg\.normalizeParams\(tpl,/);
  assert.match(brug, /delete merged\.anchor/);
  assert.match(brug, /voegParamsSamen\(ann\.params, patch\.params\)/);
  assert.match(brug, /applyTemplateRealSize\(ann, 'center'\)/);
});
