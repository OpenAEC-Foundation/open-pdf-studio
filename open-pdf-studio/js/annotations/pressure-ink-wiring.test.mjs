// Drukgevoelige inkt (#385): de bedrading die zonder de app niet te draaien
// is (bronteksten, CRLF→LF), het paneel en de vertalingen in alle talen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { inktPaneelWaarden, inktPropWaarde } from './pressure-ink-panel.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('dispatcher: ruwe pointermoves (coalesced) en palmafwijzing gaan naar het gereedschap', () => {
  const d = bron('../tools/tool-dispatcher.js');
  assert.match(d, /rejectPointer\(e, state\)\) return;/, 'pointerdown: een geweigerde aanwijzer doet niets');
  assert.match(d, /if \(state\.isDrawing\) \{\n\s+const _ruw = getTool\(state\.currentTool\);\n\s+if \(_ruw\?\.onRawPointerMove\) _ruw\.onRawPointerMove\(e, state\);/,
    'elke ruwe pointermove vóór de bundeling per beeldframe');
  const t = bron('../tools/tools/draw-tool.js');
  assert.match(t, /monstersVanEvent\(e\)/, 'de vrije hand leest alle coalesced monsters');
  assert.match(t, /aanwijzerMetDruk\(e\?\.pointerType\)/, 'alleen een pen stuurt de breedte');
});

test('scherm en bestand tekenen dezelfde streek (rendering en saver gebruiken inktGeometrie)', () => {
  assert.match(bron('./rendering.js'), /inktGeometrie\(annotation, \{ breedteFactor/);
  assert.match(bron('../pdf/saver.js'), /inktAppearanceInhoud\(ann, convertX, convertY/);
  assert.match(bron('../pdf/loader/annotation-converter.js'), /\.\.\.inktUitBestand\(extraColors, path\.length\)/);
});

test('paneel: waarden van een streek en wat een wijziging schrijft', () => {
  assert.deepEqual(inktPaneelWaarden({ type: 'draw', path: [] }),
    { inkPressure: true, inkHasPressure: false, inkMinWidth: 30, inkSmoothing: 0 });
  assert.deepEqual(inktPaneelWaarden({ pressures: [0.2], inkPressure: false, inkMinWidth: 2, inkSmoothing: 70 }),
    { inkPressure: false, inkHasPressure: true, inkMinWidth: 5, inkSmoothing: 70 });
  assert.deepEqual(inktPropWaarde('inkPressure', false), { inkPressure: false });
  assert.deepEqual(inktPropWaarde('inkPressure', true), { inkPressure: undefined });
  assert.deepEqual(inktPropWaarde('inkMinWidth', '250'), { inkMinWidth: 100 });
  assert.deepEqual(inktPropWaarde('inkSmoothing', 33.4), { inkSmoothing: 33 });
});

test('voorkeuren: standaardwaarden bestaan', () => {
  const c = bron('../core/constants.ts');
  for (const k of ['drawPressure: true', 'drawPressureMinWidth: 30', 'drawSmoothing: 50', 'drawPenOnly: false']) {
    assert.ok(c.includes(k), k);
  }
});

test('vertalingen: elke taal heeft de inkt-teksten, echt vertaald', () => {
  const map = new URL('../i18n/locales/', import.meta.url);
  const talen = readdirSync(map);
  assert.ok(talen.length >= 40);
  const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, map), 'utf8'));
  const sleutels = {
    properties: (d) => d.ink,
    preferences: (d) => d.drawing,
  };
  const velden = {
    properties: ['title', 'pressure', 'pressureHint', 'minWidth', 'minWidthHint', 'smoothing', 'smoothingHint'],
    preferences: ['smoothing', 'pressure', 'pressureHint', 'pressureMinWidth', 'penOnly', 'penOnlyHint'],
  };
  for (const ns of Object.keys(velden)) {
    const en = sleutels[ns](lees('en', ns));
    for (const veld of velden[ns]) {
      let gelijk = 0;
      for (const taal of talen) {
        const v = sleutels[ns](lees(taal, ns))?.[veld];
        assert.equal(typeof v, 'string', `${taal}/${ns}: ${veld} ontbreekt`);
        assert.ok(v.trim().length > 0, `${taal}/${ns}: ${veld} is leeg`);
        if (taal !== 'en' && v === en[veld]) gelijk++;
      }
      assert.ok(gelijk <= 2, `${ns}.${veld}: ${gelijk} talen gebruiken de Engelse tekst`);
    }
  }
});
