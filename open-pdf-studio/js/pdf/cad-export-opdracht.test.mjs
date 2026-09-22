import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARGUMENTEN, exportFout, exportOpdrachtArgumenten, exportUitkomst, leesExportOpdracht,
} from "./cad-export-opdracht.js";
import { CAD_EXPORT_STANDAARD } from "../solid/stores/cad-export-instellingen.js";
import { MAX_ENTITEITEN, exportArgumenten } from "./cad-export-logica.js";

// De MCP-opdracht `app_export_cad` loopt dezelfde weg als het exportvenster:
// dezelfde instellingen, dezelfde argumentopbouw (exportArgumenten) en dezelfde
// exportroutine. Hier de pure regels: argumenten lezen, argumenten voor de
// omzetter, het verslag (#400).

const PDF = "C:/werk/plan.pdf";
const DOEL = "C:/werk/uit/plan.dxf";

// ── De argumenten ──────────────────────────────────────────────────────────
test("the target path gives the format, or the format gives the extension", () => {
  const dxf = leesExportOpdracht({ path: DOEL }, undefined);
  assert.equal(dxf.ok, true);
  assert.equal(dxf.inst.format, "dxf");
  assert.equal(dxf.pad, DOEL);

  const dwg = leesExportOpdracht({ path: "C:/werk/uit/plan.dwg" }, undefined);
  assert.equal(dwg.inst.format, "dwg");

  // Zonder extensie geeft het formaat de extensie; zonder beide is het een fout.
  const toegevoegd = leesExportOpdracht({ path: "C:/werk/uit/plan", format: "dwg" }, undefined);
  assert.equal(toegevoegd.ok, true);
  assert.equal(toegevoegd.pad, "C:/werk/uit/plan.dwg");
  assert.equal(leesExportOpdracht({ path: "C:/werk/uit/plan" }, undefined).ok, false);
  // Formaat en extensie in tegenspraak: het formaat wint en de extensie volgt.
  const strijd = leesExportOpdracht({ path: DOEL, format: "dwg" }, undefined);
  assert.equal(strijd.pad, "C:/werk/uit/plan.dwg");
  assert.equal(strijd.inst.format, "dwg");
  // Een onthouden binaire DXF blijft binair bij een .dxf-doel.
  assert.equal(leesExportOpdracht({ path: DOEL }, { format: "dxf_binary" }).inst.format, "dxf_binary");
});

test("a path is only accepted when it is an absolute path", () => {
  assert.equal(leesExportOpdracht({}, undefined).ok, false);
  assert.equal(leesExportOpdracht({ path: "uit/plan.dxf" }, undefined).ok, false);
  assert.equal(leesExportOpdracht({ path: "C:/werk/../plan.dxf" }, undefined).ok, false);
  assert.equal(leesExportOpdracht({ path: "C:/werk/plan.pdf" }, undefined).ok, false, "een PDF is geen doelbestand");
  assert.match(leesExportOpdracht({ path: "/tmp/plan.dxf", pagina: 1 }, undefined).error, /unknown argument: pagina/);
  assert.equal(leesExportOpdracht([DOEL], undefined).ok, false);
});

test("pages, origin, area, scale, layers and annotations are checked, never silently defaulted", () => {
  const o = leesExportOpdracht({
    path: DOEL, pages: "1-3, 5", origin: "model", area: [10, 20, 110, 70], annotations: true,
    scaleMode: "custom", scale: 50, layers: "single", units: "m", layersOff: ["Hulp", " "], allowLarge: true,
  }, undefined);
  assert.equal(o.ok, true, o.error);
  assert.equal(o.paginas, "1-3, 5");
  assert.equal(o.oorsprong, "model");
  assert.deepEqual(o.gebied, { x: 10, y: 20, width: 100, height: 50 });
  assert.equal(o.inst.annotations, true);
  assert.equal(o.inst.scaleMode, "custom");
  assert.equal(o.inst.customScale, 50);
  assert.equal(o.inst.layers, "single");
  assert.equal(o.inst.units, "m");
  assert.deepEqual(o.lagenUit, ["Hulp"]);
  assert.equal(o.grootToegestaan, true);

  // Standaard: de huidige pagina, wat het venster onthield.
  const standaard = leesExportOpdracht({ path: DOEL }, { scaleMode: "paper", layers: "style" });
  assert.equal(standaard.paginas, "current");
  assert.equal(standaard.oorsprong, "page");
  assert.equal(standaard.gebied, null);
  assert.equal(standaard.inst.scaleMode, "paper");
  assert.equal(standaard.inst.layers, "style");
  assert.equal(standaard.grootToegestaan, false);
  // De opdracht wint per veld van wat het venster onthield.
  assert.equal(leesExportOpdracht({ path: DOEL, layers: "single" }, { layers: "style" }).inst.layers, "single");
  // `scale` zonder `scaleMode` betekent een eigen schaal.
  const eigen = leesExportOpdracht({ path: DOEL, scale: 20 }, { scaleMode: "measure" });
  assert.equal(eigen.inst.scaleMode, "custom");
  assert.equal(eigen.inst.customScale, 20);

  for (const slecht of [
    { pages: 3 }, { pages: "" }, { origin: "corner" }, { area: [1, 2, 3] }, { area: [10, 10, 5, 20] },
    { annotations: "yes" }, { scaleMode: "fit" }, { scale: -1 }, { scale: "50" }, { layers: "none" },
    { units: "ft" }, { layersOff: "Hulp" }, { format: "svg" }, { allowLarge: 1 }, { scaleMode: "custom" },
  ]) {
    const uit = leesExportOpdracht({ path: DOEL, ...slecht }, undefined);
    assert.equal(uit.ok, false, JSON.stringify(slecht));
    assert.equal(typeof uit.error, "string");
  }
  assert.ok(ARGUMENTEN.includes("path") && ARGUMENTEN.includes("pages") && ARGUMENTEN.includes("origin"));
});

// ── De argumenten voor de omzetter ─────────────────────────────────────────
test("the converter gets the same arguments as from the dialog, plus the model origin", () => {
  const o = leesExportOpdracht({ path: DOEL, origin: "model", area: [10, 20, 110, 70], annotations: true }, undefined);
  const args = exportOpdrachtArgumenten(o, {
    pdfPath: PDF, pageIndex: 2, outputPath: DOEL, schaalnoemer: 100, paginaHoogte: 600, uitgeslotenLagen: ["HULP"],
  });
  // Wat het venster zou sturen met dezelfde instellingen …
  const venster = exportArgumenten({ ...CAD_EXPORT_STANDAARD, annotations: true, origin: "model" }, {
    pdfPath: PDF, pageIndex: 2, outputPath: DOEL, schaalnoemer: 100, gebied: [10, 530, 100, 50],
    uitgeslotenLagen: ["HULP"], maxEntiteiten: MAX_ENTITEITEN,
  });
  assert.deepEqual(args, venster);
  // … en het gebied in app-punten (linksboven) is omgezet naar de weergegeven
  // pagina met de oorsprong linksonder.
  assert.deepEqual(args.area, [10, 530, 100, 50]);
  assert.equal(args.origin, "model", "de oorsprong van het model komt door, ook al kent het venster hem nog niet");
  assert.equal(args.maxEntities, MAX_ENTITEITEN);

  // Zonder gebied geen area; met allowLarge geen grens; papiermaat geeft geen schaalnoemer.
  const los = exportOpdrachtArgumenten(leesExportOpdracht({ path: DOEL, allowLarge: true, scaleMode: "paper" }, undefined), {
    pdfPath: PDF, pageIndex: 0, outputPath: DOEL, schaalnoemer: null, paginaHoogte: 600, uitgeslotenLagen: [],
  });
  assert.equal(los.area, undefined);
  assert.equal(los.maxEntities, undefined);
  assert.equal(los.scaleDenominator, undefined);
  assert.equal(los.origin, "page");
});

// ── Het verslag ────────────────────────────────────────────────────────────
test("the result names the files, the counts and the warnings, with a code for a failure", () => {
  const o = leesExportOpdracht({ path: DOEL, pages: "all" }, undefined);
  const verslag = (n) => ({
    output_path: `C:/werk/uit/plan_p${n}.dxf`, file_size: 1000 * n, page_width: 841, page_height: 594, page_rotate: 0,
    scale_denominator: 100,
    convert: { lines: 10, polylines: 2, splines: 0, hatches: 1, texts: 3, layers: 4, skipped_images: n === 2 ? 1 : 0, skipped_invisible_text: 0 },
  });
  const uit = exportUitkomst(o, [{ pagina: 1, verslag: verslag(1) }, { pagina: 2, verslag: verslag(2) }], ["a warning"]);
  assert.equal(uit.ok, true);
  assert.equal(uit.format, "dxf");
  assert.equal(uit.files.length, 2);
  assert.deepEqual(uit.files[0], {
    page: 1, path: "C:/werk/uit/plan_p1.dxf", bytes: 1000, objects: 16, scale: "1:100", width: 841, height: 594,
    layers: 4, skipped: { images: 0, invisible_text: 0 },
  });
  assert.equal(uit.objects, 32);
  assert.equal(uit.bytes, 3000);
  assert.deepEqual(uit.warnings, ["a warning", "page 2: 1 image(s) were skipped"]);

  const groot = exportFout(new Error("TOO_LARGE:900000:750000"), DOEL, 3);
  assert.equal(groot.ok, false);
  assert.equal(groot.code, "tooLarge");
  assert.equal(groot.page, 3);
  assert.deepEqual([groot.entities, groot.limit], [900000, 750000]);
  assert.match(groot.error, /allowLarge/);
  assert.equal(exportFout(new Error("NO_MODEL_SPACE"), DOEL, 1).code, "noModelSpace");
  assert.equal(exportFout(new Error("MODEL_SPACE_AMBIGUOUS:2"), DOEL, 1).n, 2);
  const anders = exportFout(new Error("disk full"), DOEL, 1);
  assert.equal(anders.code, "failed");
  assert.match(anders.error, /disk full/);
  assert.equal(anders.file_path, DOEL);
});
