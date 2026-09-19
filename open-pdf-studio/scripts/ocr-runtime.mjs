// Downloads the OCR proof-of-concept's runtime assets (Tesseract trained-data
// files for English + Traditional Chinese, and a CJK-capable font used to
// embed the invisible searchable text layer) — SHA-256-verified, cached
// locally, never committed to the repo. Mirrors native-runtime.mjs's
// download/verify pattern for libpdfium.dylib.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESSDATA_DIR = path.join(PROJECT_DIR, 'src-tauri', 'resources', 'tessdata');
const FONTS_DIR = path.join(PROJECT_DIR, 'src-tauri', 'resources', 'fonts');

export const OCR_RUNTIME_ASSETS = Object.freeze([
  {
    name: 'eng.traineddata',
    url: 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata',
    sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
    destination: path.join(TESSDATA_DIR, 'eng.traineddata'),
  },
  {
    name: 'chi_tra.traineddata',
    url: 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/chi_tra.traineddata',
    sha256: '529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b',
    destination: path.join(TESSDATA_DIR, 'chi_tra.traineddata'),
  },
  {
    name: 'NotoSansTC-Regular.ttf',
    url: 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf',
    sha256: '5bab0cb3c1cf89dde07c4a95a4054b195afbcfe784d69d75c340780712237537',
    destination: path.join(FONTS_DIR, 'NotoSansTC-Regular.ttf'),
  },
]);

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function isAssetReady(asset) {
  try {
    await access(asset.destination);
    return (await sha256(asset.destination)) === asset.sha256;
  } catch {
    return false;
  }
}

async function downloadAsset(asset) {
  const response = await fetch(asset.url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${asset.name} (${response.status} ${response.statusText})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.sha256) {
    throw new Error(`${asset.name}: SHA-256 mismatch (expected ${asset.sha256}, got ${actual})`);
  }
  await mkdir(path.dirname(asset.destination), { recursive: true });
  await writeFile(asset.destination, bytes);
}

export async function ensureOcrRuntime() {
  for (const asset of OCR_RUNTIME_ASSETS) {
    if (await isAssetReady(asset)) {
      console.log(`[ocr-runtime] ${asset.name}: already present, verified`);
      continue;
    }
    console.log(`[ocr-runtime] ${asset.name}: downloading...`);
    await downloadAsset(asset);
    console.log(`[ocr-runtime] ${asset.name}: downloaded and verified`);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  ensureOcrRuntime().catch((error) => {
    console.error(`[ocr-runtime] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
