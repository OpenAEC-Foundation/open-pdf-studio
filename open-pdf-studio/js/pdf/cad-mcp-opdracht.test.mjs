import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARGUMENTEN, DEKKING_MIN, DEKKING_STANDAARD, MAX_PADLENGTE, kiesLagen, kiesRuimte, leesImportOpdracht,
  opdrachtArgumenten, opdrachtUitkomst, padFout,
} from "./cad-mcp-opdracht.js";
import { CAD_IMPORT_STANDAARD } from "../solid/stores/cad-import-instellingen.js";

const PAD = "C:/werk/plan.dwg";

const SCAN = {
  defaultSpace: "Blad 1",
  layers: [
    { name: "0", off: false, frozen: false, plottable: true },
    { name: "Wanden", off: false, frozen: false, plottable: true },
    { name: "Hulp", off: true, frozen: false, plottable: true },
    { name: "Defpoints", off: false, frozen: false, plottable: false },
  ],
  spaces: [
    { id: "model", label: "Model", kind: "model", layers: [{ name: "0", objects: 3 }, { name: "Wanden", objects: 9 }] },
    { id: "Blad 1", label: "Blad 1", kind: "layout", layers: [{ name: "0", objects: 1 }] },
  ],
};

// ── Het pad ────────────────────────────────────────────────────────────────
test("a path is only accepted when it is an absolute path of a drawing", () => {
  assert.equal(padFout(PAD), "");
  assert.equal(padFout("C:\\werk\\plan.DXF"), "");
  assert.equal(padFout("/home/ik/plan.dxf"), "");
  assert.equal(padFout("\\\\server\\deel\\plan.dwg"), "", "een netwerkmap kan de gebruiker ook zelf openen");
  assert.match(padFout(undefined), /missing or invalid/);
  assert.match(padFout(""), /missing or invalid/);
  assert.match(padFout(42), /missing or invalid/);
  assert.match(padFout("plan.dwg"), /absolute/);
  assert.match(padFout("C:/werk/../geheim/plan.dwg"), /"\.\."/);
  assert.match(padFout("C:/werk/plan.pdf"), /not a CAD drawing/);
  assert.match(padFout("C:/werk/.dwg"), /not a CAD drawing/);
  assert.match(padFout("https://voorbeeld.test/plan.dwg"), /URL/);
  assert.match(padFout("file:///C:/werk/plan.dwg"), /URL/);
  assert.match(padFout("\\\\?\\C:\\werk\\plan.dwg"), /device path/);
  assert.match(padFout("\\\\.\\COM1\\plan.dwg"), /device path/);
  assert.match(padFout(`C:/werk/pl${String.fromCharCode(10)}an.dwg`), /control characters/);
  assert.match(padFout(`C:/${"a".repeat(MAX_PADLENGTE)}.dwg`), /longer than/);
});

// ── Argumenten lezen ───────────────────────────────────────────────────────
test("only the path is required; everything else comes from the defaults", () => {
  const o = leesImportOpdracht({ path: PAD }, undefined);
  assert.equal(o.ok, true);
  assert.equal(o.pad, PAD);
  assert.equal(o.ruimte, null);
  assert.equal(o.doel, "new");
  assert.equal(o.dekking, DEKKING_STANDAARD);
  assert.deepEqual(o.lagenUit, []);
  assert.equal(o.venster, null);
  assert.deepEqual(o.inst, { ...CAD_IMPORT_STANDAARD, pens: [], fonts: [], searchPaths: [] });
});

test("preview is refused and never reaches the converter", () => {
  const geweigerd = leesImportOpdracht({ path: PAD, preview: true }, undefined);
  assert.equal(geweigerd.ok, false);
  assert.match(geweigerd.error, /preview/);
  assert.equal(ARGUMENTEN.includes("preview"), false);
  // Ook een onthouden instelling met die naam komt er niet door.
  const o = leesImportOpdracht({ path: PAD }, { preview: true });
  const args = opdrachtArgumenten(o, SCAN.spaces[0], { outputPath: "uit.pdf" });
  assert.equal("preview" in args, false);
});

test("an unknown or wrongly typed argument is an error, not a silent default", () => {
  const mis = (extra, patroon) => {
    const o = leesImportOpdracht({ path: PAD, ...extra }, undefined);
    assert.equal(o.ok, false, JSON.stringify(extra));
    assert.match(o.error, patroon, JSON.stringify(extra));
  };
  mis({ schaal: 50 }, /unknown argument: schaal/);
  mis({ outputPath: "C:/elders/uit.pdf" }, /unknown argument/);
  mis({ scale: "50" }, /params\.scale must be a number/);
  mis({ scale: -5 }, /params\.scale/);
  mis({ scale: Number.NaN }, /params\.scale/);
  mis({ paper: "A5" }, /params\.paper must be one of/);
  mis({ colors: "rood" }, /params\.colors must be one of/);
  mis({ target: "replace" }, /params\.target must be one of/);
  mis({ text: "ja" }, /params\.text must be true or false/);
  mis({ layersOff: "Hulp" }, /params\.layersOff must be a list/);
  mis({ layersOff: ["Hulp", 7] }, /params\.layersOff must be a list/);
  mis({ searchPaths: [null] }, /params\.searchPaths/);
  mis({ pens: [["#ff0000", 0.5]] }, /params\.pens/);
  mis({ singleColor: "blauw" }, /params\.singleColor/);
  mis({ space: "" }, /params\.space/);
  mis({ window: [0, 0, 1] }, /params\.window/);
  mis({ window: [5, 0, 1, 1] }, /params\.window/);
  mis({ window: [0, 0, 1, 1], area: "limits" }, /exclude each other/);
  mis({ opacity: 0.3 }, /only applies to target "underlay"/);
  mis({ opacity: "half", target: "underlay" }, /params\.opacity must be a number/);
  assert.equal(leesImportOpdracht("plan.dwg", undefined).ok, false);
  assert.equal(leesImportOpdracht([PAD], undefined).ok, false);
  assert.equal(leesImportOpdracht(null, undefined).ok, false);
});

test("the command wins per field from what the dialog remembered", () => {
  const onthouden = { scale: 100, paper: "A1", colors: "gray", marginMm: 5, hatch: "none", area: "window" };
  const o = leesImportOpdracht({
    path: PAD, space: " Blad 1 ", scale: 50, colors: "single", singleColor: "ff8800", marginMm: 9999, text: false,
    layersOff: ["hulp", " "], layersOn: ["Defpoints"], searchPaths: ["C:/werk/onderleggers"], target: "underlay", opacity: 5,
  }, onthouden);
  assert.equal(o.ok, true);
  assert.equal(o.ruimte, "Blad 1");
  assert.equal(o.doel, "underlay");
  assert.equal(o.dekking, 1, "begrensd");
  assert.equal(leesImportOpdracht({ path: PAD, target: "underlay", opacity: 0 }, undefined).dekking, DEKKING_MIN);
  assert.equal(o.inst.scale, 50);
  assert.equal(o.inst.paper, "A1", "onthouden");
  assert.equal(o.inst.hatch, "none", "onthouden");
  assert.equal(o.inst.colors, "single");
  assert.equal(o.inst.singleColor, "#FF8800");
  assert.equal(o.inst.marginMm, 200, "buiten het bereik komt op de grens");
  assert.equal(o.inst.text, false);
  assert.equal(o.inst.area, "extents", "een onthouden venster hoort bij een andere tekening");
  assert.deepEqual(o.inst.searchPaths, ["C:/werk/onderleggers"]);
  assert.deepEqual(o.lagenUit, ["hulp"]);
  assert.deepEqual(o.lagenAan, ["Defpoints"]);
  assert.deepEqual(o.papierKeuze, {}, "de opdracht noemde geen papier");
});

test("every choice the command offers is one the dialog keeps", () => {
  const bron = readFileSync(new URL("./cad-mcp-opdracht.js", import.meta.url), "utf8");
  const blok = bron.slice(bron.indexOf("const KEUZES"), bron.indexOf("});", bron.indexOf("const KEUZES")));
  const regels = [...blok.matchAll(/^\s+(\w+): \[([^\]]+)\]/gm)];
  assert.ok(regels.length >= 8);
  for (const [, naam, lijst] of regels) {
    for (const waarde of lijst.split(",").map((w) => w.trim().replace(/'/g, ""))) {
      const o = leesImportOpdracht({ path: PAD, [naam]: waarde }, undefined);
      assert.equal(o.ok, true, `${naam}=${waarde}`);
      assert.equal(o.inst[naam], waarde, `${naam}=${waarde} valt in het venster terug op de standaard`);
    }
  }
});

// ── Ruimte en lagen ────────────────────────────────────────────────────────
test("the space is what the file suggests, or the one that was asked for", () => {
  assert.equal(kiesRuimte(SCAN, null).ruimte.id, "Blad 1");
  assert.equal(kiesRuimte(SCAN, "MODEL").ruimte.id, "model");
  assert.equal(kiesRuimte(SCAN, "blad 1").ruimte.kind, "layout");
  const weg = kiesRuimte(SCAN, "Blad 9");
  assert.equal(weg.ok, false);
  assert.match(weg.error, /space not found: Blad 9/);
  assert.deepEqual(weg.spaces, ["model", "Blad 1"]);
  assert.equal(kiesRuimte({ spaces: [] }, null).ok, false);
  assert.equal(kiesRuimte(null, "model").ok, false);
});

test("layers: what the file switches off, plus layersOff, minus layersOn", () => {
  const standaard = kiesLagen(SCAN, "model", leesImportOpdracht({ path: PAD }, undefined));
  assert.deepEqual(standaard.excludedLayers, ["Hulp", "Defpoints"]);
  assert.deepEqual(standaard.hiddenLayers, []);
  assert.deepEqual(standaard.onbekend, []);

  const eigen = kiesLagen(SCAN, "model", leesImportOpdracht({
    path: PAD, layersOff: ["wanden", "Bestaat niet"], layersOn: ["HULP"],
  }, undefined));
  assert.deepEqual(eigen.excludedLayers, ["Wanden", "Defpoints"]);
  assert.deepEqual(eigen.onbekend, ["Bestaat niet"]);

  const verborgen = kiesLagen(SCAN, "model", leesImportOpdracht({ path: PAD, includeOffLayers: true }, undefined));
  assert.deepEqual(verborgen.excludedLayers, []);
  assert.deepEqual(verborgen.hiddenLayers, ["Hulp", "Defpoints"]);
});

// ── Argumenten voor de omzetter ────────────────────────────────────────────
test("the converter gets the same arguments as from the dialog", () => {
  const o = leesImportOpdracht({ path: PAD, scale: 50, paper: "A3", units: "m", window: [0, 0, 10, 5] }, { paper: "A0" });
  const args = opdrachtArgumenten(o, SCAN.spaces[0], {
    outputPath: "uit.pdf", excludedLayers: ["Hulp"], hiddenLayers: [], limits: { maxSearchPaths: 16 },
  });
  assert.equal(args.path, PAD);
  assert.equal(args.outputPath, "uit.pdf");
  assert.deepEqual(args.spaces, ["model"]);
  assert.deepEqual(args.excludedLayers, ["Hulp"]);
  assert.equal(args.scale, 50);
  assert.equal(args.paper, "A3");
  assert.equal(args.units, "m");
  assert.equal(args.area, "window");
  assert.deepEqual(args.window, [0, 0, 10, 5]);
  // Alle sleutels zijn velden van ImportArgs in de crate.
  const modRs = readFileSync(new URL("../../../open-pdf-cad/src/import/mod.rs", import.meta.url), "utf8");
  const struct = modRs.slice(modRs.indexOf("pub struct ImportArgs"), modRs.indexOf("impl ImportArgs"));
  const velden = new Set([...struct.matchAll(/pub (\w+):/g)].map((m) => m[1].replace(/_(\w)/g, (_, c) => c.toUpperCase())));
  for (const sleutel of Object.keys(args)) assert.ok(velden.has(sleutel), `${sleutel} is not a field of ImportArgs`);
});

test("a layout keeps its own paper unless the command names one", () => {
  const onthouden = { paper: "A0", orientation: "landscape" };
  const layout = SCAN.spaces[1];
  const zonder = opdrachtArgumenten(leesImportOpdracht({ path: PAD }, onthouden), layout, { outputPath: "uit.pdf" });
  assert.equal(zonder.paper, "auto", "het onthouden papier geldt alleen voor de modelruimte");
  assert.equal(zonder.orientation, "auto");
  assert.deepEqual(zonder.spaces, ["Blad 1"]);
  const met = opdrachtArgumenten(leesImportOpdracht({ path: PAD, paper: "A2" }, onthouden), layout, { outputPath: "uit.pdf" });
  assert.equal(met.paper, "A2");
  const model = opdrachtArgumenten(leesImportOpdracht({ path: PAD }, onthouden), SCAN.spaces[0], { outputPath: "uit.pdf" });
  assert.equal(model.paper, "A0");
  assert.equal(model.orientation, "landscape");
});

// ── Het antwoord ───────────────────────────────────────────────────────────
test("the result names pages, warnings and outside files, never a path", () => {
  const o = leesImportOpdracht({ path: PAD }, undefined);
  const uit = opdrachtUitkomst(o, "append", {
    outputPath: "C:/tijdelijk/opds-import-1-plan.pdf",
    pages: [
      { space: "model", paper: "A1", widthMm: 841, heightMm: 594, scale: 50, scaleText: "1:50", objects: 12 },
      { space: "Blad 1", paper: "A3", widthMm: 420, heightMm: 297, scale: 1, scaleText: "1:1", objects: 3 },
    ],
    warnings: ["xrefsMissing:1"],
    externals: [
      { name: "C:\\project\\onderlegger.dwg", kind: "xref", status: "missing" },
      { name: "foto.png", kind: "image", status: "loaded" },
      { name: "", kind: "image", status: "loaded" },
    ],
    externalsTruncated: true,
  }, ["Bestaat niet"]);
  assert.equal(uit.ok, true);
  assert.equal(uit.file_path, PAD);
  assert.equal(uit.target, "append");
  assert.equal(uit.pages, 2);
  assert.equal(uit.objects, 15);
  assert.equal(uit.space, "model");
  assert.equal(uit.paper, "A1");
  assert.equal(uit.scale, "1:50");
  assert.equal(uit.page_list.length, 2);
  assert.deepEqual(uit.warnings, ["xrefsMissing:1"]);
  assert.deepEqual(uit.externals, [
    { name: "onderlegger.dwg", kind: "xref", status: "missing" },
    { name: "foto.png", kind: "image", status: "loaded" },
  ]);
  assert.equal(uit.externals_truncated, true);
  assert.deepEqual(uit.unknown_layers, ["Bestaat niet"]);
  assert.equal(JSON.stringify(uit).includes("opds-import"), false, "het tijdelijke bestand blijft binnen");

  const leeg = opdrachtUitkomst(o, "new", {});
  assert.equal(leeg.pages, 0);
  assert.deepEqual(leeg.warnings, []);
  assert.deepEqual(leeg.externals, []);
});
