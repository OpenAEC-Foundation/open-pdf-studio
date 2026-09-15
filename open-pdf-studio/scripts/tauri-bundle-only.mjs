// Bundel-only wrapper voor tauri-action.
//
// tauri-action roept zijn `tauriScript` aan als `<script> build <args>`. Op
// Windows compileert de workflow de app eerst zelf (`tauri build --no-bundle`)
// en tekent daarna het hoofdprogramma en de pdfium-worker-sidecar. Pas dán mag
// er gebundeld worden, anders belanden ongetekende exe's in de installer.
// Deze wrapper vertaalt tauri-actions `build` daarom naar `tauri bundle`, dat
// niet opnieuw compileert en de sidecar niet opnieuw kopieert. Andere
// commando's gaan ongewijzigd door naar de Tauri-CLI. tauri-action vindt de
// artefacten daarna op de gebruikelijke plek en uploadt ze (incl. latest.json).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectDir = path.resolve(path.dirname(scriptPath), '..');

/**
 * npm-argumenten voor de Tauri-CLI bij de argumenten die tauri-action meegeeft.
 * @param {string[]} argv  bv. ['build', '--target', 'x86_64-pc-windows-msvc']
 * @returns {string[]}     bv. ['run', 'tauri', '--', 'bundle', '--target', ...]
 */
export function bundleArgs(argv) {
  const [command, ...rest] = argv;
  const vertaald = command === 'build' ? 'bundle' : command;
  return ['run', 'tauri', '--', ...(vertaald ? [vertaald] : []), ...rest];
}

function main() {
  const isWindows = process.platform === 'win32';
  const child = spawn(isWindows ? 'npm.cmd' : 'npm', bundleArgs(process.argv.slice(2)), {
    cwd: projectDir,
    env: process.env,
    stdio: 'inherit',
    // Node weigert .cmd-bestanden zonder shell (EINVAL sinds Node 20.12).
    shell: isWindows,
  });
  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
