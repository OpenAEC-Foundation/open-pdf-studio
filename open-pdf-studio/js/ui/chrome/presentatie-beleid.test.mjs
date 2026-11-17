// Presentation view: which view to return to, which keys turn pages, and
// where a page turn ends.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { weergaveNaam, presentatieActie, doelPagina, isTypend } from './presentatie-beleid.js';

test('the view to return to is named the way setViewMode takes it', () => {
  assert.equal(weergaveNaam({ viewMode: 'single' }), 'single');
  assert.equal(weergaveNaam({ viewMode: 'continuous' }), 'continuous');
  assert.equal(weergaveNaam({ viewMode: 'continuous', bookSpread: true }), 'book');
  assert.equal(weergaveNaam({ viewMode: 'continuous', facingSpread: true }), 'facing');
  assert.equal(weergaveNaam(null), 'single');
});

test('arrow and page keys turn pages; modifiers, typing and dialogs leave the key alone', () => {
  assert.equal(presentatieActie({ key: 'ArrowRight' }), 'next');
  assert.equal(presentatieActie({ key: 'PageDown' }), 'next');
  assert.equal(presentatieActie({ key: 'ArrowLeft' }), 'prev');
  assert.equal(presentatieActie({ key: 'PageUp' }), 'prev');
  assert.equal(presentatieActie({ key: 'Home' }), 'first');
  assert.equal(presentatieActie({ key: 'End' }), 'last');
  assert.equal(presentatieActie({ key: 'a' }), null);
  assert.equal(presentatieActie({ key: ' ' }), null, 'Space stays the pan key');
  assert.equal(presentatieActie({ key: 'ArrowRight', ctrlKey: true }), null);
  assert.equal(presentatieActie({ key: 'ArrowRight', shiftKey: true }), null);
  assert.equal(presentatieActie({ key: 'ArrowRight' }, { typend: true }), null);
  assert.equal(presentatieActie({ key: 'ArrowRight' }, { dialoogOpen: true }), null);
});

test('a page turn stays inside the document', () => {
  assert.equal(doelPagina('next', 1, 3), 2);
  assert.equal(doelPagina('next', 3, 3), 3);
  assert.equal(doelPagina('prev', 1, 3), 1);
  assert.equal(doelPagina('prev', 3, 3), 2);
  assert.equal(doelPagina('first', 2, 3), 1);
  assert.equal(doelPagina('last', 2, 3), 3);
  assert.equal(doelPagina('next', 1, 0), 1);
});

test('typing is recognised by the focused element', () => {
  assert.equal(isTypend({ tagName: 'INPUT' }), true);
  assert.equal(isTypend({ tagName: 'textarea' }), true);
  assert.equal(isTypend({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypend({ tagName: 'CANVAS' }), false);
  assert.equal(isTypend(null), false);
});

test('full screen switches the presentation view on and off with the real window state', () => {
  const bron = fs.readFileSync(new URL('./fullscreen.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(bron, /zetPresentatie\(/);
  // Every place that records the window state goes through one function.
  const rest = bron.replace(/function zetStand[\s\S]*?\n}\n/, '');
  assert.doesNotMatch(rest, /setIsFullscreen\(/, 'state is recorded through zetStand only');
});

test('the presentation view hides the working interface', () => {
  const css = fs.readFileSync(new URL('../../../styles/layout.css', import.meta.url), 'utf8');
  for (const deel of ['.title-bar', '.ribbon-container', '.document-tabs', '.status-bar']) {
    assert.ok(new RegExp(`\\.presentation-mode \\${deel}\\b`).test(css), deel);
  }
});
