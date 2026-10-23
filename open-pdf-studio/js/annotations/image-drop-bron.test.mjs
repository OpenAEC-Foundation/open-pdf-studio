// Bronbewaking voor het plaatsen van een afbeelding: de bitmap blijft aan zijn
// data-URL gekoppeld (een ingetrokken blob-URL liet alleen het kader staan) en
// de Afbeelding-knop opent een bestandskeuze in plaats van een gereedschap te
// kiezen dat niet bestaat.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('image-drop: de afbeelding laadt uit de data-URL en trekt geen blob-URL in', () => {
  const bron = lees('./image-drop.js');
  assert.doesNotMatch(bron, /revokeObjectURL/);
  assert.match(bron, /img\.src = dataUrl;/);
});

test('de Afbeelding-knop kiest een bestand en plaatst het', () => {
  const lint = lees('../solid/components/ribbon/DrawingTab.jsx');
  const knop = lint.slice(lint.indexOf('id="dr-image"'), lint.indexOf('id="dr-remove-image"'));
  assert.match(knop, /kiesEnPlaatsAfbeelding/);
  assert.doesNotMatch(knop, /setTool\('image'\)/);
  assert.match(lees('./image-drop.js'), /export async function kiesEnPlaatsAfbeelding/);
});

test('een afbeelding die nog laadt, hertekent zodra hij klaar is', () => {
  const bron = lees('./rendering.js');
  const deel = bron.slice(bron.indexOf("case 'image':"), bron.indexOf("case 'textHighlight':"));
  assert.match(deel, /_redrawOnLoad/);
  assert.match(deel, /hertekenActieveWeergave/);
});
