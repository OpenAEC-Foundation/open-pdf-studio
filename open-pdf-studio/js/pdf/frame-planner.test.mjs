import assert from 'node:assert/strict';
import test from 'node:test';

import { maakFramePlanner, bewaakSchrijven } from './frame-planner.js';

// Een stilstaand venster vroeg elk schermframe (240 Hz) een animatieframe aan,
// ook zonder werk: ~15 % van een kern in de webview plus de GPU. De render-lus
// van de viewport vraagt nu alleen een frame als er werk is. Deze tests leggen
// dat vast met een nep-requestAnimationFrame.

function nepFrames() {
  const wachtrij = new Map();
  let volgend = 1;
  return {
    vraag: (cb) => {
      const id = volgend++;
      wachtrij.set(id, cb);
      return id;
    },
    annuleer: (id) => { wachtrij.delete(id); },
    get aantal() { return wachtrij.size; },
    // Draai alle nu wachtende frames (wat ze zelf weer aanvragen wacht op
    // de volgende ronde, zoals in de browser).
    draai(t = 0) {
      const nu = [...wachtrij.values()];
      wachtrij.clear();
      for (const cb of nu) cb(t);
      return nu.length;
    },
  };
}

function planner(frames, { werk = () => false, frame = () => {} } = {}) {
  return maakFramePlanner({
    heeftWerk: () => werk(),
    frame: (t) => frame(t),
    vraagFrame: frames.vraag,
    annuleerFrame: frames.annuleer,
  });
}

test('zonder werk vraagt de planner geen frame', () => {
  const f = nepFrames();
  const p = planner(f);
  p.start();
  p.plan();
  assert.equal(f.aantal, 0);
  assert.equal(p.gepland, false);
});

test('werk plant precies één frame, ook als er vaker om gevraagd wordt', () => {
  const f = nepFrames();
  let werk = false;
  const p = planner(f, { werk: () => werk });
  p.start();
  werk = true;
  p.plan();
  p.plan();
  p.plan();
  assert.equal(f.aantal, 1);
  assert.equal(p.gepland, true);
});

test('na een frame zonder resterend werk komt er geen nieuw frame', () => {
  const f = nepFrames();
  let werk = true;
  let frames = 0;
  const p = planner(f, { werk: () => werk, frame: () => { frames++; werk = false; } });
  p.start();
  assert.equal(f.draai(), 1);
  assert.equal(frames, 1);
  assert.equal(f.aantal, 0, 'geen frame meer zonder werk');
  assert.equal(p.gepland, false);
});

test('werk dat blijft (wieluitloop) houdt de lus elk frame in leven tot het op is', () => {
  const f = nepFrames();
  let rest = 5;
  let frames = 0;
  const p = planner(f, { werk: () => rest > 0, frame: () => { frames++; rest--; } });
  p.start();
  for (let i = 0; i < 5; i++) {
    assert.equal(f.aantal, 1, `frame ${i + 1} staat klaar`);
    f.draai();
  }
  assert.equal(frames, 5);
  assert.equal(f.aantal, 0, 'na de laatste stap stopt de lus');
});

test('een schrijfactie tijdens het frame wacht tot het frame klaar is: één vervolgframe', () => {
  const f = nepFrames();
  let werk = true;
  let frames = 0;
  const p = planner(f, {
    werk: () => werk,
    frame: () => {
      frames++;
      werk = false;
      // Iets in het frame zet opnieuw werk klaar (bijv. dirty) en vraagt een frame.
      if (frames === 1) {
        werk = true;
        p.plan();
        p.plan();
        assert.equal(f.aantal, 0, 'binnen het frame nog niets aangevraagd');
      }
    },
  });
  p.start();
  f.draai();
  assert.equal(f.aantal, 1);
  f.draai();
  assert.equal(frames, 2);
  assert.equal(f.aantal, 0);
});

test('stop annuleert het geplande frame en plant daarna niets; start hervat', () => {
  const f = nepFrames();
  let werk = true;
  let frames = 0;
  const p = planner(f, { werk: () => werk, frame: () => { frames++; werk = false; } });
  p.start();
  assert.equal(f.aantal, 1);
  p.stop();
  assert.equal(f.aantal, 0, 'frame geannuleerd');
  p.plan();
  assert.equal(f.aantal, 0, 'gestopt: geen frames');
  assert.equal(p.aan, false);
  p.start();
  assert.equal(f.aantal, 1, 'start plant meteen als er werk wacht');
  f.draai();
  assert.equal(frames, 1);
});

test('opnieuw starten laat nooit twee frames staan', () => {
  const f = nepFrames();
  const p = planner(f, { werk: () => true });
  p.start();
  p.start();
  p.stop();
  p.start();
  p.start();
  assert.equal(f.aantal, 1);
});

test('een frame dat na stop toch nog afgaat, doet niets', () => {
  const f = nepFrames();
  let frames = 0;
  // Een annuleer die niets doet, zoals een frame dat al onderweg was.
  const p = maakFramePlanner({
    heeftWerk: () => true,
    frame: () => { frames++; },
    vraagFrame: f.vraag,
    annuleerFrame: () => {},
  });
  p.start();
  p.stop();
  f.draai();
  assert.equal(frames, 0);
  assert.equal(f.aantal, 0);
});

test('zonder requestAnimationFrame (node) plant hij niets en gooit hij niets', () => {
  assert.equal(typeof globalThis.requestAnimationFrame, 'undefined');
  let frames = 0;
  const p = maakFramePlanner({ heeftWerk: () => true, frame: () => { frames++; } });
  p.start();
  assert.equal(p.plan(), false);
  assert.equal(p.gepland, false);
  p.stop();
  assert.equal(frames, 0);
});

test('een fout in een frame laat de planner niet hangen: de volgende vraag plant weer', () => {
  const f = nepFrames();
  let gooi = true;
  let frames = 0;
  const p = planner(f, {
    werk: () => true,
    frame: () => {
      frames++;
      if (gooi) { gooi = false; throw new Error('kapot'); }
    },
  });
  p.start();
  assert.throws(() => f.draai(), /kapot/);
  assert.equal(f.aantal, 0, 'geen foutlus per frame');
  p.plan();
  assert.equal(f.aantal, 1);
  f.draai();
  assert.equal(frames, 2);
});

// ─── bewaakSchrijven: dirty/active als accessor op de viewport ──────────────

test('de eigenschap wordt een accessor die de waarde houdt en elke schrijfactie meldt', () => {
  const obj = { zoom: 2, dirty: true, active: false };
  const meldingen = [];
  bewaakSchrijven(obj, 'dirty', (nieuw, oud) => meldingen.push([nieuw, oud]));
  const d = Object.getOwnPropertyDescriptor(obj, 'dirty');
  assert.equal(typeof d.get, 'function');
  assert.equal(typeof d.set, 'function');
  assert.equal(d.enumerable, true);
  assert.equal(d.configurable, true);
  assert.equal(obj.dirty, true, 'huidige waarde blijft');
  obj.dirty = false;
  obj.dirty = true;
  obj.dirty = true;
  assert.equal(obj.dirty, true);
  assert.deepEqual(meldingen, [[false, true], [true, false], [true, true]]);
});

test('opnieuw bewaken (HMR) behoudt de waarde en meldt alleen nog aan de nieuwe melder', () => {
  const obj = { active: false };
  let oud = 0;
  let nieuw = 0;
  bewaakSchrijven(obj, 'active', () => { oud++; });
  obj.active = true;
  bewaakSchrijven(obj, 'active', () => { nieuw++; });
  assert.equal(obj.active, true, 'waarde overgenomen');
  obj.active = false;
  assert.equal(obj.active, false);
  assert.equal(oud, 1);
  assert.equal(nieuw, 1);
});

test('JSON en klonen bevatten de bewaakte vlaggen, in de oorspronkelijke volgorde', () => {
  const obj = { zoom: 1.5, dirty: true, active: false, pageType: 'unknown' };
  bewaakSchrijven(obj, 'dirty', () => {});
  bewaakSchrijven(obj, 'active', () => {});
  obj.active = true;
  assert.equal(JSON.stringify(obj), '{"zoom":1.5,"dirty":true,"active":true,"pageType":"unknown"}');
  assert.deepEqual(JSON.parse(JSON.stringify(obj)), { zoom: 1.5, dirty: true, active: true, pageType: 'unknown' });
  assert.deepEqual({ ...obj }, { zoom: 1.5, dirty: true, active: true, pageType: 'unknown' });
  assert.deepEqual(structuredClone(obj), { zoom: 1.5, dirty: true, active: true, pageType: 'unknown' });
  assert.deepEqual(Object.keys(obj), ['zoom', 'dirty', 'active', 'pageType']);
});
