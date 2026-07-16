import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PDFIUM_RUNTIME,
  isNativeRuntimeReady,
  nativeRuntimePlan,
} from './native-runtime.mjs';

test('native runtime preparation is a no-op outside macOS', () => {
  assert.equal(nativeRuntimePlan({ platform: 'win32', projectDir: 'C:\\app' }), null);
  assert.equal(nativeRuntimePlan({ platform: 'linux', projectDir: '/app' }), null);
});

test('macOS uses the pinned universal PDFium runtime and checksum', () => {
  const plan = nativeRuntimePlan({ platform: 'darwin', projectDir: '/app' });

  assert.equal(plan.version, '7834');
  assert.equal(plan.sha256, '659e2f647ffd667b36487375165563e58f961db9cf75a45104dc59b9407ccbdf');
  assert.equal(plan.libraryPath, path.join('/app', 'src-tauri', 'binaries', 'macos-universal', 'libpdfium.dylib'));
  assert.equal(plan.metadataPath, `${plan.libraryPath}.runtime.json`);
  assert.equal(plan.url, PDFIUM_RUNTIME.url);
});

test('a cached runtime is valid only with matching metadata and library', async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'opds-runtime-'));
  const plan = nativeRuntimePlan({ platform: 'darwin', projectDir });

  try {
    assert.equal(await isNativeRuntimeReady(plan), false);

    await mkdir(path.dirname(plan.libraryPath), { recursive: true });
    await writeFile(plan.libraryPath, 'dylib');
    await writeFile(plan.metadataPath, JSON.stringify({ version: plan.version, sha256: 'wrong' }));
    assert.equal(await isNativeRuntimeReady(plan), false);

    await writeFile(plan.metadataPath, JSON.stringify({ version: plan.version, sha256: plan.sha256 }));
    assert.equal(await isNativeRuntimeReady(plan), true);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
