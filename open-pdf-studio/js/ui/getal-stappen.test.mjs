// Zwevende stapknoppen voor getalvelden (#853), met een nagebootst document:
// tonen bij aanwijzen en focus, een klik stuurt dezelfde pijltoets als het
// toetsenbord, en velden die niet mogen of al knoppen hebben blijven kaal.
import assert from 'node:assert/strict';
import test from 'node:test';

import { installeerGetalStappen } from './getal-stappen.js';

class NepElement {
  constructor(doc, tag) {
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.kinderen = [];
    this.ouder = null;
    this.attrs = {};
    this.style = {};
    this.luisteraars = {};
    this.klassen = new Set();
    this.disabled = false;
    this.readOnly = false;
    this.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.gestuurd = [];
    this.classList = {
      add: (k) => this.klassen.add(k),
      remove: (k) => this.klassen.delete(k),
      contains: (k) => this.klassen.has(k),
    };
  }
  set className(v) { this.klassen = new Set(v.split(/\s+/).filter(Boolean)); }
  append(...kinderen) { for (const k of kinderen) { k.ouder = this; this.kinderen.push(k); } }
  remove() {
    if (this.ouder) this.ouder.kinderen = this.ouder.kinderen.filter((k) => k !== this);
    this.ouder = null;
  }
  contains(x) { for (let e = x; e; e = e.ouder) if (e === this) return true; return false; }
  get isConnected() { return this.doc.body.contains(this); }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  addEventListener(type, f) { (this.luisteraars[type] ||= []).push(f); }
  dispatchEvent(e) {
    this.gestuurd.push(e);
    for (const f of this.luisteraars[e.type] || []) f(e);
    return true;
  }
  matches(sel) {
    assert.equal(sel, 'input[data-getal]');
    return this.tagName === 'INPUT' && 'data-getal' in this.attrs;
  }
  closest(sel) {
    const gezocht = sel.split(',').map((s) => s.trim().replace(/^\./, ''));
    for (let e = this; e; e = e.ouder) if (gezocht.some((k) => e.klassen.has(k))) return e;
    return null;
  }
  focus() {
    this.doc.activeElement = this;
    this.doc.vuur('focusin', { target: this });
  }
  getBoundingClientRect() { return this.rect; }
  klik() { for (const f of this.luisteraars.click || []) f({ type: 'click' }); }
}

function nepDocument() {
  const frames = [];
  const doc = {
    luisteraars: {},
    activeElement: null,
    geraakt: null,
    mutatie: null,
    createElement: (tag) => new NepElement(doc, tag),
    addEventListener(type, f) { (this.luisteraars[type] ||= []).push(f); },
    vuur(type, e) { for (const f of this.luisteraars[type] || []) f({ type, ...e }); },
    elementFromPoint() { return doc.geraakt; },
    frame() { while (frames.length) frames.shift()(); },
  };
  doc.body = new NepElement(doc, 'body');
  doc.defaultView = {
    KeyboardEvent: class { constructor(type, o) { Object.assign(this, { type }, o); } },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    getComputedStyle: () => ({ direction: 'ltr' }),
    addEventListener() {},
    MutationObserver: class {
      constructor(f) { doc.mutatie = f; }
      observe() {}
    },
  };
  return doc;
}

function opzet() {
  const doc = nepDocument();
  installeerGetalStappen(doc);
  const knoppen = doc.body.kinderen[0];
  const veld = (attrs = {}, ouder = doc.body) => {
    const el = doc.createElement('input');
    el.setAttribute('data-getal', '');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.rect = { left: 100, top: 50, right: 180, bottom: 72, width: 80, height: 22 };
    ouder.append(el);
    return el;
  };
  const wijsAan = (el, geraakt = el) => {
    doc.geraakt = geraakt;
    doc.vuur('pointerover', { target: el });
    doc.frame();
  };
  return { doc, knoppen, veld, wijsAan };
}

test('hover shows the buttons at the inner edge of the field', () => {
  const { knoppen, veld, wijsAan } = opzet();
  const el = veld({ 'aria-label': 'Overlap', step: '0.5' });
  assert.equal(knoppen.style.display, 'none');
  wijsAan(el);
  assert.equal(knoppen.style.display, 'flex');
  assert.equal(knoppen.style.left, '163px');
  assert.equal(knoppen.style.top, '51px');
  assert.ok(el.classList.contains('numeric-field-stepping'));
  assert.equal(knoppen.kinderen[0].getAttribute('aria-label'), 'Overlap +0.5');
  assert.equal(knoppen.kinderen[1].getAttribute('aria-label'), 'Overlap −0.5');
});

test('a step click focuses the field, sends the arrow key and keeps the buttons', () => {
  const { doc, knoppen, veld, wijsAan } = opzet();
  const el = veld();
  wijsAan(el);
  knoppen.kinderen[0].klik();
  assert.equal(doc.activeElement, el);
  // Focusing the hovered field must not hide its buttons, not even for a frame.
  assert.equal(knoppen.style.display, 'flex');
  assert.ok(el.classList.contains('numeric-field-stepping'));
  assert.deepEqual(el.gestuurd.map((e) => `${e.type}:${e.key}:${e.bubbles}:${e.cancelable}`),
    ['keydown:ArrowUp:true:true']);
  knoppen.kinderen[1].klik();
  assert.equal(el.gestuurd.at(-1).key, 'ArrowDown');
});

test('focus moving to another numeric field moves the buttons along', () => {
  const { doc, knoppen, veld, wijsAan } = opzet();
  const a = veld();
  const b = veld();
  b.rect = { left: 300, top: 90, right: 360, bottom: 112, width: 60, height: 22 };
  wijsAan(a);
  doc.geraakt = b;
  b.focus();
  doc.frame();
  assert.ok(!a.classList.contains('numeric-field-stepping'));
  assert.ok(b.classList.contains('numeric-field-stepping'));
  assert.equal(knoppen.style.left, '343px');
});

test('disabled, read-only and fields with their own buttons get no floating buttons', () => {
  const { doc, knoppen, veld, wijsAan } = opzet();
  const uit = veld();
  uit.disabled = true;
  const alleenLezen = veld();
  alleenLezen.readOnly = true;
  for (const klasse of ['number-stepper', 'watermark-spin']) {
    const omhulsel = doc.createElement('span');
    omhulsel.className = klasse;
    doc.body.append(omhulsel);
    wijsAan(veld({}, omhulsel));
    assert.equal(knoppen.style.display, 'none', klasse);
  }
  for (const el of [uit, alleenLezen]) {
    wijsAan(el);
    assert.equal(knoppen.style.display, 'none');
  }
  // A plain text field is no numeric field.
  const tekst = doc.createElement('input');
  doc.body.append(tekst);
  wijsAan(tekst);
  assert.equal(knoppen.style.display, 'none');
});

test('covered or removed fields leave no clickable buttons behind', () => {
  const { doc, knoppen, veld, wijsAan } = opzet();
  const el = veld();
  wijsAan(el, doc.body); // a dialog or panel lies over the field
  assert.equal(knoppen.style.display, 'none');

  wijsAan(el);
  assert.equal(knoppen.style.display, 'flex');
  el.remove();
  doc.mutatie([]);
  assert.equal(knoppen.style.display, 'none');
  // A click after removal does nothing.
  knoppen.kinderen[0].klik();
  assert.deepEqual(el.gestuurd, []);
});
