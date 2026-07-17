import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectDir = path.resolve(path.dirname(scriptPath), '..');
const bundleOutputDir = path.resolve(
  projectDir,
  '..',
  'target',
  'universal-apple-darwin',
  'release',
  'bundle',
);

export function isTransientNotarizationFailure(output) {
  return /failed to notarize/i.test(output)
    && (/HTTP status code:\s*5\d\d/i.test(output) || /please try again (?:at a )?later time/i.test(output));
}

export async function bundleMacOSWithRetry({
  runBundle,
  cleanBundleOutput,
  wait,
  logger = console,
  maxAttempts = 4,
  retryDelayMs = 30_000,
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new TypeError('maxAttempts must be a positive integer no greater than 10');
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 300_000) {
    throw new TypeError('retryDelayMs must be a non-negative integer no greater than 300000');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await cleanBundleOutput();
    logger.log(`macOS bundle/notarization attempt ${attempt}/${maxAttempts}`);
    const result = await runBundle(attempt);
    if (result.code === 0) {
      return { attempts: attempt };
    }

    const transient = isTransientNotarizationFailure(result.output);
    if (!transient || attempt === maxAttempts) {
      throw new Error(result.output.trim() || `macOS bundle command exited with code ${result.code}`);
    }

    const delay = retryDelayMs * (2 ** (attempt - 1));
    logger.error(`Temporary notarization service failure; retrying in ${delay} ms.`);
    await wait(delay);
  }

  throw new Error('macOS bundling exhausted all attempts');
}

function runBundleCommand() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', 'tauri', '--', 'bundle', '--target', 'universal-apple-darwin'];

  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, {
      cwd: projectDir,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main() {
  const maxAttempts = Number.parseInt(process.env.MACOS_NOTARIZATION_MAX_ATTEMPTS ?? '4', 10);
  const retryDelayMs = Number.parseInt(process.env.MACOS_NOTARIZATION_RETRY_DELAY_MS ?? '30000', 10);

  await bundleMacOSWithRetry({
    runBundle: runBundleCommand,
    cleanBundleOutput: () => rm(bundleOutputDir, { recursive: true, force: true }),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxAttempts,
    retryDelayMs,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
