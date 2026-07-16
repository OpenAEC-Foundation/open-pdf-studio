import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PDFIUM_RUNTIME = Object.freeze({
  version: '7834',
  url: 'https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7834/pdfium-mac-univ.tgz',
  sha256: '659e2f647ffd667b36487375165563e58f961db9cf75a45104dc59b9407ccbdf',
});

export function nativeRuntimePlan({
  platform = process.platform,
  projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
} = {}) {
  if (platform !== 'darwin') return null;

  const libraryPath = path.join(projectDir, 'src-tauri', 'binaries', 'macos-universal', 'libpdfium.dylib');
  return {
    ...PDFIUM_RUNTIME,
    libraryPath,
    metadataPath: `${libraryPath}.runtime.json`,
  };
}

export async function isNativeRuntimeReady(plan) {
  if (!plan) return true;
  try {
    await access(plan.libraryPath);
    const metadata = JSON.parse(await readFile(plan.metadataPath, 'utf8'));
    return metadata.version === plan.version && metadata.sha256 === plan.sha256;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destination, bytes);
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

export async function prepareNativeRuntime(options = {}) {
  const plan = nativeRuntimePlan(options);
  if (!plan) {
    console.log('Native runtime: no preparation needed on this platform.');
    return;
  }
  if (await isNativeRuntimeReady(plan)) {
    console.log(`Native runtime: PDFium ${plan.version} is ready.`);
    return;
  }

  await mkdir(path.dirname(plan.libraryPath), { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opds-pdfium-'));
  const archivePath = path.join(tempDir, 'pdfium-mac-univ.tgz');
  const stagedLibrary = path.join(tempDir, 'lib', 'libpdfium.dylib');
  const nextLibrary = `${plan.libraryPath}.new`;

  try {
    console.log(`Native runtime: downloading PDFium ${plan.version}...`);
    await download(plan.url, archivePath);
    const actualSha256 = await sha256(archivePath);
    if (actualSha256 !== plan.sha256) {
      throw new Error(`PDFium checksum mismatch: expected ${plan.sha256}, received ${actualSha256}`);
    }
    await run('tar', ['xzf', archivePath, '-C', tempDir, 'lib/libpdfium.dylib'], tempDir);
    await copyFile(stagedLibrary, nextLibrary);
    await rm(plan.libraryPath, { force: true });
    await rename(nextLibrary, plan.libraryPath);
    await writeFile(plan.metadataPath, `${JSON.stringify({ version: plan.version, sha256: plan.sha256 }, null, 2)}\n`);
    console.log(`Native runtime: installed ${plan.libraryPath}`);
  } finally {
    await rm(nextLibrary, { force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  prepareNativeRuntime().catch(error => {
    console.error(`Native runtime preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
