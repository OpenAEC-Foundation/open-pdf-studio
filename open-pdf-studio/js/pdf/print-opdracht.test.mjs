import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARGUMENTEN_BESTAND, ARGUMENTEN_PRINTER, INHOUDEN, MAX_KOPIEEN, PAPIERKEUZES,
  kiesPaginas, leesPrintOpdracht, opdrachtPaginaInstelling, papierSleutel, plaatsingKeuzes,
  printOpdrachtArgumenten, printUitkomst, printerUitkomst, standaardPapier, velFormaatNaam,
} from "./print-opdracht.js";
import { PRINT_STANDAARD } from "../solid/stores/print-instellingen.js";
import { PAPIERFORMATEN, printArgumenten } from "./print-pagina-instelling.js";
import { berekenPlaatsing } from "./print-plaatsing.js";
import { isBestandsPrinter } from "./print-doel.js";

// De MCP-opdrachten `app_print_to_pdf` en `app_print` lopen dezelfde weg als
// het printvenster: dezelfde keuzes, dezelfde plaatsing (print-plaatsing.js) en
// dezelfde printroutine (print-job.js). Hier de pure regels: argumenten lezen,
// de argumenten voor de printroutine, en het antwoord.

const DOEL = "C:/werk/uit/plan - afdruk.pdf";
// Wat `printArgumenten` voor een document zonder eigen Pagina-instelling geeft.
const GEEN_INSTELLING = { orientatie: "auto", papier: "printer", stand: null };

// ── De argumenten ──────────────────────────────────────────────────────────
test("app_print_to_pdf needs an absolute path that ends in .pdf", () => {
  const goed = leesPrintOpdracht({ path: DOEL }, { venster: GEEN_INSTELLING });
  assert.equal(goed.ok, true, goed.error);
  assert.equal(goed.pad, DOEL);

  assert.equal(leesPrintOpdracht({}, { venster: GEEN_INSTELLING }).ok, false);
  assert.match(leesPrintOpdracht({ path: "uit/plan.pdf" }, {}).error, /absolute path/);
  assert.match(leesPrintOpdracht({ path: "C:/werk/plan.dwg" }, {}).error, /end in \.pdf/);
  assert.match(leesPrintOpdracht({ path: "C:/werk/plan" }, {}).error, /end in \.pdf/);
  assert.match(leesPrintOpdracht({ path: "C:/werk/../plan.pdf" }, {}).error, /"\.\." parts/);
  assert.match(leesPrintOpdracht({ path: "https://elders/plan.pdf" }, {}).error, /URL/);
  assert.equal(leesPrintOpdracht([DOEL], {}).ok, false, "params is geen object");
});

test("an unknown or wrongly typed argument is refused, never silently ignored", () => {
  assert.match(leesPrintOpdracht({ path: DOEL, dpi: 300 }, {}).error, /unknown argument: dpi/);
  // De printer hoort bij app_print, het pad bij app_print_to_pdf.
  assert.match(leesPrintOpdracht({ path: DOEL, printer: "X" }, {}).error, /unknown argument: printer/);
  assert.match(leesPrintOpdracht({ printer: "X", path: DOEL }, { naarBestand: false }).error, /unknown argument: path/);
  assert.match(leesPrintOpdracht({ path: DOEL, pages: 3 }, {}).error, /params\.pages/);
  assert.match(leesPrintOpdracht({ path: DOEL, center: "ja" }, {}).error, /params\.center/);
  assert.match(leesPrintOpdracht({ path: DOEL, autoRotate: "ja" }, {}).error, /params\.autoRotate/);
  assert.match(leesPrintOpdracht({ path: DOEL, zoom: "50" }, {}).error, /params\.zoom must be a number/);
  assert.match(leesPrintOpdracht({ path: DOEL, zoom: 5 }, {}).error, /between 10 and 400/);
  assert.match(leesPrintOpdracht({ path: DOEL, scaling: "groot" }, {}).error, /params\.scaling/);
  assert.match(leesPrintOpdracht({ path: DOEL, content: "alles" }, {}).error, /params\.content/);
  assert.match(leesPrintOpdracht({ path: DOEL, orientation: "zijwaarts" }, {}).error, /params\.orientation/);
  assert.match(leesPrintOpdracht({ path: DOEL, paper: "A9" }, {}).error, /params\.paper/);
  assert.deepEqual([...ARGUMENTEN_BESTAND].sort(), [
    "autoRotate", "center", "content", "orientation", "pages", "paper", "path", "scaling", "zoom",
  ]);
  assert.deepEqual([...ARGUMENTEN_PRINTER].sort(), [
    "autoRotate", "center", "content", "copies", "orientation", "pages", "paper", "printer", "scaling", "zoom",
  ]);
});

test("app_print needs a printer, and takes copies", () => {
  assert.match(leesPrintOpdracht({}, { naarBestand: false }).error, /params\.printer/);
  assert.match(leesPrintOpdracht({ printer: "  " }, { naarBestand: false }).error, /params\.printer/);
  const o = leesPrintOpdracht({ printer: " Kantoor ", copies: 3 }, { naarBestand: false, venster: GEEN_INSTELLING });
  assert.equal(o.ok, true, o.error);
  assert.equal(o.printer, "Kantoor");
  assert.equal(o.kopieen, 3);
  assert.equal(o.pad, null);
  for (const fout of [0, 2.5, MAX_KOPIEEN + 1, "2"]) {
    assert.match(leesPrintOpdracht({ printer: "X", copies: fout }, { naarBestand: false }).error, /params\.copies/);
  }
  // Zonder aantal het aantal dat het venster onthield.
  assert.equal(leesPrintOpdracht({ printer: "X" }, { naarBestand: false, onthouden: { copies: 4 } }).kopieen, 4);
});

test("the remembered dialog settings are the base; the command wins per field", () => {
  const onthouden = {
    scaling: "shrink", zoom: 75, autoCenter: false, content: "doc-only", autoRotate: false, range: "custom",
    customPages: "3-4", subset: "odd", reverseOrder: true,
  };
  const basis = leesPrintOpdracht({ path: DOEL }, { onthouden, venster: { orientatie: "portrait", papier: "a3", stand: "portrait" } });
  assert.equal(basis.schaling, "shrink");
  assert.equal(basis.zoom, 75);
  assert.equal(basis.centreren, false);
  assert.equal(basis.inhoud, "doc-only");
  // Het onthouden paginabereik hoort bij een ander document: de opdracht begint
  // bij de standaard van het venster zelf, en even/oneven doet niet mee.
  assert.equal(basis.paginas, "all");

  const eigen = leesPrintOpdracht(
    { path: DOEL, scaling: "actual", center: true, content: "document-and-markups", pages: "2-5" },
    { onthouden, venster: GEEN_INSTELLING },
  );
  assert.equal(eigen.schaling, "actual");
  assert.equal(eigen.centreren, true);
  assert.equal(eigen.inhoud, "doc-and-markups");
  assert.equal(eigen.paginas, "2-5");
  assert.equal(INHOUDEN["document-and-markups"], "doc-and-markups");
  assert.equal(INHOUDEN.document, "doc-only");
  assert.equal(PRINT_STANDAARD.range, "all", "de standaard van het venster is alle pagina's");
});

test("a zoom implies custom-scale, and custom-scale needs a zoom", () => {
  const o = leesPrintOpdracht({ path: DOEL, zoom: 42 }, { venster: GEEN_INSTELLING });
  assert.equal(o.schaling, "custom-scale");
  assert.equal(o.zoom, 42);
  assert.match(leesPrintOpdracht({ path: DOEL, scaling: "custom-scale" }, {}).error, /needs params\.zoom/);
  // Hele procenten, zoals de dialoog.
  assert.equal(leesPrintOpdracht({ path: DOEL, zoom: 42.4 }, {}).zoom, 42);
});

test("paper takes a size, \"page\" or \"printer\", each where it makes sense", () => {
  assert.equal(leesPrintOpdracht({ path: DOEL, paper: "A3L" }, {}).papier, "a3l");
  assert.equal(leesPrintOpdracht({ path: DOEL, paper: "a3l" }, {}).papier, "a3l");
  assert.equal(leesPrintOpdracht({ path: DOEL, paper: "Letter" }, {}).papier, "letter");
  assert.equal(leesPrintOpdracht({ path: DOEL, paper: "page" }, {}).papier, "page");
  assert.match(leesPrintOpdracht({ path: DOEL, paper: "printer" }, {}).error, /needs a printer/);
  assert.match(leesPrintOpdracht({ printer: "X", paper: "page" }, { naarBestand: false }).error, /only applies to app_print_to_pdf/);
  assert.equal(leesPrintOpdracht({ printer: "X", paper: "printer" }, { naarBestand: false }).papier, "printer");
  assert.equal(papierSleutel("A0"), "a0");
  assert.equal(papierSleutel("onzin"), null);
  // Elke keuze uit de gereedschapslijst is een geldige keuze.
  for (const keuze of PAPIERKEUZES) assert.ok(papierSleutel(keuze), keuze);
  assert.equal(PAPIERKEUZES.length, Object.keys(PAPIERFORMATEN).length + 2);
});

test("without paper the command takes the paper the next print would already get", () => {
  // Een bevestigde Pagina-instelling wint, ook bij een afdruk naar een bestand.
  assert.equal(standaardPapier("a2", true), "a2");
  assert.equal(standaardPapier("a2", false), "a2");
  // Geen Pagina-instelling: het papier van de printer, of — zonder printer —
  // elke pagina op haar eigen vel, net als "Opslaan als PDF" in het venster.
  assert.equal(standaardPapier("printer", false), "printer");
  assert.equal(standaardPapier("printer", true), "page");
  assert.equal(standaardPapier(undefined, true), "page");
  const doc = leesPrintOpdracht({ path: DOEL }, { venster: { orientatie: "landscape", papier: "a1", stand: "landscape" } });
  assert.equal(doc.papier, "a1");
  assert.equal(doc.orientatie, "landscape");
});

test("orientation and autoRotate describe the same choice and may not contradict", () => {
  assert.equal(leesPrintOpdracht({ path: DOEL, orientation: "landscape" }, {}).orientatie, "landscape");
  assert.equal(leesPrintOpdracht({ path: DOEL, orientation: "landscape" }, {}).autoRotate, false);
  assert.equal(leesPrintOpdracht({ path: DOEL, autoRotate: true }, {}).orientatie, "auto");
  assert.equal(leesPrintOpdracht({ path: DOEL, autoRotate: true }, {}).autoRotate, true);
  // autoRotate false zonder stand: die uit de Pagina-instelling, anders staand.
  assert.equal(leesPrintOpdracht({ path: DOEL, autoRotate: false }, { venster: { stand: "landscape" } }).orientatie, "landscape");
  assert.equal(leesPrintOpdracht({ path: DOEL, autoRotate: false }, { venster: GEEN_INSTELLING }).orientatie, "portrait");
  assert.match(leesPrintOpdracht({ path: DOEL, autoRotate: true, orientation: "portrait" }, {}).error, /leave params\.orientation out/);
  assert.match(leesPrintOpdracht({ path: DOEL, autoRotate: false, orientation: "auto" }, {}).error, /exclude each other/);
  // Zonder beide: de stand die de volgende afdruk toch al zou krijgen.
  assert.equal(leesPrintOpdracht({ path: DOEL }, { venster: GEEN_INSTELLING }).orientatie, "auto");
});

// ── De paginalijst ─────────────────────────────────────────────────────────
test("pages picks all, the current page, or the range through parsePageRange", () => {
  const aanroepen = [];
  const bereik = (tekst, totaal) => {
    aanroepen.push([tekst, totaal]);
    return [2, 3];
  };
  const alles = kiesPaginas({ paginas: "all" }, { totaal: 4, huidig: 2, bereik });
  assert.deepEqual(alles.pages, [1, 2, 3, 4]);
  const huidig = kiesPaginas({ paginas: "current" }, { totaal: 4, huidig: 3, bereik });
  assert.deepEqual(huidig.pages, [3]);
  assert.deepEqual(aanroepen, [], "\"all\" en \"current\" gaan niet langs parsePageRange");

  const deel = kiesPaginas({ paginas: "2-3" }, { totaal: 4, huidig: 1, bereik });
  assert.deepEqual(deel.pages, [2, 3]);
  assert.deepEqual(aanroepen, [["2-3", 4]], "het bereik gaat woordelijk naar parsePageRange");

  const leeg = kiesPaginas({ paginas: "9" }, { totaal: 4, huidig: 1, bereik: () => [] });
  assert.equal(leeg.ok, false);
  assert.match(leeg.error, /selects no page of 4/);
  // Een getoonde pagina buiten het document valt binnen het bereik.
  assert.deepEqual(kiesPaginas({ paginas: "current" }, { totaal: 2, huidig: 9, bereik }).pages, [2]);
  assert.equal(kiesPaginas({ paginas: "all" }, { totaal: 0, bereik }).ok, false);
});

// ── Dezelfde argumenten als het printvenster ──────────────────────────────
test("the arguments are the ones the print dialog would send", () => {
  const opdracht = leesPrintOpdracht(
    { path: DOEL, paper: "A3", orientation: "landscape", scaling: "shrink", center: false, content: "document" },
    { venster: GEEN_INSTELLING },
  );
  const vel = { breedteMm: 297, hoogteMm: 420 };
  const marges = { staand: { links: 5, boven: 5, rechts: 5, onder: 5 } };
  const keuzes = plaatsingKeuzes(opdracht, { vel, marges });
  // Zo bouwt PrintDialog.jsx plaatsingKeuzes op.
  assert.deepEqual(keuzes, {
    papier: { breedteMm: 297, hoogteMm: 420, bedrukbaar: marges },
    orientatie: "landscape",
    schaling: "shrink",
    zoom: 100,
    centreren: false,
  });
  // En zo roept executePrint slaPrintOpAlsPdf aan.
  assert.deepEqual(printOpdrachtArgumenten(opdracht, { pages: [1, 2], keuzes }), {
    pages: [1, 2],
    pad: DOEL,
    orientatie: "landscape",
    vel: keuzes.papier,
    schaling: "shrink",
    zoom: 100,
    centreren: false,
    inhoud: "doc-only",
    openen: null,
  });
});

test("without a known sheet a file print lays every page on its own sheet, a printer fits it in", () => {
  const bestand = leesPrintOpdracht({ path: DOEL, paper: "page" }, { venster: GEEN_INSTELLING });
  assert.equal(plaatsingKeuzes(bestand, { vel: null }).papier, "pagina");
  const printer = leesPrintOpdracht({ printer: "Kantoor" }, { naarBestand: false, venster: GEEN_INSTELLING });
  assert.equal(plaatsingKeuzes(printer, { vel: null }).papier, null);
  const keuzes = plaatsingKeuzes(printer, { vel: null });
  assert.deepEqual(printOpdrachtArgumenten(printer, { pages: [1], keuzes }), {
    pages: [1],
    copies: 1,
    printer: "Kantoor",
    orientatie: "auto",
    papier: "printer",
    vel: null,
    schaling: "fit",
    zoom: 100,
    centreren: true,
    inhoud: "doc-and-markups",
  });
});

test("the command's own page setup gives the dialog functions the requested paper", () => {
  const opdracht = leesPrintOpdracht({ printer: "Kantoor", paper: "A2", orientation: "portrait" }, { naarBestand: false });
  const instelling = opdrachtPaginaInstelling(opdracht, 7);
  assert.deepEqual(instelling, { docId: 7, size: "a2", orientation: "portrait", handmatig: true });
  assert.deepEqual(printArgumenten({ autoRotate: opdracht.autoRotate, paginaInstelling: instelling, docId: 7 }), {
    orientatie: "portrait",
    papier: "a2",
  });
  // Automatisch draaien laat de driver per pagina draaien, zoals in het venster.
  const auto = leesPrintOpdracht({ printer: "Kantoor", paper: "A2", autoRotate: true }, { naarBestand: false });
  assert.equal(printArgumenten({
    autoRotate: auto.autoRotate, paginaInstelling: opdrachtPaginaInstelling(auto, 7), docId: 7,
  }).orientatie, "auto");
  // "page" heeft geen formaat voor de driver.
  const eigen = leesPrintOpdracht({ path: DOEL, paper: "page" }, {});
  assert.equal(opdrachtPaginaInstelling(eigen, 7).size, "printer");
});

// ── Het antwoord ───────────────────────────────────────────────────────────
test("the answer names the sheet, its orientation and the scale that was used", () => {
  const opdracht = leesPrintOpdracht({ path: DOEL, paper: "A3", orientation: "landscape" }, {});
  const keuzes = plaatsingKeuzes(opdracht, { vel: { breedteMm: 297, hoogteMm: 420 } });
  // Een liggende A3-pagina op een liggend A3-vel: ware grootte, niets gedraaid.
  const a3Liggend = { breedtePt: 420 / (25.4 / 72), hoogtePt: 297 / (25.4 / 72) };
  const plaatsing = berekenPlaatsing({ ...keuzes, pagina: a3Liggend });
  const uit = printUitkomst(opdracht, [{ page: 1, plaatsing }]);
  assert.equal(uit.ok, true);
  assert.equal(uit.file_path, DOEL);
  assert.equal(uit.pages, 1);
  assert.equal(uit.sheet, "A3");
  assert.equal(uit.widthMm, 420);
  assert.equal(uit.heightMm, 297);
  assert.equal(uit.orientation, "landscape");
  assert.equal(uit.scale_percent, 100);
  assert.equal(uit.uniform, true);
  assert.equal(uit.content, "document-and-markups");
  assert.deepEqual(uit.warnings, []);
  assert.equal(uit.page_list[0].rotated, false);
});

test("pages with different sheets report per page, and cut-off pages give a warning", () => {
  const opdracht = leesPrintOpdracht({ path: DOEL, paper: "A4", orientation: "portrait", scaling: "actual" }, {});
  const keuzes = plaatsingKeuzes(opdracht, { vel: { breedteMm: 210, hoogteMm: 297 } });
  const pt = (mm) => mm / (25.4 / 72);
  const a4 = berekenPlaatsing({ ...keuzes, pagina: { breedtePt: pt(210), hoogtePt: pt(297) } });
  // Een A3 op ware grootte past niet op A4: afgesneden.
  const a3 = berekenPlaatsing({ ...keuzes, pagina: { breedtePt: pt(297), hoogtePt: pt(420) } });
  const uit = printUitkomst(opdracht, [{ page: 1, plaatsing: a4 }, { page: 2, plaatsing: a3 }], { gerasterd: true });
  assert.equal(uit.pages, 2);
  assert.equal(uit.uniform, true, "hetzelfde vel; alleen de pagina erop verschilt");
  assert.equal(uit.sheet, "A4");
  assert.match(uit.warnings.join("\n"), /page 2: the page does not fit/);
  assert.match(uit.warnings.join("\n"), /printed as images/);
  assert.equal(uit.page_list[1].page, 2);
  assert.equal(velFormaatNaam(297, 420), "A3");
  assert.equal(velFormaatNaam(300, 400), "");
});

test("a print to a printer names the printer, the sheet and the number of copies", () => {
  const opdracht = leesPrintOpdracht({ printer: "Kantoor", copies: 2, paper: "A1" }, { naarBestand: false });
  const keuzes = plaatsingKeuzes(opdracht, { vel: { breedteMm: 594, hoogteMm: 841 } });
  const plaatsing = berekenPlaatsing({ ...keuzes, pagina: { breedtePt: 1684, hoogtePt: 2384 } });
  const uit = printUitkomst(opdracht, [{ page: 1, plaatsing }]);
  assert.equal(uit.printer, "Kantoor");
  assert.equal(uit.copies, 2);
  assert.equal(uit.sheet, "A1");
  assert.equal(uit.paper, "a1");
  assert.equal(uit.file_path, undefined);
});

// ── De printerlijst ────────────────────────────────────────────────────────
test("the printer list reports driver, port, default and whether it writes to a file", () => {
  const lijst = [
    { Name: "Kantoor", DriverName: "Laser PCL6", PortName: "IP_192.168.1.20", Default: true, PrinterStatus: 3 },
    { Name: "Naar bestand", DriverName: "Generic", PortName: "PORTPROMPT:" },
    { Name: "Archief", DriverName: "Microsoft Print To PDF", PortName: "PORTPROMPT:" },
    null,
    { DriverName: "zonder naam" },
  ];
  const uit = printerUitkomst(lijst, "Kantoor", isBestandsPrinter);
  assert.equal(uit.ok, true);
  assert.equal(uit.count, 3);
  assert.equal(uit.default_printer, "Kantoor");
  assert.deepEqual(uit.printers[0], {
    name: "Kantoor", driver: "Laser PCL6", port: "IP_192.168.1.20", default: true, status: 3, writes_to_file: false,
  });
  assert.equal(uit.printers[1].writes_to_file, true);
  assert.equal(uit.printers[2].writes_to_file, true);
  assert.equal(uit.printers[1].default, false);

  const leeg = printerUitkomst([], "", isBestandsPrinter, "lpstat not found");
  assert.deepEqual(leeg.printers, []);
  assert.equal(leeg.default_printer, "");
  assert.equal(leeg.error_detail, "lpstat not found");
});
