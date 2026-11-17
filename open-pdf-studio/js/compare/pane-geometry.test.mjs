// Compare panes on a very wide window (#1149): every edge of the page can be
// reached at every zoom, a zoom keeps the point under the cursor, both panes
// of side-by-side stay on the same part, and the page bitmap stays within
// what a canvas can hold.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PANE_PADDING, BASE_SCALE, MAX_ZOOM, MAX_BITMAP_EDGE, MAX_BITMAP_PX,
  axisLayout, legacyCentredOffset, anchoredScroll, contentFractionAt, mirrorScroll, cappedRenderScale, clampZoom,
} from './pane-geometry.js';

const PT_PER_MM = 72 / 25.4;
const A0 = { width: 1189 * PT_PER_MM, height: 841 * PT_PER_MM };
const A1 = { width: 841 * PT_PER_MM, height: 594 * PT_PER_MM };
const A4 = { width: 210 * PT_PER_MM, height: 297 * PT_PER_MM };

// A 5120 x 1440 window: the change list takes 260 px, the toolbar and tabs
// about 140 px of the height.
const WIDE = { width: 5120 - 260, height: 1440 - 140 };
const NORMAL = { width: 1920 - 260, height: 1080 - 140 };
const natural = (page) => ({ w: page.width * BASE_SCALE, h: page.height * BASE_SCALE });
const fitZoom = (pane, page) => {
  const n = natural(page);
  return Math.min((pane.width - 2 * PANE_PADDING) / n.w, (pane.height - 2 * PANE_PADDING) / n.h);
};

test('the former layout: zoomed in, the left part of the page lies outside the scroll area', () => {
  const n = natural(A0);
  // Fitted on the wide window the height decides, so the page is narrow in a
  // very wide pane and starts about 1500 px from the left edge.
  const fit = fitZoom(WIDE, A0);
  assert.ok(legacyCentredOffset(WIDE.width, n.w * fit) > 1400);
  // Zoomed in to 400 %: the page is four times as wide as the pane.
  const w = n.w * 4;
  const legacy = legacyCentredOffset(WIDE.width, w);
  assert.ok(legacy < -7000, `the page started at ${legacy}`);
  // The scroll position cannot go below 0, so that many pixels of the left
  // side (more than a third of the sheet) could not be shown.
  assert.ok(-legacy / w > 0.35);
  // The same fault on an ordinary screen, only sooner.
  assert.ok(legacyCentredOffset(NORMAL.width, n.w * 1) < 0);
});

test('every edge is reachable at every zoom, on a 5120 px wide and on an ordinary window', () => {
  for (const pane of [WIDE, NORMAL, { width: WIDE.width / 2, height: WIDE.height }]) {
    for (const page of [A0, A1, A4]) {
      const n = natural(page);
      for (let z = 0.1; z <= MAX_ZOOM + 1e-9; z *= 1.1) {
        for (const [size, content, centre] of [[pane.width, n.w * z, true], [pane.height, n.h * z, false]]) {
          const l = axisLayout(size, content, { centre });
          // Scrolled to the start, the first page pixel is inside the pane.
          assert.ok(l.offset >= PANE_PADDING - 1e-9, `start edge at zoom ${z}`);
          assert.ok(l.offset < size, `start edge visible at zoom ${z}`);
          // Scrolled to the end, the last page pixel is inside the pane.
          const end = l.offset + content - l.max;
          assert.ok(end <= size - PANE_PADDING + 1e-6 || l.max === 0, `end edge at zoom ${z}: ${end} in ${size}`);
          assert.ok(end > 0);
          // A page that fits is centred horizontally and needs no scrolling.
          if (content + 2 * PANE_PADDING <= size) {
            assert.equal(l.max, 0);
            if (centre) assert.ok(Math.abs((l.offset + content / 2) - size / 2) < 1e-6, 'centred');
          }
        }
      }
    }
  }
});

// The former zoom arithmetic: the point under the cursor was taken as
// scroll + cursor, without the distance from the pane edge to the page.
const legacyZoomScroll = (scroll, anchor, factor) => Math.max(0, (scroll + anchor) * factor - anchor);
// The former layout: always centred; only the half that sticks out on the
// right adds to the scroll range.
const legacyMax = (pane, content) => Math.max(0, (content + 2 * PANE_PADDING - pane) / 2);
const legacyFractionAt = (scroll, anchor, pane, content) => (scroll + anchor - legacyCentredOffset(pane, content)) / content;

test('zooming in on the wide window keeps the point under the cursor; the former arithmetic lost it', () => {
  const n = natural(A0);
  const pane = WIDE.width;
  const z0 = fitZoom(WIDE, A0);
  // The cursor over a point at a quarter of the sheet width.
  const cursor = axisLayout(pane, n.w * z0, { centre: true }).offset + 0.25 * n.w * z0;
  const inside = (s, zoom) => s > 0 && s < axisLayout(pane, n.w * zoom, { centre: true }).max;
  let z = z0;
  let scroll = 0;
  let legacyScroll = 0;
  let held = 0;
  let worstLegacy = 0;
  while (z < MAX_ZOOM) {
    const z1 = clampZoom(z * 1.1);
    const before = contentFractionAt(scroll, cursor, pane, n.w * z, { centre: true });
    const legacyBefore = legacyFractionAt(legacyScroll, cursor, pane, n.w * z);
    const next = anchoredScroll({ scroll, anchor: cursor, pane, content0: n.w * z, content1: n.w * z1, centre: true });
    // A browser clamps the scroll position to the range.
    const legacyNext = Math.min(legacyMax(pane, n.w * z1), legacyZoomScroll(legacyScroll, cursor, z1 / z));
    // While the page fits it is centred and grows about the middle of the
    // pane. From the moment it scrolls, the point under the cursor is held.
    if (inside(next, z1)) {
      const after = contentFractionAt(next, cursor, pane, n.w * z1, { centre: true });
      if (inside(scroll, z)) { assert.ok(Math.abs(after - before) < 1e-9, `zoom ${z1}: ${before} -> ${after}`); held++; }
    }
    const legacyAfter = legacyFractionAt(legacyNext, cursor, pane, n.w * z1);
    worstLegacy = Math.max(worstLegacy, Math.abs(legacyAfter - legacyBefore) * n.w * z1);
    scroll = next;
    legacyScroll = legacyNext;
    z = z1;
  }
  assert.ok(held >= 15, `held on ${held} steps`);
  // The former arithmetic on the former layout moved the sheet under the
  // cursor by more than two hundred pixels in one wheel step on this window.
  assert.ok(worstLegacy > 200, `the former arithmetic moved the sheet ${Math.round(worstLegacy)} px in one step`);
});

test('zoomed in at the left edge of the sheet, the left edge can still be scrolled to; zooming out stays in range', () => {
  const n = natural(A0);
  const pane = WIDE.width;
  let z = fitZoom(WIDE, A0);
  const cursor = axisLayout(pane, n.w * z, { centre: true }).offset; // on the left edge of the fitted page
  let scroll = 0;
  while (z < MAX_ZOOM) {
    const z1 = clampZoom(z * 1.1);
    scroll = anchoredScroll({ scroll, anchor: cursor, pane, content0: n.w * z, content1: n.w * z1, centre: true });
    z = z1;
    const l = axisLayout(pane, n.w * z, { centre: true });
    assert.ok(scroll >= 0 && scroll <= l.max);
    // Scrolled fully to the left, the left edge of the sheet is in view.
    assert.ok(l.offset - 0 >= PANE_PADDING - 1e-9 && l.offset < pane, `left edge at ${l.offset} for zoom ${z}`);
    // The former layout put it left of the scroll area as soon as the page was wider than the pane.
    if (l.max > 0) assert.ok(legacyCentredOffset(pane, n.w * z) < PANE_PADDING);
  }
  while (z > 0.1) {
    const z1 = clampZoom(z / 1.1);
    scroll = anchoredScroll({ scroll, anchor: cursor, pane, content0: n.w * z, content1: n.w * z1, centre: true });
    z = z1;
    const l = axisLayout(pane, n.w * z, { centre: true });
    assert.ok(scroll >= 0 && scroll <= l.max + 1e-9);
  }
  assert.equal(scroll, 0);
});

test('the anchor arithmetic survives a page without a size and an anchor beside the page', () => {
  assert.equal(anchoredScroll({ scroll: 30, anchor: 10, pane: 500, content0: 0, content1: 2000 }), 30);
  assert.equal(anchoredScroll({ scroll: 30, anchor: 10, pane: 500, content0: 0, content1: 100 }), 0);
  // Cursor in the margin left of a centred page: the page grows away from it, the scroll stays in range.
  const s = anchoredScroll({ scroll: 0, anchor: 20, pane: 4000, content0: 1000, content1: 9000, centre: true });
  assert.equal(s, 0);
});

test('side-by-side: both panes show the same part after a zoom, also with pages of different size', () => {
  const pane = WIDE.width / 2;
  const cursor = 900;
  // The same sheet on both sides: identical scroll positions at every step.
  const n = natural(A0);
  let z = fitZoom({ width: pane, height: WIDE.height }, A0);
  let left = 0;
  let right = 0;
  for (let i = 0; i < 30; i++) {
    const z1 = clampZoom(z * 1.1);
    left = anchoredScroll({ scroll: left, anchor: cursor, pane, content0: n.w * z, content1: n.w * z1, centre: true });
    right = anchoredScroll({ scroll: right, anchor: cursor, pane, content0: n.w * z, content1: n.w * z1, centre: true });
    z = z1;
    assert.equal(left, right);
  }
  // An A1 against an A0: each pane keeps its own point under the cursor.
  const o = natural(A1);
  const lo = anchoredScroll({ scroll: 400, anchor: cursor, pane, content0: o.w * 2, content1: o.w * 3, centre: true });
  const ln = anchoredScroll({ scroll: 800, anchor: cursor, pane, content0: n.w * 2, content1: n.w * 3, centre: true });
  assert.ok(Math.abs(contentFractionAt(lo, cursor, pane, o.w * 3, { centre: true }) - contentFractionAt(400, cursor, pane, o.w * 2, { centre: true })) < 1e-9);
  assert.ok(Math.abs(contentFractionAt(ln, cursor, pane, n.w * 3, { centre: true }) - contentFractionAt(800, cursor, pane, n.w * 2, { centre: true })) < 1e-9);
  // Scrolling one pane moves the other by the same fraction of its range.
  const maxO = axisLayout(pane, o.w * 3, { centre: true }).max;
  const maxN = axisLayout(pane, n.w * 3, { centre: true }).max;
  assert.equal(mirrorScroll(0, maxO, maxN), 0);
  assert.equal(mirrorScroll(maxO, maxO, maxN), maxN);
  assert.ok(Math.abs(mirrorScroll(maxO / 2, maxO, maxN) - maxN / 2) < 1e-9);
  // A pane that does not scroll passes nothing on beyond the range of the other.
  assert.equal(mirrorScroll(0, 0, maxN), 0);
  assert.equal(mirrorScroll(50, 0, 20), 20);
  assert.equal(mirrorScroll(50, 0, -5), 0);
});

test('the page bitmap stays within what a canvas holds; the zoom on screen is not limited', () => {
  // A0 at 800 %: 40 000 x 28 000 px would be asked for.
  const want = BASE_SCALE * MAX_ZOOM;
  assert.ok(A0.width * want > 40000);
  const r = cappedRenderScale(want, [A0, A0]);
  assert.equal(r.capped, true);
  assert.ok(r.scale < want);
  const w = Math.ceil(A0.width * r.scale);
  const h = Math.ceil(A0.height * r.scale);
  assert.ok(w <= MAX_BITMAP_EDGE && h <= MAX_BITMAP_EDGE, `${w} x ${h}`);
  assert.ok(w * h <= MAX_BITMAP_PX * 1.001, `${w * h} px`);
  // Still at least 200 dpi on an A0.
  assert.ok(r.scale * 72 > 200, `${r.scale * 72} dpi`);
  // The larger page of a pair decides for both: one scale, so they stay aligned.
  assert.equal(cappedRenderScale(want, [A4, A0]).scale, r.scale);
  // An A4 is never limited, and a low zoom is passed on unchanged.
  assert.deepEqual(cappedRenderScale(want, [A4, A4]), { scale: want, capped: false });
  assert.deepEqual(cappedRenderScale(BASE_SCALE, [A0]), { scale: BASE_SCALE, capped: false });
  // A long roll plot is limited by its edge.
  const roll = { width: 10000 * PT_PER_MM, height: 300 * PT_PER_MM };
  const rr = cappedRenderScale(want, [roll]);
  assert.ok(Math.ceil(roll.width * rr.scale) <= MAX_BITMAP_EDGE);
  // Sizes that are missing do not break it.
  assert.deepEqual(cappedRenderScale(2, [null, { width: 0, height: 0 }]), { scale: 2, capped: false });
});
