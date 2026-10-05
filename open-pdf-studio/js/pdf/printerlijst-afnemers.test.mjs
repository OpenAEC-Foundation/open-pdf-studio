// De afnemers van de printervragen met wat de spooler-opvraging van #524
// teruggeeft. Het voorbeeld staat in src-tauri/src/print_lijst.rs: daar
// toetst een Rust-test dat `printers_json` precies deze tekst maakt. Hier gaat
// dezelfde tekst door de printerlijst van de app, de printdialoog en
// `app_list_printers`, en de wachtrij van de virtuele printer krijgt het
// antwoord van `is_virtual_printer_installed`. Geen van die afnemers verandert.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isBestandsPrinter } from './print-doel.js';
import { printerUitkomst } from './print-opdracht.js';
import { kiesStartPrinter } from '../solid/stores/print-instellingen.js';
import {
  loadPrinters, printerList, defaultPrinterName, printerErrorMessage,
} from '../solid/stores/printerStore.js';
import { startPrintQueueWatcher, stopPrintQueueWatcher } from '../solid/stores/printQueueStore.js';

const bron = (() => {
  try {
    return readFileSync(new URL('../../src-tauri/src/print_lijst.rs', import.meta.url), 'utf8');
  } catch {
    return '';
  }
})();

/** De JSON-tekst uit `const VOORBEELD_JSON: &str = r#"…"#;` in print_lijst.rs. */
function voorbeeldJson() {
  const m = /const VOORBEELD_JSON: &str = r#"([^]*?)"#;/.exec(bron);
  assert.ok(m, 'VOORBEELD_JSON niet gevonden in print_lijst.rs');
  return m[1];
}

/** Doet alsof de app in Tauri draait; `antwoord(opdracht)` geeft wat Rust teruggeeft. */
function metTauri(antwoord) {
  const vragen = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (opdracht) => {
          vragen.push(opdracht);
          return antwoord(opdracht);
        },
      },
    },
  };
  return vragen;
}

test('het voorbeeld heeft de vorm van Win32_Printer: een lijst met vijf velden per printer', () => {
  const lijst = JSON.parse(voorbeeldJson());
  assert.ok(Array.isArray(lijst) && lijst.length === 4);
  for (const p of lijst) {
    assert.deepEqual(Object.keys(p), ['Name', 'DriverName', 'PortName', 'Default', 'PrinterStatus']);
    assert.equal(typeof p.Name, 'string');
    assert.equal(typeof p.DriverName, 'string');
    assert.equal(typeof p.PortName, 'string');
    assert.equal(typeof p.Default, 'boolean');
    assert.equal(typeof p.PrinterStatus, 'number');
  }
  assert.equal(lijst.filter((p) => p.Default).length, 1);
});

test('printerlijst van de app: neemt de lijst over en kiest de standaardprinter', async () => {
  const vragen = metTauri(() => voorbeeldJson());
  const lijst = await loadPrinters(true);
  assert.deepEqual(vragen, ['get_printers']);
  assert.deepEqual(lijst.map((p) => p.Name), ['Kantoor "A3"', 'Open PDF Printer', '\\\\server\\Plotter', 'Opvang']);
  assert.equal(printerList().length, 4);
  assert.equal(defaultPrinterName(), 'Kantoor "A3"');
  assert.equal(printerErrorMessage(), '');
});

test('printerlijst van de app: geen printers is een lege lijst, geen fout', async () => {
  metTauri(() => '[]');
  assert.deepEqual(await loadPrinters(true), []);
  assert.equal(defaultPrinterName(), '');
  assert.equal(printerErrorMessage(), '');
});

test('printerlijst van de app: een fout van de spooler komt als melding door', async () => {
  metTauri(() => { throw new Error('EnumPrintersW failed (error 1722)'); });
  assert.deepEqual(await loadPrinters(true), []);
  assert.match(printerErrorMessage(), /EnumPrintersW failed \(error 1722\)/);
});

test('printdialoog: begint bij de standaardprinter en herkent de bestandsprinters', async () => {
  metTauri(() => voorbeeldJson());
  const lijst = await loadPrinters(true);
  assert.equal(kiesStartPrinter(lijst, '', defaultPrinterName()), 'Kantoor "A3"');
  assert.deepEqual(
    Object.fromEntries(lijst.map((p) => [p.Name, isBestandsPrinter(p)])),
    {
      'Kantoor "A3"': false,
      'Open PDF Printer': true, // PORTPROMPT: en een PDF-stuurprogramma
      '\\\\server\\Plotter': false,
      Opvang: true, // de poort is het spoolbestand
    },
  );
});

test('app_list_printers: naam, stuurprogramma, poort, standaard en status komen mee', async () => {
  metTauri(() => voorbeeldJson());
  const lijst = await loadPrinters(true);
  const uitkomst = printerUitkomst(lijst, defaultPrinterName(), isBestandsPrinter, printerErrorMessage());
  assert.equal(uitkomst.count, 4);
  assert.equal(uitkomst.default_printer, 'Kantoor "A3"');
  assert.deepEqual(uitkomst.printers.map((p) => [p.name, p.default, p.status, p.writes_to_file]), [
    ['Kantoor "A3"', true, 3, false],
    ['Open PDF Printer', false, 3, true],
    ['\\\\server\\Plotter', false, 1, false],
    ['Opvang', false, 4, true],
  ]);
  assert.equal(uitkomst.printers[1].port, 'PORTPROMPT:');
  assert.equal(uitkomst.printers[1].driver, 'Microsoft Print To PDF');
  assert.equal('error_detail' in uitkomst, false);
});

test('wachtrij van de virtuele printer: kijkt alleen mee als de spooler de printer kent', async () => {
  let geinstalleerd = false;
  const vragen = metTauri((opdracht) => {
    if (opdracht === 'is_virtual_printer_installed') return geinstalleerd;
    if (opdracht === 'virtual_printer_collect') return false;
    if (opdracht === 'virtual_printer_jobs') return [];
    throw new Error(`onverwacht: ${opdracht}`);
  });
  try {
    await startPrintQueueWatcher();
    assert.deepEqual(vragen, ['is_virtual_printer_installed']);

    geinstalleerd = true;
    await startPrintQueueWatcher();
    assert.deepEqual(vragen, [
      'is_virtual_printer_installed', 'is_virtual_printer_installed', 'virtual_printer_collect', 'virtual_printer_jobs',
    ]);
  } finally {
    stopPrintQueueWatcher();
  }
});
