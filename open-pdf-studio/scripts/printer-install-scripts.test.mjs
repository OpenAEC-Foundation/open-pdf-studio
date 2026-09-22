// The virtual printer in the installer: what hooks.nsh promises, and what the
// printer scripts it carries do for every starting state.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nsis = path.join(here, '..', 'src-tauri', 'nsis');
const read = (name) => readFileSync(path.join(nsis, name), 'utf8');

test('installer installs the printer as "Open PDF Printer" through the generated scripts', () => {
  const hooks = read('hooks.nsh');
  // No printer is added or removed from inside the NSIS script any more.
  assert.doesNotMatch(hooks, /Add-Printer/);
  assert.doesNotMatch(hooks, /Remove-Printer/);
  assert.match(hooks, /OPDS_RUN_PRINTER_SCRIPT "install-printer\.ps1" ""/);
  assert.match(hooks, /OPDS_RUN_PRINTER_SCRIPT "install-printer\.ps1" "upgrade"/);
  assert.match(hooks, /OPDS_RUN_PRINTER_SCRIPT "uninstall-printer\.ps1" ""/);
  // The page tells the user the real name and the paper sizes.
  assert.match(hooks, /Adds 'Open PDF Printer' to your Windows printers list/);
  for (const size of ['A1', 'A0', 'A3L', 'A2L', 'A1L']) {
    assert.match(hooks, new RegExp(`\\b${size}\\b`), `${size} is not mentioned on the page`);
  }
  assert.doesNotMatch(hooks, /Adds 'Open PDF Studio'/);
});

test('installer runs PowerShell by full path and takes the scripts from next to hooks.nsh', () => {
  const hooks = read('hooks.nsh');
  assert.doesNotMatch(hooks, /ExecToLog\s+["']powershell /i);
  assert.match(hooks, /\$WINDIR\\sysnative\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(hooks, /\$SYSDIR\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
  // Taken at include time: inside a macro the current file is the installer script.
  assert.match(hooks, /^!define OPDS_HOOKS_DIR "\$\{__FILEDIR__\}"/m);
  assert.match(hooks, /File "\/oname=\$PLUGINSDIR\\\$\{_FILE\}" "\$\{OPDS_HOOKS_DIR\}\\\$\{_FILE\}"/);
});

test('an upgrade that uninstalls the previous version first keeps the printer', () => {
  const hooks = read('hooks.nsh');
  const installer = read('installer.nsi');
  assert.match(installer, /\$\{IfThen\} \$R0 <> 0 \$\{\|\} StrCpy \$R1 "\$R1 \/KEEPPRINTER" \$\{\|\}/);
  // The flag has to come before the uninstall directory, which must stay last.
  assert.ok(installer.indexOf('/KEEPPRINTER') < installer.indexOf('StrCpy $R1 "$R1 _?=$4"'));
  assert.match(hooks, /\$\{GetOptions\} \$CMDLINE "\/KEEPPRINTER" \$R0/);
  const keep = hooks.indexOf('"/KEEPPRINTER"');
  const remove = hooks.indexOf('OPDS_RUN_PRINTER_SCRIPT "uninstall-printer.ps1"');
  assert.ok(keep > 0 && keep < remove, 'the flag is checked before anything is removed');
});

// Only in CI (or on explicit request): on a developer machine the script
// definitions are never loaded into a PowerShell that also knows the real
// printer cmdlets, however well the simulation guards itself.
const draaiPrinterScripts = process.env.OPDS_PRINTER_SCRIPT_TESTS === '1' || process.env.CI === 'true';
test('printer scripts: every starting state, on a simulated print server', {
  skip: process.platform !== 'win32' ? 'Windows PowerShell only'
    : draaiPrinterScripts ? false : 'set OPDS_PRINTER_SCRIPT_TESTS=1 (runs in CI)',
}, () => {
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  // The test script replaces every printer command by a simulation and
  // refuses to run otherwise: no real printer, port or paper size is touched.
  const run = spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(here, 'printer-install-scripts.test.ps1'),
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /\d+ checks, 0 failed/);
});
