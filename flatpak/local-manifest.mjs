#!/usr/bin/env node
// Put the local build manifest at the checkout root: sandboxed builders reject
// directory sources outside the manifest directory, even if the host can read them.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANIFEST_FILE } from './flathub-manifest.mjs';
import { NPM_SOURCES_FILE, CARGO_SOURCES_FILE } from './generate-sources.mjs';

export function localManifest(manifest) {
  let text = manifest.replace(/\r\n/g, '\n');
  const source = /^(      - type: dir\n        path: )\.\.$/m;
  if (!source.test(text)) throw new Error('manifest has no expected local directory source');
  text = text.replace(source, '$1.');
  for (const file of [NPM_SOURCES_FILE, CARGO_SOURCES_FILE]) {
    const include = `      - ${file}\n`;
    if (!text.includes(include)) throw new Error(`manifest has no ${file} include`);
    text = text.replace(include, `      - flatpak/${file}\n`);
  }
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  writeFileSync(path.join(here, '..', MANIFEST_FILE),
    localManifest(readFileSync(path.join(here, MANIFEST_FILE), 'utf8')));
}
