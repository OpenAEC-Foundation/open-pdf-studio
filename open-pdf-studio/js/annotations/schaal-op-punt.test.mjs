import { test } from "node:test";
import assert from "node:assert/strict";
import {
  schaalOpPunt, schaalOpPuntUitBronnen, schaalgebiedenOpPagina, verzamelSchaalBronnen,
} from "./schaal-op-punt.js";
import { viewportOp } from "../pdf/pdf-viewports.js";

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

// ── Eén doorloop voor de bronnen (#491) ─────────────────────────────────────
//
// De bronnen worden één keer verzameld (verzamelSchaalBronnen) en daarna per
// punt opgezocht (schaalOpPuntUitBronnen). De uitkomst moet precies die van de
// oude zoektocht blijven, die voor elk punt de hele annotatielijst doorliep.
// Die oude zoektocht staat hieronder letterlijk als referentie.

function oudeSchaalOpPunt(doc, pageNum, x, y) {
  if (!doc) return null;
  const annotaties = Array.isArray(doc.annotations) ? doc.annotations : [];
  for (const a of annotaties) {
    if (a.type !== "viewport" || a.page !== pageNum) continue;
    if (x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
      return { pixelsPerUnit: a.pixelsPerUnit, unit: a.unit, method: "viewport" };
    }
  }
  const schaalbalken = annotaties.filter((a) => a.type === "scaleBar");
  const opPagina = schaalbalken.find((sb) => sb.page === pageNum);
  if (opPagina) return { pixelsPerUnit: opPagina.pixelsPerUnit, unit: opPagina.unit, method: "scaleBar" };
  const vp = viewportOp(doc.pdfViewports?.[pageNum], x, y);
  if (vp) return { pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: "pdfViewport" };
  const docSchaal = doc.measureScale;
  if (docSchaal && docSchaal.pixelsPerUnit > 0) {
    return { pixelsPerUnit: docSchaal.pixelsPerUnit, unit: docSchaal.unit || "mm", method: "document" };
  }
  if (schaalbalken.length) {
    return { pixelsPerUnit: schaalbalken[0].pixelsPerUnit, unit: schaalbalken[0].unit, method: "scaleBar" };
  }
  return null;
}

// De oude volgorde van de schaalgebieden (scale-region.js vóór #491).
function oudeGebieden(doc, pageNum) {
  const arr = (doc.annotations || []).filter((a) => a.type === "scaleRegion" && a.page === pageNum);
  arr.sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return arr;
}

// Vaste pseudo-willekeur: elke run test dezelfde documenten.
function toeval(zaad) {
  let s = zaad >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAGINAS = [1, 2, 3, undefined, NaN, "1"];

function willekeurigDocument(r) {
  const kies = (lijst) => lijst[Math.floor(r() * lijst.length)];
  const annotations = [];
  const aantal = Math.floor(r() * 40);
  for (let i = 0; i < aantal; i++) {
    const type = kies(["box", "line", "viewport", "viewport", "scaleBar", "scaleRegion", "measureArea"]);
    const w = kies([0, 10, 50, 50, 200]);
    annotations.push({
      id: `a${i}`, type, page: kies(PAGINAS),
      x: Math.floor(r() * 300), y: Math.floor(r() * 300), width: w, height: kies([w, 10, 50, 200]),
      pixelsPerUnit: kies([PPU(20), PPU(50), PPU(100), 0.5]), unit: kies(["mm", "cm", undefined]),
      scaleString: kies(["1:50", "1:100"]), units: kies(["mm", "m"]),
    });
  }
  const pdfViewports = r() < 0.5 ? {} : {
    1: [{ x: 0, y: 0, width: 150, height: 150, pixelsPerUnit: PPU(75), unit: "mm" }],
    2: [
      { x: 100, y: 100, width: 200, height: 200, pixelsPerUnit: PPU(25), unit: "cm" },
      { x: 120, y: 120, width: 50, height: 50, pixelsPerUnit: PPU(10), unit: "mm" },
    ],
  };
  const measureScale = kies([null, undefined, { pixelsPerUnit: 0, unit: "mm" }, { pixelsPerUnit: PPU(200) }, { pixelsPerUnit: PPU(100), unit: "m" }]);
  return { annotations, pdfViewports, measureScale };
}

test("collected sources give exactly the scale of the old per-point search", () => {
  const r = toeval(491);
  let vergeleken = 0;
  for (let d = 0; d < 300; d++) {
    const doc = willekeurigDocument(r);
    const bronnen = verzamelSchaalBronnen(doc);
    for (let p = 0; p < 25; p++) {
      const pagina = PAGINAS[Math.floor(r() * PAGINAS.length)];
      // Ook precies op randen: gehele coördinaten vallen op de hoeken van de vlakken.
      const x = Math.floor(r() * 320) - 10;
      const y = Math.floor(r() * 320) - 10;
      const verwacht = oudeSchaalOpPunt(doc, pagina, x, y);
      assert.deepEqual(schaalOpPuntUitBronnen(bronnen, doc, pagina, x, y), verwacht);
      assert.deepEqual(schaalOpPunt(doc, pagina, x, y), verwacht);
      vergeleken++;
    }
    for (const pagina of PAGINAS) {
      assert.deepEqual(schaalgebiedenOpPagina(bronnen, pagina), oudeGebieden(doc, pagina));
    }
  }
  assert.equal(vergeleken, 7500);
});

test("scale regions of equal area keep their list order", () => {
  const a = { type: "scaleRegion", page: 1, x: 0, y: 0, width: 10, height: 20, id: "a" };
  const b = { type: "scaleRegion", page: 1, x: 5, y: 5, width: 20, height: 10, id: "b" };
  const klein = { type: "scaleRegion", page: 1, x: 5, y: 5, width: 5, height: 5, id: "klein" };
  const doc = { annotations: [a, b, klein] };
  assert.deepEqual(schaalgebiedenOpPagina(verzamelSchaalBronnen(doc), 1).map((g) => g.id), ["klein", "a", "b"]);
});

test("a lookup after collecting reads only the sources, not the other annotations", () => {
  const gelezen = new Map();
  const bespied = (a) => new Proxy(a, {
    get(doel, sleutel) {
      gelezen.set(a.id, (gelezen.get(a.id) || 0) + 1);
      return doel[sleutel];
    },
  });
  const annotations = [];
  for (let i = 0; i < 500; i++) annotations.push(bespied({ id: `vak${i}`, type: "box", page: 1, x: i, y: i, width: 5, height: 5 }));
  annotations.push(bespied({ id: "balk", type: "scaleBar", page: 2, pixelsPerUnit: PPU(50), unit: "mm" }));
  const doc = { annotations };
  const bronnen = verzamelSchaalBronnen(doc);
  // Verzamelen leest van elke annotatie alleen het type (en bij een bron de pagina).
  assert.equal(gelezen.get("vak0"), 1);
  assert.equal(gelezen.get("vak499"), 1);
  gelezen.clear();
  for (let i = 0; i < 500; i++) schaalOpPuntUitBronnen(bronnen, doc, 1, i, i);
  assert.deepEqual([...gelezen.keys()], ["balk"], "alleen de schaalbalk wordt nog gelezen");
  assert.deepEqual(schaalOpPuntUitBronnen(bronnen, doc, 1, 3, 3), { pixelsPerUnit: PPU(50), unit: "mm", method: "scaleBar" });
});

test("a page number that is NaN matches nothing, like a strict comparison", () => {
  const vp = { type: "viewport", page: NaN, x: 0, y: 0, width: 100, height: 100, pixelsPerUnit: PPU(10), unit: "mm" };
  const balk = { type: "scaleBar", page: NaN, pixelsPerUnit: PPU(20), unit: "mm" };
  const doc = { annotations: [vp, balk] };
  // Geen viewport en geen schaalbalk "op deze pagina"; wel de schaalbalk elders.
  assert.deepEqual(schaalOpPunt(doc, NaN, 10, 10), { pixelsPerUnit: PPU(20), unit: "mm", method: "scaleBar" });
  assert.deepEqual(oudeSchaalOpPunt(doc, NaN, 10, 10), { pixelsPerUnit: PPU(20), unit: "mm", method: "scaleBar" });
  assert.deepEqual(schaalgebiedenOpPagina(verzamelSchaalBronnen({ annotations: [{ type: "scaleRegion", page: NaN, width: 1, height: 1 }] }), NaN), []);
});
