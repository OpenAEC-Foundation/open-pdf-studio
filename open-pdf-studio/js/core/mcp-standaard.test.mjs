import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { MCP_STANDAARD } from './mcp-standaard.js';
import { voegSamenMetStandaarden } from './preferences-merge.js';

test('AI-koppeling staat bij een nieuwe installatie standaard aan', () => {
  assert.equal(MCP_STANDAARD.mcpEnabled, true);
  assert.equal(MCP_STANDAARD.mcpPort, 9223);
});

test('nieuwe installatie (niets opgeslagen) krijgt de koppeling aan', () => {
  assert.equal(voegSamenMetStandaarden(MCP_STANDAARD, null).mcpEnabled, true);
  assert.equal(voegSamenMetStandaarden(MCP_STANDAARD, {}).mcpEnabled, true);
});

test('een opgeslagen "uit" blijft uit na het samenvoegen met de standaarden', () => {
  const samen = voegSamenMetStandaarden(MCP_STANDAARD, { mcpEnabled: false, theme: 'x' });
  assert.equal(samen.mcpEnabled, false);
  assert.equal(samen.mcpPort, 9223);
  assert.equal(samen.theme, 'x');
});

test('een opgeslagen eigen poort blijft staan', () => {
  assert.equal(voegSamenMetStandaarden(MCP_STANDAARD, { mcpPort: 9300 }).mcpPort, 9300);
});

test('DEFAULT_PREFERENCES neemt de MCP-standaard over en overschrijft hem niet', () => {
  const bron = readFileSync(new URL('./constants.ts', import.meta.url), 'utf8');
  assert.match(bron, /\.\.\.MCP_STANDAARD/);
  assert.doesNotMatch(bron, /^\s*mcpEnabled\s*:/m);
  assert.doesNotMatch(bron, /^\s*mcpPort\s*:/m);
});

test('preferences.js voegt opgeslagen voorkeuren samen via de gedeelde regel', () => {
  const bron = readFileSync(new URL('./preferences.js', import.meta.url), 'utf8');
  assert.match(bron, /voegSamenMetStandaarden\(DEFAULT_PREFERENCES, loaded\)/);
});
