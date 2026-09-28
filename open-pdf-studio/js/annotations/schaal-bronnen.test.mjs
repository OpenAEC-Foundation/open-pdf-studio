// Schaalbronnen per doorloop (#491): binnen metSchaalBronnen worden de
// schaalbronnen van een document één keer verzameld; daarbuiten, en in de
// volgende doorloop, altijd vers. Deze tests pinnen dat een toegevoegde,
// verplaatste, gewijzigde of verwijderde schaalbron bij de volgende opzoeking
// meetelt, en dat een reactieve berekening die binnen een doorloop draait
// haar eigen abonnementen houdt.
//
// Solid draait hier de reactieve browserbouw, zoals in de app
// (zie ../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { createRoot, createSignal, createMemo, untrack } = await import('solid-js');
const { createMutable } = await import('solid-js/store');
const { metSchaalBronnen, schaalBronnen, schaalBronnenInDoorloop, vergeetSchaalBronnen } = await import('./schaal-bronnen.js');
const { schaalOpPuntUitBronnen } = await import('./schaal-op-punt.js');

const PPU = (n) => 72 / (25.4 * n);
const schaal = (doc, pagina, x, y) => schaalOpPuntUitBronnen(schaalBronnen(doc), doc, pagina, x, y);

/** Een document waarvan de annotatielijst telt hoe vaak hij doorlopen wordt. */
function geteldDocument(annotaties) {
  const doc = { annotations: annotaties, doorlopen: 0 };
  const lijst = annotaties;
  doc.annotations = new Proxy(lijst, {
    get(doel, sleutel, ontvanger) {
      if (sleutel === Symbol.iterator) doc.doorlopen++;
      return Reflect.get(doel, sleutel, ontvanger);
    },
  });
  return doc;
}

function vakken(n, pagina = 1) {
  return Array.from({ length: n }, (_, i) => ({ id: `v${i}`, type: 'box', page: pagina, x: i, y: i, width: 4, height: 4 }));
}

test('outside a pass every lookup collects afresh; inside a pass once per document', () => {
  const doc = geteldDocument([...vakken(200), { id: 'b', type: 'scaleBar', page: 1, pixelsPerUnit: PPU(50), unit: 'mm' }]);
  for (let i = 0; i < 50; i++) schaal(doc, 1, i, i);
  assert.equal(doc.doorlopen, 50);

  doc.doorlopen = 0;
  metSchaalBronnen(() => {
    for (let i = 0; i < 50; i++) assert.equal(schaal(doc, 1, i, i).pixelsPerUnit, PPU(50));
    assert.equal(schaalBronnen(doc), schaalBronnen(doc), 'dezelfde bronnen binnen de doorloop');
  });
  assert.equal(doc.doorlopen, 1);
  assert.equal(schaalBronnenInDoorloop(doc), null, 'na de doorloop is er niets meer bewaard');
});

test('each document in a pass has its own sources', () => {
  const a = { annotations: [{ type: 'scaleBar', page: 1, pixelsPerUnit: PPU(20), unit: 'mm' }] };
  const b = { annotations: [{ type: 'scaleBar', page: 1, pixelsPerUnit: PPU(200), unit: 'cm' }] };
  metSchaalBronnen(() => {
    assert.equal(schaal(a, 1, 0, 0).pixelsPerUnit, PPU(20));
    assert.equal(schaal(b, 1, 0, 0).pixelsPerUnit, PPU(200));
    assert.equal(schaal(a, 1, 0, 0).unit, 'mm');
  });
});

test('a scale source added, moved, edited or deleted is seen by the next pass', () => {
  const doc = { annotations: vakken(20), measureScale: { pixelsPerUnit: PPU(100), unit: 'mm' } };
  const opzoeken = () => metSchaalBronnen(() => schaal(doc, 1, 10, 10));
  assert.equal(opzoeken().method, 'document');

  const vp = { id: 'vp', type: 'viewport', page: 1, x: 0, y: 0, width: 50, height: 50, pixelsPerUnit: PPU(20), unit: 'mm' };
  doc.annotations.push(vp);
  assert.deepEqual(opzoeken(), { pixelsPerUnit: PPU(20), unit: 'mm', method: 'viewport' }, 'toegevoegd');

  vp.x = 100;
  assert.equal(opzoeken().method, 'document', 'verplaatst: het punt ligt er niet meer in');
  vp.x = 0;
  vp.page = 2;
  assert.equal(opzoeken().method, 'document', 'naar een andere pagina verplaatst');
  vp.page = 1;
  vp.pixelsPerUnit = PPU(10);
  assert.equal(opzoeken().pixelsPerUnit, PPU(10), 'gewijzigde schaal');

  doc.annotations.splice(doc.annotations.indexOf(vp), 1);
  assert.equal(opzoeken().method, 'document', 'verwijderd');
});

test('invalidating inside a pass (a change mid-pass) makes the next lookup collect again', () => {
  const doc = { annotations: vakken(5) };
  metSchaalBronnen(() => {
    assert.equal(schaal(doc, 1, 1, 1), null);
    doc.annotations.push({ type: 'scaleBar', page: 1, pixelsPerUnit: PPU(50), unit: 'mm' });
    assert.equal(schaal(doc, 1, 1, 1), null, 'zonder ongeldig maken: de bronnen van deze doorloop');
    vergeetSchaalBronnen();
    assert.equal(schaal(doc, 1, 1, 1).pixelsPerUnit, PPU(50));
  });
});

test('a nested pass has its own sources and the outer one keeps working', () => {
  const doc = geteldDocument(vakken(10));
  metSchaalBronnen(() => {
    schaal(doc, 1, 0, 0);
    metSchaalBronnen(() => {
      schaal(doc, 1, 0, 0);
      schaal(doc, 1, 0, 0);
    });
    schaal(doc, 1, 0, 0);
  });
  assert.equal(doc.doorlopen, 2, 'één keer buiten, één keer binnen');
});

test('a pass that throws is closed all the same', () => {
  const doc = { annotations: vakken(3) };
  assert.throws(() => metSchaalBronnen(() => {
    schaalBronnen(doc);
    throw new Error('stuk');
  }), /stuk/);
  assert.equal(schaalBronnenInDoorloop(doc), null);
});

test('a memo recomputing inside another pass still subscribes to the scale sources itself', () => {
  // Twee schaalbalken: A op pagina 2 (eerste in de lijst) en B op pagina 3.
  // Op pagina 1 geldt dan "de eerste schaalbalk elders": A. Wordt B naar
  // pagina 1 verplaatst, dan wint B. Dat ziet de memo alleen als hij de
  // pagina's van de bronnen zelf gelezen heeft.
  const doc = createMutable({
    annotations: [
      ...vakken(5),
      { id: 'A', type: 'scaleBar', page: 2, pixelsPerUnit: PPU(20), unit: 'mm' },
      { id: 'B', type: 'scaleBar', page: 3, pixelsPerUnit: PPU(50), unit: 'mm' },
    ],
  });
  const [tik, setTik] = createSignal(0);
  let berekeningen = 0;
  const dispose = createRoot((d) => {
    const opPunt = createMemo(() => {
      tik();
      berekeningen++;
      return schaalOpPuntUitBronnen(schaalBronnen(doc), doc, 1, 0, 0);
    });
    // De memo rekent opnieuw BINNEN een doorloop die buiten elke memo geopend
    // is (zoals hertekenen): die bronnen horen niet bij de memo.
    untrack(() => metSchaalBronnen(() => {
      schaalBronnen(doc);
      setTik(1);
      assert.equal(opPunt().pixelsPerUnit, PPU(20));
    }));
    const voor = berekeningen;
    doc.annotations[6].page = 1;
    assert.ok(berekeningen > voor, 'de memo rekent opnieuw na het verplaatsen van B');
    assert.equal(opPunt().pixelsPerUnit, PPU(50));
    return d;
  });
  dispose();
});

test('a pass opened inside a memo shares its sources and keeps the memo reactive', () => {
  const doc = createMutable({ annotations: vakken(30), measureScale: null });
  let doorlopen = 0;
  const dispose = createRoot((d) => {
    const waarden = createMemo(() => {
      doorlopen++;
      return metSchaalBronnen(() => doc.annotations.map((a) => schaal(doc, 1, a.x, a.y)?.pixelsPerUnit ?? null));
    });
    assert.deepEqual(new Set(waarden()), new Set([null]));
    doc.annotations.push({ id: 'balk', type: 'scaleBar', page: 1, pixelsPerUnit: PPU(100), unit: 'mm' });
    assert.deepEqual(new Set(waarden()), new Set([PPU(100)]), 'nieuwe schaalbalk');
    doc.annotations[30].pixelsPerUnit = PPU(50);
    assert.deepEqual(new Set(waarden()), new Set([PPU(50)]), 'gewijzigde schaal');
    doc.annotations[30].page = 2;
    assert.deepEqual(new Set(waarden()), new Set([PPU(50)]), 'elders: nog steeds de enige schaalbalk');
    doc.measureScale = { pixelsPerUnit: PPU(10), unit: 'mm' };
    assert.deepEqual(new Set(waarden()), new Set([PPU(10)]), 'de documentschaal gaat voor een balk elders');
    doc.annotations.splice(30, 1);
    doc.measureScale = null;
    assert.deepEqual(new Set(waarden()), new Set([null]), 'verwijderd');
    return d;
  });
  dispose();
  assert.ok(doorlopen >= 6);
});
