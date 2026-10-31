import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openaecOmgeving, metWerkmap, installeerWerkmapDialogen } from './openaec-omgeving.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const appMap = path.resolve(hier, '..', '..');
const lees = (rel) => readFileSync(path.join(appMap, rel), 'utf8').replace(/\r\n/g, '\n');

const beheerd = { __OPENAEC__: { werkmap: '/openaec' } };

test('openaecOmgeving: zonder init-script niets bijzonders', () => {
  assert.deepEqual(openaecOmgeving({}), { werkmap: null });
  assert.deepEqual(openaecOmgeving(undefined), { werkmap: null });
  assert.deepEqual(openaecOmgeving(beheerd), { werkmap: '/openaec' });
  assert.equal(openaecOmgeving({ __OPENAEC__: { werkmap: '  ' } }).werkmap, null);
  assert.equal(openaecOmgeving({ __OPENAEC__: { werkmap: 42 } }).werkmap, null);
});

test('metWerkmap: werkmap als start, een gekozen map blijft staan', () => {
  assert.deepEqual(metWerkmap({ multiple: true }, '/openaec'), { multiple: true, defaultPath: '/openaec' });
  assert.deepEqual(metWerkmap(undefined, '/openaec'), { defaultPath: '/openaec' });
  assert.deepEqual(metWerkmap({ defaultPath: '' }, '/openaec'), { defaultPath: '/openaec' });
  assert.deepEqual(metWerkmap({ defaultPath: 'document.pdf' }, '/openaec/'), { defaultPath: '/openaec/document.pdf' });
  assert.deepEqual(metWerkmap({ defaultPath: '/home/u/plan.pdf' }, '/openaec'), { defaultPath: '/home/u/plan.pdf' });
  assert.deepEqual(metWerkmap({ defaultPath: 'C:\\plannen\\plan.pdf' }, '/openaec'), { defaultPath: 'C:\\plannen\\plan.pdf' });
  const opties = { defaultPath: 'x.pdf' };
  assert.equal(metWerkmap(opties, null), opties, 'zonder werkmap hetzelfde object');
  const bevroren = Object.freeze({ filters: [] });
  assert.deepEqual(metWerkmap(bevroren, '/openaec'), { filters: [], defaultPath: '/openaec' }, 'geen mutatie');
});

function nepDialoog() {
  const aanroepen = [];
  const dialog = {
    open: async (o) => { aanroepen.push(['open', o]); return null; },
    save: async (o) => { aanroepen.push(['save', o]); return null; },
  };
  return { dialog, aanroepen };
}

test('installeerWerkmapDialogen: open en save beginnen in de werkmap, één keer', async () => {
  const { dialog, aanroepen } = nepDialoog();
  const g = { ...beheerd, __TAURI__: { dialog } };
  assert.equal(installeerWerkmapDialogen(g), true);
  assert.equal(installeerWerkmapDialogen(g), false, 'niet dubbel inpakken');
  await g.__TAURI__.dialog.open({ multiple: false });
  await g.__TAURI__.dialog.save({ defaultPath: 'kopie.pdf' });
  await g.__TAURI__.dialog.open({ defaultPath: '/elders' });
  assert.deepEqual(aanroepen, [
    ['open', { multiple: false, defaultPath: '/openaec' }],
    ['save', { defaultPath: '/openaec/kopie.pdf' }],
    ['open', { defaultPath: '/elders' }],
  ]);
});

test('installeerWerkmapDialogen: zonder werkmap of dialoog verandert er niets', () => {
  const { dialog } = nepDialoog();
  const open = dialog.open;
  assert.equal(installeerWerkmapDialogen({ __TAURI__: { dialog } }), false);
  assert.equal(dialog.open, open);
  assert.equal(installeerWerkmapDialogen({ ...beheerd }), false);
  assert.equal(installeerWerkmapDialogen(undefined), false);
});

test('bedrading: dialogen in de werkmap, beheerde modus alleen via core/beheerd.js', () => {
  const main = lees('js/main.js');
  const installeer = main.indexOf('installeerWerkmapDialogen(window)');
  assert.notEqual(installeer, -1);
  assert.ok(installeer < main.indexOf("get('view') === 'printqueue'"), 'vóór het printwachtrijvenster');
  // Eén schakelaar voor de beheerde modus: geen tweede vlag uit __OPENAEC__.
  for (const bestand of ['js/ui/chrome/updater.js', 'js/help/previous-version.js', 'js/help/whats-new-trigger.js']) {
    const bron = lees(bestand);
    assert.match(bron, /magMelden\(/, bestand);
    assert.doesNotMatch(bron, /openaec-omgeving/, bestand);
  }
});

test('Rust zet window.__OPENAEC__ en registreert de updater niet in beheerde modus', () => {
  const rust = lees('src-tauri/src/openaec_omgeving.rs');
  assert.match(rust, /'__OPENAEC__'/);
  assert.match(rust, /pub const VAR_BEHEERD: &str = crate::beheerd::OMGEVINGSVARIABELE;/);
  assert.match(rust, /let beheerd = crate::beheerd::waarde_is_aan\(/);
  const lib = lees('src-tauri/src/lib.rs');
  assert.match(lib, /if !beheerd::is_beheerd\(\) \{\n\s+builder = builder\.plugin\(tauri_plugin_updater/);
  assert.match(lib, /builder\.plugin\(openaec_omgeving::plugin\(\)\)/);
  // Alleen in een container of beheerd: op een bureaublad blijft SIGTERM standaard.
  assert.match(lib, /if openaec_omgeving::huidige\(\)\.sigterm_afhandelen\(\) \{\n\s+openaec_omgeving::installeer_sigterm/);
  // De D-Bus-controle geldt alleen op Linux (macOS kent launchd:-adressen).
  assert.match(lib, /cfg!\(target_os = "linux"\)\s*&& !openaec_omgeving::sessiebus_bruikbaar/);
});
