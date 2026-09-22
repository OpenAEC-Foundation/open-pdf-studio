import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString, degrees } from "pdf-lib";
import { MAX_VEELHOEK, MAX_VIEWPORTS, draaiViewports, leesViewportsVanPagina } from "./pdf-viewports.js";

// Een paginarotatie in de app zet de annotaties over naar de nieuwe
// weergaveruimte; de meetschalen uit de PDF (/VP) moeten dezelfde draai
// krijgen, anders valt een maatlijn buiten elke viewport of in die van de
// buur (#400). De verwachting komt uit opnieuw lezen met /Rotate: de app
// leest een opgeslagen rotatie precies zo.

const PPU_100 = 100 * 25.4 / 72;

async function paginaMetViewports(breedte, hoogte, rotate = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([breedte, hoogte]);
  if (rotate) page.setRotation(degrees(rotate));
  const vp = (bbox, naam, extra = {}) => ({
    Type: "Viewport", BBox: bbox, Name: PDFString.of(naam),
    Measure: { Type: "Measure", Subtype: "RL", R: PDFString.of("1:100"), X: [{ U: PDFString.of("mm"), C: PPU_100, D: 1 }] },
    ...extra,
  });
  page.node.set(PDFName.of("VP"), doc.context.obj([
    vp([100, 100, 1500, 1500], "plattegrond"),
    vp([1600, 200, 2300, 900], "detail", { OPS_Clip: [1600, 200, 2300, 200, 1600, 900] }),
  ]));
  return page;
}

for (const draai of [90, 180, 270]) {
  test(`a viewport on a 2384x1684 sheet turned ${draai} degrees equals a fresh read of the turned page`, async () => {
    const recht = leesViewportsVanPagina(await paginaMetViewports(2384, 1684));
    assert.equal(recht.length, 2);
    const gedraaid = draaiViewports(recht, draai, 2384, 1684);
    const verwacht = leesViewportsVanPagina(await paginaMetViewports(2384, 1684, draai));
    assert.deepEqual(rond(gedraaid), rond(verwacht));
  });
}

test("turning twice by 90 degrees is turning once by 180, and 0 changes nothing", async () => {
  const recht = leesViewportsVanPagina(await paginaMetViewports(2384, 1684));
  const twee = draaiViewports(draaiViewports(recht, 90, 2384, 1684), 90, 1684, 2384);
  assert.deepEqual(rond(twee), rond(draaiViewports(recht, 180, 2384, 1684)));
  assert.deepEqual(draaiViewports(recht, 0, 2384, 1684), recht);
  assert.deepEqual(draaiViewports(recht, 360, 2384, 1684), recht);
  assert.equal(draaiViewports(undefined, 90, 1, 1), undefined);
});

test("the scale and the names survive the turn; only the geometry changes", async () => {
  const recht = leesViewportsVanPagina(await paginaMetViewports(2384, 1684));
  const [a, b] = draaiViewports(recht, 90, 2384, 1684);
  assert.equal(a.name, "plattegrond");
  assert.equal(a.pixelsPerUnit, recht[0].pixelsPerUnit);
  assert.equal(a.unit, "mm");
  assert.equal(b.veelhoek.length, 3);
  // Na 90 graden: de pagina is 1684 breed; de viewport ligt binnen die breedte.
  assert.ok(a.x >= 0 && a.x + a.width <= 1684 + 1e-9);
  assert.ok(a.y >= 0 && a.y + a.height <= 2384 + 1e-9);
});

function rond(lijst) {
  return lijst.map((v) => ({
    ...v,
    x: +v.x.toFixed(6), y: +v.y.toFixed(6), width: +v.width.toFixed(6), height: +v.height.toFixed(6),
    ...(v.veelhoek ? { veelhoek: v.veelhoek.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]) } : {}),
  }));
}

// Een bestand met een absurde /VP-lijst mag het openen van het document niet
// vasthouden: boven de grens (dezelfde 1024 als de lezer van de terugweg naar
// CAD) valt de hele lijst van die pagina weg, met een waarschuwing — nooit een
// halve lijst waar de keuze van de viewport van afhangt (#400).
test("more viewports than the limit drops the whole list of that page, with a warning", async () => {
  const lijstVan = async (aantal) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const vp = {
      Type: "Viewport", BBox: [0, 0, 100, 100],
      Measure: { Type: "Measure", Subtype: "RL", X: [{ U: PDFString.of("mm"), C: PPU_100, D: 1 }] },
    };
    page.node.set(PDFName.of("VP"), doc.context.obj(Array.from({ length: aantal }, () => vp)));
    return page;
  };
  const waarschuwingen = [];
  const oud = console.warn;
  console.warn = (...a) => waarschuwingen.push(a.join(" "));
  try {
    assert.equal(leesViewportsVanPagina(await lijstVan(MAX_VIEWPORTS)).length, MAX_VIEWPORTS, "op de grens: alles");
    assert.equal(waarschuwingen.length, 0);
    assert.equal(leesViewportsVanPagina(await lijstVan(MAX_VIEWPORTS + 1)).length, 0, "erover: niets");
    assert.equal(waarschuwingen.length, 1);
    assert.match(waarschuwingen[0], /1025/);
  } finally {
    console.warn = oud;
  }
});

test("an outline with more points than the limit falls back to the bounding box", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const teVeel = Array.from({ length: 2 * (MAX_VEELHOEK + 1) }, (_, i) => i % 100);
  const precies = Array.from({ length: 2 * MAX_VEELHOEK }, (_, i) => i % 100);
  const vp = (clip) => ({
    Type: "Viewport", BBox: [0, 0, 100, 100], OPS_Clip: clip,
    Measure: { Type: "Measure", Subtype: "RL", X: [{ U: PDFString.of("mm"), C: PPU_100, D: 1 }] },
  });
  page.node.set(PDFName.of("VP"), doc.context.obj([vp(teVeel), vp(precies)]));
  const [zonder, met] = leesViewportsVanPagina(page);
  assert.equal(zonder.veelhoek, undefined);
  assert.equal(met.veelhoek.length, MAX_VEELHOEK);
});

test("only a viewport with a model matrix offers a way back to CAD", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const vp = (extra) => ({
    Type: "Viewport", BBox: [0, 0, 100, 100],
    Measure: { Type: "Measure", Subtype: "RL", X: [{ U: PDFString.of("mm"), C: PPU_100, D: 1 }] },
    ...extra,
  });
  page.node.set(PDFName.of("VP"), doc.context.obj([
    vp({}),
    vp({ OPS_ModelMatrix: [0.1, 0, 0, 0.1, -155000, -463000] }),
    vp({ OPS_ModelMatrix: [1, 0, 0] }),
  ]));
  const [zonder, met, kapot] = leesViewportsVanPagina(page);
  assert.equal(zonder.heeftModelMatrix, undefined);
  assert.equal(met.heeftModelMatrix, true);
  assert.equal(kapot.heeftModelMatrix, undefined);
});
