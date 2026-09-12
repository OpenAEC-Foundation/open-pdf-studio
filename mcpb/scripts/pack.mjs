// Bouwt de Claude Desktop-extensie: mcpb/dist/open-pdf-studio.mcpb.
//
//   node mcpb/scripts/pack.mjs             bouwen, valideren en inpakken
//   node mcpb/scripts/pack.mjs --manifest  alleen mcpb/manifest.json bijwerken
//                                          (versie + gereedschappen)
//
// De server in de bundel is de stdio-brug uit mcp-stdio/ met de publieke
// gereedschapslijst (mcp-stdio/tools.json, gegenereerd door de Rust-test
// tools_json_van_de_brug_is_actueel).

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';
const MAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(MAP, '..');
const BRUG = join(REPO, 'mcp-stdio');

const leesJson = (pad) => JSON.parse(readFileSync(pad, 'utf8'));
const schrijfJson = (pad, data) => writeFileSync(pad, JSON.stringify(data, null, 2) + '\n', 'utf8');

const versie = leesJson(join(REPO, 'open-pdf-studio', 'package.json')).version;
const tools = leesJson(join(BRUG, 'tools.json'));

const manifestPad = join(MAP, 'manifest.json');
const manifest = leesJson(manifestPad);
manifest.version = versie;
// In de bibliotheek volstaat de eerste zin; de volledige beschrijving krijgt
// Claude uit tools/list.
const eersteZin = (tekst) => String(tekst || '').split(/(?<=\.)\s/)[0];
manifest.tools = tools.map((t) => ({ name: t.name, description: eersteZin(t.description) }));
schrijfJson(manifestPad, manifest);
console.log(`manifest.json: v${versie}, ${manifest.tools.length} gereedschappen`);
if (process.argv.includes('--manifest')) process.exit(0);

const BUILD = join(MAP, 'build');
const DIST = join(MAP, 'dist');
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(join(BUILD, 'server'), { recursive: true });
mkdirSync(DIST, { recursive: true });

schrijfJson(join(BUILD, 'manifest.json'), manifest);
copyFileSync(join(MAP, 'icon.png'), join(BUILD, 'icon.png'));
copyFileSync(join(MAP, 'README.md'), join(BUILD, 'README.md'));
copyFileSync(join(BRUG, 'server.mjs'), join(BUILD, 'server', 'index.mjs'));
copyFileSync(join(BRUG, 'brug.mjs'), join(BUILD, 'server', 'brug.mjs'));
copyFileSync(join(BRUG, 'tools.json'), join(BUILD, 'server', 'tools.json'));
schrijfJson(join(BUILD, 'server', 'package.json'), {
  name: 'open-pdf-studio-mcpb-server',
  version: versie,
  private: true,
  type: 'module',
});

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const cli = (...args) => execFileSync(npx, ['-y', MCPB_CLI, ...args], {
  stdio: 'inherit', shell: process.platform === 'win32',
});
cli('validate', join(BUILD, 'manifest.json'));
const doel = join(DIST, 'open-pdf-studio.mcpb');
cli('pack', BUILD, doel);
console.log(`klaar: ${doel}`);
