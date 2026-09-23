// Sessieherstel: wat gebeurt er in de browser, en wat weet de gebruiker? (#456)

import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = {};

const { sessieHerstelBeleid, meldLegeStart, WEB_SESSIE_SLEUTEL } =
  await import('./sessie-herstel.js');
const { saveSession, loadSession } = await import('./platform.js');

test('bureaublad: de voorkeur beslist, dev herstelt altijd', () => {
  assert.deepEqual(sessieHerstelBeleid({ inTauri: true, voorkeurAan: true }),
    { herstellen: true, reden: 'bureaublad' });
  assert.deepEqual(sessieHerstelBeleid({ inTauri: true, voorkeurAan: false }),
    { herstellen: false, reden: 'voorkeur-uit' });
  assert.deepEqual(sessieHerstelBeleid({ inTauri: true, voorkeurAan: false, inDev: true }),
    { herstellen: true, reden: 'dev' });
});

test('browser: nooit herstellen, ook niet met de voorkeur aan of in dev', () => {
  for (const voorkeurAan of [true, false]) {
    for (const inDev of [true, false]) {
      assert.deepEqual(sessieHerstelBeleid({ inTauri: false, voorkeurAan, inDev }),
        { herstellen: false, reden: 'geen-webopslag' },
        `voorkeurAan=${voorkeurAan} inDev=${inDev}`);
    }
  }
});

test('browser: de gebruiker krijgt het te horen, het bureaublad niet', () => {
  assert.equal(meldLegeStart({ inTauri: false }), true);
  assert.equal(meldLegeStart({ inTauri: true }), false);
  assert.equal(WEB_SESSIE_SLEUTEL, 'webSessionStartsEmpty');
});

test('browser: er blijft niets van de sessie achter in localStorage', async () => {
  const opslag = new Map();
  globalThis.localStorage = {
    getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
    setItem: (k, v) => opslag.set(k, String(v)),
    removeItem: (k) => opslag.delete(k),
  };
  delete globalThis.window.__TAURI__;

  // Een oude sessie uit een vorige versie van de app.
  opslag.set('pdfStudioSession', JSON.stringify({ openFiles: ['Contract.pdf'] }));

  await saveSession({ openFiles: ['Blad.pdf', 'Contract.pdf'] });
  assert.equal(opslag.has('pdfStudioSession'), false,
    'bestandsnamen horen niet in de browseropslag te blijven staan');
  assert.equal(await loadSession(), null);
});
