import assert from 'node:assert/strict';
import test from 'node:test';
import { schaalVoorPassen } from './page-scale-geometry.js';
import {
  MIN_CONTENT_AREA_MM, hasMargins, marginsForPage, normalizeMargins, resizeGeometry,
  unrotatedMargins, validateResizeMargins,
} from './resize-margins-geometry.js';

const NONE = { left: 0, right: 0, top: 0, bottom: 0 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`);

/**
 * What Resize Pages computed before margins existed, copied from the old
 * code: the reference for "zero margins changes nothing".
 */
function before({ crop, rotation, targetW, targetH, scaleContent }) {
  const rotated = rotation === 90 || rotation === 270;
  const visualOldW = rotated ? crop.height : crop.width;
  const visualOldH = rotated ? crop.width : crop.height;
  const unrotW = rotated ? targetH : targetW;
  const unrotH = rotated ? targetW : targetH;
  if (scaleContent) {
    const { s, dx: ux, dy: uy } = schaalVoorPassen(crop.width, crop.height, unrotW, unrotH);
    return {
      box: { x: 0, y: 0, width: unrotW, height: unrotH },
      content: { s, tx: ux - s * crop.x, ty: uy - s * crop.y },
      visual: schaalVoorPassen(visualOldW, visualOldH, targetW, targetH),
    };
  }
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  return {
    box: { x: centerX - unrotW / 2, y: centerY - unrotH / 2, width: unrotW, height: unrotH },
    content: null,
    visual: { s: 1, dx: (targetW - visualOldW) / 2, dy: (targetH - visualOldH) / 2 },
  };
}

/** A point of the unrotated page, as displayed (top-left origin, y down). */
function shown(point, box, rotation) {
  switch (rotation) {
    case 90: return { x: point.y - box.y, y: point.x - box.x };
    case 180: return { x: box.x + box.width - point.x, y: point.y - box.y };
    case 270: return { x: box.y + box.height - point.y, y: box.x + box.width - point.x };
    default: return { x: point.x - box.x, y: box.y + box.height - point.y };
  }
}

const CROPS = [
  { x: 0, y: 0, width: 595.28, height: 841.89 },
  { x: 36.5, y: -12.25, width: 1190.55, height: 841.89 },
  { x: -100.3, y: 250.7, width: 311.811, height: 123.456 },
];
const TARGETS = [[595.2755905511812, 841.8897637795276], [841.8897637795276, 595.2755905511812], [300.1, 1200.7]];

test('zero margins give exactly the numbers from before margins existed', () => {
  for (const crop of CROPS) {
    for (const [targetW, targetH] of TARGETS) {
      for (const rotation of [0, 90, 180, 270]) {
        for (const scaleContent of [false, true]) {
          const input = { crop, rotation, targetW, targetH, scaleContent };
          const old = before(input);
          for (const margins of [undefined, null, NONE]) {
            const now = resizeGeometry({ ...input, margins });
            // Same numbers, not merely close ones (=== so that 0 and -0 count as equal).
            for (const key of ['x', 'y', 'width', 'height']) assert.ok(now.box[key] === old.box[key], `box.${key}`);
            for (const key of ['s', 'dx', 'dy']) assert.ok(now.visual[key] === old.visual[key], `visual.${key}`);
            if (old.content) {
              for (const key of ['s', 'tx', 'ty']) assert.ok(now.content[key] === old.content[key], `content.${key}`);
            } else {
              assert.equal(now.content, null);
            }
            assert.equal(now.clip, null, 'nothing is clipped without margins');
          }
        }
      }
    }
  }
});

test('scale to fit: the page fills the area between asymmetric margins', () => {
  // 200 x 100 onto 400 x 300 with left 20, right 80, top 10, bottom 90:
  // the area is 300 x 200 at (20, 10) from the top-left; factor 1.5.
  const g = resizeGeometry({
    crop: { x: 0, y: 0, width: 200, height: 100 },
    rotation: 0, targetW: 400, targetH: 300,
    margins: { left: 20, right: 80, top: 10, bottom: 90 },
    scaleContent: true,
  });
  assert.deepEqual(g.box, { x: 0, y: 0, width: 400, height: 300 });
  assert.equal(g.content.s, 1.5);
  // 300 x 150 in an area 300 x 200: flush left and right, 25 free above and below.
  assert.deepEqual(g.visual, { s: 1.5, dx: 20, dy: 10 + 25 });
  // PDF space has y up: the bottom margin (90) plus the 25 below the content.
  assert.equal(g.content.tx, 20);
  assert.equal(g.content.ty, 90 + 25);
  assert.deepEqual(g.clip, { x: 0, y: 0, width: 200, height: 100 });
});

test('scale to fit never reaches into a margin', () => {
  const margins = { left: 30, right: 5, top: 12, bottom: 40 };
  for (const crop of CROPS) {
    for (const [targetW, targetH] of TARGETS) {
      for (const rotation of [0, 90, 180, 270]) {
        const g = resizeGeometry({ crop, rotation, targetW, targetH, margins, scaleContent: true });
        const rotated = rotation === 90 || rotation === 270;
        const oldW = rotated ? crop.height : crop.width;
        const oldH = rotated ? crop.width : crop.height;
        const { s, dx, dy } = g.visual;
        assert.ok(dx >= margins.left - 1e-9 && dy >= margins.top - 1e-9);
        assert.ok(dx + s * oldW <= targetW - margins.right + 1e-9);
        assert.ok(dy + s * oldH <= targetH - margins.bottom + 1e-9);
        // It touches the area in one direction and is centred in the other.
        near(dx - margins.left, targetW - margins.right - (dx + s * oldW), 'centred sideways');
        near(dy - margins.top, targetH - margins.bottom - (dy + s * oldH), 'centred up and down');
        const fills = Math.abs(s * oldW - (targetW - margins.left - margins.right)) < 1e-6
          || Math.abs(s * oldH - (targetH - margins.top - margins.bottom)) < 1e-6;
        assert.ok(fills, 'the content touches the margin area');
      }
    }
  }
});

test('keep size: the page is centred between the margins and cropped to that area', () => {
  // 400 x 300 kept at size on 300 x 300 with left 50, right 10, top 20, bottom 30:
  // the area is 240 x 250, so 80 is cut off left and right, 25 above and below.
  const crop = { x: 10, y: 20, width: 400, height: 300 };
  const g = resizeGeometry({
    crop, rotation: 0, targetW: 300, targetH: 300,
    margins: { left: 50, right: 10, top: 20, bottom: 30 },
    scaleContent: false,
  });
  assert.equal(g.content, null);
  assert.deepEqual(g.visual, { s: 1, dx: 50 + (240 - 400) / 2, dy: 20 + (250 - 300) / 2 });
  // The box lies around the content: its left edge is 30 to the right of the
  // left edge of the old page, its bottom edge 5 below the old bottom edge
  // (25 is cut off below the area, which starts 30 above the new bottom edge).
  assert.deepEqual(g.box, { x: 10 + 30, y: 20 - 5, width: 300, height: 300 });
  // Visible: the margin area, in the coordinates of the content.
  assert.deepEqual(g.clip, { x: 40 + 50, y: 15 + 30, width: 240, height: 250 });
});

test('keep size on a larger page: the whole old page stays, nothing outside it shows', () => {
  const crop = { x: 0, y: 0, width: 100, height: 100 };
  const g = resizeGeometry({
    crop, rotation: 0, targetW: 300, targetH: 200,
    margins: { left: 40, right: 0, top: 0, bottom: 0 },
    scaleContent: false,
  });
  // Area 260 x 200 starting 40 from the left; the page sits in its middle.
  assert.deepEqual(g.visual, { s: 1, dx: 40 + 80, dy: 50 });
  assert.deepEqual(g.clip, crop);
});

test('the content, the box and the annotations agree on every rotation', () => {
  const margins = { left: 30, right: 5, top: 12, bottom: 40 };
  for (const crop of CROPS) {
    for (const [targetW, targetH] of TARGETS) {
      for (const rotation of [0, 90, 180, 270]) {
        for (const scaleContent of [false, true]) {
          for (const m of [NONE, margins]) {
            const g = resizeGeometry({ crop, rotation, targetW, targetH, margins: m, scaleContent });
            // The new page is displayed at the size that was asked for.
            const rotated = rotation === 90 || rotation === 270;
            near(rotated ? g.box.height : g.box.width, targetW);
            near(rotated ? g.box.width : g.box.height, targetH);
            // A point of the content, seen before and after: the app's
            // annotations (displayed space) must land on the same spot.
            for (const [fx, fy] of [[0, 0], [1, 1], [0.25, 0.8]]) {
              const point = { x: crop.x + fx * crop.width, y: crop.y + fy * crop.height };
              const wasShown = shown(point, crop, rotation);
              const moved = g.content
                ? { x: g.content.s * point.x + g.content.tx, y: g.content.s * point.y + g.content.ty }
                : point;
              const isShown = shown(moved, g.box, rotation);
              near(isShown.x, g.visual.s * wasShown.x + g.visual.dx, `x at rotation ${rotation}`);
              near(isShown.y, g.visual.s * wasShown.y + g.visual.dy, `y at rotation ${rotation}`);
            }
          }
        }
      }
    }
  }
});

test('on a page with /Rotate 90 the margins are the displayed ones', () => {
  // Stored 100 wide x 200 high, shown 200 wide x 100 high. New size as shown:
  // 300 x 200, with a left margin of 60 only.
  const crop = { x: 0, y: 0, width: 100, height: 200 };
  const g = resizeGeometry({
    crop, rotation: 90, targetW: 300, targetH: 200,
    margins: { left: 60, right: 0, top: 0, bottom: 0 },
    scaleContent: true,
  });
  // Stored box: the dimensions are swapped back.
  assert.deepEqual(g.box, { x: 0, y: 0, width: 200, height: 300 });
  // Shown area 240 x 200 for a page shown 200 x 100: factor 1.2, at the left margin.
  assert.equal(g.visual.s, 1.2);
  near(g.visual.dx, 60);
  near(g.visual.dy, (200 - 120) / 2);
  // The displayed left is the stored bottom on such a page.
  assert.deepEqual(unrotatedMargins({ left: 60, right: 0, top: 0, bottom: 0 }, 90), { left: 0, bottom: 60, right: 0, top: 0 });
  near(g.content.ty, 60);
  near(g.content.tx, (200 - 120) / 2);
});

test('displayed margins map to the stored sides for each quarter turn', () => {
  const m = { left: 1, right: 2, top: 3, bottom: 4 };
  assert.deepEqual(unrotatedMargins(m, 0), { left: 1, right: 2, top: 3, bottom: 4 });
  assert.deepEqual(unrotatedMargins(m, 90), { left: 3, bottom: 1, right: 4, top: 2 });
  assert.deepEqual(unrotatedMargins(m, 180), { left: 2, right: 1, top: 4, bottom: 3 });
  assert.deepEqual(unrotatedMargins(m, 270), { left: 4, top: 1, right: 3, bottom: 2 });
  assert.deepEqual(unrotatedMargins(m, -90), unrotatedMargins(m, 270));
  assert.deepEqual(unrotatedMargins(m, 450), unrotatedMargins(m, 90));
});

test('odd pages take the odd set, even pages the even set when there is one', () => {
  const odd = { left: 20, right: 10, top: 5, bottom: 5 };
  const even = { left: 10, right: 20, top: 5, bottom: 5 };
  for (const page of [1, 3, 5, 99]) assert.deepEqual(marginsForPage(page, { odd, even }), odd);
  for (const page of [2, 4, 6, 100]) assert.deepEqual(marginsForPage(page, { odd, even }), even);
  // One set for all pages.
  for (const page of [1, 2, 3, 4]) assert.deepEqual(marginsForPage(page, { odd }), odd);
  for (const page of [1, 2]) assert.deepEqual(marginsForPage(page, { odd, even: null }), odd);
  // No margins at all.
  assert.deepEqual(marginsForPage(1, null), NONE);
  assert.deepEqual(marginsForPage(2, undefined), NONE);
});

test('odd and even pages end up mirrored with mirrored margins', () => {
  const crop = { x: 0, y: 0, width: 500, height: 700 };
  const margins = { odd: { left: 60, right: 20, top: 30, bottom: 30 }, even: { left: 20, right: 60, top: 30, bottom: 30 } };
  const place = (page) => resizeGeometry({
    crop, rotation: 0, targetW: 595, targetH: 842, margins: marginsForPage(page, margins), scaleContent: true,
  }).visual;
  const odd = place(1);
  const even = place(2);
  assert.equal(odd.s, even.s);
  assert.equal(odd.dy, even.dy);
  // The free strip left of an odd page is the one right of an even page.
  near(odd.dx, 595 - (even.dx + even.s * 500));
  assert.ok(odd.dx > even.dx);
});

test('missing or unreadable sides count as zero', () => {
  assert.deepEqual(normalizeMargins({ left: 5 }), { left: 5, right: 0, top: 0, bottom: 0 });
  assert.deepEqual(normalizeMargins({ left: 'x', right: NaN, top: null, bottom: undefined }), NONE);
  assert.equal(hasMargins(null), false);
  assert.equal(hasMargins(NONE), false);
  assert.equal(hasMargins({ bottom: 0.5 }), true);
});

test('margins that leave no room on the page are rejected, with the reason', () => {
  const ok = { left: 20, right: 20, top: 25, bottom: 25 };
  assert.equal(validateResizeMargins(210, 297, null), null);
  assert.equal(validateResizeMargins(210, 297, { odd: NONE }), null);
  // Without margins a page size that is itself unusable is not a margin problem.
  assert.equal(validateResizeMargins(0, 0, { odd: NONE, even: NONE }), null);
  assert.deepEqual(validateResizeMargins(0, 0, { odd: { ...NONE, left: 1 } }), { code: 'too-wide', pages: 'odd' });
  assert.equal(validateResizeMargins(210, 297, { odd: ok, even: ok }), null);

  // Larger than the page, per direction.
  assert.deepEqual(validateResizeMargins(210, 297, { odd: { ...ok, left: 150, right: 100 } }), { code: 'too-wide', pages: 'odd' });
  assert.deepEqual(validateResizeMargins(210, 297, { odd: { ...ok, top: 300 } }), { code: 'too-high', pages: 'odd' });
  // Exactly the page width leaves nothing either; at least 1 mm must remain.
  assert.deepEqual(validateResizeMargins(210, 297, { odd: { ...ok, left: 105, right: 105 } }), { code: 'too-wide', pages: 'odd' });
  assert.deepEqual(validateResizeMargins(210, 297, { odd: { ...ok, left: 105, right: 104.5 } }), { code: 'too-wide', pages: 'odd' });
  assert.equal(validateResizeMargins(210, 297, { odd: { ...ok, left: 105, right: 105 - MIN_CONTENT_AREA_MM } }), null);

  // The even set is checked as well, and named.
  assert.deepEqual(validateResizeMargins(210, 297, { odd: ok, even: { ...ok, top: 200, bottom: 200 } }), { code: 'too-high', pages: 'even' });

  // Negative or not a number.
  assert.deepEqual(validateResizeMargins(210, 297, { odd: { ...ok, left: -1 } }), { code: 'negative', pages: 'odd' });
  assert.deepEqual(validateResizeMargins(210, 297, { odd: ok, even: { ...ok, bottom: NaN } }), { code: 'negative', pages: 'even' });
  assert.deepEqual(validateResizeMargins(210, 297, { odd: { ...ok, right: Infinity } }), { code: 'negative', pages: 'odd' });
});
