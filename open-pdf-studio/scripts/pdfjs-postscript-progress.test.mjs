import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { patchPostscriptProgress } from './pdfjs-postscript-progress.mjs';
const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
const probe = fileURLToPath(new URL('./postscript-probe.mjs', import.meta.url));
function run(mode, program, timeout = 15000) {
  // The child may be killed while blocked; use a dedicated temp root so its
  // temporary worker is cleaned up by the parent even after a hard timeout.
  const root = mkdtempSync(join(tmpdir(), 'opds-ps-test-'));
  try { return spawnSync(process.execPath, [probe, mode, program], {
    encoding: 'utf8', timeout, env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
  }); } finally { rmSync(root, {recursive: true, force: true}); }
}
test('backport matches once, is idempotent and rejects dependency drift', () => {
  const fixed = patchPostscriptProgress(source);
  assert.notEqual(fixed, source);
  assert.equal(patchPostscriptProgress(fixed), fixed);
  assert.throws(() => patchPostscriptProgress(source.replace('const number = parseFloat(match[0]);', 'const number = 42;')), /no longer matches/);
  assert.throws(() => patchPostscriptProgress(source + source), /no longer matches/);
});
// The lexer exactly as the worker ships it (webpack module boundaries).
function lexerFrom(workerSource) {
  const start = workerSource.indexOf('const TOKEN =', workerSource.indexOf(';// ./src/core/postscript/lexer.js'));
  const end = workerSource.indexOf(';// ./src/core/postscript/ast.js', start);
  assert.ok(start > 0 && end > start, 'PostScript lexer module found in the worker');
  return new Function(workerSource.slice(start, end) + '; return {Lexer: lexer_Lexer, TOKEN};')();
}
// Without the backport the parser loops forever on the same position. Proven
// on the unpatched lexer itself, without waiting for a hung worker to time out.
for (const token of ['+', '-', '.', '1e999']) {
  test(`unpatched real lexer makes no progress on ${token}`, () => {
    const { Lexer } = lexerFrom(source);
    const lexer = new Lexer(token);
    lexer.next();
    assert.equal(lexer.pos, 0, 'stuck at the same input position');
  });
}
for (const program of ['{ pop + 0 0 }', '{ pop - 0 0 }', '{ pop 1e999 0 0 }', '{ pop foo 0 0 }', '{ pop @ 0 0 }', '{ 0 0 }']) {
  test(`patched real PDF worker completes Type 4 shading: ${program}`, () => {
    const result = run('patched', program);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS/);
  });
}

// The separate web unit (vite.web-unit.config.js) ships the modern build.
const modern = readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8');
test('modern build: backport matches once, is idempotent and rejects dependency drift', () => {
  const fixed = patchPostscriptProgress(modern);
  assert.notEqual(fixed, modern);
  assert.equal(patchPostscriptProgress(fixed), fixed);
  assert.throws(() => patchPostscriptProgress(modern + modern), /no longer matches/);
  const stuck = new (lexerFrom(modern).Lexer)('+');
  stuck.next();
  assert.equal(stuck.pos, 0, 'the unpatched modern lexer is stuck as well');
});

for (const [build, worker] of [['legacy', source], ['modern', modern]]) test(`${build} build: real lexer advances for malformed tokens, including an invalid operator match`, () => {
  const { Lexer, TOKEN } = lexerFrom(patchPostscriptProgress(worker));
  const lexer = new Lexer('+ foo - bar 1e999 baz . @');
  for (let i = 0; i < 8; i++) {
    const previous = lexer.pos;
    const token = lexer.next();
    assert.equal(token.id, TOKEN.number);
    assert.equal(token.value, 0);
    assert.ok(lexer.pos > previous);
  }
  assert.equal(lexer.next().id, TOKEN.eof);
  const invalidOperator = new Lexer('@');
  assert.equal(invalidOperator._getOperator().value, 0);
  assert.equal(invalidOperator.pos, 1);
});
