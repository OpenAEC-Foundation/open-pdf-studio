// Rol van deze app-instantie. Een losgemaakt tabblad opent in een tweede
// instantie (eigen proces, gestart met --new-instance). Die tweede instantie
// mag niet doen wat alleen de hoofdinstantie hoort te doen: de sessie
// bewaren of herstellen (dan verliest de hoofdinstantie haar tabbladen), de
// AI-koppeling starten (poort bezet), de printwachtrij volgen (dubbele
// dialogen) of de PrtScn-sneltoets claimen.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLEEN_HOOFDINSTANTIE,
  taakToegestaan,
  leesInstantieRol,
} from './instantie-rol.js';

test('de hoofdinstantie doet alles', () => {
  for (const taak of ALLEEN_HOOFDINSTANTIE) {
    assert.equal(taakToegestaan(taak, { tweede: false }), true, taak);
  }
  assert.equal(taakToegestaan('iets-anders', { tweede: false }), true);
});

test('een tweede instantie slaat de taken van de hoofdinstantie over', () => {
  for (const taak of ['sessie-bewaren', 'sessie-herstellen', 'mcp-koppeling', 'printwachtrij', 'prtscn', 'standaard-app']) {
    assert.ok(ALLEEN_HOOFDINSTANTIE.includes(taak), taak);
    assert.equal(taakToegestaan(taak, { tweede: true }), false, taak);
  }
});

test('een tweede instantie doet de overige taken gewoon', () => {
  assert.equal(taakToegestaan('documenten-openen', { tweede: true }), true);
});

test('zonder bekende rol geldt de hoofdinstantie', () => {
  assert.equal(taakToegestaan('sessie-bewaren', null), true);
  assert.equal(taakToegestaan('sessie-bewaren', undefined), true);
});

test('leesInstantieRol vraagt de rol aan Rust', async () => {
  const rol = await leesInstantieRol(async (cmd) => {
    assert.equal(cmd, 'instance_role');
    return { secondary: true };
  });
  assert.deepEqual(rol, { tweede: true });
});

test('leesInstantieRol valt terug op de hoofdinstantie als Rust niet antwoordt', async () => {
  assert.deepEqual(await leesInstantieRol(async () => { throw new Error('geen tauri'); }), { tweede: false });
  assert.deepEqual(await leesInstantieRol(async () => null), { tweede: false });
  assert.deepEqual(await leesInstantieRol(null), { tweede: false });
});
