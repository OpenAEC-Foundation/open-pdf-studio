// Esc in het voortgangsvenster = Annuleren (#766).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { koppelEscAnnuleren, isAnnuleerToets } from './laad-annuleren.js';

function toets(key, extra = {}) {
  const e = new Event('keydown', { cancelable: true });
  Object.defineProperty(e, 'key', { value: key });
  if (extra.repeat) Object.defineProperty(e, 'repeat', { value: true });
  return e;
}

function opstelling({ open = true, kan = true } = {}) {
  const doel = new EventTarget();
  const toestand = { open, kan, geannuleerd: 0, doorgelaten: 0 };
  const los = koppelEscAnnuleren(doel, {
    open: () => toestand.open, kan: () => toestand.kan, annuleer: () => { toestand.geannuleerd++; },
  });
  // Een andere Esc-luisteraar van de app (gereedschap, dialoog).
  doel.addEventListener('keydown', () => { toestand.doorgelaten++; });
  return { doel, toestand, los };
}

test('Esc cancels while the dialog offers Cancel, and does not reach the rest of the app', () => {
  const { doel, toestand } = opstelling();
  const e = toets('Escape');
  doel.dispatchEvent(e);
  assert.equal(toestand.geannuleerd, 1);
  assert.equal(toestand.doorgelaten, 0);
  assert.equal(e.defaultPrevented, true);
});

test('Esc without a cancellable dialog passes through', () => {
  const { doel, toestand } = opstelling({ open: false });
  doel.dispatchEvent(toets('Escape'));
  assert.equal(toestand.geannuleerd, 0);
  assert.equal(toestand.doorgelaten, 1);
});

test('past the point of no return Esc is swallowed but cancels nothing', () => {
  const { doel, toestand } = opstelling({ kan: false });
  doel.dispatchEvent(toets('Escape'));
  assert.equal(toestand.geannuleerd, 0);
  assert.equal(toestand.doorgelaten, 0);
});

test('other keys, held-down Esc and a detached listener do nothing', () => {
  const { doel, toestand, los } = opstelling();
  doel.dispatchEvent(toets('Enter'));
  doel.dispatchEvent(toets('Escape', { repeat: true }));
  assert.equal(toestand.geannuleerd, 0);
  los();
  doel.dispatchEvent(toets('Escape'));
  assert.equal(toestand.geannuleerd, 0);
  assert.equal(isAnnuleerToets({ key: 'Esc' }), true);
});

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the loading overlay wires Esc and disables the button past the point of no return', () => {
  const overlay = bron('../../solid/components/LoadingOverlay.jsx');
  assert.match(overlay, /koppelEscAnnuleren\(window,/);
  assert.match(overlay, /cancelDisabled\(\)/);
  assert.match(overlay, /disabled=\{!kanAnnuleren\(\)\}/);
  // Movable like a modal, no click-outside handler on the backdrop, no cursor change.
  assert.match(overlay, /onMouseDown=\{opNeer\}/);
  assert.doesNotMatch(overlay, /cursor\s*[:=]/);
  assert.doesNotMatch(overlay, /class="loading-overlay"[^>]*onClick/);
  const dialogs = bron('./dialogs.js');
  assert.match(dialogs, /setCancelDisabled\(!!annulerenUit\)/);
  assert.match(dialogs, /setCancelDisabled\(false\)/);
});
