import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFNumber, PDFString } from "pdf-lib";
import {
  schaalnoemerUitMeetschaal, schaalTekst, appRechthoekNaarWeergave, vensterNaarWeergave, weergaveMaat,
  bestandenPerPagina, exportArgumenten, leesTeGroot, leesExportFout, voegTellingenSamen, objectenNaUitsluiten, basisnaam,
  grootteTekst, MM_PER_PT, formaatUitPad, padMetFormaat, modelOorsprongMogelijk,
} from "./cad-export-logica.js";
import { CAD_EXPORT_STANDAARD, herstelCadExportInstellingen } from "../solid/stores/cad-export-instellingen.js";
import { eenheidUitLabel, schaalUitMeasure, naarAppRuimte, leesPdfViewports, viewportOp } from "./pdf-viewports.js";

const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("scale denominator from the app's measure scale", () => {
  // 1:100 in mm: 72/25,4/100 punten per mm.
  assert.ok(bijna(schaalnoemerUitMeetschaal({ pixelsPerUnit: 72 / 25.4 / 100, unit: "mm" }), 100));
  // 1:50 in meters.
  assert.ok(bijna(schaalnoemerUitMeetschaal({ pixelsPerUnit: (72 / 25.4 / 50) * 1000, unit: "m" }), 50));
  // Zonder kalibratie geeft de app 1 pt per mm: dat is geen schaal.
  assert.equal(schaalnoemerUitMeetschaal({ pixelsPerUnit: 1, unit: "mm" }), null);
  assert.equal(schaalnoemerUitMeetschaal(null), null);
  assert.equal(schaalnoemerUitMeetschaal({ pixelsPerUnit: 2, unit: "parsec" }), null);
});

test("scale text", () => {
  assert.equal(schaalTekst(100), "1:100");
  assert.equal(schaalTekst(2.5), "1:2,5");
  assert.equal(schaalTekst(0.2), "5:1");
  assert.equal(schaalTekst(0), "");
});

test("app rectangle to the displayed page with the origin at the bottom left", () => {
  assert.deepEqual(appRechthoekNaarWeergave({ x: 10, y: 20, width: 100, height: 50 }, 600), [10, 530, 100, 50]);
  // Negatieve breedte/hoogte (van rechtsonder getekend) geeft dezelfde rechthoek.
  assert.deepEqual(appRechthoekNaarWeergave({ x: 110, y: 70, width: -100, height: -50 }, 600), [10, 530, 100, 50]);
});

test("window in millimetres to points", () => {
  const v = vensterNaarWeergave({ x: 25.4, y: 0, breedte: 25.4, hoogte: 50.8 });
  assert.ok(bijna(v[0], 72) && bijna(v[2], 72) && bijna(v[3], 144));
  assert.equal(vensterNaarWeergave({ x: 0, y: 0, breedte: 0, hoogte: 5 }), null);
});

test("displayed page size swaps for quarter turns", () => {
  assert.deepEqual(weergaveMaat(100, 200, 90), { breedte: 200, hoogte: 100 });
  assert.deepEqual(weergaveMaat(100, 200, -90), { breedte: 200, hoogte: 100 });
  assert.deepEqual(weergaveMaat(100, 200, 180), { breedte: 100, hoogte: 200 });
});

test("one file per page", () => {
  assert.deepEqual([...bestandenPerPagina("C:\\uit\\plan.dxf", [3])], [[3, "C:\\uit\\plan.dxf"]]);
  assert.deepEqual([...bestandenPerPagina("C:\\uit\\plan.dxf", [1, 2])], [[1, "C:\\uit\\plan_p1.dxf"], [2, "C:\\uit\\plan_p2.dxf"]]);
  assert.deepEqual([...bestandenPerPagina("/a.b/plan", [1, 2])], [[1, "/a.b/plan_p1"], [2, "/a.b/plan_p2"]]);
  assert.equal(basisnaam("C:\\x\\mijn blad.pdf"), "mijn blad");
});

test("format and file extension stay in step", () => {
  assert.equal(formaatUitPad("C:\\Tekeningen\\plan.dwg", "dxf"), "dwg");
  assert.equal(formaatUitPad("C:\\Tekeningen\\plan.DXF", "dwg"), "dxf");
  assert.equal(formaatUitPad("plan.dxf", "dxf_binary"), "dxf_binary");
  assert.equal(formaatUitPad("plan.dw", "dxf"), "dxf");
  assert.equal(formaatUitPad("", "dwg"), "dwg");
  assert.equal(padMetFormaat("C:\\uit\\plan.dxf", "dwg"), "C:\\uit\\plan.dwg");
  assert.equal(padMetFormaat("C:\\uit\\plan.DWG", "dxf_binary"), "C:\\uit\\plan.dxf");
  assert.equal(padMetFormaat("C:\\uit\\plan", "dwg"), "C:\\uit\\plan.dwg");
  assert.equal(padMetFormaat("C:\\uit\\plan.v2", "dxf"), "C:\\uit\\plan.v2.dxf");
  assert.equal(padMetFormaat("C:\\map.d\\plan", "dxf"), "C:\\map.d\\plan.dxf");
  assert.equal(padMetFormaat("/home/a/plan.", "dwg"), "/home/a/plan.dwg");
  assert.equal(padMetFormaat("  ", "dwg"), "");
});

test("export arguments follow the settings", () => {
  const inst = { ...CAD_EXPORT_STANDAARD, format: "dwg", text: false, annotations: true, units: "m", origin: "area" };
  const args = exportArgumenten(inst, {
    pdfPath: "a.pdf", pageIndex: 2, outputPath: "a.dwg", schaalnoemer: 50,
    gebied: [1, 2, 3, 4], uitgeslotenLagen: ["X"], maxEntiteiten: 750000,
  });
  assert.equal(args.format, "dwg");
  assert.equal(args.text, "skip");
  assert.equal(args.units, "m");
  assert.equal(args.origin, "area");
  assert.equal(args.scaleDenominator, 50);
  assert.deepEqual(args.area, [1, 2, 3, 4]);
  assert.deepEqual(args.excludedLayers, ["X"]);
  assert.equal(args.maxEntities, 750000);
  assert.equal(args.annotations, true);
  // Papiermaat: geen schaal, geen gebied, geen grens.
  const kaal = exportArgumenten(CAD_EXPORT_STANDAARD, { pdfPath: "a.pdf", pageIndex: 0 });
  assert.equal(kaal.scaleDenominator, undefined);
  assert.equal(kaal.area, undefined);
  assert.equal(kaal.maxEntities, undefined);
});

test("the too-large error is recognised", () => {
  assert.deepEqual(leesTeGroot("TOO_LARGE:2459192:750000"), { entities: 2459192, limit: 750000 });
  assert.deepEqual(leesTeGroot(new Error("TOO_LARGE:8:2")), { entities: 8, limit: 2 });
  assert.equal(leesTeGroot("export afgebroken"), null);
});

test("the errors of exporting in model coordinates are recognised", () => {
  assert.deepEqual(leesExportFout("NO_MODEL_SPACE"), { sleutel: "noModelSpace" });
  assert.deepEqual(leesExportFout(new Error("MODEL_SPACE_AMBIGUOUS:3")), { sleutel: "modelSpaceAmbiguous", n: 3 });
  assert.deepEqual(leesExportFout(new Error("MODEL_UNITS_UNKNOWN:parsec")), { sleutel: "modelUnitsUnknown", unit: "parsec" });
  assert.deepEqual(leesExportFout("MODEL_UNITS_UNKNOWN:"), { sleutel: "modelUnitsUnknown", unit: "?" });
  assert.deepEqual(leesExportFout("bestandsfout: schijf vol"), { sleutel: "failed", error: "bestandsfout: schijf vol" });
  assert.deepEqual(leesExportFout(null), { sleutel: "failed", error: "" });
});

test("layer counts of several pages merge by name", () => {
  const kleur = { r: 0, g: 0, b: 0 };
  const merged = voegTellingenSamen([
    { layers: [{ name: "Wanden", color: kleur, entities: 3, from_ocg: true, from_annotation: false }] },
    { layers: [{ name: "WANDEN", color: kleur, entities: 4, from_ocg: true, from_annotation: false },
      { name: "OPS_Square", color: kleur, entities: 1, from_ocg: false, from_annotation: true }] },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].entities, 7);
  assert.equal(objectenNaUitsluiten(merged, ["wanden"]), 1);
  assert.equal(objectenNaUitsluiten(merged, []), 8);
});

test("sizes", () => {
  assert.equal(grootteTekst(512), "512 B");
  assert.equal(grootteTekst(2048), "2 kB");
  assert.equal(grootteTekst(1.5 * 1024 * 1024), "1,5 MB");
});

test("stored export settings are validated", () => {
  assert.deepEqual(herstelCadExportInstellingen(undefined), CAD_EXPORT_STANDAARD);
  const s = herstelCadExportInstellingen({
    format: "dwg", version: "r1999", units: "km", scaleMode: "custom", customScale: "-5",
    curveToleranceMm: 50, text: "ja", annotations: true, customPages: 42, offsetX: "12.5",
  });
  assert.equal(s.format, "dwg");
  assert.equal(s.version, CAD_EXPORT_STANDAARD.version);
  assert.equal(s.units, CAD_EXPORT_STANDAARD.units);
  assert.equal(s.scaleMode, "custom");
  assert.equal(s.customScale, 0.01);
  assert.equal(s.curveToleranceMm, 1);
  assert.equal(s.text, CAD_EXPORT_STANDAARD.text);
  assert.equal(s.annotations, true);
  assert.equal(s.customPages, "");
  assert.equal(s.offsetX, 12.5);
});

test("the route back to the model is a real origin choice: remembered, sent, and every crate origin is offered", () => {
  // De crate kent drie oorsprongen (snake_case); het venster moet ze alle drie kennen.
  const convertRs = readFileSync(new URL("../../../open-pdf-cad/src/convert.rs", import.meta.url), "utf8");
  const enumBlok = convertRs.slice(convertRs.indexOf("pub enum OriginMode"), convertRs.indexOf("}", convertRs.indexOf("pub enum OriginMode")));
  const crate = [...enumBlok.matchAll(/^\s{4}(\w+),$/gm)].map((m) => m[1].toLowerCase()).sort();
  assert.deepEqual(crate, ["area", "model", "page"]);
  for (const origin of crate) {
    assert.equal(herstelCadExportInstellingen({ origin }).origin, origin, `origin ${origin} survives the preferences`);
    assert.equal(exportArgumenten({ ...CAD_EXPORT_STANDAARD, origin }, { pdfPath: "a.pdf", pageIndex: 0 }).origin, origin);
  }
  assert.equal(herstelCadExportInstellingen({ origin: "elders" }).origin, "page");
  // Alleen een pagina met een viewport mét modelmatrix kan een terugweg dragen.
  const M = { heeftModelMatrix: true };
  assert.equal(modelOorsprongMogelijk({ 1: [M], 2: [] }, [1]), true);
  assert.equal(modelOorsprongMogelijk({ 1: [M], 2: [] }, [2]), false);
  assert.equal(modelOorsprongMogelijk({ 1: [M], 2: [] }, [2, 1]), true);
  assert.equal(modelOorsprongMogelijk({ 1: [{}], 2: [{}, M] }, [1]), false, "meetschaal zonder matrix telt niet");
  assert.equal(modelOorsprongMogelijk({ 1: [{}], 2: [{}, M] }, [2]), true);
  assert.equal(modelOorsprongMogelijk(undefined, [1]), false);
  assert.equal(modelOorsprongMogelijk({}, []), false);
});

test("units from measure labels", () => {
  assert.equal(eenheidUitLabel(" mm "), "mm");
  assert.equal(eenheidUitLabel("M"), "m");
  assert.equal(eenheidUitLabel('"'), "in");
  assert.equal(eenheidUitLabel(" "), null);
  assert.equal(eenheidUitLabel("furlong"), null);
});

test("measure dictionary to the app's scale", () => {
  // Blanco eenheid met 0,35278 mm per punt: papier 1:1.
  const papier = schaalUitMeasure(0.35278, " ");
  assert.equal(papier.unit, "mm");
  assert.ok(bijna(papier.mmPerPoint / MM_PER_PT, 1, 1e-4));
  // 1:100 in meters zoals een CAD-plot hem schrijft.
  const m = schaalUitMeasure(0.03527778, "m");
  assert.equal(m.unit, "m");
  assert.ok(bijna(m.mmPerPoint / MM_PER_PT, 100, 1e-3));
  assert.ok(bijna(m.pixelsPerUnit, 1 / 0.03527778));
  // Kilometers gaan naar meters.
  const km = schaalUitMeasure(0.001, "km");
  assert.equal(km.unit, "m");
  assert.ok(bijna(km.pixelsPerUnit, 1));
  assert.equal(schaalUitMeasure(0, "mm"), null);
});

test("viewport box to app space for every rotation", () => {
  const view = [0, 0, 100, 200];
  // Linksonder-vierkant 0..10 × 0..20 in gebruikersruimte.
  assert.deepEqual(naarAppRuimte([0, 0, 10, 20], view, 0), { x: 0, y: 180, width: 10, height: 20 });
  assert.deepEqual(naarAppRuimte([0, 0, 10, 20], view, 90), { x: 0, y: 0, width: 20, height: 10 });
  assert.deepEqual(naarAppRuimte([0, 0, 10, 20], view, 180), { x: 90, y: 0, width: 10, height: 20 });
  assert.deepEqual(naarAppRuimte([0, 0, 10, 20], view, 270), { x: 180, y: 90, width: 20, height: 10 });
  // Box met oorsprong buiten (0,0).
  assert.deepEqual(naarAppRuimte([-50, -100, -40, -80], [-50, -100, 50, 100], 0), { x: 0, y: 180, width: 10, height: 20 });
});

test("viewports are read from a PDF and the innermost one wins", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.node.set(PDFName.of("Rotate"), PDFNumber.of(0));
  const measure = (c, u, r) => doc.context.obj({
    Type: "Measure", Subtype: "RL", R: PDFString.of(r),
    X: [doc.context.obj({ U: PDFString.of(u), C: c, D: 1 })],
  });
  page.node.set(PDFName.of("VP"), doc.context.obj([
    doc.context.obj({ Type: "Viewport", BBox: [0, 0, 400, 300], Measure: measure(0.35278, "mm", "1:1") }),
    doc.context.obj({ Type: "Viewport", BBox: [100, 100, 200, 200], Name: PDFString.of("Detail"), Measure: measure(17.639, "mm", "1:50") }),
    doc.context.obj({ Type: "Viewport", BBox: [0, 0, 10, 10] }),
  ]));
  const reloaded = await PDFDocument.load(await doc.save());
  const vps = leesPdfViewports(reloaded);
  assert.deepEqual(Object.keys(vps), ["1"]);
  assert.equal(vps[1].length, 2, "een viewport zonder /Measure telt niet");
  const detail = vps[1][1];
  assert.equal(detail.name, "Detail");
  assert.equal(detail.ratio, "1:50");
  assert.deepEqual([detail.x, detail.y, detail.width, detail.height], [100, 100, 100, 100]);
  // Midden van het detail: de detailschaal; ernaast: de papierschaal.
  assert.equal(viewportOp(vps[1], 150, 150).name, "Detail");
  assert.equal(viewportOp(vps[1], 20, 20).ratio, "1:1");
  assert.equal(viewportOp(vps[1], 500, 20), null);
});
