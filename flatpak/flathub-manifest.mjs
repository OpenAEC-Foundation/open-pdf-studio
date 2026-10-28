#!/usr/bin/env node
// Writes the files for the Flathub repository (github.com/flathub/<app id>)
// for one release:
//
//   <out>/org.openaec.OpenPdfStudio.yml   the manifest from this directory, with
//                                         the local `type: dir` source replaced
//                                         by the release tag and its commit
//   <out>/generated-sources-npm.json      offline npm dependencies
//   <out>/generated-sources-cargo.json    offline cargo dependencies
//   <out>/flathub.json                    Flathub build options
//
// The desktop file, metainfo and icons come from the tagged source itself.
//
// Usage:
//   node flatpak/flathub-manifest.mjs --tag v2026.43.11 --commit <40-hex sha> --out <dir>
//
// The commit is the one the tag points at: git rev-parse 'v2026.43.11^{commit}'

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './generate-sources.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const APP_ID = 'org.openaec.OpenPdfStudio';
export const MANIFEST_FILE = `${APP_ID}.yml`;
export const REPOSITORY = 'https://github.com/OpenAEC-Foundation/open-pdf-studio.git';

// The local source block: its comment, `- type: dir`, `path: ..` and the
// optional skip list.
const LOCAL_SOURCE = /^( *)# The app itself\..*\n(?:\1#.*\n)*\1- type: dir\n\1  path: \.\.\n(?:\1  skip:\n(?:\1    - .*\n)+)?/m;

/** The manifest text with the local directory source replaced by a git source. */
export function flathubManifest(manifest, { tag, commit }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error(`tag "${tag}" is not vYYYY.W.N`);
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error(`commit "${commit}" is not a full 40-character sha`);
  const text = manifest.replace(/\r\n/g, '\n');
  const match = LOCAL_SOURCE.exec(text);
  if (!match) throw new Error('manifest has no local `type: dir` source to replace');
  const indent = match[1];
  const git = [
    '# The app itself, at the release tag.',
    '- type: git',
    `  url: ${REPOSITORY}`,
    `  tag: ${tag}`,
    `  commit: ${commit}`,
  ].map((line) => `${indent}${line}\n`).join('');
  return text.slice(0, match.index) + git + text.slice(match.index + match[0].length);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i].split('=', 2);
    if (!['--tag', '--commit', '--out'].includes(key)) throw new Error(`unknown argument ${args[i]}`);
    options[key.slice(2)] = inline ?? args[++i];
  }
  for (const key of ['tag', 'commit', 'out']) {
    if (!options[key]) throw new Error(`--${key} is required`);
  }
  return options;
}

function main(args) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`${error.message}\nUsage: node flatpak/flathub-manifest.mjs --tag vYYYY.W.N --commit <sha> --out <dir>`);
    return 1;
  }
  const out = path.resolve(options.out);
  mkdirSync(out, { recursive: true });
  const manifest = flathubManifest(readFileSync(path.join(here, MANIFEST_FILE), 'utf8'), options);
  writeFileSync(path.join(out, MANIFEST_FILE), manifest);
  for (const [file, contents] of Object.entries(generate())) writeFileSync(path.join(out, file), contents);
  copyFileSync(path.join(here, 'flathub.json'), path.join(out, 'flathub.json'));
  console.log(`Flathub files for ${options.tag} (${options.commit}) written to ${out}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
