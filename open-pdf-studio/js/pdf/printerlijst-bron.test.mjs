// De printers op Windows zonder PowerShell (#524). Endpoint-beveiliging
// beëindigt een documentprogramma dat powershell.exe start, en de app vroeg
// bij elke start zo de printers op. Nu komen ze rechtstreeks uit de spooler
// (src-tauri/src/print_lijst.rs). De Rust-tests daar draaien op deze machine
// niet (alleen `cargo test --no-run`), dus dezelfde regels staan hier nog
// eens, gelezen uit de bron.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const SRC = new URL('../../src-tauri/src/', import.meta.url);

/** Een bronbestand onder src-tauri/src; leeg als het er (nog) niet is. */
function lees(pad) {
  try {
    return readFileSync(new URL(pad, SRC), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return '';
  }
}

const lib = lees('lib.rs');
const lijst = lees('print_lijst.rs');

/** Bron zonder regelcommentaar (`//`, `///`, `//!`). */
const zonderCommentaar = (bron) => bron.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

/**
 * Index van de `}` die het blok sluit dat bij de eerste `{` vanaf `start`
 * begint. Accolades in commentaar, tekst ("…", r#"…"#) en tekens ('{')
 * tellen niet mee.
 */
function blokEinde(bron, start) {
  let diepte = 0;
  for (let i = bron.indexOf('{', start); i >= 0 && i < bron.length; i++) {
    const c = bron[i];
    if (c === '/' && bron[i + 1] === '/') i = bron.indexOf('\n', i);
    else if (c === '/' && bron[i + 1] === '*') i = bron.indexOf('*/', i) + 1;
    else if (c === 'r' && /^r#*"/.test(bron.slice(i, i + 4)) && !/\w/.test(bron[i - 1])) {
      const hekjes = /^r(#*)"/.exec(bron.slice(i))[1];
      i = bron.indexOf(`"${hekjes}`, i + hekjes.length + 2) + hekjes.length;
    } else if (c === '"') {
      for (i++; bron[i] !== '"'; i++) if (bron[i] === '\\') i++;
    } else if (c === "'" && bron[i + 2] === "'") i += 2;
    else if (c === "'" && bron[i + 1] === '\\') i = bron.indexOf("'", i + 2);
    else if (c === '{') diepte++;
    else if (c === '}' && --diepte === 0) return i;
  }
  return -1;
}

/** De volledige functie `naam` (kop en lichaam) uit `bron`. */
function functie(bron, naam) {
  const kop = new RegExp(`(?:pub(?:\\(crate\\))? )?(?:async )?(?:unsafe )?fn ${naam}\\s*[(<]`).exec(bron);
  assert.ok(kop, `fn ${naam} niet gevonden`);
  const eind = blokEinde(bron, kop.index);
  assert.ok(eind > 0, `fn ${naam} sluit niet`);
  return bron.slice(kop.index, eind + 1);
}

/** Het blok direct na het attribuut `#[cfg(<voorwaarde>)]` in `code`. */
function cfgBlok(code, voorwaarde) {
  const at = code.indexOf(`#[cfg(${voorwaarde})]`);
  assert.ok(at >= 0, `#[cfg(${voorwaarde})] niet gevonden`);
  return code.slice(at, blokEinde(code, at) + 1);
}

/** Alle .rs-bestanden onder src-tauri/src, als pad ten opzichte daarvan. */
function rustBestanden(map = '') {
  return readdirSync(new URL(map || '.', SRC), { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory()) return rustBestanden(`${map}${d.name}/`);
    return d.name.endsWith('.rs') ? [`${map}${d.name}`] : [];
  });
}

/** De binnenste functie in `bron` waar positie `index` in valt. */
function omringendeFunctie(bron, index) {
  let beste = null;
  for (const m of bron.matchAll(/\bfn (\w+)\s*[(<]/g)) {
    if (m.index > index) break;
    const eind = blokEinde(bron, m.index);
    if (eind > index) beste = m[1];
  }
  return beste;
}

const OPSTARTVRAGEN = ['get_printers', 'is_virtual_printer_installed', 'virtual_printer_catch_enabled'];

test('opstarten: de printervragen starten op Windows geen proces meer', () => {
  for (const naam of OPSTARTVRAGEN) {
    const code = zonderCommentaar(functie(lib, naam));
    const windows = cfgBlok(code, 'target_os = "windows"');
    assert.doesNotMatch(
      windows,
      /powershell|Get-Printer|Get-CimInstance|Command::new|no_window_command|\.output\(|\.spawn\(/i,
      naam,
    );
    assert.match(windows, /print_lijst::/, `${naam} vraagt de spooler via print_lijst`);
    // Niet op de hoofdthread: een trage spooler mag het venster niet ophouden.
    assert.match(code, /^async fn /, `${naam} is async`);
    assert.match(windows, /tauri::async_runtime::spawn_blocking\(/, `${naam} vraagt op een blokkerende thread`);
  }
});

test('opstarten: main.js vraagt de printers en de virtuele printer nog steeds op', () => {
  // De opvraging zelf blijft; alleen de weg in Rust verandert.
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /import\('\.\/solid\/stores\/printQueueStore\.js'\)\s*\.then\(m => m\.startPrintQueueWatcher\(\)\)/);
  assert.match(main, /import\('\.\/solid\/stores\/printerStore\.js'\)\s*\.then\(m => m\.loadPrinters\(\)\)/);
  const wachtrij = readFileSync(new URL('../solid/stores/printQueueStore.js', import.meta.url), 'utf8');
  assert.match(wachtrij, /_invoke\('is_virtual_printer_installed'\)/);
  const printers = readFileSync(new URL('../solid/stores/printerStore.js', import.meta.url), 'utf8');
  assert.match(printers, /inv\('get_printers'\)/);
});

test('macOS en Linux: ongewijzigd, get_printers vraagt CUPS via lpstat', () => {
  const code = zonderCommentaar(functie(lib, 'get_printers'));
  const cups = cfgBlok(code, 'any(target_os = "linux", target_os = "macos")');
  assert.deepEqual([...cups.matchAll(/Command::new\("([^"]+)"\)/g)].map((m) => m[1]), ['lpstat', 'lpstat']);
  for (const naam of ['is_virtual_printer_installed', 'virtual_printer_catch_enabled']) {
    const anders = cfgBlok(zonderCommentaar(functie(lib, naam)), 'not(target_os = "windows")');
    assert.match(anders, /\{\s*false\s*\}$/, `${naam} geeft buiten Windows false`);
  }
});

test('virtuele printer: dezelfde namen en hetzelfde spoolbestand als installeren en omzetten', () => {
  const geinstalleerd = zonderCommentaar(functie(lib, 'is_virtual_printer_installed'));
  assert.match(geinstalleerd, /print_formulieren::PRINTERNAAM/);
  // De oude naam telt nog als geïnstalleerd, tot de gebruiker opnieuw installeert.
  assert.match(geinstalleerd, /print_formulieren::OUDE_PRINTERNAAM/);
  const opvang = zonderCommentaar(functie(lib, 'virtual_printer_catch_enabled'));
  assert.match(opvang, /print_formulieren::PRINTERNAAM/);
  assert.doesNotMatch(opvang, /OUDE_PRINTERNAAM/);
  assert.match(opvang, /vp_spool_dir\(\)/);
  assert.match(opvang, /\.join\("latest\.pdf"\)/);
  assert.match(zonderCommentaar(functie(lib, 'virtual_printer_enable_catch')), /vp_spool_dir\(\)[^]*\.join\("latest\.pdf"\)/);
  const formulieren = lees('print_formulieren.rs');
  assert.match(formulieren, /pub const PRINTERNAAM: &str = "Open PDF Printer";/);
  assert.match(formulieren, /pub const OUDE_PRINTERNAAM: &str = "Open PDF Studio";/);
});

test('PowerShell start alleen nog na een klik van de gebruiker', () => {
  // Installeren, verwijderen en de opvang aanzetten blijven op PowerShell:
  // die lopen pas na een klik in Voorkeuren. De meting in pdf_lezen.rs is
  // een test die alleen met --ignored draait.
  const toegestaan = [
    'lib.rs run_elevated_ps_script',
    'lib.rs virtual_printer_enable_catch',
    'handtekening/pdf_lezen.rs meet_geheugen_en_tijd',
  ];
  const gevonden = [];
  for (const pad of rustBestanden()) {
    const bron = zonderCommentaar(lees(pad));
    for (const m of bron.matchAll(/(?:Command::new|no_window_command)\(\s*"powershell(?:\.exe)?"\s*\)/gi)) {
      gevonden.push(`${pad} ${omringendeFunctie(bron, m.index)}`);
    }
  }
  assert.deepEqual(gevonden.sort(), toegestaan.sort());
  assert.match(zonderCommentaar(functie(lib, 'install_virtual_printer')), /run_elevated_ps_script\(/);
  assert.match(zonderCommentaar(functie(lib, 'remove_virtual_printer')), /run_elevated_ps_script\(/);
});

test('print_lijst bestaat alleen op Windows', () => {
  assert.match(lib, /#\[cfg\(target_os = "windows"\)\]\npub mod print_lijst;/);
});

test('print_lijst: één opvraging met EnumPrintersW (lokaal en verbindingen, niveau 2) en GetDefaultPrinterW', () => {
  const code = zonderCommentaar(lijst);
  assert.match(code, /EnumPrintersW\(\s*PRINTER_ENUM_LOCAL \| PRINTER_ENUM_CONNECTIONS,\s*std::ptr::null\(\),\s*2,/);
  assert.match(code, /as \*const PRINTER_INFO_2W/);
  assert.match(code, /GetDefaultPrinterW\(/);
  for (const veld of ['pPrinterName', 'pDriverName', 'pPortName', 'Status']) {
    assert.match(code, new RegExp(`\\.${veld}\\b`), veld);
  }
});

test('print_lijst: alleen lezen, geen proces en geen wijzigende spooler-aanroep', () => {
  assert.ok(lijst, 'print_lijst.rs ontbreekt');
  const code = zonderCommentaar(lijst);
  assert.doesNotMatch(code, /std::process|Command::new|powershell/i);
  assert.doesNotMatch(
    code,
    /\b(AddPrinter|DeletePrinter|SetPrinter|AddPort|DeletePort|ConfigurePort|AddForm|DeleteForm|SetForm|OpenPrinter|SetDefaultPrinter|AddPrinterConnection|DeletePrinterConnection|AddPrinterDriver|DeletePrinterDriver|SetJob|AddJob|StartDocPrinter)\w*\s*\(/,
  );
});

// De spoolerbits van PRINTER_INFO_2.Status (winspool.h).
const BITS = {
  PAUSED: 0x1, ERROR: 0x2, PENDING_DELETION: 0x4, PAPER_JAM: 0x8, PAPER_OUT: 0x10, MANUAL_FEED: 0x20,
  PAPER_PROBLEM: 0x40, OFFLINE: 0x80, IO_ACTIVE: 0x100, BUSY: 0x200, PRINTING: 0x400, OUTPUT_BIN_FULL: 0x800,
  NOT_AVAILABLE: 0x1000, WAITING: 0x2000, PROCESSING: 0x4000, INITIALIZING: 0x8000, WARMING_UP: 0x10000,
  TONER_LOW: 0x20000, NO_TONER: 0x40000, PAGE_PUNT: 0x80000, USER_INTERVENTION: 0x100000,
  OUT_OF_MEMORY: 0x200000, DOOR_OPEN: 0x400000, SERVER_UNKNOWN: 0x800000, POWER_SAVE: 0x1000000,
  SERVER_OFFLINE: 0x2000000, DRIVER_UPDATE_NEEDED: 0x4000000,
};
// Waarschuwingen: de printer blijft bruikbaar, dus klaar (3).
const BLIJFT_KLAAR = ['TONER_LOW', 'POWER_SAVE', 'DRIVER_UPDATE_NEEDED'];

/** De `const NAAM: u32 = …;` uit print_lijst.rs als getallen. */
function bitgroepen() {
  const groepen = {};
  for (const [, naam, waarde] of lijst.matchAll(/const (\w+): u32 =([^;]*);/g)) {
    groepen[naam] = waarde.split('|').map((s) => s.trim()).reduce((acc, deel) => {
      const bit = deel.startsWith('PRINTER_STATUS_') ? BITS[deel.slice('PRINTER_STATUS_'.length)] : groepen[deel];
      assert.ok(bit !== undefined, `onbekend deel ${deel} in ${naam}`);
      return acc | bit;
    }, 0);
  }
  return groepen;
}

/** De tabel STATUSCODES: [bits, code] in volgorde van voorrang. */
function statustabel() {
  const tabel = /const STATUSCODES: \[\(u32, u16\); \d+\] = \[([^\]]*)\];/.exec(lijst);
  assert.ok(tabel, 'STATUSCODES niet gevonden');
  const groepen = bitgroepen();
  return [...tabel[1].matchAll(/\((\w+),\s*(\d+)\)/g)].map(([, naam, code]) => {
    const bits = naam.startsWith('PRINTER_STATUS_') ? BITS[naam.slice('PRINTER_STATUS_'.length)] : groepen[naam];
    assert.ok(bits, `onbekende groep ${naam}`);
    return [bits, Number(code)];
  });
}

/** De regel van print_lijst.rs: de eerste groep met een gezette bit beslist, anders klaar (3). */
function cimStatus(tabel, status) {
  const rij = tabel.find(([bits]) => (status & bits) !== 0);
  return rij ? rij[1] : 3;
}

// [PRINTER_INFO_2.Status, Win32_Printer.PrinterStatus]. Codes van
// Win32_Printer.PrinterStatus: 1 overig, 2 onbekend, 3 klaar, 4 bezig,
// 5 opwarmen. Gemeten op deze machine (Get-CimInstance Win32_Printer,
// alleen lezen): status 0 geeft 3, een offline printer (PrinterState 128)
// geeft 1.
const GEVALLEN = [
  [0x0, 3],
  [0x80, 1],
  [0x1, 1],
  [0x2, 1],
  [0xa, 1],
  [0x2000, 1],
  [0x2000000, 1],
  [0x400, 4],
  [0x200, 4],
  [0x100, 4],
  [0x4000, 4],
  [0x10000, 5],
  [0x8000, 5],
  [0x800000, 2],
  [0x20000, 3],
  [0x1000000, 3],
  [0x4000000, 3],
  [0x20400, 4],
  [0x401, 1],
  [0x400400, 1],
  [0x800080, 1],
  [0x800400, 2],
  [0x10400, 4],
  [0x80000000, 3],
];

test('statuscodes: elke spoolerbit hoort bij precies één groep, of laat de printer klaar', () => {
  const tabel = statustabel();
  assert.deepEqual(tabel.map(([, code]) => code), [1, 2, 4, 5]);
  let gezien = 0;
  for (const [bits] of tabel) {
    assert.equal(gezien & bits, 0, 'groepen overlappen');
    gezien |= bits;
  }
  for (const naam of BLIJFT_KLAAR) {
    assert.equal(gezien & BITS[naam], 0, `${naam} beslist niet`);
    gezien |= BITS[naam];
  }
  assert.equal(gezien, Object.values(BITS).reduce((a, b) => a | b, 0), 'een spoolerbit is vergeten');
});

test('statuscodes: stilstand gaat voor onbekend, onbekend voor bezig, bezig voor opwarmen', () => {
  const tabel = statustabel();
  for (const [status, code] of GEVALLEN) {
    assert.equal(cimStatus(tabel, status), code, `0x${status.toString(16)}`);
  }
  // Dezelfde gevallen staan in de Rust-test.
  const rust = functie(lijst, 'statuscode_volgt_win32_printer');
  for (const [status, code] of GEVALLEN) {
    assert.match(rust, new RegExp(`cim_printerstatus\\(0x${status.toString(16)}\\), ${code}\\)`, 'i'), `0x${status.toString(16)}`);
  }
});

test('JSON-regel: dezelfde velden in dezelfde volgorde als Win32_Printer', () => {
  const struct = /struct JsonRegel<'a> \{([^}]*)\}/.exec(lijst);
  assert.ok(struct, 'JsonRegel niet gevonden');
  const velden = [...struct[1].matchAll(/#\[serde\(rename = "(\w+)"\)\]\s*\w+: ([^,\n]+),/g)].map(([, n, t]) => [n, t.trim()]);
  assert.deepEqual(velden, [
    ['Name', "&'a str"], ['DriverName', "&'a str"], ['PortName', "&'a str"], ['Default', 'bool'], ['PrinterStatus', 'u16'],
  ]);
});

test('namen en poort: zonder onderscheid in hoofdletters, zoals Windows printernamen en paden vergelijkt', () => {
  assert.match(functie(lijst, 'zelfde_naam'), /to_lowercase\(\)[^]*==[^]*to_lowercase\(\)/);
  const poort = zonderCommentaar(functie(lijst, 'vangt_in_spoolbestand'));
  assert.match(poort, /trim\(\)/);
  assert.match(poort, /is_empty\(\)/);
  assert.match(poort, /to_lowercase\(\)[^]*==[^]*to_lowercase\(\)/);
  // De standaardprinter en de virtuele printer gaan langs dezelfde vergelijking.
  assert.match(zonderCommentaar(functie(lijst, 'printers_json')), /zelfde_naam\(/);
  assert.match(zonderCommentaar(functie(lijst, 'heeft_printer')), /zelfde_naam\(/);
  assert.match(zonderCommentaar(functie(lijst, 'poort_van')), /zelfde_naam\(/);
});
