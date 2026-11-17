// De website-deploy (.github/workflows/live.yml) checkt maar een paar mappen
// uit. Importeert de broncode iets van daarbuiten, dan breekt de webbouw en
// blijft de website op een oude versie staan zonder dat iemand het merkt: dat
// gebeurde van 6 tot 17 november 2026 met mcp-stdio/tools.json.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(app, '..');
const norm = (p) => p.split(path.sep).join('/');

/** De mappen onder `checkout_sparse:` in de deploy-workflow. */
export function uitgecheckteMappen(yaml) {
  const regels = yaml.replace(/\r\n/g, '\n').split('\n');
  const begin = regels.findIndex((r) => /^\s*checkout_sparse:\s*\|/.test(r));
  if (begin < 0) return [];
  const inspringing = regels[begin].match(/^\s*/)[0].length;
  const mappen = [];
  for (const r of regels.slice(begin + 1)) {
    if (r.trim() === '') continue;
    if (r.match(/^\s*/)[0].length <= inspringing) break;
    mappen.push(r.trim().replace(/\/+$/, ''));
  }
  return mappen;
}

/** Alle relatieve imports in de broncode die buiten de app-map uitkomen. */
function importsBuitenDeApp() {
  const uit = [];
  const loop = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { loop(p); continue; }
      if (!/\.(js|jsx|ts|tsx|mjs)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const doel = path.resolve(path.dirname(p), m[1].split('?')[0]);
        if (!doel.startsWith(app + path.sep)) uit.push({ van: norm(path.relative(repo, p)), naar: norm(path.relative(repo, doel)) });
      }
    }
  };
  loop(path.join(app, 'js'));
  return uit;
}

test('de lijst met uitgecheckte mappen wordt uit de workflow gelezen', () => {
  const yaml = 'jobs:\n  deploy:\n    with:\n      checkout_sparse: |\n        open-pdf-studio\n        mcp-stdio/\n    secrets:\n      x: y\n';
  assert.deepEqual(uitgecheckteMappen(yaml), ['open-pdf-studio', 'mcp-stdio']);
  assert.deepEqual(uitgecheckteMappen('jobs: {}\n'), []);
});

test('de deploy checkt de app-map uit', () => {
  const mappen = uitgecheckteMappen(fs.readFileSync(path.join(repo, '.github', 'workflows', 'live.yml'), 'utf8'));
  assert.ok(mappen.includes('open-pdf-studio'), mappen.join(', '));
});

test('elke import buiten de app-map valt binnen wat de deploy uitcheckt', () => {
  const mappen = uitgecheckteMappen(fs.readFileSync(path.join(repo, '.github', 'workflows', 'live.yml'), 'utf8'));
  const mist = importsBuitenDeApp().filter(({ naar }) => !mappen.some((m) => naar === m || naar.startsWith(`${m}/`)));
  assert.deepEqual(mist, [], 'add the folder to checkout_sparse in .github/workflows/live.yml, or keep the import inside open-pdf-studio/');
});
