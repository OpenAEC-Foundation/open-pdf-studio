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
test('unpatched real PDF worker hangs on a bare sign, bounded by subprocess deadline', () => {
  const result = run('old', '{ pop + 0 0 }', 10000);
  assert.match(result.stdout, /READY/, 'worker reached shading before the deadline');
  assert.equal(result.error?.code, 'ETIMEDOUT', result.stdout + result.stderr);
});
for (const program of ['{ pop + 0 0 }', '{ pop - 0 0 }', '{ pop 1e999 0 0 }', '{ pop foo 0 0 }', '{ pop @ 0 0 }', '{ 0 0 }']) {
  test(`patched real PDF worker completes Type 4 shading: ${program}`, () => {
    const result = run('patched', program);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS/);
  });
}

test('real lexer advances for malformed tokens, including an invalid operator match', () => {
  const fixed = patchPostscriptProgress(source);
  const start = fixed.indexOf('const TOKEN =', fixed.indexOf(';// ./src/core/postscript/lexer.js'));
  const end = fixed.indexOf(';// ./src/core/postscript/ast.js', start);
  const { Lexer, TOKEN } = new Function(fixed.slice(start, end) + '; return {Lexer: lexer_Lexer, TOKEN};')();
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
