// Statusbadge op de markering (#1076): waar hij staat, welke kleur hij heeft,
// en dat hij alleen op het scherm komt en niet in het opgeslagen uiterlijk.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { statusBadge, tekenStatusBadges, BADGE_PIXELS } from './status-badge.js';
import { statusLijst } from './status-sets.js';

const LIJST = statusLijst({
  markupStatusSets: [{ name: 'Bouwteam', statuses: [{ name: 'Approved', color: '#00aa00', closed: true }] }],
  activeMarkupStatusSet: 'Bouwteam',
});
const VAK = { x: 100, y: 200, width: 50, height: 30 };

test('de badge ligt op de rechterbovenhoek en is op het scherm altijd even groot', () => {
  assert.deepEqual(statusBadge({ status: 'Approved' }, LIJST, VAK, 1),
    { x: 150 - BADGE_PIXELS / 2, y: 200 - BADGE_PIXELS / 2, maat: BADGE_PIXELS, kleur: '#00aa00' });
  const groot = statusBadge({ status: 'approved' }, LIJST, VAK, 3);
  assert.equal(groot.maat, BADGE_PIXELS / 3);
  assert.equal(groot.x + groot.maat / 2, 150);
  assert.equal(groot.y + groot.maat / 2, 200);
});

test('de kleur volgt de status: vast, eigen of onbekend; zonder status geen badge', () => {
  assert.equal(statusBadge({ status: 'rejected' }, LIJST, VAK, 1).kleur, '#ef4444');
  assert.equal(statusBadge({ status: 'needs info' }, LIJST, VAK, 1).kleur, '#888888');
  assert.equal(statusBadge({}, LIJST, VAK, 1), null);
  assert.equal(statusBadge({ status: 'none' }, LIJST, VAK, 1), null);
  assert.equal(statusBadge({ status: 'approved' }, LIJST, null, 1), null);
  assert.equal(statusBadge({ status: 'approved' }, LIJST, { x: NaN, y: 0, width: 1, height: 1 }, 1), null);
});

function nepCanvas(schaal = 2) {
  const log = [];
  return {
    log,
    getTransform: () => ({ a: schaal, b: 0, c: 0, d: schaal, e: 0, f: 0 }),
    save: () => log.push(['save']),
    restore: () => log.push(['restore']),
    setLineDash: () => {},
    fillRect(x, y, w, h) { log.push(['fill', this.fillStyle, x, y, w, h]); },
    strokeRect() { log.push(['stroke']); },
  };
}

test('tekenen: alleen markeringen met een status op deze pagina die zichtbaar zijn', () => {
  const ctx = nepCanvas(4);
  const anns = [
    { id: 'a', page: 1, status: 'approved' },
    { id: 'b', page: 1 },
    { id: 'c', page: 2, status: 'approved' },
    { id: 'd', page: 1, status: 'completed', hidden: true },
    { id: 'e', page: 1, status: 'rejected' },
  ];
  const aantal = tekenStatusBadges(ctx, anns, 1, {
    lijst: LIJST, grenzen: () => VAK, verborgen: (a) => !!a.hidden, dpr: 2,
  });
  assert.equal(aantal, 2);
  const kleuren = ctx.log.filter((r) => r[0] === 'fill' && r[1] !== '#ffffff');
  assert.deepEqual(kleuren.map((r) => r[1]), ['#00aa00', '#ef4444']);
  // 4 apparaatpixels per eenheid bij dpr 2 = 2 schermpixels per eenheid.
  assert.equal(kleuren[0][4], BADGE_PIXELS / 2);
  assert.deepEqual([ctx.log[0][0], ctx.log.at(-1)[0]], ['save', 'restore'], 'de toestand van het canvas blijft zoals hij was');
});

test('tekenen zonder omhullende of met een falende omhullende slaat de markering over', () => {
  const ctx = nepCanvas();
  const anns = [{ page: 1, status: 'approved' }, { page: 1, status: 'rejected' }];
  let n = 0;
  const aantal = tekenStatusBadges(ctx, anns, 1, { lijst: LIJST, grenzen: () => { if (n++ === 0) throw new Error('stuk'); return null; } });
  assert.equal(aantal, 0);
  assert.equal(tekenStatusBadges(null, anns, 1, { grenzen: () => VAK }), 0);
});

test('de voorkeur staat standaard uit', () => {
  const bron = readFileSync(new URL('../core/constants.ts', import.meta.url), 'utf8');
  assert.match(bron, /\n\s*showStatusBadges: false,/);
});

test('de badge hoort bij het scherm: niet in drawAnnotation, niet in uitvoer, niet in de saver', () => {
  const bron = readFileSync(new URL('../annotations/rendering.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const aanroepen = [...bron.matchAll(/tekenStatusBadgesOpScherm\(/g)].length;
  assert.equal(aanroepen, 3, 'de functie zelf, de enkele pagina en de doorlopende weergave');
  const start = bron.indexOf('export function drawAnnotation(');
  const eind = bron.indexOf('\nfunction drawTextEdits(');
  assert.ok(start > 0 && eind > start);
  assert.equal(bron.slice(start, eind).includes('tekenStatusBadges'), false, 'drawAnnotation tekent ook het opgeslagen uiterlijk');
  // In de doorlopende weergave alleen als het een schermrendering is.
  assert.match(bron, /if \(lagen\.schermlijndikte && lagen\.markeringen\) tekenStatusBadgesOpScherm\(/);
  for (const pad of ['../pdf/saver.js', '../pdf/exporter.js']) {
    assert.equal(readFileSync(new URL(pad, import.meta.url), 'utf8').includes('status-badge'), false, pad);
  }
});
