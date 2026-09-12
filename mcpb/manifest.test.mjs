// Bewaakt dat de manifest van de Claude Desktop-extensie gelijk loopt met de
// app: dezelfde versie, dezelfde gereedschappen als de brug meelevert, en de
// velden die de extensiebibliotheek eist.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const lees = (pad) => JSON.parse(readFileSync(new URL(pad, import.meta.url), 'utf8'));
const manifest = lees('./manifest.json');
const tools = lees('../mcp-stdio/tools.json');
const app = lees('../open-pdf-studio/package.json');

test('MCPB-manifest 0.3 met de versie van de app', () => {
  assert.equal(manifest.manifest_version, '0.3');
  assert.equal(manifest.name, 'open-pdf-studio');
  assert.equal(manifest.version, app.version);
});

test('de gereedschappen in de manifest zijn die van de brug', () => {
  assert.deepEqual(
    manifest.tools.map((t) => t.name),
    tools.map((t) => t.name),
    'draai node mcpb/scripts/pack.mjs --manifest',
  );
  for (const t of manifest.tools) assert.ok(t.description, `${t.name} zonder beschrijving`);
});

test('de server is de meegeleverde brug, met de poort uit de gebruikersinstelling', () => {
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.mjs');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.mjs']);
  assert.equal(manifest.server.mcp_config.env.OPS_MCP_PORT, '${user_config.port}');
  assert.equal(manifest.user_config.port.type, 'number');
  assert.equal(manifest.user_config.port.default, 9223);
});

test('privacybeleid, documentatie en ondersteuning zijn HTTPS-links', () => {
  assert.ok(manifest.privacy_policies.length > 0, 'privacy_policies is verplicht');
  for (const url of [...manifest.privacy_policies, manifest.documentation, manifest.support, manifest.homepage]) {
    assert.match(url, /^https:\/\//, url);
  }
  assert.equal(manifest.icon, 'icon.png');
  assert.equal(manifest.license, 'LGPL-3.0-or-later');
});

test('de README heeft een Privacy Policy-sectie en drie voorbeelden', () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  assert.match(readme, /^## Privacy Policy$/m);
  const voorbeelden = readme.split(/^## Examples$/m)[1]?.split(/^## /m)[0] || '';
  assert.ok((voorbeelden.match(/^### /gm) || []).length >= 3, 'minstens drie voorbeelden');
});
