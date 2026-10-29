import assert from 'node:assert/strict';
import test from 'node:test';

import { voerZoomAllesUit, centreerCorrectie } from './zoom-alles.js';
import { maakMiddelmuisHandlers } from '../tools/middelmuis-pan-beleid.js';
import { maakMiddelmuisDubbelklik } from '../tools/middelmuis-dubbelklik.js';

test('centreerCorrectie legt het paginamidden op het venstermidden', () => {
  const venster = { left: 0, top: 100, width: 800, height: 600 };
  assert.deepEqual(centreerCorrectie({ left: 100, top: 900, width: 400, height: 500 }, venster), { dx: -100, dy: 750 });
  assert.deepEqual(centreerCorrectie({ left: 200, top: 150, width: 400, height: 500 }, venster), { dx: 0, dy: 0 });
  assert.deepEqual(centreerCorrectie(null, venster), { dx: 0, dy: 0 });
});

// ── Headless weergavemodel ──
// Een minimale nabootsing van beide weergaven: dezelfde fit-regel als
// computeFitZoom ('page': min(breedte-, hoogteverhouding)), pagina's onder
// elkaar met een vaste tussenruimte in de doorlopende weergave, en een
// scrollpositie die door centreerPagina wordt gezet.

const GAT = 10;

function maakModel({ modus, paginas, huidig = 1, venster = { w: 800, h: 600 }, rotatie = 0, schaal = 2.5, scrollTop = 0 }) {
  const m = { modus, paginas, huidig, venster, rotatie, schaal, scrollTop, scrollLeft: 0, offset: null, log: [] };
  const maat = (p) => {
    const { w, h } = m.paginas[p - 1];
    return m.rotatie % 180 ? { w: h, h: w } : { w, h };
  };
  const top = (p) => {
    let y = GAT;
    for (let i = 1; i < p; i++) y += maat(i).h * m.schaal + GAT;
    return y;
  };
  m.rect = (p) => {
    const { w, h } = maat(p);
    return {
      left: (m.venster.w - w * m.schaal) / 2 - m.scrollLeft,
      top: top(p) - m.scrollTop,
      width: w * m.schaal,
      height: h * m.schaal,
    };
  };
  m.afh = {
    weergaveModus: () => m.modus,
    boekweergave: () => false,
    referentiePagina: () => {
      const mid = m.venster.h / 2;
      let best = null; let afstand = Infinity;
      for (let p = 1; p <= m.paginas.length; p++) {
        const r = m.rect(p);
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < afstand) { afstand = d; best = p; }
      }
      return best;
    },
    zetHuidigePagina: (p) => { m.huidig = p; m.log.push(`huidig ${p}`); },
    passendOpPagina: async () => {
      const { w, h } = maat(m.huidig);
      m.schaal = Math.min(m.venster.w / w, m.venster.h / h);
      if (m.modus === 'single') m.offset = { x: (m.venster.w - w * m.schaal) / 2, y: (m.venster.h - h * m.schaal) / 2 };
      m.log.push('fit');
    },
    centreerPagina: (p) => {
      const { dx, dy } = centreerCorrectie(m.rect(p), { left: 0, top: 0, width: m.venster.w, height: m.venster.h });
      m.scrollLeft += dx;
      m.scrollTop = Math.max(0, m.scrollTop + dy);
      m.log.push(`centreer ${p}`);
    },
  };
  return m;
}

const A4 = { w: 595, h: 842 };
const A3L = { w: 1191, h: 842 };

function volledigInBeeld(m, p) {
  const r = m.rect(p);
  const eps = 1e-6;
  return r.left >= -eps && r.top >= -eps
    && r.left + r.width <= m.venster.w + eps && r.top + r.height <= m.venster.h + eps;
}

test('enkele pagina: precies Fit page, gecentreerd, bij elke zoom en rotatie', async () => {
  for (const rotatie of [0, 90, 180, 270]) {
    for (const schaal of [0.1, 1, 8]) {
      const m = maakModel({ modus: 'single', paginas: [A4, A3L], huidig: 2, rotatie, schaal });
      await voerZoomAllesUit(m.afh);
      assert.deepEqual(m.log, ['fit']);
      const { w, h } = rotatie % 180 ? { w: A3L.h, h: A3L.w } : A3L;
      assert.ok(Math.abs(m.schaal - Math.min(800 / w, 600 / h)) < 1e-9);
      assert.ok(m.offset.x >= 0 && m.offset.y >= 0);
      assert.equal(m.huidig, 2);
    }
  }
});

test('doorlopend: de pagina in beeld blijft referentie en wordt passend en gecentreerd', async () => {
  const paginas = [A4, A4, A3L, A4, A4];
  // Ingezoomd, ergens halverwege pagina 3 gescrold.
  const m = maakModel({ modus: 'continuous', paginas, huidig: 2, schaal: 3 });
  m.scrollTop = m.rect(3).top + m.rect(3).height / 2 - 300;
  await voerZoomAllesUit(m.afh);
  assert.deepEqual(m.log, ['huidig 3', 'fit', 'centreer 3', 'huidig 3']);
  assert.equal(m.huidig, 3);
  assert.ok(volledigInBeeld(m, 3), 'pagina 3 staat volledig in beeld');
  assert.ok(m.scrollTop > 0, 'niet teruggesprongen naar pagina 1');
});

test('doorlopend bij gedraaide weergave en lage zoom: referentie blijft staan', async () => {
  const paginas = Array.from({ length: 10 }, () => A4);
  const m = maakModel({ modus: 'continuous', paginas, huidig: 7, rotatie: 90, schaal: 0.2 });
  m.scrollTop = m.rect(7).top + m.rect(7).height / 2 - 300;
  await voerZoomAllesUit(m.afh);
  assert.equal(m.huidig, 7);
  assert.ok(volledigInBeeld(m, 7));
});

test('boekweergave (één spread, niet scrollend): alleen Fit page', async () => {
  const m = maakModel({ modus: 'continuous', paginas: [A4, A4], huidig: 1 });
  m.afh.boekweergave = () => true;
  await voerZoomAllesUit(m.afh);
  assert.deepEqual(m.log, ['fit']);
});

test('headless: synthetische middel-dubbelklik zet de weergave op passend, pan blijft werken', async () => {
  const paginas = [A4, A4, A4, A4];
  const m = maakModel({ modus: 'continuous', paginas, huidig: 2, schaal: 4 });
  m.scrollTop = m.rect(3).top + m.rect(3).height / 2 - 300;
  let t = 0;
  const pans = [];
  const gepland = [];
  const h = maakMiddelmuisHandlers({
    heeftDocument: () => true,
    weergaveModus: () => m.modus,
    isPanning: () => false,
    rondBewerkingenAf: () => {},
    sluitMenu: () => {},
    startScrollPan: () => pans.push(t),
    startViewportPan: () => false,
    dubbelklik: maakMiddelmuisDubbelklik({ nu: () => t }),
    zoomAlles: () => voerZoomAllesUit(m.afh),
    plan: (fn) => gepland.push(fn),
  });
  const doel = { closest: (sel) => (sel === '#pdf-container' ? {} : null) };
  const ev = (o) => ({ button: 1, buttons: 4, clientX: 400, clientY: 300, target: doel,
    preventDefault() {}, stopPropagation() {}, ...o });

  const schaalVoor = m.schaal;
  for (const t0 of [0, 180]) {
    t = t0; h.onPointerDown(ev());
    t = t0 + 50; h.onPointerUp(ev({ buttons: 0 }));
  }
  assert.equal(pans.length, 2, 'beide drukken starten gewoon een pan');
  assert.equal(gepland.length, 1, 'zoom alles wordt na de pointerup uitgevoerd');
  assert.equal(m.schaal, schaalVoor, 'nog niets gezoomd vóór het uitgestelde werk');
  await gepland[0]();

  assert.ok(Math.abs(m.schaal - Math.min(800 / A4.w, 600 / A4.h)) < 1e-9);
  assert.equal(m.huidig, 3);
  assert.ok(volledigInBeeld(m, 3));

  // Een middelsleep daarna pant en zoomt niet.
  const schaalNa = m.schaal;
  t = 1000; h.onPointerDown(ev());
  t = 1100; h.onPointerUp(ev({ buttons: 0 }));
  t = 1200; h.onPointerDown(ev());
  t = 1220; h.onPointerMove(ev({ button: -1, clientX: 450, clientY: 360 }));
  t = 1300; h.onPointerUp(ev({ buttons: 0, clientX: 450, clientY: 360 }));
  assert.equal(gepland.length, 1);
  assert.equal(m.schaal, schaalNa);
  assert.equal(pans.length, 4);
});
