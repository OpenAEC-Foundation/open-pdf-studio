import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normaliseFilters, reviewMatches, reviewSummary, detectReviewRegions, textBoxesFromItems,
  isLegendHeading, titleField, MAX_REGIONS
} from './symbol-review.js';

// A generated A3 landscape floor plan in page-view points: 17 receptacle
// symbols on the plan, a legend top right that shows the symbol once, and a
// title block bottom right whose text gives one false candidate.
const PAGE = { width: 1190, height: 842 };
const text = (str, x, y, size = 8) => ({ text: str, x, y, width: str.length * size * .55, height: size });

function sheet() {
  const boxes = [
    // Room names on the plan itself.
    text('Woonkamer', 300, 300, 10), text('Keuken', 520, 420, 10), text('Slaapkamer 1', 180, 560, 10),
    // Legend: heading, then one row per symbol; the symbols sit left of the text.
    text('LEGENDA', 930, 60, 12),
    text('Wandcontactdoos enkel', 960, 90), text('Wandcontactdoos dubbel', 960, 112),
    text('Lichtpunt plafond', 960, 134), text('Schakelaar', 960, 156),
    // Title block: field labels and their values.
    text('Projectnummer', 900, 700), text('2026-014', 990, 700),
    text('Schaal', 900, 722), text('1:50', 990, 722),
    text('Datum', 900, 744), text('17-11-2026', 990, 744),
    text('Getekend', 900, 766), text('MV', 990, 766),
    text('Tekeningnummer', 900, 788), text('E-101', 990, 788)
  ];
  const symbol = (x, y, score = 1) => ({ page: 1, bounds: { x, y, width: 14, height: 14 }, score, rotation: 0, scale: 1 });
  const real = [];
  for (let i = 0; i < 17; i++) real.push(symbol(120 + (i % 6) * 110, 200 + Math.floor(i / 6) * 150, i % 4 ? 1 : .93));
  const inLegend = symbol(938, 108),
    inTitle = symbol(1000, 741, .97);
  return { boxes, real, inLegend, inTitle, all: [...real, inLegend, inTitle] };
}

const detectedOn = (boxes, page = 1) => detectReviewRegions(boxes, PAGE).map(r => ({ ...r, page }));
const centreIn = (m, b) => {
  const cx = m.bounds.x + m.bounds.width / 2,
    cy = m.bounds.y + m.bounds.height / 2;
  return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
};

test('legend and title block are found in the page text', () => {
  const { boxes, real, inLegend, inTitle } = sheet(),
    regions = detectReviewRegions(boxes, PAGE);
  assert.deepEqual(regions.map(r => r.kind).sort(), ['legend', 'titleBlock']);
  const legend = regions.find(r => r.kind === 'legend').bounds,
    title = regions.find(r => r.kind === 'titleBlock').bounds;
  assert.ok(centreIn(inLegend, legend), 'the legend symbol lies in the legend region');
  assert.ok(centreIn(inTitle, title), 'the title text lies in the title block region');
  for (const m of real) assert.ok(!centreIn(m, legend) && !centreIn(m, title), 'plan symbols stay outside');
  // The title block runs on to the frame: right and bottom page edge.
  assert.equal(title.x + title.width, PAGE.width);
  assert.equal(title.y + title.height, PAGE.height);
  for (const b of [legend, title]) assert.ok(b.x >= 0 && b.y >= 0 && b.width * b.height < .4 * PAGE.width * PAGE.height);
});

test('default: nothing is dropped, legend and title block candidates are flagged', () => {
  const { boxes, all } = sheet(),
    out = reviewMatches(all, normaliseFilters(), detectedOn(boxes));
  assert.equal(out.matches.length, 19);
  assert.equal(out.excluded, 0);
  assert.deepEqual(reviewSummary(out.matches, out.excluded), { candidates: 19, safe: 17, review: 2, excluded: 0 });
  const flagged = out.matches.filter(m => m.review);
  assert.deepEqual(flagged.map(m => m.reviewReasons), [['legend'], ['titleBlock']]);
  for (const m of out.matches.filter(m => !m.review)) assert.equal('reviewReasons' in m, false);
  // The candidate itself is passed on unchanged.
  assert.deepEqual(out.matches[0].bounds, all[0].bounds);
  assert.equal(out.matches[0].score, all[0].score);
});

test('regions detected on another page do not flag', () => {
  const { boxes, all } = sheet(),
    out = reviewMatches(all, normaliseFilters(), detectedOn(boxes, 2));
  assert.equal(out.matches.filter(m => m.review).length, 0);
});

test('minScore flags weaker candidates and keeps them', () => {
  const { boxes, all } = sheet(),
    out = reviewMatches(all, normaliseFilters({ minScore: .98 }), detectedOn(boxes));
  assert.equal(out.matches.length, 19);
  const below = out.matches.filter(m => m.reviewReasons?.includes('belowMinScore'));
  assert.equal(below.length, all.filter(m => m.score < .98).length);
  assert.ok(below.length > 0 && below.every(m => m.score < .98));
  // Below the score and inside the title block: both reasons.
  assert.deepEqual(out.matches.at(-1).reviewReasons, ['belowMinScore', 'titleBlock']);
  // A candidate exactly at minScore is not below it.
  const edge = reviewMatches([{ page: 1, bounds: { x: 0, y: 0, width: 4, height: 4 }, score: .9 }], normaliseFilters({ minScore: .9 }));
  assert.equal(edge.matches[0].review, false);
});

test('excludeRegions drops candidates by centre and counts them', () => {
  const { boxes, all, inLegend } = sheet(),
    legendArea = { x: 900, y: 40, width: 290, height: 150 },
    out = reviewMatches(all, normaliseFilters({ excludeRegions: [legendArea] }), detectedOn(boxes));
  assert.equal(out.excluded, 1);
  assert.equal(out.matches.length, 18);
  assert.ok(!out.matches.some(m => m.bounds.x === inLegend.bounds.x && m.bounds.y === inLegend.bounds.y));
  assert.deepEqual(reviewSummary(out.matches, out.excluded), { candidates: 18, safe: 17, review: 1, excluded: 1 });
  // A candidate that only overlaps the region, centre outside, stays.
  const straddle = { page: 1, bounds: { x: 890, y: 100, width: 14, height: 14 }, score: 1 };
  assert.equal(reviewMatches([straddle], normaliseFilters({ excludeRegions: [legendArea] })).matches.length, 1);
});

test('a region with a page only applies to that page', () => {
  const m = page => ({ page, bounds: { x: 10, y: 10, width: 10, height: 10 }, score: 1 }),
    area = { x: 0, y: 0, width: 50, height: 50 };
  let out = reviewMatches([m(1), m(2)], normaliseFilters({ excludeRegions: [{ page: 2, ...area }] }));
  assert.deepEqual(out.matches.map(x => x.page), [1]);
  out = reviewMatches([m(1), m(2)], normaliseFilters({ excludeRegions: [area] }));
  assert.equal(out.matches.length, 0);
  assert.equal(out.excluded, 2);
  // withinRegion on page 1 leaves page 2 unrestricted.
  out = reviewMatches([m(1), m(2)], normaliseFilters({ withinRegion: { page: 1, x: 100, y: 100, width: 50, height: 50 } }));
  assert.deepEqual(out.matches.map(x => x.page), [2]);
});

test('withinRegion keeps only what lies inside, and combines with excludeRegions', () => {
  const { all } = sheet(),
    plan = { x: 100, y: 180, width: 700, height: 480 };
  let out = reviewMatches(all, normaliseFilters({ withinRegion: plan, detectRegions: false }));
  assert.equal(out.matches.length, 17);
  assert.equal(out.excluded, 2);
  assert.ok(out.matches.every(m => m.review === false));
  out = reviewMatches(all, normaliseFilters({ withinRegion: plan, excludeRegions: [{ x: 100, y: 180, width: 120, height: 60 }] }));
  assert.equal(out.matches.length, 16);
  assert.equal(out.excluded, 3);
});

test('filters are validated', () => {
  assert.deepEqual(normaliseFilters(), { exclude: [], within: null, minScore: null, detect: true });
  assert.equal(normaliseFilters({ detectRegions: false }).detect, false);
  assert.deepEqual(normaliseFilters({ excludeRegions: [{ page: 3, x: 1, y: 2, width: 3, height: 4, extra: 1 }] }).exclude, [{ page: 3, x: 1, y: 2, width: 3, height: 4 }]);
  const bad = [
    { excludeRegions: {} },
    { excludeRegions: [null] },
    { excludeRegions: [{ x: 0, y: 0, width: 0, height: 5 }] },
    { excludeRegions: [{ x: 0, y: 0, width: 5, height: -1 }] },
    { excludeRegions: [{ x: '0', y: 0, width: 5, height: 5 }] },
    { excludeRegions: [{ x: 0, y: 0, width: Infinity, height: 5 }] },
    { excludeRegions: [{ page: 0, x: 0, y: 0, width: 5, height: 5 }] },
    { excludeRegions: [{ page: 1.5, x: 0, y: 0, width: 5, height: 5 }] },
    { excludeRegions: Array.from({ length: MAX_REGIONS + 1 }, () => ({ x: 0, y: 0, width: 5, height: 5 })) },
    { withinRegion: [] },
    { withinRegion: { x: 0, y: 0, width: 5 } },
    { detectRegions: 'no' }
  ];
  for (const b of bad) assert.throws(() => normaliseFilters(b), /INVALID_REGIONS/, JSON.stringify(b).slice(0, 80));
  for (const minScore of [.49, 1.01, NaN, '0.9']) assert.throws(() => normaliseFilters({ minScore }), /INVALID_MIN_SCORE/);
  assert.equal(normaliseFilters({ minScore: 1 }).minScore, 1);
});

test('legend headings: the word itself, not a reference to it', () => {
  for (const t of ['LEGEND', 'Legenda', 'Renvooi', 'ELECTRICAL LEGEND', 'Legend:', 'Symbol key', 'Symbolen', 'Légende', 'Zeichenerklärung', 'Renvooi elektra']) assert.ok(isLegendHeading(t), t);
  for (const t of ['SEE LEGEND', 'Zie renvooi', 'Legendary', 'Key plan', 'Woonkamer', 'All symbols on this sheet are shown in the legend on sheet E-001', '']) assert.ok(!isLegendHeading(t), t);
});

test('title block field labels', () => {
  assert.equal(titleField('Schaal: 1:100'), 'scale');
  assert.equal(titleField('SCALE'), 'scale');
  assert.equal(titleField('Drawn by'), 'drawn');
  assert.equal(titleField('Get.'), 'drawn');
  assert.equal(titleField('Projectnummer'), 'project');
  assert.equal(titleField('Rev.'), 'revision');
  assert.equal(titleField('Sheet 3 of 12'), 'drawing');
  assert.equal(titleField('Scaled drawings shall not be used'), null);
  assert.equal(titleField('Datumlijn'), null);
  assert.equal(titleField('Scale drawings are for reference only and never for construction'), null);
});

test('no region without enough evidence', () => {
  // A legend heading with nothing below it, and two field labels only.
  assert.deepEqual(detectReviewRegions([text('LEGEND', 500, 780, 12)], PAGE), []);
  assert.deepEqual(detectReviewRegions([text('Scale', 900, 700), text('Date', 900, 722)], PAGE), []);
  // The same three labels spread over the whole sheet are not one block.
  assert.deepEqual(detectReviewRegions([text('Scale', 40, 40), text('Date', 600, 400), text('Drawn', 1100, 800)], PAGE), []);
  // A "legend" that would swallow the sheet is not believed.
  const wall = [text('LEGEND', 20, 20, 12)];
  for (let y = 50; y < 820; y += 20) wall.push({ text: 'x'.repeat(200), x: 30, y, width: 1100, height: 8 });
  assert.deepEqual(detectReviewRegions(wall, PAGE), []);
  assert.deepEqual(detectReviewRegions(null, PAGE), []);
  assert.deepEqual(detectReviewRegions([], { width: 0, height: 0 }), []);
});

test('legend rows stop at a wide gap and at another column', () => {
  const boxes = [
    text('LEGEND', 100, 100, 10), text('Receptacle', 130, 125), text('Switch', 130, 145),
    text('General notes', 130, 400), text('Far right', 700, 125)
  ];
  const [legend] = detectReviewRegions(boxes, PAGE);
  assert.equal(legend.kind, 'legend');
  assert.ok(legend.bounds.y + legend.bounds.height < 400);
  assert.ok(legend.bounds.x + legend.bounds.width < 700);
  assert.ok(legend.bounds.x < 100, 'room for the symbols left of the text');
});

test('text items of a page become boxes in page-view coordinates', () => {
  // pdf.js items: PDF space has its origin bottom left; the viewport flips y.
  const viewport = { scale: 1, transform: [1, 0, 0, -1, 0, PAGE.height], width: PAGE.width, height: PAGE.height };
  const item = (str, x, top, size = 8, eol = true) => ({ str, transform: [size, 0, 0, size, x, PAGE.height - top - size], width: str.length * size * .55, height: size, fontName: 'f1', hasEOL: eol });
  const items = [
    // One item per glyph, as CAD output often has it.
    ...[...'LEGENDA'].map((ch, i) => item(ch, 930 + i * 12 * .55, 60, 12, i === 6)),
    item('Wandcontactdoos', 960, 90), item('Schakelaar', 960, 112),
    item('', 0, 0), item('Schaal', 900, 722), item('Datum', 900, 744), item('Getekend', 900, 766)
  ];
  const boxes = textBoxesFromItems(items, viewport);
  assert.deepEqual(boxes.map(b => b.text), ['LEGENDA', 'Wandcontactdoos', 'Schakelaar', 'Schaal', 'Datum', 'Getekend']);
  const heading = boxes[0];
  assert.ok(Math.abs(heading.x - 930) < .01 && Math.abs(heading.y - 60) < .01 && Math.abs(heading.height - 12) < .01);
  assert.deepEqual(detectReviewRegions(boxes, viewport).map(r => r.kind), ['legend', 'titleBlock']);
  assert.deepEqual(textBoxesFromItems(undefined, viewport), []);
});

// The tool schema lives in several places; the Rust literal is the source and
// the Rust test that compares it with tools.json does not run locally.
test('the MCP schema carries the review options in every copy', () => {
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const packaged = JSON.parse(read('../../../mcp-stdio/tools.json')).find(t => t.name === 'app_search_symbols');
  const rust = read('../../src-tauri/src/mcp_server.rs'),
    start = rust.indexOf('{\n    "name": "app_search_symbols"');
  assert.ok(start > 0, 'app_search_symbols in mcp_server.rs');
  let depth = 0,
    end = start;
  for (; end < rust.length; end++) {
    if (rust[end] === '{') depth++;
    else if (rust[end] === '}' && --depth === 0) break;
  }
  const native = JSON.parse(rust.slice(start, end + 1));
  assert.equal(native.description, packaged.description);
  assert.deepEqual(native.inputSchema, packaged.inputSchema);
  const props = packaged.inputSchema.properties;
  for (const key of ['excludeRegions', 'withinRegion', 'minScore', 'detectRegions']) assert.ok(props[key], key);
  assert.equal(props.excludeRegions.maxItems, MAX_REGIONS);
  assert.deepEqual(props.excludeRegions.items, props.withinRegion);
  assert.deepEqual(props.withinRegion.required, ['x', 'y', 'width', 'height']);
  assert.equal(props.minScore.minimum, .5);
  assert.equal(props.minScore.maximum, 1);
  for (const word of ['excludeRegions', 'withinRegion', 'minScore', 'review', 'legend', 'title block', 'top left']) assert.ok(packaged.description.includes(word), word);
  const python = read('../../../python/src/open_pdf_studio/_tools.py');
  for (const word of ['exclude_regions', 'within_region', 'min_score', 'detect_regions']) assert.ok(python.includes(word), word);
});
