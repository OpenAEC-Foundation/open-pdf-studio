// Counts the lines of JavaScript/TypeScript and Rust in the tracked files and
// writes the table between the code-stats markers in the README.
//   node open-pdf-studio/scripts/code-stats.mjs          update the README
//   node open-pdf-studio/scripts/code-stats.mjs --print  only print the table
// Third-party code shipped in the repository (the PDF.js viewer) and generated
// files are left out. Rust keeps its unit tests inside the source files, so
// the test column only holds separate test files.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TALEN = [
  { naam: 'JavaScript / TypeScript', ext: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'] },
  { naam: 'Rust', ext: ['.rs'] },
];
const OVERSLAAN = /(^|\/)(public\/pdfjs|node_modules|dist|target)\/|\.generated\.|\.min\./;
const TEST = /\.test\.|(^|\/)(tests|web-unit)\//;

export function telRegels(tekst) {
  if (!tekst) return 0;
  const n = tekst.split('\n').length;
  return tekst.endsWith('\n') ? n - 1 : n;
}

export function tabel(rijen) {
  const totaal = rijen.reduce((s, r) => s + r.bron + r.test, 0);
  const getal = (n) => n.toLocaleString('en-US');
  const pct = (n) => (totaal ? ((n / totaal) * 100).toFixed(1) : '0.0') + '%';
  const regels = [
    '| Language | Source lines | Test lines | Total | Share |',
    '|---|---:|---:|---:|---:|',
    ...rijen.map((r) => `| ${r.naam} | ${getal(r.bron)} | ${getal(r.test)} | ${getal(r.bron + r.test)} | ${pct(r.bron + r.test)} |`),
    `| **Total** | **${getal(rijen.reduce((s, r) => s + r.bron, 0))}** | **${getal(rijen.reduce((s, r) => s + r.test, 0))}** | **${getal(totaal)}** | **100%** |`,
  ];
  return regels.join('\n') + '\n\n' + grafiek(rijen);
}

// Taartdiagram dat GitHub in de README tekent (Mermaid).
export function grafiek(rijen) {
  const punten = [];
  for (const r of rijen) {
    if (r.bron) punten.push(`    "${r.naam} (source)" : ${r.bron}`);
    if (r.test) punten.push(`    "${r.naam} (tests)" : ${r.test}`);
  }
  return ['```mermaid', 'pie showData', '    title Lines of code by language', ...punten, '```'].join('\n');
}

function tel() {
  const bestanden = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
  const rijen = TALEN.map((t) => ({ naam: t.naam, bron: 0, test: 0 }));
  for (const f of bestanden) {
    if (OVERSLAAN.test(f)) continue;
    const i = TALEN.findIndex((t) => t.ext.includes(path.extname(f)));
    if (i < 0) continue;
    let n;
    try { n = telRegels(readFileSync(path.join(root, f), 'utf8')); } catch { continue; }
    rijen[i][TEST.test(f) ? 'test' : 'bron'] += n;
  }
  return rijen;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t = tabel(tel());
  if (process.argv.includes('--print')) {
    console.log(t);
  } else {
    const readme = path.join(root, 'README.md');
    const s = readFileSync(readme, 'utf8');
    const re = /(<!-- code-stats:start -->)[\s\S]*?(<!-- code-stats:end -->)/;
    if (!re.test(s)) throw new Error('code-stats markers not found in README.md');
    writeFileSync(readme, s.replace(re, `$1\n${t}\n$2`));
    console.log(t);
  }
}
