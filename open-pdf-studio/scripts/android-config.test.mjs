// Android-configuratie (#596): rechten, eigen activiteit en ondertekening.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { activiteitPad, controleerPakket } from './android-project.mjs';

const app = new URL('..', import.meta.url);
const lees = (rel) => readFileSync(new URL(rel, app), 'utf8');
const json = (rel) => JSON.parse(lees(rel));

// Rechten die alleen op het bureaublad bestaan of zin hebben.
const ALLEEN_BUREAUBLAD = new Set([
  'core:webview:allow-create-webview-window',
  'core:window:allow-create',
  'core:window:allow-close',
  'core:window:allow-minimize',
  'core:window:allow-maximize',
  'core:window:allow-unmaximize',
  'core:window:allow-is-maximized',
  'core:window:allow-start-dragging',
  'core:window:allow-destroy',
  'core:window:allow-set-icon',
  'core:window:allow-show',
  'core:window:allow-set-focus',
  'updater:default',
  'drag:default',
]);

test('de mobiele rechten gelden voor het hoofdvenster', () => {
  // Zonder "windows" gold geen enkel recht: event.listen, os.locale,
  // dialog.open en fs.read_file faalden met "not allowed by ACL".
  const mobiel = json('src-tauri/capabilities/mobile.json');
  assert.deepEqual(mobiel.windows, ['main']);
  assert.deepEqual(mobiel.platforms, ['android', 'iOS']);
});

test('elk recht van het bureaublad bestaat ook mobiel, tenzij het daar niet past', () => {
  const bureaublad = json('src-tauri/capabilities/default.json').permissions;
  const mobiel = new Set(json('src-tauri/capabilities/mobile.json').permissions);
  for (const recht of bureaublad) {
    if (ALLEEN_BUREAUBLAD.has(recht)) continue;
    assert.ok(mobiel.has(recht), `${recht} ontbreekt in mobile.json`);
  }
  for (const recht of ['core:default', 'fs:read-all', 'dialog:allow-open', 'os:default', 'deep-link:default']) {
    assert.ok(mobiel.has(recht), recht);
  }
});

test('de eigen MainActivity hoort bij de app-id en komt op de juiste plek', () => {
  const { identifier } = json('src-tauri/tauri.conf.json');
  const kotlin = lees('src-tauri/android/MainActivity.kt');
  controleerPakket(kotlin, identifier);
  assert.equal(activiteitPad('org.openaec.openpdfstudio'),
    join('src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', 'org', 'openaec', 'openpdfstudio', 'MainActivity.kt'));
  assert.throws(() => activiteitPad('../evil'));
  assert.throws(() => controleerPakket('package com.ander.app\n', identifier));
});

test('MainActivity houdt de webview vrij van de systeembalken en levert bestandsnamen', () => {
  const kotlin = lees('src-tauri/android/MainActivity.kt');
  assert.match(kotlin, /WindowInsetsCompat\.Type\.systemBars\(\)\s*or\s*WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(kotlin, /setPadding\(/);
  assert.match(kotlin, /addJavascriptInterface\([^,]+,\s*"OpdsAndroid"\)/);
  assert.match(kotlin, /@JavascriptInterface\s+fun displayName\(/);
  // De JS-kant gebruikt dezelfde namen.
  const js = lees('js/core/bestandsnaam.js');
  assert.match(js, /globalThis\.OpdsAndroid/);
  assert.match(js, /\.displayName\(/);
});

// De stappen van job build-android, in volgorde.
function androidStappen() {
  const yml = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const begin = yml.indexOf('\n  build-android:\n');
  assert.ok(begin > 0, 'job build-android bestaat');
  const rest = yml.slice(begin + 1);
  const eind = rest.search(/\n {2}[a-z][\w-]*:\n/);
  return eind > 0 ? rest.slice(0, eind) : rest;
}

test('de release past het Android-project aan tussen init en build', () => {
  const job = androidStappen();
  const init = job.indexOf('npx tauri android init');
  const aanpassen = job.indexOf('node scripts/android-project.mjs');
  const bouwen = job.indexOf('npx tauri android build');
  assert.ok(init > 0 && aanpassen > init && bouwen > aanpassen, 'init, aanpassen, bouwen');
});

test('de release ondertekent met een vaste sleutel uit de secrets', () => {
  const job = androidStappen();
  for (const geheim of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    assert.match(job, new RegExp(`${geheim}: \\$\\{\\{ secrets\\.${geheim} \\}\\}`), geheim);
  }
  // Geen wachtwoorden van de vaste sleutel op de opdrachtregel.
  assert.match(job, /--ks-pass env:KS_PASS/);
  assert.match(job, /--key-pass env:KEY_PASS/);
  // Zonder secrets nog steeds een APK, maar met een waarschuwing.
  assert.match(job, /::warning title=Android signing::/);
  // De sleutel blijft niet in de bouwmap staan.
  assert.match(job, /rm -f "\$KEYSTORE"/);
  assert.doesNotMatch(job, /\$APK_DIR\/release\.keystore/);
});
