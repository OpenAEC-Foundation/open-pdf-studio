#!/usr/bin/env node
// Generates the offline sources for the Flatpak build from the lockfiles,
// without network access: the lockfiles already carry every URL and checksum.
//
//   flatpak/generated-sources-npm.json    from open-pdf-studio/package-lock.json
//   flatpak/generated-sources-cargo.json  from Cargo.lock (the workspace lock)
//
// The output follows the layout of flatpak-node-generator (npm) and
// flatpak-cargo-generator, so flatpak-builder fills an npm cache and a cargo
// vendor directory before the build starts and the build itself needs no
// network:
//
//   npm:   flatpak-node/npm-cache/_cacache/content-v2/sha512/..  (tarballs)
//          flatpak-node/npm-cache/_cacache/index-v5/..           (URL index)
//   cargo: cargo/vendor/<name>-<version>/                         (crates)
//          cargo/config.toml                                      (source replacement)
//
// The manifest points npm_config_cache and CARGO_HOME at those directories.
//
// Usage:
//   node flatpak/generate-sources.mjs           write both files
//   node flatpak/generate-sources.mjs --check   write nothing; exit 1 when a
//                                               file is missing or out of date

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export const NPM_SOURCES_FILE = 'generated-sources-npm.json';
export const CARGO_SOURCES_FILE = 'generated-sources-cargo.json';

const NPM_CACHE = 'flatpak-node/npm-cache/_cacache';
const CARGO_VENDOR = 'cargo/vendor';
const VENDORED_SOURCES = 'vendored-sources';

const sha = (algorithm, data) => createHash(algorithm).update(data).digest('hex');

// Splits a hex digest the way cacache stores it: aa/bb/rest.
function cacachePath(dir, hex) {
  return { dest: `${dir}/${hex.slice(0, 2)}/${hex.slice(2, 4)}`, 'dest-filename': hex.slice(4) };
}

// The strongest hash of an SRI integrity string ("sha512-<base64>", possibly
// several separated by spaces).
function parseIntegrity(integrity) {
  const order = ['sha512', 'sha384', 'sha256', 'sha1'];
  const hashes = String(integrity).trim().split(/\s+/).map((entry) => {
    const dash = entry.indexOf('-');
    return { algorithm: entry.slice(0, dash), base64: entry.slice(dash + 1).replace(/\?.*$/, '') };
  }).filter((h) => order.includes(h.algorithm));
  hashes.sort((a, b) => order.indexOf(a.algorithm) - order.indexOf(b.algorithm));
  const best = hashes[0];
  if (!best) throw new Error(`unsupported integrity "${integrity}"`);
  return { ...best, hex: Buffer.from(best.base64, 'base64').toString('hex') };
}

// One cacache index line, as cacache writes it: "<sha1 of json>\t<json>".
function indexLine(url, integrity) {
  const json = JSON.stringify({
    key: `make-fetch-happen:request-cache:${url}`,
    integrity,
    time: 0,
    metadata: { url, reqHeaders: {}, resHeaders: {} },
  });
  return `${sha('sha1', json)}\t${json}`;
}

/**
 * npm sources for a lockfileVersion 2/3 package-lock: every registry tarball
 * goes into the cacache content store under its integrity, with an index
 * entry under its URL, so `npm ci --offline` finds it.
 */
export function npmSources(lock) {
  if (!lock || !lock.packages) throw new Error('package-lock.json without "packages" (lockfileVersion 2 or 3 needed)');
  const files = [];
  const index = new Map();
  const seen = new Set();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || entry.link || entry.inBundle) continue;
    if (!entry.resolved || !entry.integrity) {
      throw new Error(`${key}: no resolved URL or integrity in package-lock.json`);
    }
    const url = entry.resolved;
    if (!/^https:\/\//.test(url)) throw new Error(`${key}: only https tarballs are supported (${url})`);
    const hash = parseIntegrity(entry.integrity);
    const integrity = `${hash.algorithm}-${hash.base64}`;
    if (!seen.has(hash.hex)) {
      seen.add(hash.hex);
      files.push({
        type: 'file',
        url,
        [hash.algorithm]: hash.hex,
        ...cacachePath(`${NPM_CACHE}/content-v2/${hash.algorithm}`, hash.hex),
      });
    }
    const keyHash = sha('sha256', `make-fetch-happen:request-cache:${url}`);
    const target = cacachePath(`${NPM_CACHE}/index-v5`, keyHash);
    const id = `${target.dest}/${target['dest-filename']}`;
    const lines = index.get(id) ?? { target, lines: new Set() };
    lines.lines.add(indexLine(url, integrity));
    index.set(id, lines);
  }
  const inline = [...index.values()].map(({ target, lines }) => ({
    type: 'inline',
    contents: [...lines].join('\n'),
    ...target,
  }));
  return [...files, ...inline];
}

/** The [[package]] entries of a Cargo.lock (TOML subset that cargo writes). */
export function parseCargoLock(text) {
  const packages = [];
  for (const block of text.replace(/\r\n/g, '\n').split(/^\[\[package\]\]$/m).slice(1)) {
    const field = (name) => new RegExp(`^${name} = "([^"]*)"$`, 'm').exec(block)?.[1];
    packages.push({ name: field('name'), version: field('version'), source: field('source'), checksum: field('checksum') });
  }
  return packages;
}

function gitSource(source) {
  // git+https://host/repo?rev=abc#<full commit>
  const url = new URL(source.replace(/^git\+/, ''));
  const commit = url.hash.slice(1);
  const reference = {};
  for (const key of ['rev', 'tag', 'branch']) {
    if (url.searchParams.has(key)) reference[key] = url.searchParams.get(key);
  }
  url.hash = '';
  url.search = '';
  return { repo: url.toString(), commit, reference, key: source.replace(/#.*$/, '') };
}

const tomlString = (value) => JSON.stringify(value);

/**
 * cargo sources for a Cargo.lock: crates.io crates as .crate archives in a
 * vendor directory, git dependencies as git checkouts at the locked commit,
 * and a cargo config that replaces both with the vendor directory.
 */
export function cargoSources(lockText) {
  const sources = [];
  const gitConfig = new Map();
  for (const pkg of parseCargoLock(lockText)) {
    if (!pkg.source) continue; // workspace member, built from the checkout
    const dest = `${CARGO_VENDOR}/${pkg.name}-${pkg.version}`;
    if (pkg.source.startsWith('registry+')) {
      if (pkg.source !== 'registry+https://github.com/rust-lang/crates.io-index') {
        throw new Error(`${pkg.name}: only crates.io is supported (${pkg.source})`);
      }
      if (!/^[0-9a-f]{64}$/.test(pkg.checksum ?? '')) throw new Error(`${pkg.name} ${pkg.version}: no checksum in Cargo.lock`);
      sources.push({
        type: 'archive',
        'archive-type': 'tar-gzip',
        url: `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`,
        sha256: pkg.checksum,
        dest,
      });
      sources.push({
        type: 'inline',
        contents: JSON.stringify({ package: pkg.checksum, files: {} }),
        dest,
        'dest-filename': '.cargo-checksum.json',
      });
    } else if (pkg.source.startsWith('git+')) {
      const git = gitSource(pkg.source);
      if (!/^[0-9a-f]{40}$/.test(git.commit)) throw new Error(`${pkg.name}: no full commit in ${pkg.source}`);
      sources.push({ type: 'git', url: git.repo, commit: git.commit, 'disable-submodules': true, dest });
      sources.push({
        type: 'inline',
        contents: JSON.stringify({ package: null, files: {} }),
        dest,
        'dest-filename': '.cargo-checksum.json',
      });
      gitConfig.set(git.key, git);
    } else {
      throw new Error(`${pkg.name}: unsupported source ${pkg.source}`);
    }
  }

  const config = [
    `[source.${VENDORED_SOURCES}]`,
    `directory = ${tomlString(CARGO_VENDOR)}`,
    '',
    '[source.crates-io]',
    `replace-with = ${tomlString(VENDORED_SOURCES)}`,
  ];
  for (const git of gitConfig.values()) {
    config.push('', `[source.${tomlString(git.key)}]`, `git = ${tomlString(git.repo)}`);
    for (const [key, value] of Object.entries(git.reference)) config.push(`${key} = ${tomlString(value)}`);
    config.push(`replace-with = ${tomlString(VENDORED_SOURCES)}`);
  }
  sources.push({ type: 'inline', contents: `${config.join('\n')}\n`, dest: 'cargo', 'dest-filename': 'config.toml' });
  return sources;
}

const asJson = (sources) => `${JSON.stringify(sources, null, 2)}\n`;

/** Both generated files as { [file name]: contents } for the given repo. */
export function generate(root = repoRoot) {
  const lock = JSON.parse(readFileSync(path.join(root, 'open-pdf-studio', 'package-lock.json'), 'utf8'));
  const cargoLock = readFileSync(path.join(root, 'Cargo.lock'), 'utf8');
  return {
    [NPM_SOURCES_FILE]: asJson(npmSources(lock)),
    [CARGO_SOURCES_FILE]: asJson(cargoSources(cargoLock)),
  };
}

function main(args) {
  const check = args.includes('--check');
  const outputs = generate();
  let stale = 0;
  for (const [file, contents] of Object.entries(outputs)) {
    const target = path.join(here, file);
    const count = JSON.parse(contents).length;
    if (check) {
      const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
      if (current !== contents) {
        console.error(`flatpak/${file} is ${current === null ? 'missing' : 'out of date'}; run: node flatpak/generate-sources.mjs`);
        stale++;
      } else {
        console.log(`flatpak/${file}: up to date (${count} sources)`);
      }
    } else {
      writeFileSync(target, contents);
      console.log(`flatpak/${file}: ${count} sources`);
    }
  }
  return stale ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
