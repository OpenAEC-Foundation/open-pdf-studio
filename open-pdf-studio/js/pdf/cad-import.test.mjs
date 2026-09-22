import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from "pdf-lib";
import {
  PAPIERFORMATEN, STANDAARDSCHALEN, MM_PER_EENHEID, schaalNaarBoven, schaalTekst, ruimteVan, lagenVoorRuimte,
  standaardUitgesloten, zetNietPlotbaar, filterLagen, sorteerLagen, lagenKeuze, gebiedUitLagen, gebiedMaatMm,
  papierVan, papierVoorstel, importArgumenten, leesWaarschuwingen, leesImportFout, pdfNaamVoor, mapVan, faseWeergave,
  grootteTekst, oorsprongVerschuiving, getalTekst, effectiefDoel, effectiefGebied, isCadTekening, limitsOmvatten, voegLagenSamen,
  gedraaideMaat, decimaalTeken, maakWachtrij, vensterGeldig, buitenBestanden, LAYOUT_PAPIER_STANDAARD,
  papierInstellingen, layoutPagina, papierTeKlein, modelInhoudOpPapier, papierSamenvatting, eenheidMelding, weggelatenLagen,
  kleurTekst, schoonPennen, schoonLetters, schoonZoekpaden, raadLetter, lettersVanScan, lettersVoorTekening,
  metLetterRegel, pennenUitLagen, metNieuwePen, metPenKleur, pendikte, drempelProcent, beeldpuntenGrens, MAX_PENNEN,
  MAX_LETTERS, MAX_ZOEKPADEN, MAX_PENDIKTE_MM, MAX_MEGAPIXELS, PENDIKTE_STANDAARD_MM,
} from "./cad-import-logica.js";
import {
  CAD_IMPORT_STANDAARD, herstelCadImportInstellingen, herstelCadImportVoorinstellingen, metVoorinstelling,
  zonderVoorinstelling, MAX_VOORINSTELLINGEN,
} from "../solid/stores/cad-import-instellingen.js";
import { leesPdfViewports, viewportOp } from "./pdf-viewports.js";
import {
  maakVertrager, voorbeeldMaat, vensterUitVoorbeeld, voorbeeldSleutel, maakBeeldwissel,
} from "./cad-import-voorbeeld.js";
import {
  paginaNoemer, onderleggerFactor, onderleggerVak, rasterPlan, rasterPlanVoorVak, witNaarDoorzichtig, dekkingUitProcent, ONDERLEGGER_DPI,
  MAX_RASTER_PIXELS, MAX_RASTER_ZIJDE, STROOK_PIXELS,
} from "./cad-import-plaatsing.js";

const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const laag = (name, extra = {}) => ({
  name, color: "#FF0000", aci: 1, off: false, frozen: false, locked: false, plottable: true, linetype: "Continuous",
  lineweightMm: null, objects: 0, ...extra,
});

// ── Gelijk aan de crate ────────────────────────────────────────────────────
// Het venster stelt papier en schaal voor met dezelfde regels als de omzetting
// in open-pdf-cad; beide lijsten moeten dus gelijk blijven.
const paperRs = readFileSync(new URL("../../../open-pdf-cad/src/import/paper.rs", import.meta.url), "utf8");

test("paper sizes are the same as in the converter", () => {
  const rust = [...paperRs.matchAll(/PaperSize \{ id: "(\w+)", width_mm: ([\d.]+), height_mm: ([\d.]+)/g)]
    .map((m) => ({ id: m[1], breedte: Number(m[2]), hoogte: Number(m[3]) }));
  assert.ok(rust.length >= 10);
  assert.deepEqual(PAPIERFORMATEN.map((p) => ({ id: p.id, breedte: p.breedte, hoogte: p.hoogte })), rust);
});

test("standard scales are the same as in the converter", () => {
  const begin = paperRs.indexOf("= &[", paperRs.indexOf("pub const STANDARD_SCALES")) + 4;
  const blok = paperRs.slice(begin, paperRs.indexOf("];", begin));
  const rust = [...blok.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  assert.deepEqual([...STANDAARDSCHALEN], rust);
});

test("the remembered paper choices are exactly the paper sizes plus automatic and custom", () => {
  const s = herstelCadImportInstellingen({ paper: "A1L" });
  assert.equal(s.paper, "A1L");
  for (const p of PAPIERFORMATEN) assert.equal(herstelCadImportInstellingen({ paper: p.id }).paper, p.id);
  assert.equal(herstelCadImportInstellingen({ paper: "B5" }).paper, "auto");
});

// ── Schaal ─────────────────────────────────────────────────────────────────
test("fit to paper rounds up to the next standard scale", () => {
  assert.equal(schaalNaarBoven(1), 1);
  assert.equal(schaalNaarBoven(1.0000000001), 1);
  assert.equal(schaalNaarBoven(37), 50);
  assert.equal(schaalNaarBoven(101), 200);
  assert.equal(schaalNaarBoven(220), 250);
  assert.equal(schaalNaarBoven(0.3), 0.5);
  // Boven de lijst: twee significante cijfers naar boven.
  assert.equal(schaalNaarBoven(123456), 130000);
  assert.equal(schaalNaarBoven(0), 1);
  assert.equal(schaalNaarBoven(NaN), 1);
});

test("scale as text", () => {
  assert.equal(schaalTekst(100), "1:100");
  assert.equal(schaalTekst(2.5), "1:2,5");
  assert.equal(schaalTekst(0.5), "2:1");
  assert.equal(schaalTekst(2.5, "."), "1:2.5");
  assert.equal(schaalTekst(-1), "");
});

// ── Ruimte en lagen ────────────────────────────────────────────────────────
const scan = {
  defaultSpace: "Layout1",
  layers: [laag("0"), laag("Wanden", { objects: 5 }), laag("Maten", { off: true }), laag("Hulp", { plottable: false })],
  spaces: [
    { id: "model", kind: "model", bounds: [0, 0, 10, 10], layers: [{ name: "WANDEN", objects: 12, bounds: [0, 0, 10, 5] }] },
    { id: "Layout1", kind: "layout", bounds: [0, 0, 420, 297], layers: [{ name: "Kader", objects: 3, bounds: [0, 0, 420, 297] }] },
  ],
};

test("the chosen space, else the default space, else the first", () => {
  assert.equal(ruimteVan(scan, "model").id, "model");
  assert.equal(ruimteVan(scan, "bestaat-niet").id, "Layout1");
  assert.equal(ruimteVan(null, "model"), null);
});

test("layers carry the count and extent of the chosen space, and layers only found in that space are listed", () => {
  const model = lagenVoorRuimte(scan, "model");
  assert.equal(model.find((l) => l.name === "Wanden").objects, 12);
  assert.deepEqual(model.find((l) => l.name === "Wanden").bounds, [0, 0, 10, 5]);
  assert.equal(model.find((l) => l.name === "Maten").objects, 0);
  const layout = lagenVoorRuimte(scan, "Layout1");
  assert.equal(layout.find((l) => l.name === "Kader").objects, 3);
  assert.equal(layout.length, 5);
});

test("layers that are off or frozen in the file, and non-plotting layers, start excluded", () => {
  const lagen = [laag("A"), laag("B", { off: true }), laag("C", { frozen: true }), laag("D", { plottable: false })];
  assert.deepEqual([...standaardUitgesloten(lagen)].sort(), ["B", "C", "D"]);
  assert.deepEqual([...standaardUitgesloten(lagen, false)].sort(), ["B", "C"]);
});

test("the non-plotting switch only touches non-plotting layers and keeps the rest of the selection", () => {
  const lagen = [laag("A"), laag("B"), laag("D", { plottable: false })];
  const uit = new Set(["B"]);
  assert.deepEqual([...zetNietPlotbaar(lagen, uit, true)].sort(), ["B", "D"]);
  assert.deepEqual([...zetNietPlotbaar(lagen, new Set(["B", "D"]), false)].sort(), ["B"]);
  // De invoer blijft onaangetast.
  assert.deepEqual([...uit], ["B"]);
});

test("the search filter: plain text matches anywhere, * and ? match the whole name", () => {
  const lagen = ["A-WALL", "A-WALL-HATCH", "S-BEAM", "a-door", "WALL"].map((n) => laag(n));
  const namen = (l) => l.map((x) => x.name);
  assert.deepEqual(namen(filterLagen(lagen, "wall")), ["A-WALL", "A-WALL-HATCH", "WALL"]);
  assert.deepEqual(namen(filterLagen(lagen, "A-*")), ["A-WALL", "A-WALL-HATCH", "a-door"]);
  assert.deepEqual(namen(filterLagen(lagen, "*WALL")), ["A-WALL", "WALL"]);
  assert.deepEqual(namen(filterLagen(lagen, "?-BEAM")), ["S-BEAM"]);
  assert.deepEqual(namen(filterLagen(lagen, "  ")), namen(lagen));
  // Regex-tekens in een laagnaam zijn gewone tekens.
  assert.deepEqual(namen(filterLagen([laag("A(1)"), laag("A11")], "A(1)")), ["A(1)"]);
  assert.deepEqual(namen(filterLagen([laag("A.1"), laag("AX1")], "A.*")), ["A.1"]);
});

test("sorting the layer list per column", () => {
  const lagen = [laag("b", { objects: 2 }), laag("A", { objects: 10, off: true }), laag("c", { objects: 1, color: "#0000FF" })];
  const namen = (l) => l.map((x) => x.name);
  assert.deepEqual(namen(sorteerLagen(lagen, "name", true)), ["A", "b", "c"]);
  assert.deepEqual(namen(sorteerLagen(lagen, "name", false)), ["c", "b", "A"]);
  assert.deepEqual(namen(sorteerLagen(lagen, "objects", false)), ["A", "b", "c"]);
  assert.deepEqual(namen(sorteerLagen(lagen, "state", false))[0], "A");
  assert.deepEqual(namen(sorteerLagen(lagen, "color", true))[0], "c");
  assert.deepEqual(namen(sorteerLagen(lagen, null, true)), ["b", "A", "c"]);
  // Laagnummers natuurlijk: 2 voor 10.
  assert.deepEqual(namen(sorteerLagen([laag("L10"), laag("L2")], "name", true)), ["L2", "L10"]);
});

test("excluded layers are left out, or taken along hidden when PDF layers are kept", () => {
  const lagen = [laag("A"), laag("B"), laag("C")];
  const uit = new Set(["B"]);
  assert.deepEqual(lagenKeuze(lagen, uit, { layersAsOcg: true, includeOffLayers: false }), { excludedLayers: ["B"], hiddenLayers: [] });
  assert.deepEqual(lagenKeuze(lagen, uit, { layersAsOcg: true, includeOffLayers: true }), { excludedLayers: [], hiddenLayers: ["B"] });
  // Zonder PDF-lagen kan een laag niet verborgen meekomen: dan blijft hij weg.
  assert.deepEqual(lagenKeuze(lagen, uit, { layersAsOcg: false, includeOffLayers: true }), { excludedLayers: ["B"], hiddenLayers: [] });
});

test("a drawing laid on the page asks for no measuring scale and no model matrix: the snippet drops both", () => {
  const o = { path: "a.dwg", outputPath: "a.pdf", spaces: ["model"] };
  const onderlegger = importArgumenten({ ...CAD_IMPORT_STANDAARD, measure: true, modelMatrix: true }, { ...o, doel: "underlay" });
  assert.equal(onderlegger.measure, false);
  assert.equal(onderlegger.modelMatrix, false);
  // Een nieuw document en een nieuwe pagina houden /VP en /Measure wel.
  for (const doel of ["new", "append", undefined]) {
    const args = importArgumenten({ ...CAD_IMPORT_STANDAARD, measure: true, modelMatrix: true }, { ...o, doel });
    assert.equal(args.measure, true, String(doel));
    assert.equal(args.modelMatrix, true, String(doel));
  }
});

test("a drawing laid on the page leaves hidden layers out: the snippet cannot switch them off", () => {
  const lagen = [laag("A"), laag("B")];
  const uit = new Set(["B"]);
  const inst = { layersAsOcg: true, includeOffLayers: true };
  assert.deepEqual(lagenKeuze(lagen, uit, inst, "underlay"), { excludedLayers: ["B"], hiddenLayers: [] });
  assert.deepEqual(weggelatenLagen(lagen, uit, inst, "underlay"), new Set(["B"]));
  // Een nieuw document en een nieuwe pagina houden de lagenlijst en kunnen ze wel verbergen.
  assert.deepEqual(lagenKeuze(lagen, uit, inst, "new"), { excludedLayers: [], hiddenLayers: ["B"] });
  assert.deepEqual(lagenKeuze(lagen, uit, inst, "append"), { excludedLayers: [], hiddenLayers: ["B"] });
});

// ── Gebied, papier, plaatsing ──────────────────────────────────────────────
test("the area follows the layers that take part", () => {
  const lagen = [laag("A", { bounds: [0, 0, 10, 10] }), laag("B", { bounds: [-5, 2, 3, 30] }), laag("C", { bounds: null })];
  assert.deepEqual(gebiedUitLagen(lagen, new Set()), [-5, 0, 10, 30]);
  assert.deepEqual(gebiedUitLagen(lagen, new Set(["B"])), [0, 0, 10, 10]);
  assert.equal(gebiedUitLagen(lagen, new Set(["A", "B"])), null);
  assert.deepEqual(gebiedMaatMm([0, 0, 10, 5], 1000), { breedte: 10000, hoogte: 5000 });
  assert.equal(gebiedMaatMm(null, 1), null);
});

test("the area counts hidden layers, because the converter draws them and measures them too", () => {
  // Uitgezette kaderlaag van 100 × 100 m, zichtbaar werk van 10 × 10 m.
  const lagen = [laag("WERK", { bounds: [0, 0, 10000, 10000] }), laag("KADER", { bounds: [-45000, -45000, 55000, 55000] })];
  const uit = new Set(["KADER"]);
  // Weggelaten: alleen het werk telt.
  assert.deepEqual(weggelatenLagen(lagen, uit, { layersAsOcg: true, includeOffLayers: false }), new Set(["KADER"]));
  assert.deepEqual(gebiedUitLagen(lagen, weggelatenLagen(lagen, uit, { layersAsOcg: true, includeOffLayers: false })), [0, 0, 10000, 10000]);
  // Verborgen meegenomen: de omzetter tekent het kader ook, dus het blad wordt erom gemaakt.
  assert.deepEqual(weggelatenLagen(lagen, uit, { layersAsOcg: true, includeOffLayers: true }), new Set());
  assert.deepEqual(gebiedUitLagen(lagen, weggelatenLagen(lagen, uit, { layersAsOcg: true, includeOffLayers: true })), [-45000, -45000, 55000, 55000]);
  // Zonder PDF-lagen kan er niets verborgen mee: weggelaten.
  assert.deepEqual(weggelatenLagen(lagen, uit, { layersAsOcg: false, includeOffLayers: true }), new Set(["KADER"]));
});

test("limits are only offered when they enclose the drawing", () => {
  assert.equal(limitsOmvatten([0, 0, 420, 297], [10, 10, 400, 200]), true);
  assert.equal(limitsOmvatten([0, 0, 12, 9], [10, 10, 400, 200]), false);
  assert.equal(limitsOmvatten(null, [0, 0, 1, 1]), false);
});

test("remembered limits that do not enclose the drawing go to the converter as extents, like the dialog shows", () => {
  // Het venster rekent dan met de extents; de omzetter moet hetzelfde gebied krijgen.
  assert.equal(effectiefGebied("limits", false), "extents");
  assert.equal(effectiefGebied("limits", true), "limits");
  assert.equal(effectiefGebied("window", false), "window");
  assert.equal(effectiefGebied("extents", true), "extents");
  const args = importArgumenten({ ...CAD_IMPORT_STANDAARD, area: effectiefGebied("limits", false) }, {
    path: "a.dwg", outputPath: "a.pdf", spaces: ["model"],
  });
  assert.equal(args.area, "extents");
});

test("fit to paper: automatic paper means A3, orientation from the area", () => {
  // 40 × 20 m in mm op A3 liggend met 10 mm marge: 40000/400 = 100 → 1:100.
  const v = papierVoorstel({ breedte: 40000, hoogte: 20000 }, { ...CAD_IMPORT_STANDAARD });
  assert.deepEqual(v, { papier: "A3", liggend: true, schaal: 100, breedteMm: 420, hoogteMm: 297 });
  // Iets groter: naar de volgende standaardschaal.
  assert.equal(papierVoorstel({ breedte: 40001, hoogte: 20000 }, CAD_IMPORT_STANDAARD).schaal, 200);
  // Staand gebied → staand papier.
  assert.equal(papierVoorstel({ breedte: 100, hoogte: 300 }, CAD_IMPORT_STANDAARD).liggend, false);
  // Vast papier A1, passend.
  const a1 = papierVoorstel({ breedte: 40000, hoogte: 20000 }, { ...CAD_IMPORT_STANDAARD, paper: "A1" });
  assert.equal(a1.papier, "A1");
  assert.equal(a1.schaal, 50);
});

test("a fixed scale picks the smallest paper it fits on, including the extended sheets", () => {
  // 25 × 5 m op 1:50 = 500 × 100 mm → A3 liggend is 400 breed binnen de marge,
  // A3L liggend (630 × 297) past wel.
  const v = papierVoorstel({ breedte: 25000, hoogte: 5000 }, { ...CAD_IMPORT_STANDAARD, scale: 50 });
  assert.deepEqual(v, { papier: "A3L", liggend: true, schaal: 50, breedteMm: 630, hoogteMm: 297 });
  // Groter dan A0: maatwerk, naar boven afgerond.
  const groot = papierVoorstel({ breedte: 200000, hoogte: 1000 }, { ...CAD_IMPORT_STANDAARD, scale: 100 });
  assert.equal(groot.papier, "custom");
  assert.equal(groot.breedteMm, 2020);
  // Gedraaid over 90°: breedte en hoogte wisselen.
  const draai = papierVoorstel({ breedte: 25000, hoogte: 5000 }, { ...CAD_IMPORT_STANDAARD, scale: 50, rotation: 90 });
  assert.equal(draai.liggend, false);
  // Oriëntatie vastgezet.
  const staand = papierVoorstel({ breedte: 10000, hoogte: 5000 }, { ...CAD_IMPORT_STANDAARD, scale: 100, orientation: "portrait" });
  assert.equal(staand.liggend, false);
  assert.equal(staand.papier, "A4");
  // Eigen papier.
  const eigen = papierVoorstel({ breedte: 1, hoogte: 1 }, { ...CAD_IMPORT_STANDAARD, scale: 1, paper: "custom", paperWidthMm: 500, paperHeightMm: 300 });
  assert.deepEqual(eigen, { papier: "custom", liggend: true, schaal: 1, breedteMm: 500, hoogteMm: 300 });
});

test("the origin shift is the drawing point that lands on the page corner, as in the converter", () => {
  // Zelfde geval als de cratetest national_coordinates_stay_exact_end_to_end:
  // 10 × 5 m op 1:100, linksonder, 10 mm marge → hoek op (x0 − 1000, y0 − 1000).
  const gebied = [155000000, 463000000, 155010000, 463005000];
  const inst = { ...CAD_IMPORT_STANDAARD, scale: 100, placement: "lower_left", marginMm: 10 };
  const voorstel = papierVoorstel(gebiedMaatMm(gebied, 1), inst);
  assert.deepEqual(oorsprongVerschuiving(gebied, inst, voorstel, 1), { x: 155000000 - 1000, y: 463000000 - 1000 });
  // Gecentreerd op A4 liggend (297 × 210 mm): halve pagina terug vanaf het midden.
  const midden = { ...inst, placement: "center" };
  const v2 = papierVoorstel(gebiedMaatMm(gebied, 1), midden);
  assert.equal(v2.breedteMm, 297);
  assert.deepEqual(oorsprongVerschuiving(gebied, midden, v2, 1), {
    x: 155005000 - (297 / 2) * 100,
    y: 463002500 - (210 / 2) * 100,
  });
  // Op het basispunt: dat punt komt op de marge.
  const oorsprong = { ...inst, placement: "origin" };
  const v3 = papierVoorstel(gebiedMaatMm(gebied, 1), oorsprong);
  assert.deepEqual(oorsprongVerschuiving(gebied, oorsprong, v3, 1, [1000, 2000]), { x: 1000 - 1000, y: 2000 - 1000 });
  assert.equal(oorsprongVerschuiving(null, inst, voorstel, 1), null);
  assert.equal(getalTekst(-155000000, "nl"), "−155.000.000");
  assert.equal(getalTekst(1234.5, "en"), "1,234.5");
  assert.equal(decimaalTeken("nl"), ",");
  assert.equal(decimaalTeken("en"), ".");
});

test("a free rotation grows the area, quarter turns stay exact", () => {
  assert.deepEqual(gedraaideMaat({ breedte: 100, hoogte: 50 }, 0), { breedte: 100, hoogte: 50 });
  assert.deepEqual(gedraaideMaat({ breedte: 100, hoogte: 50 }, 90), { breedte: 50, hoogte: 100 });
  assert.deepEqual(gedraaideMaat({ breedte: 100, hoogte: 50 }, 180), { breedte: 100, hoogte: 50 });
  const schuin = gedraaideMaat({ breedte: 100, hoogte: 50 }, 45);
  assert.ok(Math.abs(schuin.breedte - 106.066) < 0.001 && Math.abs(schuin.hoogte - 106.066) < 0.001);
  // Het papiervoorstel rekent met dat grotere vlak.
  const schuinVoorstel = papierVoorstel({ breedte: 25000, hoogte: 5000 }, { ...CAD_IMPORT_STANDAARD, scale: 50, rotation: 45 });
  assert.ok(schuinVoorstel.breedteMm >= 424 && schuinVoorstel.hoogteMm >= 424, JSON.stringify(schuinVoorstel));
});

test("the queue keeps every dropped drawing, once", () => {
  const rij = maakWachtrij();
  assert.equal(rij.voegToe("a.dwg"), true);
  assert.equal(rij.voegToe("a.dwg"), false, "geen dubbele");
  assert.equal(rij.voegToe("b.pdf"), false, "alleen tekeningen");
  assert.equal(rij.voegToe("c.dxf"), true);
  assert.equal(rij.lengte, 2);
  assert.equal(rij.volgende(), "a.dwg");
  assert.equal(rij.volgende(), "c.dxf");
  assert.equal(rij.volgende(), null);
  rij.voegToe("d.dwg");
  rij.leeg();
  assert.equal(rij.lengte, 0);
});

test("the queue tells its listeners how many drawings wait, so the dialog can show it", () => {
  const rij = maakWachtrij();
  const gezien = [];
  const stop = rij.luister((n) => gezien.push(n));
  rij.voegToe("a.dwg");
  rij.voegToe("a.dwg"); // dubbel: geen wijziging, geen melding
  rij.voegToe("b.dxf");
  assert.deepEqual(gezien, [1, 2]);
  rij.volgende();
  assert.deepEqual(gezien, [1, 2, 1]);
  rij.leeg();
  assert.deepEqual(gezien, [1, 2, 1, 0]);
  stop();
  rij.voegToe("c.dwg");
  assert.deepEqual(gezien, [1, 2, 1, 0], "na afmelden niets meer");
});

test("a window needs a positive width and height", () => {
  assert.equal(vensterGeldig({ x0: 0, y0: 0, x1: 10, y1: 5 }), true);
  assert.equal(vensterGeldig({ x0: 10, y0: 0, x1: 0, y1: 5 }), false);
  assert.equal(vensterGeldig({ x0: 0, y0: 5, x1: 10, y1: 5 }), false);
  assert.equal(vensterGeldig({ x0: 0, y0: 0, x1: NaN, y1: 5 }), false);
});

// ── Doel ───────────────────────────────────────────────────────────────────
test("a new page is only possible with a document open", () => {
  assert.equal(effectiefDoel("append", true), "append");
  assert.equal(effectiefDoel("append", false), "new");
  assert.equal(effectiefDoel("new", true), "new");
  assert.equal(effectiefDoel("iets", true), "new");
});

test("CAD drawings are recognised by extension", () => {
  assert.equal(isCadTekening("C:\\tek\\plan.DWG"), true);
  assert.equal(isCadTekening("/tmp/a.dxf"), true);
  assert.equal(isCadTekening("a.pdf"), false);
  assert.equal(isCadTekening("dwg"), false);
  assert.equal(isCadTekening(null), false);
});

// ── Argumenten voor Rust ───────────────────────────────────────────────────
test("the arguments match the converter's contract (camelCase, only what is set)", () => {
  const args = importArgumenten({ ...CAD_IMPORT_STANDAARD }, {
    path: "a.dwg", outputPath: "a.pdf", spaces: [], excludedLayers: ["X"], hiddenLayers: [], window: [0, 0, 1, 1],
  });
  assert.equal(args.path, "a.dwg");
  assert.equal(args.outputPath, "a.pdf");
  assert.deepEqual(args.spaces, ["model"]);
  assert.deepEqual(args.excludedLayers, ["X"]);
  assert.equal(args.layersAsOcg, true);
  assert.equal(args.measure, true);
  assert.equal(args.area, "extents");
  assert.equal(args.paper, "auto");
  assert.equal(args.placement, "center");
  assert.equal("units" in args, false, "eenheid uit het bestand: niet meesturen");
  assert.equal("scale" in args, false, "passend: geen schaal");
  assert.equal("window" in args, false, "geen venster zonder gebied 'venster'");
  assert.equal("paperWidthMm" in args, false);

  const vast = importArgumenten({ ...CAD_IMPORT_STANDAARD, units: "m", scale: 50, area: "window", paper: "custom", paperWidthMm: 500, paperHeightMm: 300, lineweight: "fixed", lineweightMm: 0.13, measure: false }, {
    path: "a.dxf", outputPath: "b.pdf", spaces: ["Layout1"], window: [1, 2, 3, 4],
  });
  assert.equal(vast.units, "m");
  assert.equal(vast.scale, 50);
  assert.deepEqual(vast.window, [1, 2, 3, 4]);
  assert.equal(vast.paperWidthMm, 500);
  assert.equal(vast.lineweightMm, 0.13);
  assert.equal(vast.measure, false);
  assert.deepEqual(vast.spaces, ["Layout1"]);
  // Alle sleutels zijn velden van ImportArgs in de crate.
  const modRs = readFileSync(new URL("../../../open-pdf-cad/src/import/mod.rs", import.meta.url), "utf8");
  const struct = modRs.slice(modRs.indexOf("pub struct ImportArgs"), modRs.indexOf("impl ImportArgs"));
  const velden = new Set([...struct.matchAll(/pub (\w+):/g)].map((m) => m[1].replace(/_(\w)/g, (_, c) => c.toUpperCase())));
  for (const sleutel of Object.keys(vast)) assert.ok(velden.has(sleutel), `${sleutel} is not a field of ImportArgs`);
  for (const sleutel of Object.keys(args)) assert.ok(velden.has(sleutel), `${sleutel} is not a field of ImportArgs`);
});

test("the footer shows the phase, with a percentage only when the total is known", () => {
  // Verkennen: nog geen melding binnen, dan "lezen" zonder percentage.
  assert.deepEqual(faseWeergave(null, "scan"), { sleutel: "reading", pct: null });
  // Lezen van een DWG heeft geen totaal: onbepaald, ook tijdens het verkennen.
  assert.deepEqual(faseWeergave({ phase: "read", done: 0, total: 0 }, "scan"), { sleutel: "reading", pct: null });
  // Een grote tekst-DXF telt bytes.
  assert.deepEqual(faseWeergave({ phase: "read", done: 50, total: 200 }, "scan"), { sleutel: "phaseRead", pct: 25 });
  // Verkennen telt ruimtes.
  assert.deepEqual(faseWeergave({ phase: "scan", done: 1, total: 3 }, "scan"), { sleutel: "phaseScan", pct: 33 });
  assert.deepEqual(faseWeergave({ phase: "scan", done: 3, total: 3 }, "scan"), { sleutel: "phaseScan", pct: 100 });
  // De import zelf: als voorheen, een onbekend totaal is 0 % in de tekst en een onbepaalde balk.
  assert.deepEqual(faseWeergave(null, "import"), { sleutel: "phaseRead", pct: null });
  assert.deepEqual(faseWeergave({ phase: "draw", done: 5, total: 10 }, "import"), { sleutel: "phaseDraw", pct: 50 });
  assert.deepEqual(faseWeergave({ phase: "write", done: 0, total: 0 }, "import"), { sleutel: "phaseWrite", pct: null });
  assert.deepEqual(faseWeergave({ phase: "open", done: 0, total: 0 }, "import"), { sleutel: "phaseOpen", pct: null });
  // Nooit boven de 100 en nooit een vreemde fase.
  assert.deepEqual(faseWeergave({ phase: "draw", done: 12, total: 10 }, "import"), { sleutel: "phaseDraw", pct: 100 });
  assert.deepEqual(faseWeergave({ phase: "iets", done: 1, total: 2 }, "import"), { sleutel: "phaseRead", pct: 50 });
});

test("warnings and errors from the converter", () => {
  assert.deepEqual(leesWaarschuwingen(["xrefs:3", "viewports3d:1"]), [
    { sleutel: "xrefs", aantal: 3, waarde: "3" },
    { sleutel: "viewports3d", aantal: 1, waarde: "1" },
  ]);
  assert.deepEqual(leesWaarschuwingen(null), []);
  assert.deepEqual(leesImportFout("IMPORT_CANCELLED"), { sleutel: "cancelled" });
  assert.deepEqual(leesImportFout("IMPORT_EMPTY:model"), { sleutel: "emptySpace" });
  assert.deepEqual(leesImportFout("IMPORT_PAGE_TOO_LARGE:6000:3000"), { sleutel: "pageTooLarge", width: "6000", height: "3000" });
  assert.deepEqual(leesImportFout("IMPORT_TOO_OLD:AC1009"), { sleutel: "tooOld", version: "AC1009" });
  assert.deepEqual(leesImportFout("IMPORT_READ:bad header"), { sleutel: "readFailed", error: "bad header" });
  assert.deepEqual(leesImportFout("IMPORT_IO:disk full"), { sleutel: "failed", error: "disk full" });
  // Een pad heeft zelf dubbele punten; het blijft heel.
  assert.deepEqual(leesImportFout("IMPORT_EXISTS:C:\\Temp\\plan.pdf"), { sleutel: "exists", path: "C:\\Temp\\plan.pdf" });
  assert.deepEqual(leesImportFout("IMPORT_WINDOW_INVALID"), { sleutel: "windowInvalid" });
  assert.deepEqual(leesImportFout(new Error("boem")), { sleutel: "failed", error: "boem" });
  // Een te lange tabel wordt al bij het lezen van de argumenten geweigerd; de
  // melding van de app staat er dan omheen.
  assert.deepEqual(
    leesImportFout("invalid args `args` for command `import_cad_to_pdf`: IMPORT_ARGS_TOO_LONG:pens:1024 at line 1 column 9"),
    { sleutel: "argsTooLong", field: "pens", max: "1024" },
  );
  assert.deepEqual(leesImportFout("IMPORT_ARGS_TOO_LONG:searchPaths:16"), { sleutel: "argsTooLong", field: "searchPaths", max: "16" });
});

test("small helpers", () => {
  assert.equal(pdfNaamVoor("C:\\a\\plan.v2.dwg"), "plan.v2.pdf");
  assert.equal(pdfNaamVoor(""), "tekening.pdf");
  assert.equal(mapVan("C:\\a\\plan.dwg"), "C:\\a\\");
  assert.equal(mapVan("plan.dwg"), "");
  assert.equal(grootteTekst(512), "512 B");
  assert.equal(grootteTekst(1536), "1,5 kB");
  assert.equal(grootteTekst(5 * 1024 * 1024), "5 MB");
  assert.equal(papierVan("a3l").id, "A3L");
  assert.equal(papierVan("B5"), null);
  assert.equal(MM_PER_EENHEID.ft, 304.8);
  // Eenheden die alleen uit een bestand kunnen komen ($INSUNITS 3, 7, 10, 14).
  assert.equal(MM_PER_EENHEID.km, 1e6);
  assert.equal(MM_PER_EENHEID.dm, 100);
  assert.equal(MM_PER_EENHEID.yd, 914.4);
  assert.equal(MM_PER_EENHEID.mi, 1609344);
});

test("the base point only goes along when it is the user's own", () => {
  const inst = { ...CAD_IMPORT_STANDAARD, placement: "origin", ownBasePoint: true, basePointX: 1000, basePointY: -2000 };
  const o = { path: "a.dwg", outputPath: "a.pdf", spaces: ["model"] };
  assert.deepEqual(importArgumenten(inst, o).basePoint, [1000, -2000]);
  assert.equal("basePoint" in importArgumenten({ ...inst, ownBasePoint: false }, o), false, "anders $INSBASE uit het bestand");
  assert.equal("basePoint" in importArgumenten({ ...inst, placement: "center" }, o), false);
});

// ── Onthouden instellingen ─────────────────────────────────────────────────
test("remembered settings are validated like the print settings", () => {
  assert.deepEqual(herstelCadImportInstellingen(undefined), CAD_IMPORT_STANDAARD);
  assert.deepEqual(herstelCadImportInstellingen("kapot"), CAD_IMPORT_STANDAARD);
  const s = herstelCadImportInstellingen({
    target: "append", units: "parsec", paper: "A2L", orientation: "landscape", placement: "origin",
    marginMm: 9999, scale: "100", rotation: "x", layersAsOcg: "ja", includeOffLayers: true, measure: false,
    paperWidthMm: -5, onbekend: 1,
  });
  assert.equal(s.target, "append");
  assert.equal(s.units, "file");
  assert.equal(s.paper, "A2L");
  assert.equal(s.orientation, "landscape");
  assert.equal(s.placement, "origin");
  assert.equal(s.marginMm, 200);
  assert.equal(s.scale, 100);
  assert.equal(s.rotation, 0);
  assert.equal(s.layersAsOcg, true);
  assert.equal(s.includeOffLayers, true);
  assert.equal(s.measure, false);
  assert.equal(s.paperWidthMm, 1);
  assert.equal("onbekend" in s, false);
  // Alleen de onthouden (O/V) instellingen: niets uit het bestand.
  for (const k of ["space", "layers", "excludedLayers", "window", "path"]) assert.equal(k in CAD_IMPORT_STANDAARD, false, k);
});

test("presets: named, validated, unique, capped", () => {
  let lijst = metVoorinstelling([], "  Bouw 1:100 ", { scale: 100, paper: "A1" });
  lijst = metVoorinstelling(lijst, "bouw 1:100", { scale: 200 });
  assert.equal(lijst.length, 1);
  assert.equal(lijst[0].name, "bouw 1:100");
  assert.equal(lijst[0].settings.scale, 200);
  assert.equal(lijst[0].settings.paper, "auto");
  assert.deepEqual(metVoorinstelling(lijst, "   ", {}), lijst);
  assert.deepEqual(zonderVoorinstelling(lijst, "BOUW 1:100"), []);
  const veel = Array.from({ length: 30 }, (_, i) => ({ name: `p${i}`, settings: {} }));
  assert.equal(herstelCadImportVoorinstellingen(veel).length, MAX_VOORINSTELLINGEN);
  assert.deepEqual(herstelCadImportVoorinstellingen([{ name: "" }, { settings: {} }, null]), []);
});

// ── PDF-lagen bij "nieuwe pagina" ──────────────────────────────────────────
async function pdfMetLagen() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const ctx = doc.context;
  const wanden = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Wanden") }));
  const maten = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Maten") }));
  const geenLaag = ctx.register(ctx.obj({ MCID: 3 }));
  const props = ctx.obj({});
  props.set(PDFName.of("L0"), wanden);
  props.set(PDFName.of("L1"), maten);
  props.set(PDFName.of("MC0"), geenLaag);
  const resources = page.node.Resources();
  resources.set(PDFName.of("Properties"), props);
  doc.catalog.set(PDFName.of("OCProperties"), ctx.obj({
    OCGs: [wanden, maten],
    D: { Order: [wanden, maten], ON: [wanden], OFF: [maten] },
  }));
  return doc.save();
}

test("inserted pages bring their PDF layers into the catalogue, hidden layers stay hidden", async () => {
  const src = await PDFDocument.load(await pdfMetLagen());
  const dest = await PDFDocument.create();
  dest.addPage([100, 100]);
  const gekopieerd = await dest.copyPages(src, [0]);
  gekopieerd.forEach((p) => dest.addPage(p));
  const pdfLib = { PDFName, PDFArray, PDFDict };
  assert.equal(voegLagenSamen(dest, gekopieerd, pdfLib, src), 2);
  // Twee keer samenvoegen voegt niets dubbel toe.
  assert.equal(voegLagenSamen(dest, gekopieerd, pdfLib, src), 0);

  const opnieuw = await PDFDocument.load(await dest.save());
  const oc = opnieuw.catalog.lookup(PDFName.of("OCProperties"));
  const naam = (ref) => opnieuw.context.lookup(ref).lookup(PDFName.of("Name")).decodeText();
  const namen = (arr) => (arr ? arr.asArray().map(naam) : []);
  const d = oc.lookup(PDFName.of("D"));
  assert.deepEqual(namen(oc.lookup(PDFName.of("OCGs"))), ["Wanden", "Maten"]);
  assert.deepEqual(namen(d.lookup(PDFName.of("ON"))), ["Wanden"]);
  assert.deepEqual(namen(d.lookup(PDFName.of("OFF"))), ["Maten"]);
  assert.deepEqual(namen(d.lookup(PDFName.of("Order"))), ["Wanden", "Maten"]);
});

test("existing layers keep their place, inline layers become objects, duplicate names get the source", async () => {
  // Doel met een eigen laag zonder /Order (zoals veel PDF's), bron met een
  // laag die rechtstreeks in /Properties staat en dezelfde naam heeft.
  const dest = await PDFDocument.create();
  const eigenPagina = dest.addPage([100, 100]);
  const eigen = dest.context.register(dest.context.obj({ Type: "OCG", Name: PDFString.of("Wanden") }));
  const props = dest.context.obj({});
  props.set(PDFName.of("L0"), eigen);
  eigenPagina.node.Resources().set(PDFName.of("Properties"), props);
  dest.catalog.set(PDFName.of("OCProperties"), dest.context.obj({ OCGs: [eigen], D: { ON: [eigen] } }));

  const src = await PDFDocument.create();
  const srcPagina = src.addPage([100, 100]);
  const inline = src.context.obj({ Type: "OCG", Name: PDFString.of("Wanden") });
  const srcProps = src.context.obj({});
  srcProps.set(PDFName.of("L0"), inline);
  srcPagina.node.Resources().set(PDFName.of("Properties"), srcProps);

  const gekopieerd = await dest.copyPages(src, [0]);
  gekopieerd.forEach((p) => dest.addPage(p));
  assert.equal(voegLagenSamen(dest, gekopieerd, { PDFName, PDFArray, PDFDict, PDFString }, src, "plan.dwg"), 1);

  const opnieuw = await PDFDocument.load(await dest.save());
  const oc = opnieuw.catalog.lookup(PDFName.of("OCProperties"));
  const naam = (ref) => opnieuw.context.lookup(ref).lookup(PDFName.of("Name")).decodeText();
  const namen = (arr) => (arr ? arr.asArray().map(naam) : []);
  const d = oc.lookup(PDFName.of("D"));
  assert.deepEqual(namen(oc.lookup(PDFName.of("OCGs"))), ["Wanden", "Wanden (plan.dwg)"]);
  assert.deepEqual(namen(d.lookup(PDFName.of("Order"))), ["Wanden", "Wanden (plan.dwg)"], "de bestaande laag blijft in de volgorde");
  assert.deepEqual(namen(d.lookup(PDFName.of("ON"))), ["Wanden", "Wanden (plan.dwg)"]);
  // De laag van de ingevoegde pagina is nu een eigen object, geen inline woordenboek.
  const ingevoegd = opnieuw.getPages()[1].node.Resources().lookup(PDFName.of("Properties")).get(PDFName.of("L0"));
  assert.equal(ingevoegd.constructor.name, "PDFRef");
});

test("pages without layers leave the catalogue alone", async () => {
  const src = await PDFDocument.create();
  src.addPage([10, 10]);
  const dest = await PDFDocument.create();
  const gekopieerd = await dest.copyPages(src, [0]);
  assert.equal(voegLagenSamen(dest, gekopieerd, { PDFName, PDFArray, PDFDict }, src), 0);
  assert.equal(dest.catalog.lookup(PDFName.of("OCProperties")), undefined);
});

test("a duplicate layer name with characters outside ASCII stays readable", async () => {
  const naamMetTekens = "Wände – 壁";
  const dest = await PDFDocument.create();
  dest.addPage([100, 100]);
  const eigen = dest.context.register(dest.context.obj({ Type: "OCG", Name: PDFHexString.fromText(naamMetTekens) }));
  dest.catalog.set(PDFName.of("OCProperties"), dest.context.obj({ OCGs: [eigen], D: { ON: [eigen] } }));

  const src = await PDFDocument.create();
  const srcPagina = src.addPage([100, 100]);
  const laagRef = src.context.register(src.context.obj({ Type: "OCG", Name: PDFHexString.fromText(naamMetTekens) }));
  const srcProps = src.context.obj({});
  srcProps.set(PDFName.of("L0"), laagRef);
  srcPagina.node.Resources().set(PDFName.of("Properties"), srcProps);

  const gekopieerd = await dest.copyPages(src, [0]);
  gekopieerd.forEach((p) => dest.addPage(p));
  const pdfLib = { PDFName, PDFArray, PDFDict, PDFString, PDFHexString };
  assert.equal(voegLagenSamen(dest, gekopieerd, pdfLib, src, "plän.dwg"), 1);

  const opnieuw = await PDFDocument.load(await dest.save());
  const oc = opnieuw.catalog.lookup(PDFName.of("OCProperties"));
  const namen = oc.lookup(PDFName.of("OCGs")).asArray().map((ref) => opnieuw.context.lookup(ref).lookup(PDFName.of("Name")).decodeText());
  assert.deepEqual(namen, [naamMetTekens, `${naamMetTekens} (plän.dwg)`]);
});

test("an inline layer that sits on several inserted pages is registered once", async () => {
  const src = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const pagina = src.addPage([100, 100]);
    const props = src.context.obj({});
    // Elke pagina heeft haar eigen inline woordenboek voor dezelfde laag.
    props.set(PDFName.of("L0"), src.context.obj({ Type: "OCG", Name: PDFString.of("Wanden") }));
    if (i === 2) props.set(PDFName.of("L1"), src.context.obj({ Type: "OCG", Name: PDFString.of("Maten") }));
    pagina.node.Resources().set(PDFName.of("Properties"), props);
  }
  const dest = await PDFDocument.create();
  dest.addPage([100, 100]);
  const gekopieerd = await dest.copyPages(src, [0, 1, 2]);
  gekopieerd.forEach((p) => dest.addPage(p));
  const pdfLib = { PDFName, PDFArray, PDFDict, PDFString, PDFHexString };
  assert.equal(voegLagenSamen(dest, gekopieerd, pdfLib, src, "plan.dwg"), 2);

  const opnieuw = await PDFDocument.load(await dest.save());
  const oc = opnieuw.catalog.lookup(PDFName.of("OCProperties"));
  const namen = oc.lookup(PDFName.of("OCGs")).asArray().map((ref) => opnieuw.context.lookup(ref).lookup(PDFName.of("Name")).decodeText());
  assert.deepEqual(namen, ["Wanden", "Maten"], "één laag Wanden, niet drie met een achtervoegsel");
  const verwijzingen = opnieuw.getPages().slice(1).map((p) => String(p.node.Resources().lookup(PDFName.of("Properties")).get(PDFName.of("L0"))));
  assert.equal(new Set(verwijzingen).size, 1, "alle pagina's wijzen naar hetzelfde laagobject");
  assert.match(verwijzingen[0], /^\d+ \d+ R$/);
});

// ── Meetgebied van een niet-rechthoekig venster ─────────────────────────────
// De import schrijft de omhullende in /BBox en de vorm zelf in /OPS_Clip. Een
// punt binnen de omhullende maar buiten de vorm hoort bij het buurvenster, ook
// als dat groter is (#400).
test("a point outside the shape of a clipped viewport goes to its neighbour", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const measure = (c, r) => doc.context.obj({
    Type: "Measure", Subtype: "RL", R: PDFString.of(r),
    X: [doc.context.obj({ U: PDFString.of("mm"), C: c, D: 1 })],
  });
  page.node.set(PDFName.of("VP"), doc.context.obj([
    doc.context.obj({ Type: "Viewport", BBox: [0, 0, 400, 300], Name: PDFString.of("Blad"), Measure: measure(0.35278, "1:1") }),
    // Groot buurvenster dat de lege hoek van de driehoek overlapt.
    doc.context.obj({ Type: "Viewport", BBox: [60, 60, 380, 280], Name: PDFString.of("Buur"), Measure: measure(35.278, "1:100") }),
    // Driehoek met de rechte hoek linksonder: (10,10) (110,10) (10,110).
    doc.context.obj({
      Type: "Viewport", BBox: [10, 10, 110, 110], Name: PDFString.of("Driehoek"), Measure: measure(17.639, "1:50"),
      OPS_Clip: [10, 10, 110, 10, 10, 110],
    }),
    // Een kapotte vorm (oneven aantal getallen) valt terug op de omhullende.
    doc.context.obj({
      Type: "Viewport", BBox: [300, 10, 340, 50], Name: PDFString.of("Kapot"), Measure: measure(17.639, "1:50"),
      OPS_Clip: [300, 10, 340, 10, 300],
    }),
  ]));
  const vps = leesPdfViewports(await PDFDocument.load(await doc.save()))[1];
  const driehoek = vps.find((v) => v.name === "Driehoek");
  assert.equal(driehoek.veelhoek.length, 3);
  // App-ruimte: y omlaag vanaf de bovenrand (300 hoog).
  assert.deepEqual(driehoek.veelhoek[0], [10, 290]);
  assert.equal(vps.find((v) => v.name === "Kapot").veelhoek, undefined);
  const op = (x, yPdf) => viewportOp(vps, x, 300 - yPdf)?.name;
  assert.equal(op(30, 30), "Driehoek", "binnen de vorm");
  assert.equal(op(100, 100), "Buur", "binnen de omhullende, buiten de vorm: het grotere buurvenster");
  assert.equal(op(20, 105), "Blad", "buiten de vorm en buiten de buur: het blad");
  assert.equal(op(320, 30), "Kapot");
});

// ── Meetschaal zoals de import hem schrijft ────────────────────────────────
// De PDF is door de crate geschreven (test the_fixture_for_the_app_matches_
// what_the_crate_writes in open-pdf-cad): 10 × 5 m in meters, 1:100,
// linksonder op 10 mm marge.
test("the measure scale the crate writes gives true lengths in the app", async () => {
  const bytes = readFileSync(new URL("./fixtures/cad-import-rechthoek-m.pdf", import.meta.url));
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  // De inhoud uitpakken en de hoeken van de rechthoek zoeken.
  const stream = page.node.lookup(PDFName.of("Contents"));
  const content = inflateSync(Buffer.from(stream.getContents())).toString("latin1");
  const pt = 72 / 25.4;
  const left = 10 * pt;
  const right = left + 100 * pt;
  const f = (v) => String(Math.round(v * 1000) / 1000);
  assert.ok(content.includes(`${f(left)} ${f(left)}`), "hoek linksonder");
  assert.ok(content.includes(`${f(right)} ${f(left)}`), "hoek rechtsonder");

  const vp = leesPdfViewports(doc);
  const { height } = page.getSize();
  // App-ruimte: y omlaag vanaf de bovenrand.
  const v = viewportOp(vp[1], (left + right) / 2, height - left);
  assert.ok(v, "geen viewport onder de rechthoek");
  assert.equal(v.unit, "m");
  assert.equal(v.ratio, "1:100");
  const lengte = (right - left) / v.pixelsPerUnit;
  assert.ok(bijna(lengte, 10, 1e-9), `10 m gemeten als ${lengte}`);
});

// ── Tekst zoals de import hem schrijft ─────────────────────────────────────
// Tweede PDF van de crate (test the_text_fixture_for_the_app_matches_what_the_
// crate_writes): dezelfde rechthoek in millimeters met een TEXT op de
// standaardstijl, invoegpunt (1000, 2000), hoogte 500, op 1:100.
test("the text the crate writes sits where the drawing puts it", async () => {
  const bytes = readFileSync(new URL("./fixtures/cad-import-tekst.pdf", import.meta.url));
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  // De letterbron: de standaardstijl wordt de schreefloze standaardletter.
  const fonts = page.node.Resources().lookup(PDFName.of("Font"));
  assert.ok(fonts instanceof PDFDict, "geen /Font in de bronnen");
  const f1 = fonts.lookup(PDFName.of("F1"));
  assert.equal(String(f1.lookup(PDFName.of("BaseFont"))), "/Helvetica");
  assert.equal(String(f1.lookup(PDFName.of("Encoding"))), "/WinAnsiEncoding");

  const stream = page.node.lookup(PDFName.of("Contents"));
  const content = inflateSync(Buffer.from(stream.getContents())).toString("latin1");
  const m = content.match(/BT \/F1 1 Tf ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) Tm \(Woonkamer 24 m2\) Tj ET/);
  assert.ok(m, `tekstopdracht niet gevonden in:\n${content}`);
  const pt = 72 / 25.4;
  // Invoegpunt: 10 mm marge + 1000/100 mm en + 2000/100 mm.
  assert.ok(bijna(Number(m[3]), 20 * pt, 1e-3), `x = ${m[3]}`);
  assert.ok(bijna(Number(m[4]), 30 * pt, 1e-3), `y = ${m[4]}`);
  // Hoofdletterhoogte 500 op 1:100 = 5 mm; de letter heeft 0,72 em aan hoofdletter.
  assert.ok(bijna(Number(m[1]) * 0.72, 5 * pt, 0.05), `korps ${m[1]}`);
  assert.equal(m[1], m[2], "niet versmald");
  // De tekst staat op zijn eigen laag.
  assert.match(content, /\/OC \/L1 BDC\s+0 g\s+BT/);
});

// ── Bestanden van buiten de tekening ───────────────────────────────────────
test("files from outside the drawing are grouped by what happened to them", () => {
  const lijst = [
    { name: "gevel.dwg", kind: "xref", status: "loaded" },
    { name: "kaart.png", kind: "image", status: "loaded" },
    { name: "weg.dwg", kind: "xref", status: "missing" },
    { name: "net.dwg", kind: "xref", status: "refused" },
    { name: "NUL.dwg", kind: "xref", status: "oddName" },
    { name: "bom.png", kind: "image", status: "tooLarge" },
    { name: "kapot.png", kind: "image", status: "unsupported" },
    { name: "naast.dxf", kind: "xref", status: "found" },
  ];
  assert.deepEqual(buitenBestanden(lijst, false), [
    { sleutel: "externalsFound", namen: "naast.dxf" },
    { sleutel: "externalsUsed", namen: "gevel.dwg, kaart.png" },
    { sleutel: "externalsMissing", namen: "weg.dwg" },
    { sleutel: "externalsRefused", namen: "net.dwg, NUL.dwg, bom.png, kapot.png" },
  ]);
  // Niets te melden: geen regels.
  assert.deepEqual(buitenBestanden([], false), []);
  assert.deepEqual(buitenBestanden(undefined, undefined), []);
  // Een lange lijst wordt ingekort, en een afgekapt verslag eindigt op een beletselteken.
  const veel = Array.from({ length: 30 }, (_, i) => ({ name: `b${i}.png`, kind: "image", status: "missing" }));
  const [regel] = buitenBestanden(veel, false);
  assert.equal(regel.namen.split(", ").length, 13);
  assert.ok(regel.namen.endsWith(", …"));
  assert.ok(buitenBestanden(lijst.slice(0, 1), true)[0].namen.endsWith(", …"));
  // Alleen een naam: wat op een pad lijkt, wordt tot de naam teruggebracht.
  assert.deepEqual(buitenBestanden([{ name: "C:\\geheim\\x.dwg", kind: "xref", status: "loaded" }, { name: 7, status: "loaded" }], false), [
    { sleutel: "externalsUsed", namen: "x.dwg" },
  ]);
});

// ── Papier van een layout, en de statusregel ───────────────────────────────
test("remembered paper belongs to the model space; a layout starts with its own paper", () => {
  const onthouden = { ...CAD_IMPORT_STANDAARD, paper: "A3", orientation: "landscape", paperWidthMm: 500, paperHeightMm: 300 };
  // Modelruimte: wat onthouden is, geldt.
  assert.deepEqual(papierInstellingen(onthouden, true, LAYOUT_PAPIER_STANDAARD), {
    paper: "A3", orientation: "landscape", paperWidthMm: 500, paperHeightMm: 300,
  });
  // Layout: het papier van de layout, wat er ook onthouden is.
  assert.equal(LAYOUT_PAPIER_STANDAARD.paper, "auto");
  assert.deepEqual(papierInstellingen(onthouden, false, LAYOUT_PAPIER_STANDAARD), {
    paper: "auto", orientation: "auto", paperWidthMm: 297, paperHeightMm: 420,
  });
  // Kiest de gebruiker bij de layout zelf een formaat, dan geldt dat.
  assert.equal(papierInstellingen(onthouden, false, { ...LAYOUT_PAPIER_STANDAARD, paper: "A1" }).paper, "A1");
  // En zo gaat het ook naar de omzetting.
  const args = importArgumenten({ ...onthouden, ...papierInstellingen(onthouden, false, LAYOUT_PAPIER_STANDAARD) }, {
    path: "a.dwg", outputPath: "a.pdf", spaces: ["Blad 1"],
  });
  assert.equal(args.paper, "auto");
  assert.equal(args.paperWidthMm, undefined);
});

test("the page of a layout follows the choice the converter makes", () => {
  const blad = { name: "ISO A0+", widthMm: 841, heightMm: 1260, rotation: 0, mmPerUnit: 1 };
  // Van de layout: haar eigen maat; een kwartslag gedraaid geplot wisselt de zijden.
  assert.deepEqual(layoutPagina(LAYOUT_PAPIER_STANDAARD, blad, null), {
    papier: "layout", breedteMm: 841, hoogteMm: 1260, liggend: false, bekend: true,
  });
  assert.deepEqual(layoutPagina(LAYOUT_PAPIER_STANDAARD, { ...blad, rotation: 1 }, null), {
    papier: "layout", breedteMm: 1260, hoogteMm: 841, liggend: true, bekend: true,
  });
  // Geen bruikbare maat in het bestand: de omzetting kiest zelf.
  assert.equal(layoutPagina(LAYOUT_PAPIER_STANDAARD, { ...blad, widthMm: 0 }, null).bekend, false);
  assert.equal(layoutPagina(LAYOUT_PAPIER_STANDAARD, null, null).bekend, false);
  // Een gekozen formaat: liggend of staand volgt de inhoud, anders het blad.
  const a3 = { ...LAYOUT_PAPIER_STANDAARD, paper: "A3" };
  assert.deepEqual(layoutPagina(a3, blad, { breedte: 800, hoogte: 1200 }), {
    papier: "A3", breedteMm: 297, hoogteMm: 420, liggend: false, bekend: true,
  });
  assert.deepEqual(layoutPagina(a3, blad, { breedte: 1200, hoogte: 800 }), {
    papier: "A3", breedteMm: 420, hoogteMm: 297, liggend: true, bekend: true,
  });
  assert.equal(layoutPagina(a3, { ...blad, widthMm: 1260, heightMm: 841 }, null).liggend, true);
  assert.equal(layoutPagina({ ...a3, orientation: "landscape" }, blad, { breedte: 1, hoogte: 9 }).liggend, true);
  assert.equal(layoutPagina({ ...a3, orientation: "portrait" }, blad, { breedte: 9, hoogte: 1 }).liggend, false);
  // Eigen maat.
  assert.deepEqual(layoutPagina({ ...a3, paper: "custom", paperWidthMm: 900, paperHeightMm: 600 }, blad, null), {
    papier: "custom", breedteMm: 900, hoogteMm: 600, liggend: true, bekend: true,
  });
});

test("content that does not fit on the chosen paper is reported", () => {
  // Een layout van 841 x 1260 mm op A3: dat wordt afgekapt.
  const a3 = layoutPagina({ ...LAYOUT_PAPIER_STANDAARD, paper: "A3" }, null, { breedte: 841, hoogte: 1260 });
  assert.deepEqual(papierTeKlein({ breedte: 841, hoogte: 1260 }, a3), { width: 841, height: 1260 });
  assert.equal(papierTeKlein({ breedte: 297, hoogte: 420 }, a3), null, "precies passend is passend");
  assert.equal(papierTeKlein({ breedte: 297.4, hoogte: 420 }, a3), null, "een halve millimeter speling");
  assert.deepEqual(papierTeKlein({ breedte: 298, hoogte: 100 }, a3), { width: 298, height: 100 });
  // Het papier van de layout zelf, of een onbekende maat: geen melding.
  const eigen = layoutPagina(LAYOUT_PAPIER_STANDAARD, { widthMm: 841, heightMm: 1260, rotation: 0 }, null);
  assert.equal(papierTeKlein({ breedte: 2000, hoogte: 2000 }, eigen), null);
  assert.equal(papierTeKlein(null, a3), null);
  assert.equal(papierTeKlein({ breedte: 10, hoogte: 10 }, null), null);

  // Modelruimte: een vaste schaal op een gekozen formaat kan te klein zijn,
  // "passend" past altijd.
  const inst = { ...CAD_IMPORT_STANDAARD, paper: "A4", scale: 100, marginMm: 10 };
  const maat = { breedte: 40000, hoogte: 20000 };
  const v = papierVoorstel(maat, inst);
  assert.deepEqual(modelInhoudOpPapier(maat, inst, v), { breedte: 420, hoogte: 220 });
  assert.deepEqual(papierTeKlein(modelInhoudOpPapier(maat, inst, v), { ...v, bekend: true }), { width: 420, height: 220 });
  const passend = { ...inst, scale: 0 };
  const vp = papierVoorstel(maat, passend);
  assert.equal(papierTeKlein(modelInhoudOpPapier(maat, passend, vp), { ...vp, bekend: true }), null);
  assert.equal(modelInhoudOpPapier(null, inst, v), null);
});

test("the status line names the paper that is really used", () => {
  const a3 = { papier: "A3", breedteMm: 420, hoogteMm: 297, liggend: true, schaal: 50 };
  // Modelruimte: het voorstel.
  assert.deepEqual(papierSamenvatting(true, a3, null), { papier: "A3", breedteMm: 420, hoogteMm: 297, liggend: true, schaal: 50 });
  // Modelruimte zonder voorstel (ongeldig venster): niets over papier, en zeker niet "van de layout".
  assert.equal(papierSamenvatting(true, null, null), null);
  assert.equal(papierSamenvatting(true, null, { papier: "layout", bekend: false }), null);
  // Layout met een gekozen formaat: dat formaat, op 1:1.
  const gekozen = layoutPagina({ ...LAYOUT_PAPIER_STANDAARD, paper: "A3" }, null, { breedte: 10, hoogte: 5 });
  assert.deepEqual(papierSamenvatting(false, null, gekozen), { papier: "A3", breedteMm: 420, hoogteMm: 297, liggend: true, schaal: 1 });
  // Layout met haar eigen papier: de maat als die bekend is, anders alleen "van de layout".
  const eigen = layoutPagina(LAYOUT_PAPIER_STANDAARD, { widthMm: 841, heightMm: 1260, rotation: 0 }, null);
  assert.deepEqual(papierSamenvatting(false, null, eigen), { papier: "layout", breedteMm: 841, hoogteMm: 1260, liggend: false, schaal: 1 });
  assert.deepEqual(papierSamenvatting(false, null, layoutPagina(LAYOUT_PAPIER_STANDAARD, null, null)), { papier: "layout", breedteMm: 0, hoogteMm: 0, liggend: false, schaal: 1 });
  // Een voorstel van de modelruimte telt niet bij een layout.
  assert.equal(papierSamenvatting(false, a3, eigen).papier, "layout");
});

// ── Eenheid ────────────────────────────────────────────────────────────────
test("the note next to the unit says what the file really says", () => {
  // Het bestand noemt geen eenheid (code 0).
  assert.deepEqual(eenheidMelding({ code: 0, unit: "", fromFile: false }, "file"), { sleutel: "noUnits" });
  // Het noemt er wel een, maar een die de import niet kent.
  assert.deepEqual(eenheidMelding({ code: 17, unit: "", fromFile: false }, "file"), { sleutel: "warn_unitsUnsupported", value: 17 });
  // Een bekende eenheid, of een eigen keuze van de gebruiker: geen melding.
  assert.equal(eenheidMelding({ code: 4, unit: "mm", fromFile: true }, "file"), null);
  assert.equal(eenheidMelding({ code: 17, unit: "", fromFile: false }, "m"), null);
  assert.equal(eenheidMelding(null, "file"), null);
});

// ── Tabblad Weergave: kleurentabel ─────────────────────────────────────────
test("the colour table keeps only valid colours and line weights", () => {
  assert.equal(kleurTekst("#ff00aa"), "#FF00AA");
  assert.equal(kleurTekst(" 00ff00 "), "#00FF00");
  for (const fout of ["rood", "#fff", "#12345g", "#1234567", "", null, undefined, 255, {}]) assert.equal(kleurTekst(fout), null);
  assert.equal(pendikte("0,35"), 0.35);
  assert.equal(pendikte(0), 0);
  for (const fout of ["", " ", "dik", -0.1, MAX_PENDIKTE_MM + 0.01, NaN, Infinity, null, true, []]) assert.equal(pendikte(fout), null);
  assert.deepEqual(
    schoonPennen([
      { color: "#ff0000", lineweightMm: 0.35 },
      { color: "00FF00", lineweightMm: "0.5" },
      { color: "rood", lineweightMm: 1 },
      { color: "#0000FF", lineweightMm: -1 },
      { color: "#0000FF", lineweightMm: 99 },
      { color: "#0000FF", lineweightMm: "" },
      null,
      "tekst",
    ]),
    [
      { color: "#FF0000", lineweightMm: 0.35 },
      { color: "#00FF00", lineweightMm: 0.5 },
    ],
  );
  for (const fout of [null, undefined, "geen lijst", {}, 5]) assert.deepEqual(schoonPennen(fout), []);
});

test("a colour has one rule in the colour table: the last one wins, as in the converter", () => {
  assert.deepEqual(
    schoonPennen([
      { color: "#FF0000", lineweightMm: 0.18 },
      { color: "#00FF00", lineweightMm: 0.5 },
      { color: "#ff0000", lineweightMm: 0.7 },
    ]),
    [{ color: "#FF0000", lineweightMm: 0.7 }, { color: "#00FF00", lineweightMm: 0.5 }],
  );
});

test("the colour table stops at its limit, and at the converter's if that is lower", () => {
  const veel = Array.from({ length: MAX_PENNEN + 50 }, (_, i) => ({ color: `#${i.toString(16).padStart(6, "0")}`, lineweightMm: 0.2 }));
  assert.equal(schoonPennen(veel).length, MAX_PENNEN);
  assert.equal(schoonPennen(veel, 10).length, 10);
  assert.equal(schoonPennen(veel, 1e9).length, MAX_PENNEN, "de omzetter mag meer kunnen, het venster niet");
  assert.equal(schoonPennen(veel, "onzin").length, MAX_PENNEN);
  // Een latere regel voor een kleur die er al in staat telt ook in een volle tabel.
  const vol = schoonPennen([...veel.slice(0, 10), { color: "#000003", lineweightMm: 1 }], 10);
  assert.equal(vol.length, 10);
  assert.equal(vol[3].lineweightMm, 1);
});

test("the layer colours of the drawing join the colour table without touching what is there", () => {
  const lagen = [
    laag("0", { color: "#FFFFFF", lineweightMm: null }),
    laag("Wanden", { color: "#FF0000", lineweightMm: 0.5 }),
    laag("Wanden 2", { color: "#ff0000", lineweightMm: 0.7 }),
    laag("Maten", { color: "#00FF00", lineweightMm: 0 }),
    laag("Kapot", { color: "geen kleur" }),
  ];
  assert.deepEqual(pennenUitLagen([{ color: "#FF0000", lineweightMm: 0.13 }], lagen), [
    { color: "#FF0000", lineweightMm: 0.13 },
    { color: "#FFFFFF", lineweightMm: PENDIKTE_STANDAARD_MM },
    { color: "#00FF00", lineweightMm: PENDIKTE_STANDAARD_MM },
  ]);
  // De dikte van de eerste laag met die kleur is het begin.
  assert.deepEqual(pennenUitLagen([], lagen.slice(1, 3)), [{ color: "#FF0000", lineweightMm: 0.5 }]);
  assert.equal(pennenUitLagen([], lagen, 2).length, 2);
  assert.deepEqual(pennenUitLagen("onzin", null), []);
});

test("a new rule in the colour table takes a colour that has no rule yet", () => {
  assert.deepEqual(metNieuwePen([], []), [{ color: "#000000", lineweightMm: PENDIKTE_STANDAARD_MM }]);
  assert.deepEqual(metNieuwePen([{ color: "#000000", lineweightMm: 1 }], ["#000000", "#ff0000"]).map((p) => p.color), ["#000000", "#FF0000"]);
  // Geen laagkleur meer vrij en zwart bezet: de eerste vrije grijstint.
  assert.equal(metNieuwePen([{ color: "#000000", lineweightMm: 1 }], []).at(-1).color, "#010101");
  const vol = [{ color: "#000000", lineweightMm: 1 }, { color: "#111111", lineweightMm: 1 }];
  assert.deepEqual(metNieuwePen(vol, [], 2), vol, "een volle tabel groeit niet");
});

test("changing a colour in the table never makes two rules for one colour", () => {
  const pennen = [{ color: "#FF0000", lineweightMm: 0.5 }, { color: "#00FF00", lineweightMm: 0.25 }];
  assert.deepEqual(metPenKleur(pennen, 1, "#0000ff"), [pennen[0], { color: "#0000FF", lineweightMm: 0.25 }]);
  assert.deepEqual(metPenKleur(pennen, 1, "#00ff00"), pennen, "dezelfde kleur mag");
  assert.equal(metPenKleur(pennen, 1, "#ff0000"), null);
  assert.equal(metPenKleur(pennen, 1, "rood"), null);
  assert.equal(metPenKleur(pennen, 5, "#123456"), null);
  assert.equal(metPenKleur(null, 0, "#123456"), null);
});

// ── Tabblad Weergave: lettertabel ──────────────────────────────────────────
const textRs = readFileSync(new URL("../../../open-pdf-cad/src/import/text.rs", import.meta.url), "utf8");

test("a font name is guessed exactly as the converter guesses it", () => {
  // Dezelfde namen als de test van de omzetter, uit de bron gelezen.
  const begin = textRs.indexOf("fn mono_is_matched_on_a_word_not_inside_one");
  const blok = textRs.slice(begin, textRs.indexOf("#[test]", begin));
  const lijsten = [...blok.matchAll(/for name in \[([^\]]+)\]/g)].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((n) => n[1]));
  assert.equal(lijsten.length, 2);
  assert.ok(lijsten[0].length >= 5 && lijsten[1].length >= 10);
  for (const naam of lijsten[0]) assert.equal(raadLetter(naam).family, "sans", naam);
  for (const naam of lijsten[1]) assert.equal(raadLetter(naam).family, "mono", naam);
  assert.equal(raadLetter("C:/letters/mono/arial.ttf").family, "sans", "een map in het pad telt niet mee");
  assert.deepEqual(raadLetter("romans.shx"), { family: "sans", bold: false, italic: false });
  assert.deepEqual(raadLetter("Arial Bold Italic"), { family: "sans", bold: true, italic: true });
  assert.deepEqual(raadLetter("courier-oblique-heavy.ttf"), { family: "mono", bold: true, italic: true });
  assert.deepEqual(raadLetter(null), { family: "sans", bold: false, italic: false });
});

test("the font table keeps only rules the converter understands", () => {
  assert.deepEqual(
    schoonLetters([
      { from: " romans.shx ", family: "mono", bold: true, italic: "ja" },
      { from: "", family: "sans" },
      { from: "arial.ttf", family: "schreef" },
      { from: "stuur\u0007teken.shx", family: "sans" },
      { from: "x".repeat(300), family: "sans" },
      { from: 12, family: "sans" },
      null,
      { from: "Txt.shx", family: "sans", bold: false, italic: true },
    ]),
    [
      { from: "romans.shx", family: "mono", bold: true, italic: false },
      { from: "Txt.shx", family: "sans", bold: false, italic: true },
    ],
  );
  // Hoofdletters maken geen andere letter; de laatste regel telt.
  assert.deepEqual(
    schoonLetters([{ from: "Romans.shx", family: "mono" }, { from: "ROMANS.SHX", family: "sans", bold: true }]),
    [{ from: "Romans.shx", family: "sans", bold: true, italic: false }],
  );
  const veel = Array.from({ length: MAX_LETTERS + 5 }, (_, i) => ({ from: `letter${i}.shx`, family: "mono" }));
  assert.equal(schoonLetters(veel).length, MAX_LETTERS);
  assert.equal(schoonLetters(veel, 3).length, 3);
  for (const fout of [null, undefined, "geen lijst", {}]) assert.deepEqual(schoonLetters(fout), []);
});

test("the font table shows the fonts of the drawing, with what is remembered or else the guess", () => {
  const scan = {
    fonts: [
      { style: "Standard", font: "txt.shx" },
      { style: "Kop", font: "Arial Bold" },
      { style: "Vast", font: "consola.ttf" },
      { style: "Nog een", font: "TXT.SHX" },
      { style: "Leeg", font: " " },
      { style: "Kapot" },
    ],
  };
  assert.deepEqual(lettersVanScan(scan), ["txt.shx", "Arial Bold", "consola.ttf"]);
  assert.deepEqual(lettersVanScan(null), []);
  assert.deepEqual(lettersVanScan({ fonts: "onzin" }), []);
  const onthouden = [{ from: "TXT.shx", family: "mono", bold: false, italic: false }, { from: "andere.shx", family: "mono" }];
  assert.deepEqual(lettersVoorTekening(scan, onthouden), [
    { from: "txt.shx", family: "mono", bold: false, italic: false, eigen: true },
    { from: "Arial Bold", family: "sans", bold: true, italic: false, eigen: false },
    { from: "consola.ttf", family: "mono", bold: false, italic: false, eigen: false },
  ]);
  assert.deepEqual(lettersVoorTekening(null, onthouden), []);
});

test("a font choice is remembered only when it differs from the guess", () => {
  let regels = metLetterRegel([], { from: "txt.shx", family: "mono", bold: false, italic: false });
  assert.deepEqual(regels, [{ from: "txt.shx", family: "mono", bold: false, italic: false }]);
  // Een regel voor een andere tekening blijft staan.
  regels = metLetterRegel(regels, { from: "romans.shx", family: "sans", bold: true, italic: false });
  assert.equal(regels.length, 2);
  // Terug naar wat de omzetter zelf kiest: de regel valt weg.
  regels = metLetterRegel(regels, { from: "TXT.SHX", family: "sans", bold: false, italic: false });
  assert.deepEqual(regels, [{ from: "romans.shx", family: "sans", bold: true, italic: false }]);
  // Een onbruikbare keuze verandert niets, behalve dat de oude regel weg is.
  assert.deepEqual(metLetterRegel(regels, { from: "romans.shx", family: "schreef" }), []);
  assert.deepEqual(metLetterRegel(regels, null), regels);
  // Vol: de oudste regel maakt plaats.
  const vol = metLetterRegel(metLetterRegel([], { from: "a.shx", family: "mono" }, 1), { from: "b.shx", family: "mono" }, 1);
  assert.deepEqual(vol.map((r) => r.from), ["b.shx"]);
});

// ── Tabblad Weergave: zoekpaden, drempel, beeldpunten ──────────────────────
test("search paths are text, unique and few", () => {
  assert.deepEqual(schoonZoekpaden(["C:/een", "  ", "C:/een", 5, null, "C:/EEN/", " C:/twee "]), ["C:/een", "C:/twee"]);
  assert.deepEqual(schoonZoekpaden(["C:/goed", "C:/stuur\u0000teken", "x".repeat(1025)]), ["C:/goed"]);
  const veel = Array.from({ length: 40 }, (_, i) => `C:/map${i}`);
  assert.equal(schoonZoekpaden(veel).length, MAX_ZOEKPADEN);
  assert.equal(schoonZoekpaden(veel, 4).length, 4);
  assert.equal(schoonZoekpaden(veel, 1000).length, MAX_ZOEKPADEN);
  for (const fout of [null, undefined, "C:/een", {}]) assert.deepEqual(schoonZoekpaden(fout), []);
});

test("the limits of the dialog never exceed those of the converter", () => {
  const bron = (bestand) => readFileSync(new URL(`../../../open-pdf-cad/src/import/${bestand}`, import.meta.url), "utf8");
  const grens = (tekst, naam) => Number(tekst.match(new RegExp(`pub const ${naam}: [a-z0-9]+ = ([0-9_]+);`))[1].replaceAll("_", ""));
  assert.ok(MAX_PENNEN <= grens(bron("style.rs"), "MAX_PENS"));
  assert.ok(MAX_LETTERS <= grens(textRs, "MAX_FONT_RULES"));
  assert.equal(MAX_ZOEKPADEN, grens(bron("xref.rs"), "MAX_SEARCH_PATHS"));
  assert.equal(MAX_MEGAPIXELS * 1e6, grens(bron("image.rs"), "MAX_IMAGE_PIXELS"));
  assert.equal(CAD_IMPORT_STANDAARD.monoThreshold, grens(bron("style.rs"), "DEFAULT_MONO_THRESHOLD_PCT"));
});

test("the black-and-white threshold is a whole percentage", () => {
  assert.equal(drempelProcent(37.6), 38);
  assert.equal(drempelProcent("80"), 80);
  assert.equal(drempelProcent(-5), 0);
  assert.equal(drempelProcent(500), 100);
  for (const fout of ["", "veel", null, undefined, NaN, true]) assert.equal(drempelProcent(fout), 50);
});

test("the image limit goes to the converter in pixels, and only when it is lower than the converter's own", () => {
  assert.equal(beeldpuntenGrens(25, 200e6), 25e6);
  assert.equal(beeldpuntenGrens(2.5, 200e6), 2.5e6);
  assert.equal(beeldpuntenGrens(MAX_MEGAPIXELS, 200e6), null, "de hoogste stand is de grens van de omzetter zelf");
  assert.equal(beeldpuntenGrens(150, 100e6), 100e6, "nooit boven wat de omzetter toelaat");
  assert.equal(beeldpuntenGrens(25, undefined), 25e6);
  for (const fout of [0, -3, "veel", null, undefined, NaN, true, Infinity]) assert.equal(beeldpuntenGrens(fout, 200e6), null);
});

// ── Tabblad Weergave: doorwerking en onthouden ─────────────────────────────
test("the display settings reach the converter arguments", () => {
  const inst = {
    ...CAD_IMPORT_STANDAARD,
    colors: "mono",
    monoThreshold: 62.4,
    lineweight: "pens",
    pens: [{ color: "#ff0000", lineweightMm: 0.35 }, { color: "kapot", lineweightMm: 1 }],
    fonts: [{ from: "romans.shx", family: "mono", bold: false, italic: false }],
    xrefs: false,
    images: false,
    searchPaths: ["C:/verwijzingen", "C:/verwijzingen"],
    reuseBlocks: false,
    maxImageMegapixels: 40,
  };
  const args = importArgumenten(inst, { path: "a.dwg", outputPath: "a.pdf", spaces: ["model"] });
  assert.equal(args.colors, "mono");
  assert.equal(args.monoThreshold, 62);
  assert.equal(args.singleColor, undefined);
  assert.equal(args.lineweight, "pens");
  assert.deepEqual(args.pens, [{ color: "#FF0000", lineweightMm: 0.35 }]);
  assert.deepEqual(args.fonts, [{ from: "romans.shx", family: "mono", bold: false, italic: false }]);
  assert.equal(args.xrefs, false);
  assert.equal(args.images, false);
  assert.deepEqual(args.searchPaths, ["C:/verwijzingen"]);
  assert.equal(args.reuseBlocks, false);
  assert.equal(args.maxImagePixels, 40e6);
});

test("the defaults send nothing the converter would not choose itself", () => {
  const args = importArgumenten(CAD_IMPORT_STANDAARD, { path: "a.dwg", outputPath: "a.pdf" });
  assert.deepEqual(args.pens, []);
  assert.deepEqual(args.fonts, []);
  assert.deepEqual(args.searchPaths, []);
  assert.equal(args.xrefs, true);
  assert.equal(args.images, true);
  assert.equal(args.reuseBlocks, true);
  for (const veld of ["monoThreshold", "singleColor", "maxImagePixels"]) assert.equal(veld in args, false, veld);
});

test("one own colour goes along as a colour, the colour table only in its own mode, and the converter's limits count", () => {
  const pens = Array.from({ length: 30 }, (_, i) => ({ color: `#0000${i.toString(16).padStart(2, "0")}`, lineweightMm: 0.2 }));
  const inst = { ...CAD_IMPORT_STANDAARD, colors: "single", singleColor: "#1a2b3c", lineweight: "fixed", pens };
  const o = { path: "a.dwg", outputPath: "a.pdf" };
  assert.equal(importArgumenten(inst, o).singleColor, "#1A2B3C");
  assert.equal(importArgumenten({ ...inst, singleColor: "paars" }, o).singleColor, "#000000");
  assert.deepEqual(importArgumenten(inst, o).pens, [], "vaste lijndikte: de tabel blijft thuis");
  const grenzen = { maxPens: 7, maxFontRules: 0, maxSearchPaths: 1, maxImagePixels: 5e6 };
  const args = importArgumenten(
    { ...inst, lineweight: "pens", fonts: [{ from: "a.shx", family: "mono" }], searchPaths: ["C:/a", "C:/b"], maxImageMegapixels: 40 },
    { ...o, limits: grenzen },
  );
  assert.equal(args.pens.length, 7);
  assert.deepEqual(args.fonts, []);
  assert.deepEqual(args.searchPaths, ["C:/a"]);
  assert.equal(args.maxImagePixels, 5e6);
});

test("remembered display settings survive nonsense in the preferences", () => {
  const s = herstelCadImportInstellingen({
    colors: "single",
    singleColor: "00ff7f",
    monoThreshold: 500,
    lineweight: "pens",
    pens: "geen lijst",
    fonts: [{ from: "x.shx", family: "mono" }, { from: "y.shx", family: "onbekend" }],
    searchPaths: ["C:/een", 5],
    xrefs: "nee",
    images: false,
    reuseBlocks: 0,
    maxImageMegapixels: 12.4,
  });
  assert.equal(s.colors, "single");
  assert.equal(s.singleColor, "#00FF7F");
  assert.equal(s.monoThreshold, 100, "wordt naar het bereik getrokken");
  assert.equal(s.lineweight, "pens");
  assert.deepEqual(s.pens, []);
  assert.deepEqual(s.fonts, [{ from: "x.shx", family: "mono", bold: false, italic: false }]);
  assert.deepEqual(s.searchPaths, ["C:/een"]);
  assert.equal(s.xrefs, true, "geen booleaan: standaard");
  assert.equal(s.images, false);
  assert.equal(s.reuseBlocks, true);
  assert.equal(s.maxImageMegapixels, 12);
  assert.equal(herstelCadImportInstellingen({ colors: "regenboog", singleColor: "rood" }).colors, "file");
  assert.equal(herstelCadImportInstellingen({ singleColor: "rood" }).singleColor, "#000000");
});

test("restored settings never share their lists with the defaults or with the preferences", () => {
  const opgeslagen = { pens: [{ color: "#FF0000", lineweightMm: 0.5 }], searchPaths: ["C:/een"] };
  const s = herstelCadImportInstellingen(opgeslagen);
  s.pens.push({ color: "#00FF00", lineweightMm: 1 });
  s.searchPaths.push("C:/twee");
  assert.equal(opgeslagen.pens.length, 1);
  assert.equal(opgeslagen.searchPaths.length, 1);
  const leeg = herstelCadImportInstellingen(null);
  leeg.fonts.push({ from: "a", family: "mono" });
  assert.deepEqual(CAD_IMPORT_STANDAARD.fonts, []);
  assert.deepEqual(herstelCadImportInstellingen(null).fonts, []);
});

// ── Voorbeeldweergave ──────────────────────────────────────────────────────
test("the delay runs only the last plan", async () => {
  const vertrager = maakVertrager(10);
  const gedaan = [];
  vertrager.plan(() => gedaan.push("een"));
  vertrager.plan(() => gedaan.push("twee"));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(gedaan, ["twee"]);
  vertrager.plan(() => gedaan.push("drie"));
  vertrager.stop();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(gedaan, ["twee"], "gestopt: niets meer");
});

test("the preview fits the page in the pane without going over the pixel limit", () => {
  const maat = voorbeeldMaat({ breedte: 841, hoogte: 1189 }, { breedte: 260, hoogte: 360 });
  assert.ok(maat.breedte <= 260 && maat.hoogte <= 360);
  assert.ok(Math.abs(maat.breedte / maat.hoogte - 841 / 1189) < 0.01, "verhouding blijft");
  assert.ok(maat.pixelsPerMm > 0);
  // Een heel groot paneel wordt afgetopt.
  const groot = voorbeeldMaat({ breedte: 841, hoogte: 1189 }, { breedte: 100000, hoogte: 100000 }, 1400);
  assert.ok(Math.max(groot.breedte, groot.hoogte) <= 1400);
  assert.equal(voorbeeldMaat(null, { breedte: 10, hoogte: 10 }), null);
  assert.equal(voorbeeldMaat({ breedte: 0, hoogte: 10 }, { breedte: 10, hoogte: 10 }), null);
});

test("dragging in the preview gives a window in drawing units", () => {
  // Pagina van 100 x 100 mm op 1:10, de tekening begint op (1000, 2000).
  const pagina = { widthMm: 100, heightMm: 100, scale: 10, offset: [1000, 2000] };
  // 2 pixels per mm: 10 px = 5 mm papier = 50 eenheden tekening. Het vak
  // begint 5 mm onder de bovenrand: 95 mm boven de onderrand.
  assert.deepEqual(
    vensterUitVoorbeeld({ x: 10, y: 10, breedte: 20, hoogte: 20 }, pagina, 1, 2),
    { x0: 1050, y0: 2850, x1: 1150, y1: 2950 },
  );
  // Tekening in meters: 1000 mm per eenheid.
  assert.deepEqual(
    vensterUitVoorbeeld({ x: 0, y: 180, breedte: 20, hoogte: 20 }, { ...pagina, offset: [5, 7] }, 1000, 2),
    { x0: 5, y0: 7, x1: 5.1, y1: 7.1 },
  );
  // Een kwartslag gedraaid op het papier: het venster is de omhullende van
  // het teruggedraaide vak. Papier-x loopt dan langs tekening-y.
  const gedraaid = vensterUitVoorbeeld({ x: 0, y: 180, breedte: 40, hoogte: 20 }, { ...pagina, offset: [0, 0] }, 1, 2, 90);
  assert.deepEqual(gedraaid, { x0: 0, y0: -200, x1: 100, y1: 0 });
  assert.equal(vensterUitVoorbeeld({ x: 0, y: 0, breedte: 0, hoogte: 5 }, pagina, 1, 2), null, "te klein");
  assert.equal(vensterUitVoorbeeld({ x: 0, y: 0, breedte: 5, hoogte: 5 }, null, 1, 2), null);
  assert.equal(vensterUitVoorbeeld({ x: 0, y: 0, breedte: 5, hoogte: 5 }, pagina, 1, 0), null);
});

test("the preview key changes only when the picture would change", () => {
  const a = { path: "a.dwg", outputPath: "x.pdf", spaces: ["model"], scale: 100 };
  const b = { ...a, outputPath: "y.pdf" };
  const c = { ...a, scale: 50 };
  assert.equal(voorbeeldSleutel(a), voorbeeldSleutel(b), "het doelbestand telt niet mee");
  assert.notEqual(voorbeeldSleutel(a), voorbeeldSleutel(c));
  assert.equal(voorbeeldSleutel(null), "");
});

// Een nep-ImageBitmap: houdt bij of hij gesloten is, en is dan net als de
// echte niet meer te tekenen (maat nul).
function nepBeeld(naam) {
  return {
    naam, width: 40, height: 30, gesloten: 0,
    close() { this.gesloten += 1; this.width = 0; this.height = 0; },
  };
}

// Het venster zoals het echt werkt: een beeld of een maat zetten tekent
// meteen opnieuw, en een gesloten beeld tekenen gooit.
function nepVenster(wissel) {
  const venster = {
    beeld: null, getekend: [],
    teken() {
      if (!wissel.tekenbaar(venster.beeld)) return;
      if (venster.beeld.gesloten) throw new Error("The image source is detached");
      venster.getekend.push(venster.beeld.naam);
    },
    zet(beeld) { venster.teken(); venster.beeld = beeld; venster.teken(); },
  };
  return venster;
}

test("a new preview picture is set before the old one is closed", () => {
  const wissel = maakBeeldwissel();
  const venster = nepVenster(wissel);
  const een = nepBeeld("een");
  const twee = nepBeeld("twee");
  const drie = nepBeeld("drie");
  wissel.wissel(venster.beeld, een, venster.zet);
  // Drie wijzigingen achter elkaar: het voorbeeld blijft elke keer staan.
  assert.doesNotThrow(() => wissel.wissel(venster.beeld, twee, venster.zet));
  assert.doesNotThrow(() => wissel.wissel(venster.beeld, drie, venster.zet));
  assert.equal(een.gesloten, 1, "het oude beeld gaat dicht");
  assert.equal(twee.gesloten, 1);
  assert.equal(drie.gesloten, 0, "het getoonde beeld blijft open");
  assert.equal(venster.beeld, drie);
  assert.equal(venster.getekend.at(-1), "drie");
  // Op het moment van zetten stond het oude beeld nog open.
  assert.deepEqual(venster.getekend, ["een", "een", "twee", "twee", "drie"]);
});

test("a closed preview picture is never drawn", () => {
  const wissel = maakBeeldwissel();
  const beeld = nepBeeld("een");
  assert.equal(wissel.tekenbaar(beeld), true);
  assert.equal(wissel.tekenbaar(null), false);
  wissel.sluit(beeld);
  assert.equal(wissel.tekenbaar(beeld), false);
  wissel.sluit(beeld);
  assert.equal(beeld.gesloten, 1, "een beeld gaat maar een keer dicht");
  // Buiten de wissel om gesloten: de maat is dan nul.
  const elders = nepBeeld("twee");
  elders.close();
  assert.equal(wissel.tekenbaar(elders), false);
  // Hetzelfde beeld opnieuw zetten sluit het niet.
  const zelfde = nepBeeld("drie");
  wissel.wissel(zelfde, zelfde, () => {});
  assert.equal(zelfde.gesloten, 0);
  // Een beeld waarvan het sluiten gooit, houdt de wissel niet tegen.
  const stuk = { width: 1, height: 1, close() { throw new Error("stuk"); } };
  assert.doesNotThrow(() => wissel.wissel(stuk, nepBeeld("vier"), () => {}));
});

// ── Tekening op de huidige pagina ──────────────────────────────────────────
test("placing on the current page only works with an open document", () => {
  assert.equal(effectiefDoel("underlay", true), "underlay");
  assert.equal(effectiefDoel("underlay", false), "new");
  assert.equal(effectiefDoel("append", true), "append");
  assert.equal(effectiefDoel("append", false), "new");
  assert.equal(effectiefDoel("onzin", true), "new");
});

test("the measuring scale of the page gives the scale denominator", () => {
  const ptPerMm = 72 / 25.4;
  assert.ok(bijna(paginaNoemer({ pixelsPerUnit: ptPerMm / 100, unit: "mm" }), 100, 1e-9));
  assert.ok(bijna(paginaNoemer({ pixelsPerUnit: (ptPerMm * 1000) / 50, unit: "m" }), 50, 1e-9));
  assert.ok(bijna(paginaNoemer({ pixelsPerUnit: (ptPerMm * 304.8) / 48, unit: "ft" }), 48, 1e-9));
  assert.equal(paginaNoemer({ pixelsPerUnit: 1, unit: "mm" }), null, "de terugval is geen schaal");
  assert.equal(paginaNoemer({ pixelsPerUnit: 0, unit: "mm" }), null);
  assert.equal(paginaNoemer({ pixelsPerUnit: 2, unit: "el" }), null);
  assert.equal(paginaNoemer(null), null);
});

test("a drawing laid on a page to scale falls at true size over the drawing", () => {
  const ptPerMm = 72 / 25.4;
  const op100 = { pixelsPerUnit: ptPerMm / 100, unit: "mm" };
  // Omgezet op 1:50, de pagina staat op 1:100: half zo groot.
  assert.ok(bijna(onderleggerFactor(50, op100), 0.5));
  assert.ok(bijna(onderleggerFactor(100, op100), 1));
  assert.ok(bijna(onderleggerFactor(200, { pixelsPerUnit: (ptPerMm * 1000) / 100, unit: "m" }), 2));
  assert.equal(onderleggerFactor(50, op100, false), null, "een layout heeft geen modelschaal");
  assert.equal(onderleggerFactor(0, op100), null);
  assert.equal(onderleggerFactor(50, { pixelsPerUnit: 1, unit: "mm" }), null);

  // Modelmaat naar paginamaat: 10 m in de tekening is op 1:100 precies 100 mm.
  const blad = { breedte: 200 * ptPerMm, hoogte: 100 * ptPerMm }; // 10 m x 5 m op 1:50
  const vak = onderleggerVak(blad, { breedte: 1000, hoogte: 800 }, onderleggerFactor(50, op100));
  assert.ok(bijna(vak.width, 100 * ptPerMm, 1e-9));
  assert.ok(bijna(vak.height, 50 * ptPerMm, 1e-9));
  assert.ok(bijna(vak.x, (1000 - vak.width) / 2, 1e-9) && bijna(vak.y, (800 - vak.height) / 2, 1e-9), "in het midden");
  assert.equal(vak.opSchaal, true);
  // Op schaal mag het object groter zijn dan de pagina: de maat gaat voor.
  const groot = onderleggerVak(blad, { breedte: 100, hoogte: 100 }, 1);
  assert.ok(bijna(groot.width, blad.breedte) && groot.x < 0);
});

test("free scaling places the sheet at paper size, shrunk to fit the page", () => {
  const vrij = onderleggerVak({ breedte: 400, hoogte: 200 }, { breedte: 1000, hoogte: 800 }, null);
  assert.deepEqual(vrij, { x: 300, y: 300, width: 400, height: 200, factor: 1, opSchaal: false });
  const krap = onderleggerVak({ breedte: 2000, hoogte: 400 }, { breedte: 1000, hoogte: 800 }, null);
  assert.ok(bijna(krap.width, 1000) && bijna(krap.height, 200) && bijna(krap.x, 0) && bijna(krap.y, 300));
  assert.deepEqual(onderleggerVak({ breedte: 50, hoogte: 20 }, null), { x: 0, y: 0, width: 50, height: 20, factor: 1, opSchaal: false });
  assert.equal(onderleggerVak({ breedte: 0, hoogte: 20 }, null), null);
  assert.equal(dekkingUitProcent(50), 0.5);
  assert.equal(dekkingUitProcent(1), 0.05);
  assert.equal(dekkingUitProcent(400), 1);
  assert.equal(dekkingUitProcent("x"), 0.5);
});

test("the raster plan keeps the resolution when it fits and lowers it when it does not", () => {
  const ptPerMm = 72 / 25.4;
  const a3 = { breedte: 420 * ptPerMm, hoogte: 297 * ptPerMm };
  const plan = rasterPlan(a3, 300);
  assert.equal(plan.begrensd, false);
  assert.ok(bijna(plan.dpi, 300, 1e-9));
  assert.ok(Math.abs(plan.breedtePx - 4960) <= 1 && Math.abs(plan.hoogtePx - 3507) <= 1);
  // Stroken dekken het hele beeld, zonder gat of overlap, elk binnen de grens.
  let y = 0;
  for (const strook of plan.stroken) {
    assert.equal(strook.yPx, y);
    assert.ok(strook.hoogtePx > 0 && strook.hoogtePx * plan.breedtePx <= STROOK_PIXELS);
    y += strook.hoogtePx;
  }
  assert.equal(y, plan.hoogtePx);
  assert.ok(plan.stroken.length >= 2);

  // A0 op 600 dpi is ruim een half miljard beeldpunten: de resolutie zakt.
  const a0 = rasterPlan({ breedte: 841 * ptPerMm, hoogte: 1189 * ptPerMm }, 600);
  assert.equal(a0.begrensd, true);
  assert.ok(a0.breedtePx * a0.hoogtePx <= MAX_RASTER_PIXELS);
  assert.ok(Math.max(a0.breedtePx, a0.hoogtePx) <= MAX_RASTER_ZIJDE);
  assert.ok(a0.dpi < 600 && a0.dpi > 100);
  assert.ok(Math.abs(a0.breedtePx / a0.hoogtePx - 841 / 1189) < 0.001, "verhouding blijft");
  // Een lange smalle strook loopt tegen de langste zijde aan.
  const lang = rasterPlan({ breedte: 72 * 100, hoogte: 72 }, 600);
  assert.ok(lang.breedtePx <= MAX_RASTER_ZIJDE && lang.begrensd);
  // Onbekende resolutie: de standaard.
  assert.ok(bijna(rasterPlan(a3, 1234).dpi, 300, 1e-9));
  assert.deepEqual([...ONDERLEGGER_DPI], [150, 300, 600]);
  assert.equal(rasterPlan({ breedte: 0, hoogte: 1 }, 300), null);
});

test("the raster follows the size on the page, not the sheet: the chosen dpi holds on the page", () => {
  const ptPerMm = 72 / 25.4;
  const a3 = { breedte: 420 * ptPerMm, hoogte: 297 * ptPerMm };
  // Blad 1:150 op een pagina 1:100: het object is 1,5 keer zo groot als het blad.
  const vergroot = onderleggerVak(a3, { breedte: 5000, hoogte: 4000 }, 1.5);
  const plan = rasterPlanVoorVak(vergroot, 300);
  assert.equal(plan.begrensd, false);
  assert.ok(bijna(plan.dpi, 300, 1e-9), "300 dpi op de pagina");
  assert.ok(Math.abs(plan.breedtePx - 4960 * 1.5) <= 2 && Math.abs(plan.hoogtePx - 3507 * 1.5) <= 2);
  // Het blad zelf wordt dan met 1,5 x 300 dpi gelezen.
  assert.ok(bijna(plan.bronSchaal, (300 / 72) * 1.5, 1e-9));
  // Uitgerekt tot voorbij de grens zakt de resolutie, en dat wordt gemeld.
  const teGroot = rasterPlanVoorVak(onderleggerVak(a3, { breedte: 5000, hoogte: 4000 }, 2.5), 300);
  assert.equal(teGroot.begrensd, true);
  assert.ok(teGroot.dpi < 300 && teGroot.breedtePx * teGroot.hoogtePx <= MAX_RASTER_PIXELS);
  // Andersom: een A0 dat op een A4 valt heeft aan een A4-raster genoeg.
  const a0 = { breedte: 841 * ptPerMm, hoogte: 1189 * ptPerMm };
  const a4 = { breedte: 210 * ptPerMm, hoogte: 297 * ptPerMm };
  const verkleind = onderleggerVak(a0, a4, null);
  const klein = rasterPlanVoorVak(verkleind, 300);
  assert.equal(klein.begrensd, false, "300 dpi op A4 past ruim");
  assert.ok(klein.breedtePx * klein.hoogtePx < 10e6, `${klein.breedtePx}x${klein.hoogtePx}`);
  assert.ok(bijna(klein.bronSchaal, (300 / 72) * verkleind.factor, 1e-9));
  assert.ok(bijna(a0.breedte * klein.bronSchaal, klein.breedtePx, 1.5), "het gerasterde blad vult het vak");
  assert.equal(rasterPlanVoorVak(null, 300), null);
});

test("white paper becomes transparent and gives the same picture back over white", () => {
  const bron = [255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 200, 220, 240, 255, 128, 128, 128, 255];
  const rgba = witNaarDoorzichtig(new Uint8ClampedArray(bron));
  assert.deepEqual([...rgba.slice(0, 4)], [0, 0, 0, 0], "wit is weg");
  assert.deepEqual([...rgba.slice(4, 8)], [0, 0, 0, 255], "zwart blijft dekkend");
  assert.deepEqual([...rgba.slice(8, 12)], [255, 0, 0, 255], "een volle kleur blijft");
  for (let i = 0; i < bron.length; i += 4) {
    const a = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c += 1) {
      const overWit = rgba[i + c] * a + 255 * (1 - a);
      assert.ok(Math.abs(overWit - bron[i + c]) <= 1.5, "beeldpunt " + i / 4 + " kanaal " + c + ": " + overWit + " tegen " + bron[i + c]);
    }
  }
});

test("the settings for placing on the page are remembered and checked", () => {
  assert.equal(CAD_IMPORT_STANDAARD.underlayOpacity, 50);
  assert.equal(CAD_IMPORT_STANDAARD.underlayBelow, true);
  assert.equal(CAD_IMPORT_STANDAARD.underlayToScale, true);
  assert.equal(CAD_IMPORT_STANDAARD.underlayAsImage, false);
  assert.equal(CAD_IMPORT_STANDAARD.underlayDpi, 300);
  const s = herstelCadImportInstellingen({
    target: "underlay", underlayOpacity: 30, underlayBelow: false, underlayToScale: false, underlayAsImage: true, underlayDpi: 600,
  });
  assert.equal(s.target, "underlay");
  assert.equal(s.underlayOpacity, 30);
  assert.equal(s.underlayBelow, false);
  assert.equal(s.underlayToScale, false);
  assert.equal(s.underlayAsImage, true);
  assert.equal(s.underlayDpi, 600);
  const onzin = herstelCadImportInstellingen({
    target: "overal", underlayOpacity: 900, underlayBelow: "ja", underlayToScale: 1, underlayAsImage: null, underlayDpi: 72,
  });
  assert.equal(onzin.target, "new");
  assert.equal(onzin.underlayOpacity, 100);
  assert.equal(onzin.underlayBelow, true);
  assert.equal(onzin.underlayToScale, true);
  assert.equal(onzin.underlayAsImage, false);
  assert.equal(onzin.underlayDpi, 300);
  assert.equal(herstelCadImportInstellingen({ underlayOpacity: 1 }).underlayOpacity, 5);
  assert.equal(herstelCadImportInstellingen({ underlayDpi: "150" }).underlayDpi, 150, "uit een keuzelijst komt tekst");
});

test("the preview switch is remembered and nonsense falls back to on", () => {
  assert.equal(CAD_IMPORT_STANDAARD.preview, true);
  assert.equal(herstelCadImportInstellingen({ preview: false }).preview, false);
  assert.equal(herstelCadImportInstellingen({ preview: "nee" }).preview, true);
});

// ── Voorinstellingen, dubbele laagnamen en de wachtrij, van begin tot eind ──
test("a preset keeps the new settings, checked, and drops unknown ones", () => {
  const lijst = metVoorinstelling([], "Kaal zwart", {
    ...CAD_IMPORT_STANDAARD,
    colors: "black",
    lineweight: "pens",
    pens: [{ color: "#123456", lineweightMm: 0.18 }],
    fonts: [{ from: "txt", family: "mono", bold: false, italic: false }],
    xrefs: false,
    images: false,
    searchPaths: ["C:/een"],
    target: "underlay",
    underlayOpacity: 30,
    underlayBelow: false,
    underlayToScale: false,
    underlayAsImage: true,
    underlayDpi: 600,
    preview: false,
    onzin: 42,
  });
  assert.equal(lijst.length, 1);
  const s = lijst[0].settings;
  assert.equal(s.colors, "black");
  assert.equal(s.lineweight, "pens");
  assert.deepEqual(s.pens, [{ color: "#123456", lineweightMm: 0.18 }]);
  assert.deepEqual(s.fonts, [{ from: "txt", family: "mono", bold: false, italic: false }]);
  assert.equal(s.xrefs, false);
  assert.equal(s.images, false);
  assert.deepEqual(s.searchPaths, ["C:/een"]);
  assert.equal(s.target, "underlay");
  assert.equal(s.underlayOpacity, 30);
  assert.equal(s.underlayBelow, false);
  assert.equal(s.underlayToScale, false);
  assert.equal(s.underlayAsImage, true);
  assert.equal(s.underlayDpi, 600);
  assert.equal(s.preview, false);
  assert.equal(s.onzin, undefined, "onbekende sleutels gaan niet mee");
  // Precies de sleutels van de standaard, niets meer en niets minder.
  assert.deepEqual(Object.keys(s).sort(), Object.keys(CAD_IMPORT_STANDAARD).sort());
  // Door de voorkeuren heen (JSON) en terug blijft alles staan.
  assert.deepEqual(herstelCadImportVoorinstellingen(JSON.parse(JSON.stringify(lijst))), lijst);
  // Een oude voorinstelling zonder de nieuwe velden krijgt de standaard.
  const oud = herstelCadImportVoorinstellingen([{ name: "Oud", settings: { colors: "gray" } }]);
  assert.equal(oud[0].settings.colors, "gray");
  assert.equal(oud[0].settings.underlayOpacity, 50);
  assert.equal(oud[0].settings.preview, true);
  assert.equal(MAX_VOORINSTELLINGEN, 20);
});

test("two imports in one document keep their layers apart, also within one call", async () => {
  const pdfLib = { PDFName, PDFArray, PDFDict, PDFString, PDFHexString };
  const doc = await PDFDocument.create();
  const maakPagina = async (namen) => {
    const bron = await PDFDocument.create();
    const p = bron.addPage([100, 100]);
    const props = bron.context.obj({});
    namen.forEach((naam, i) => {
      props.set(PDFName.of("L" + i), bron.context.register(bron.context.obj({ Type: "OCG", Name: PDFString.of(naam) })));
    });
    p.node.set(PDFName.of("Resources"), bron.context.obj({ Properties: props }));
    return bron;
  };
  const een = await maakPagina(["Wanden", "Maten"]);
  const [kopie1] = await doc.copyPages(een, [0]);
  doc.addPage(kopie1);
  assert.equal(voegLagenSamen(doc, [kopie1], pdfLib, een, "eerste.dwg"), 2);

  // De tweede tekening draagt zelf twee lagen met dezelfde naam, die ook al
  // in het document bestaat.
  const twee = await maakPagina(["Wanden", "Wanden"]);
  const [kopie2] = await doc.copyPages(twee, [0]);
  doc.addPage(kopie2);
  assert.equal(voegLagenSamen(doc, [kopie2], pdfLib, twee, "tweede.dwg"), 2);

  // Na opslaan en heropenen: elke laag heeft een eigen naam.
  const heropend = await PDFDocument.load(await doc.save());
  const oc = heropend.catalog.lookup(PDFName.of("OCProperties"));
  const namen = oc.lookup(PDFName.of("OCGs")).asArray()
    .map((ref) => heropend.context.lookup(ref).lookup(PDFName.of("Name")).decodeText());
  assert.equal(namen.length, 4);
  assert.equal(new Set(namen).size, namen.length, "dubbele namen: " + namen.join(", "));
  assert.deepEqual(namen.slice().sort(), ["Maten", "Wanden", "Wanden (tweede.dwg)", "Wanden (tweede.dwg) 2"]);
  // Alle vier staan in de volgorde van het lagenpaneel.
  assert.equal(oc.lookup(PDFName.of("D")).lookup(PDFName.of("Order")).size(), 4);
});

test("the queue hands out every drawing exactly once and knows what it holds", () => {
  const rij = maakWachtrij();
  assert.equal(rij.voegToe("a.dwg"), true);
  assert.equal(rij.voegToe("a.dwg"), false, "geen dubbele");
  assert.equal(rij.voegToe("b.dxf"), true);
  assert.equal(rij.voegToe("c.pdf"), false, "geen tekening");
  assert.equal(rij.bevat("b.dxf"), true);
  assert.equal(rij.bevat("c.pdf"), false);
  assert.equal(rij.lengte, 2);
  assert.equal(rij.volgende(), "a.dwg");
  assert.equal(rij.bevat("a.dwg"), false, "uitgedeeld is weg");
  // Wat uitgedeeld is, mag opnieuw in de rij (dezelfde tekening nog eens).
  assert.equal(rij.voegToe("a.dwg"), true);
  assert.equal(rij.volgende(), "b.dxf");
  assert.equal(rij.volgende(), "a.dwg");
  assert.equal(rij.volgende(), null);
  rij.voegToe("d.dwg");
  rij.leeg();
  assert.equal(rij.lengte, 0);
  assert.equal(rij.bevat("d.dwg"), false);
  assert.equal(rij.volgende(), null);
});

test("a preset carries the colour table, the font table and the search paths, checked", () => {
  const inst = {
    ...CAD_IMPORT_STANDAARD,
    lineweight: "pens",
    pens: [{ color: "#ff0000", lineweightMm: 0.5 }, { color: "#FF0000", lineweightMm: 9 }],
    fonts: [{ from: "txt.shx", family: "mono", bold: true, italic: false }],
    searchPaths: ["C:/bibliotheek"],
    colors: "mono",
    monoThreshold: 70,
    reuseBlocks: false,
  };
  const lijst = metVoorinstelling([], "Plot", inst);
  assert.deepEqual(lijst[0].settings.pens, [{ color: "#FF0000", lineweightMm: 0.5 }]);
  assert.deepEqual(lijst[0].settings.fonts, inst.fonts);
  assert.deepEqual(lijst[0].settings.searchPaths, ["C:/bibliotheek"]);
  assert.equal(lijst[0].settings.monoThreshold, 70);
  assert.equal(lijst[0].settings.reuseBlocks, false);
  // Door de voorkeuren heen (JSON) en terug.
  const terug = herstelCadImportVoorinstellingen(JSON.parse(JSON.stringify(lijst)));
  assert.deepEqual(terug, lijst);
});

test("a custom paper size stays within the largest pdf page", async () => {
  const { MAX_PAGINA_MM, papiermaatMm } = await import("./cad-import-logica.js");
  // 14 400 punten, de grootste pagina die een PDF kan dragen (en die de import toelaat).
  assert.equal(MAX_PAGINA_MM, 5080);
  assert.equal(papiermaatMm("420", 297), 420);
  assert.equal(papiermaatMm("99999", 297), MAX_PAGINA_MM);
  assert.equal(papiermaatMm(1e12, 297), MAX_PAGINA_MM);
  assert.equal(papiermaatMm("0.2", 297), 1);
  assert.equal(papiermaatMm("-5", 297), 1);
  for (const leeg of ["", "abc", NaN, undefined, null, Infinity]) assert.equal(papiermaatMm(leeg, 297), 297);
});

test("progress never shows NaN percent", () => {
  for (const done of [undefined, null, NaN, "x", Infinity]) {
    assert.deepEqual(faseWeergave({ phase: "draw", done, total: 10 }, "import"), { sleutel: "phaseDraw", pct: done === null ? 0 : null }, String(done));
  }
  for (const total of [NaN, Infinity, -5, "x", undefined]) {
    assert.deepEqual(faseWeergave({ phase: "draw", done: 5, total }, "import"), { sleutel: "phaseDraw", pct: null }, String(total));
  }
});
