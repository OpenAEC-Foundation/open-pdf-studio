// Slepen op een getalveld (#1168), met een nagebootst document: de sleep
// begint op het label of op een veld zonder focus, na 4 px; de waarde gaat
// via input en change; Escape herstelt; een klik geeft focus; een vinger en
// een veld buiten een sleepgebied doen niets.
import assert from 'node:assert/strict';
import test from 'node:test';

import { installeerGetalSlepen, veldBijLabel, sleeptMee } from './getal-slepen.js';
import { PIXELS_PER_STAP as P } from '../core/getal-slepen.js';

function past(el, selector) {
  return selector.split(',').some((deel) => {
    const m = /^\s*([a-z]+)?(?:\[([a-z-]+)\])?\s*$/i.exec(deel);
    assert.ok(m, `onbekende selector ${deel}`);
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !(m[2] in el.attrs)) return false;
    return true;
  });
}

class NepElement {
  constructor(doc, tag, attrs = {}) {
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.kinderen = [];
    this.ouder = null;
    this.tekst = '';
    this.disabled = false;
    this.readOnly = false;
    this.events = [];
    this.gevangen = null;
    this.geselecteerd = false;
  }
  append(...k) { for (const x of k) { x.ouder = this; this.kinderen.push(x); } return this; }
  get isConnected() { for (let e = this; e; e = e.ouder) if (e === this.doc.body) return true; return false; }
  get nextElementSibling() {
    const rij = this.ouder?.kinderen || [];
    return rij[rij.indexOf(this) + 1] || null;
  }
  get control() { return this.kinderen.find((k) => past(k, 'input, select, textarea')) || null; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  hasAttribute(n) { return n in this.attrs; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  matches(sel) { return past(this, sel); }
  closest(sel) { for (let e = this; e; e = e.ouder) if (past(e, sel)) return e; return null; }
  querySelector(sel) {
    for (const k of this.kinderen) {
      if (past(k, sel)) return k;
      const diep = k.querySelector(sel);
      if (diep) return diep;
    }
    return null;
  }
  dispatchEvent(e) { this.events.push(e.type); this.opEvent?.(e); return true; }
  setPointerCapture(id) { this.gevangen = id; }
  releasePointerCapture() { this.gevangen = null; }
  focus() { this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  select() { this.geselecteerd = true; }
}

class NepEvent { constructor(type) { this.type = type; } }

function opstelling({ taal = 'nl' } = {}) {
  const luisteraars = {};
  const doc = {
    addEventListener(type, f) { (luisteraars[type] ||= []).push(f); },
    defaultView: {
      Event: NepEvent,
      addEventListener(type, f) { (luisteraars[`win:${type}`] ||= []).push(f); },
      getSelection: () => ({ removeAllRanges() {} }),
    },
  };
  doc.body = new NepElement(doc, 'body');
  doc.activeElement = doc.body;
  const log = [];
  const sleper = installeerGetalSlepen(doc, {
    leesTekst: (el) => el.tekst,
    schrijfTekst: (el, t) => { el.tekst = t; },
    taal: () => taal,
    hint: () => 'Sleep om te wijzigen',
    begin: () => log.push('begin'),
    einde: ({ geannuleerd }) => log.push(geannuleerd ? 'geannuleerd' : 'klaar'),
  });
  const stuur = (type, e = {}) => {
    const ev = {
      type: type.replace('win:', ''), button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      clientX: 0, clientY: 0, voorkomen: false, gestopt: false,
      preventDefault() { this.voorkomen = true; }, stopPropagation() { this.gestopt = true; },
      ...e,
    };
    for (const f of luisteraars[type] || []) f(ev);
    return ev;
  };
  const paneel = new NepElement(doc, 'div', { 'data-getal-sleep': '' });
  doc.body.append(paneel);
  const groep = (attrs = {}, tekst = '14') => {
    const g = new NepElement(doc, 'div');
    const label = new NepElement(doc, 'label');
    const veld = new NepElement(doc, 'input', { 'data-getal': '', ...attrs });
    veld.tekst = tekst;
    g.append(label, veld);
    paneel.append(g);
    return { label, veld };
  };
  return { doc, stuur, groep, paneel, log, sleper };
}

test('het veld bij een label: het eerste veld erna, tot het volgende label', () => {
  const { doc, groep } = opstelling();
  const { label, veld } = groep();
  assert.equal(veldBijLabel(label), veld);
  // Een keuzelijst vóór het getalveld: het label hoort bij de keuzelijst.
  const g = new NepElement(doc, 'div');
  const l2 = new NepElement(doc, 'label');
  g.append(l2, new NepElement(doc, 'select'), new NepElement(doc, 'input', { 'data-getal': '' }));
  assert.equal(veldBijLabel(l2), null);
  // Een veld in een omhulsel (keuzeveld met pijl).
  const g3 = new NepElement(doc, 'div');
  const l3 = new NepElement(doc, 'label');
  const binnen = new NepElement(doc, 'input', { 'data-getal': '' });
  g3.append(l3, new NepElement(doc, 'div').append(binnen), new NepElement(doc, 'label'));
  assert.equal(veldBijLabel(l3), binnen);
});

test('alleen velden in een sleepgebied doen mee', () => {
  const { doc, groep, paneel } = opstelling();
  const { veld } = groep();
  assert.equal(sleeptMee(veld), true);
  veld.disabled = true;
  assert.equal(sleeptMee(veld), false);
  veld.disabled = false;
  paneel.attrs['data-getal-sleep'] = 'uit';
  assert.equal(sleeptMee(veld), false);
  const los = new NepElement(doc, 'input', { 'data-getal': '' });
  doc.body.append(los);
  assert.equal(sleeptMee(los), false);
});

test('slepen op het label verandert de waarde live en bevestigt bij loslaten', () => {
  const { stuur, groep, log, sleper } = opstelling();
  const { label, veld } = groep({ step: '1', min: '1', max: '999' });
  stuur('pointerdown', { target: label, clientX: 100, clientY: 50 });
  stuur('pointermove', { target: label, clientX: 102, clientY: 50 });
  assert.equal(sleper.isBezig(), false, 'onder de drempel');
  assert.deepEqual(veld.events, []);
  stuur('pointermove', { target: label, clientX: 100 + 10 * P, clientY: 51 });
  assert.equal(sleper.isBezig(), true);
  assert.equal(label.gevangen, 1, 'de aanwijzer is gevangen');
  assert.equal(veld.tekst, '24');
  assert.deepEqual(veld.events, ['input']);
  assert.deepEqual(log, ['begin']);
  stuur('pointermove', { target: label, clientX: 100 + 10 * P, clientY: 51 });
  assert.deepEqual(veld.events, ['input'], 'geen event zonder verandering');
  stuur('pointermove', { target: label, clientX: 100 - 3 * P, clientY: 400 });
  assert.equal(veld.tekst, '11', 'de as ligt vast: omlaag telt niet meer');
  stuur('pointerup', { target: label, clientX: 100 - 3 * P, clientY: 400 });
  assert.equal(sleper.isBezig(), false);
  assert.equal(label.gevangen, null);
  assert.deepEqual(veld.events, ['input', 'input', 'change']);
  assert.deepEqual(log, ['begin', 'klaar']);
  const klik = stuur('click', { target: label });
  assert.equal(klik.voorkomen && klik.gestopt, true, 'de klik na de sleep geeft het veld geen focus');
  assert.equal(stuur('click', { target: label }).voorkomen, false, 'een latere klik is weer gewoon');
});

test('omhoog is meer; Shift sneller, Alt fijner, in de notatie van de taal', () => {
  const { stuur, groep } = opstelling();
  const { label, veld } = groep({}, '10');
  stuur('pointerdown', { target: label, clientX: 0, clientY: 100 });
  stuur('pointermove', { target: label, clientX: 1, clientY: 100 - 4 * P });
  assert.equal(veld.tekst, '14');
  stuur('pointermove', { target: label, clientX: 1, clientY: 100 - 6 * P, shiftKey: true });
  assert.equal(veld.tekst, '34');
  stuur('pointermove', { target: label, clientX: 1, clientY: 100 - 9 * P, altKey: true });
  assert.equal(veld.tekst, '34,3');
  stuur('pointerup', { target: label });
});

test('Escape zet de beginwaarde terug', () => {
  const { stuur, groep, log, sleper } = opstelling();
  const { label, veld } = groep({}, '2,5');
  stuur('pointerdown', { target: label, clientX: 0, clientY: 0 });
  stuur('pointermove', { target: label, clientX: 5 * P, clientY: 0 });
  assert.equal(veld.tekst, '3');
  const esc = stuur('win:keydown', { key: 'Escape' });
  assert.equal(esc.voorkomen && esc.gestopt, true);
  assert.equal(sleper.isBezig(), false);
  assert.equal(veld.tekst, '2,5');
  assert.deepEqual(veld.events, ['input', 'input'], 'terug via input, geen change');
  assert.deepEqual(log, ['begin', 'geannuleerd']);
  stuur('pointermove', { target: label, clientX: 50, clientY: 0 });
  assert.equal(veld.tekst, '2,5', 'verder bewegen doet niets meer');
});

test('een klik op een veld zonder focus geeft focus om te typen', () => {
  const { doc, stuur, groep, log } = opstelling();
  const { veld } = groep();
  stuur('pointerdown', { target: veld, clientX: 10, clientY: 10 });
  const md = stuur('mousedown', { target: veld });
  assert.equal(md.voorkomen, true, 'nog geen focus bij het indrukken');
  stuur('pointermove', { target: veld, clientX: 12, clientY: 11 });
  stuur('pointerup', { target: veld, clientX: 12, clientY: 11 });
  assert.equal(doc.activeElement, veld);
  assert.equal(veld.geselecteerd, true);
  assert.deepEqual(veld.events, []);
  assert.deepEqual(log, []);
  assert.equal(stuur('click', { target: veld }).voorkomen, false);
});

test('slepen op een veld zonder focus sleept; met focus niet', () => {
  const { doc, stuur, groep } = opstelling();
  const { veld } = groep({ 'data-step': '0.1' }, '1');
  stuur('pointerdown', { target: veld, clientX: 10, clientY: 10 });
  stuur('mousedown', { target: veld });
  stuur('pointermove', { target: veld, clientX: 10 + 5 * P, clientY: 10 });
  assert.equal(veld.tekst, '1,5');
  stuur('pointerup', { target: veld });
  assert.notEqual(doc.activeElement, veld, 'na een sleep krijgt het veld geen focus');
  veld.focus();
  veld.events.length = 0;
  stuur('pointerdown', { target: veld, clientX: 10, clientY: 10 });
  assert.equal(stuur('mousedown', { target: veld }).voorkomen, false, 'tekst selecteren blijft werken');
  stuur('pointermove', { target: veld, clientX: 60, clientY: 10 });
  assert.deepEqual(veld.events, []);
  assert.equal(veld.tekst, '1,5');
});

test('een vinger, een leeg veld en een uitgeschakeld veld slepen niet', () => {
  const { stuur, groep } = opstelling();
  const a = groep();
  stuur('pointerdown', { target: a.label, pointerType: 'touch' });
  stuur('pointermove', { target: a.label, clientX: 40, pointerType: 'touch' });
  assert.deepEqual(a.veld.events, []);
  stuur('pointerup', { target: a.label, pointerType: 'touch' });
  const leeg = groep({}, '');
  stuur('pointerdown', { target: leeg.label });
  stuur('pointermove', { target: leeg.label, clientX: 40 });
  assert.deepEqual(leeg.veld.events, [], 'gemengd of leeg: geen beginwaarde');
  stuur('pointerup', { target: leeg.label });
  const uit = groep();
  uit.veld.disabled = true;
  stuur('pointerdown', { target: uit.label });
  stuur('pointermove', { target: uit.label, clientX: 40 });
  assert.deepEqual(uit.veld.events, []);
});

test('hele getallen, grenzen en een voet-inchmaat', () => {
  const { stuur, groep } = opstelling({ taal: 'en' });
  const heel = groep({ 'data-geheel': '', step: '1', min: '1', max: '5' }, '3');
  stuur('pointerdown', { target: heel.label });
  stuur('pointermove', { target: heel.label, clientX: 5 * P, altKey: true });
  assert.equal(heel.veld.tekst, '5', 'Alt blijft hele stappen, max begrenst');
  stuur('pointerup', { target: heel.label });
  const grens = groep({ 'data-min': '0', 'data-max': '100' }, '98');
  stuur('pointerdown', { target: grens.label });
  stuur('pointermove', { target: grens.label, clientX: 30 * P });
  assert.equal(grens.veld.tekst, '100');
  stuur('pointerup', { target: grens.label });
  const maat = groep({ 'data-getal': 'lengte', min: '1' }, `12'-6"`);
  stuur('pointerdown', { target: maat.label });
  stuur('pointermove', { target: maat.label, clientX: 7 * P });
  assert.equal(maat.veld.tekst, `13'-1"`);
  stuur('pointerup', { target: maat.label });
});

test('pointercancel, verloren vangst en een losgelaten knop beëindigen de sleep', () => {
  for (const einde of ['pointercancel', 'lostpointercapture', 'win:blur', 'knop-los']) {
    const { stuur, groep, log, sleper } = opstelling();
    const { label, veld } = groep();
    stuur('pointerdown', { target: label });
    stuur('pointermove', { target: label, clientX: 4 * P });
    assert.equal(sleper.isBezig(), true, einde);
    if (einde === 'knop-los') stuur('pointermove', { target: label, clientX: 9 * P, buttons: 0 });
    else stuur(einde, einde === 'win:blur' ? { pointerId: undefined } : {});
    assert.equal(sleper.isBezig(), false, einde);
    assert.equal(veld.tekst, '18', `${einde}: de waarde blijft staan`);
    assert.deepEqual(log, ['begin', 'klaar'], einde);
  }
});

test('het label krijgt de tooltip, een ander label niet', () => {
  const { doc, stuur, groep } = opstelling();
  const { label } = groep();
  stuur('pointerover', { target: label });
  assert.equal(label.getAttribute('title'), 'Sleep om te wijzigen');
  const eigen = groep();
  eigen.label.setAttribute('title', 'Eigen uitleg');
  stuur('pointerover', { target: eigen.label });
  assert.equal(eigen.label.getAttribute('title'), 'Eigen uitleg');
  const los = new NepElement(doc, 'label');
  doc.body.append(new NepElement(doc, 'div').append(los, new NepElement(doc, 'select')));
  stuur('pointerover', { target: los });
  assert.equal(los.getAttribute('title'), null);
});
