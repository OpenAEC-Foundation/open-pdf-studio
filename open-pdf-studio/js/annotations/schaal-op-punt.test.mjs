import { test } from "node:test";
import assert from "node:assert/strict";
import { schaalOpPunt } from "./schaal-op-punt.js";

// De schaal op een punt komt uit één vaste volgorde van bronnen (#400):
// viewport-annotatie → schaalbalk op de pagina → viewport uit de PDF (/VP) →
// documentschaal → schaalbalk elders. De documentschaal mag de meetschaal die
// de PDF zelf meebrengt nooit verdringen: een blad met een plattegrond 1:100
// en een detail 1:20 meet in het detail anders vijf keer te lang.

const PPU = (n) => 72 / (25.4 * n);

const detail = { x: 500, y: 100, width: 300, height: 200, pixelsPerUnit: PPU(20), unit: "mm", ratio: "1:20" };
const plattegrond = { x: 0, y: 0, width: 800, height: 600, pixelsPerUnit: PPU(100), unit: "mm", ratio: "1:100" };

test("the PDF viewport wins over the document scale", () => {
  const doc = { annotations: [], measureScale: { pixelsPerUnit: PPU(100), unit: "mm" }, pdfViewports: { 1: [plattegrond, detail] } };
  assert.equal(schaalOpPunt(doc, 1, 600, 200).pixelsPerUnit, PPU(20), "in het detail geldt 1:20");
  assert.equal(schaalOpPunt(doc, 1, 600, 200).method, "pdfViewport");
  assert.equal(schaalOpPunt(doc, 1, 100, 500).pixelsPerUnit, PPU(100), "in de plattegrond 1:100");
  // Buiten elke viewport, en op een pagina zonder viewports: de documentschaal.
  assert.equal(schaalOpPunt(doc, 1, 900, 900).pixelsPerUnit, PPU(100));
  assert.equal(schaalOpPunt(doc, 2, 600, 200).pixelsPerUnit, PPU(100));
});

test("a viewport with its own outline only claims the points inside that outline", () => {
  const driehoek = { ...detail, veelhoek: [[500, 100], [800, 100], [500, 300]] };
  const doc = { annotations: [], measureScale: { pixelsPerUnit: PPU(100), unit: "mm" }, pdfViewports: { 1: [plattegrond, driehoek] } };
  assert.equal(schaalOpPunt(doc, 1, 520, 120).pixelsPerUnit, PPU(20));
  assert.equal(schaalOpPunt(doc, 1, 790, 290).pixelsPerUnit, PPU(100), "de lege hoek is van de plattegrond");
});

test("annotations of the app come before the PDF viewport", () => {
  const vpAnn = { type: "viewport", page: 1, x: 500, y: 100, width: 300, height: 200, pixelsPerUnit: PPU(50), unit: "mm" };
  const balk = { type: "scaleBar", page: 1, pixelsPerUnit: PPU(200), unit: "cm" };
  assert.deepEqual(
    schaalOpPunt({ annotations: [vpAnn], pdfViewports: { 1: [detail] } }, 1, 600, 200),
    { pixelsPerUnit: PPU(50), unit: "mm", method: "viewport" },
  );
  assert.deepEqual(
    schaalOpPunt({ annotations: [balk], pdfViewports: { 1: [detail] } }, 1, 600, 200),
    { pixelsPerUnit: PPU(200), unit: "cm", method: "scaleBar" },
  );
});

test("a scale bar on another page comes after the PDF viewport and the document scale", () => {
  const balkElders = { type: "scaleBar", page: 3, pixelsPerUnit: PPU(200), unit: "mm" };
  assert.equal(schaalOpPunt({ annotations: [balkElders], pdfViewports: { 1: [detail] } }, 1, 600, 200).pixelsPerUnit, PPU(20));
  assert.equal(schaalOpPunt({ annotations: [balkElders], measureScale: { pixelsPerUnit: PPU(100), unit: "mm" } }, 1, 600, 200).pixelsPerUnit, PPU(100));
  assert.equal(schaalOpPunt({ annotations: [balkElders] }, 1, 600, 200).pixelsPerUnit, PPU(200), "als er niets anders is");
});

test("nothing known gives null", () => {
  assert.equal(schaalOpPunt(null, 1, 0, 0), null);
  assert.equal(schaalOpPunt({}, 1, 0, 0), null);
  assert.equal(schaalOpPunt({ annotations: [], pdfViewports: {} }, 1, 0, 0), null);
  // Een documentschaal zonder waarde telt niet.
  assert.equal(schaalOpPunt({ measureScale: { pixelsPerUnit: 0, unit: "mm" } }, 1, 0, 0), null);
});
