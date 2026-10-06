// Tekenen van proefleescorrecties (#508) op het canvas: het invoegteken heeft
// dezelfde vorm als zijn appearance in de PDF (correction-dicts.js), zodat
// scherm, afdruk en miniaturen gelijk zijn. De doorhaling van verticale tekst
// loopt langs de tekst, niet er dwars doorheen.

import assert from 'node:assert/strict';
import test from 'node:test';

import { drawCaret, strikeLine, replaceStrikeColor } from './caret.js';
import { caretGlyphPoints, quadCorners, quadMidline } from '../corrections/geometry.js';

/** Canvas-stub die het pad en de vulling vastlegt. */
function stubCtx() {
  const ops = [];
  return {
    ops,
    fillStyle: null,
    beginPath() { ops.push(['begin']); },
    moveTo(x, y) { ops.push(['move', x, y]); },
    lineTo(x, y) { ops.push(['line', x, y]); },
    closePath() { ops.push(['close']); },
    fill() { ops.push(['fill', this.fillStyle]); },
    stroke() { ops.push(['stroke']); },
  };
}

const KARET = { type: 'caret', page: 1, x: 87, y: 94.8, width: 6, height: 6, textDir: 0, color: '#0066FF' };

test('het invoegteken vult precies de punten van zijn appearance, in zijn kleur', () => {
  for (const textDir of [0, 90, 180, 270]) {
    const ctx = stubCtx();
    drawCaret(ctx, { ...KARET, textDir }, '#9900CC');
    const punten = caretGlyphPoints(KARET, textDir);
    assert.deepEqual(ctx.ops, [
      ['begin'],
      ['move', punten[0].x, punten[0].y],
      ['line', punten[1].x, punten[1].y],
      ['line', punten[2].x, punten[2].y],
      ['line', punten[3].x, punten[3].y],
      ['close'],
      ['fill', '#9900CC'],
    ], `textDir ${textDir}`);
  }
});

test('zonder kleur valt het invoegteken terug op de standaardkleur van zijn soort', () => {
  const invoegen = stubCtx();
  drawCaret(invoegen, { ...KARET, color: undefined });
  assert.deepEqual(invoegen.ops.at(-1), ['fill', '#0066FF']);
  const vervangen = stubCtx();
  drawCaret(vervangen, { ...KARET, color: undefined, intent: 'Replace' });
  assert.deepEqual(vervangen.ops.at(-1), ['fill', '#9900CC']);
});

test('een invoegteken zonder vak tekent niets', () => {
  const ctx = stubCtx();
  drawCaret(ctx, { ...KARET, width: 0 }, '#0066FF');
  assert.deepEqual(ctx.ops, []);
});

test('de top van het invoegteken wijst bij verticale tekst opzij, niet omhoog', () => {
  const ctx = stubCtx();
  drawCaret(ctx, { ...KARET, textDir: 90 }, '#0066FF');
  const [, top] = ctx.ops;
  // textDir 90: de bovenkant van de tekst ligt rechts (+x).
  assert.equal(top[1], KARET.x + KARET.width);
  assert.equal(top[2], KARET.y + KARET.height / 2);
});

test('doorhaling: horizontaal door het midden zoals voorheen, behalve bij verticale tekst', () => {
  const rect = { x: 72, y: 90, width: 18, height: 12 };
  const zoalsVoorheen = [{ x: 72, y: 96 }, { x: 90, y: 96 }];
  assert.deepEqual(strikeLine(rect, undefined), zoalsVoorheen);
  assert.deepEqual(strikeLine(rect, 0), zoalsVoorheen);
  assert.deepEqual(strikeLine(rect, 180), zoalsVoorheen);

  const staand = { x: 90, y: 72, width: 12, height: 18 };
  for (const textDir of [90, 270]) {
    const lijn = strikeLine(staand, textDir);
    assert.deepEqual(lijn, quadMidline(quadCorners(staand, textDir)), `textDir ${textDir}`);
    assert.equal(lijn[0].x, 96, 'de lijn loopt door het midden van de kolom');
    assert.equal(lijn[1].x, 96);
    assert.equal(Math.abs(lijn[1].y - lijn[0].y), 18, 'over de hele lengte van de tekst');
  }
});

test('de doorhaling van een vervanging krijgt de kleur van haar invoegteken, zoals bij het opslaan', () => {
  const k = { id: 'k', type: 'caret', intent: 'Replace', color: '#00AA00' };
  const s = { id: 's', type: 'textStrikethrough', inReplyTo: 'k', replyType: 'group', color: '#FF0000' };
  assert.equal(replaceStrikeColor(s, [k, s]), '#00AA00');
  assert.equal(replaceStrikeColor({ ...s, replyType: 'Group' }, [k, s]), '#00AA00', 'replyType zoals pdf.js hem geeft');
  assert.equal(replaceStrikeColor(s, [{ ...k, color: undefined }, s]), '#9900CC', 'zonder kleur de standaard van vervangen');
  assert.equal(replaceStrikeColor(s, [s]), null, 'zonder invoegteken: eigen kleur');
  assert.equal(replaceStrikeColor(s, [{ id: 'k', type: 'box', color: '#123456' }, s]), null, 'een groep met iets anders');
  assert.equal(replaceStrikeColor({ ...s, replyType: undefined }, [k, s]), null, 'een gewoon antwoord');
  assert.equal(replaceStrikeColor({ id: 'h', type: 'textHighlight', inReplyTo: 'k', replyType: 'group' }, [k]), null);
  assert.equal(replaceStrikeColor(s, null), null);
});
