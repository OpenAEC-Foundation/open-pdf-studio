import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bron = readFileSync(new URL('./TitleBar.jsx', import.meta.url), 'utf8');

test('de sluitknop meldt een nette afsluiting vóór het venster dichtgaat', () => {
  const start = bron.indexOf('async function handleClose()');
  const eind = bron.indexOf('export default function TitleBar', start);
  const body = bron.slice(start, eind);
  const melding = body.indexOf('await meldSchoonAfsluiten()');
  const sluiten = body.indexOf('closeWindow();');
  assert.ok(melding > 0, 'handleClose roept meldSchoonAfsluiten aan');
  assert.ok(sluiten > melding, 'eerst melden, dan sluiten');
  assert.ok(body.indexOf('if (!closed) return;') < melding, 'alleen als alle documenten dicht zijn');
});
