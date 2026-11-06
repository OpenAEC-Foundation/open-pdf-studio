#!/usr/bin/env node
// Controle van de README-beelden volgens de OpenAEC README-standaard:
//
//   node scripts/check-readme-images.mjs          (vanuit open-pdf-studio/)
//
// Faalt (exitcode 1) als
//  - README.md of README.nl.md naar een beeld verwijst dat er niet is;
//  - een beeld in docs/images/readme/ niet in BEIDE README's staat (de
//    standaard eist dezelfde beelden in dezelfde volgorde in beide talen);
//  - een beeld groter is dan 150 kB;
//  - een PNG niet 1280 tot 1600 pixels breed is.
//
// De beelden zelf komen uit scripts/generate-readme-screenshots.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const READMES = ['README.md', 'README.nl.md'];
export const BEELDMAP = 'docs/images/readme';
export const MAX_BYTES = 150 * 1024;
export const BREEDTE = { min: 1280, max: 1600 };

/** Breedte en hoogte uit de IHDR van een PNG, of null als het geen PNG is. */
export function pngMaat(bytes) {
  const handtekening = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || handtekening.some((b, i) => bytes[i] !== b)) return null;
  return { breedte: bytes.readUInt32BE(16), hoogte: bytes.readUInt32BE(20) };
}

/**
 * Relatieve beeldverwijzingen in Markdown: `![alt](pad)` en `<img src="pad">`.
 * Externe adressen (http, https, data) tellen niet mee.
 * @param {string} tekst
 * @returns {string[]} paden zoals ze in de tekst staan, zonder #anker of ?query
 */
export function beeldVerwijzingen(tekst) {
  const paden = [];
  for (const m of tekst.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) paden.push(m[1]);
  for (const m of tekst.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) paden.push(m[1]);
  return paden
    .filter((p) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(p))
    .map((p) => decodeURI(p.split(/[?#]/)[0]));
}

/**
 * @param {string} root  map met README.md, README.nl.md en docs/images/readme/
 * @returns {string[]} fouten; leeg = in orde
 */
export function controleerReadmeBeelden(root) {
  const fouten = [];
  const beeldmap = path.join(root, ...BEELDMAP.split('/'));
  const gebruikt = new Map();
  for (const readme of READMES) {
    const bestand = path.join(root, readme);
    if (!fs.existsSync(bestand)) {
      fouten.push(`${readme} is missing`);
      continue;
    }
    const verwijzingen = beeldVerwijzingen(fs.readFileSync(bestand, 'utf8'));
    const hier = new Set();
    for (const ref of verwijzingen) {
      const doel = path.resolve(root, ref);
      if (!fs.existsSync(doel)) fouten.push(`${readme} uses ${ref}, which does not exist`);
      const rel = path.relative(beeldmap, doel);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) hier.add(rel.split(path.sep).join('/'));
    }
    gebruikt.set(readme, hier);
  }

  const beelden = fs.existsSync(beeldmap)
    ? fs.readdirSync(beeldmap, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort()
    : [];
  for (const naam of beelden) {
    for (const [readme, hier] of gebruikt) {
      if (!hier.has(naam)) fouten.push(`${BEELDMAP}/${naam} is not used in ${readme}`);
    }
    const bytes = fs.readFileSync(path.join(beeldmap, naam));
    if (bytes.length > MAX_BYTES) {
      fouten.push(`${BEELDMAP}/${naam} is ${(bytes.length / 1024).toFixed(0)} kB, more than ${MAX_BYTES / 1024} kB`);
    }
    if (/\.png$/i.test(naam)) {
      const maat = pngMaat(bytes);
      if (!maat) fouten.push(`${BEELDMAP}/${naam} is not a valid PNG`);
      else if (maat.breedte < BREEDTE.min || maat.breedte > BREEDTE.max) {
        fouten.push(`${BEELDMAP}/${naam} is ${maat.breedte} px wide, not ${BREEDTE.min} to ${BREEDTE.max} px`);
      }
    }
  }
  return fouten;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const fouten = controleerReadmeBeelden(root);
  if (fouten.length) {
    for (const f of fouten) console.error(f);
    process.exit(1);
  }
  const map = path.join(root, ...BEELDMAP.split('/'));
  const aantal = fs.existsSync(map) ? fs.readdirSync(map).length : 0;
  console.log(`${aantal} README images present, at most ${MAX_BYTES / 1024} kB, used in ${READMES.join(' and ')}`);
}
