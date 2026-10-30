// The fullscreen button follows the real window state (#873).
//
// Reported from the web build: the button turned on while nothing happened,
// and could not be turned off again. In the browser the page asks the
// Fullscreen API, and that request can be refused (an iframe without
// allow="fullscreen", no user gesture, the browser itself). The button must
// then stay off and say why; the desktop window must not be trusted blindly
// either.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

// A bare browser: window and document with a controllable Fullscreen API.
const luisteraars = new Map();
const luister = (naam, fn) => {
  if (!luisteraars.has(naam)) luisteraars.set(naam, []);
  luisteraars.get(naam).push(fn);
};
const vuur = async (naam) => {
  for (const fn of luisteraars.get(naam) || []) await fn();
};
globalThis.window = { addEventListener: luister };
const element = {};
globalThis.document = { documentElement: element, addEventListener: luister };

const i18next = (await import('i18next')).default;
const ribbon = JSON.parse(fs.readFileSync(new URL('../../i18n/locales/en/ribbon.json', import.meta.url), 'utf8'));
await i18next.init({ lng: 'en', defaultNS: 'common', ns: ['common', 'ribbon'], resources: { en: { common: {}, ribbon } } });

const { toggleFullscreen, exitFullscreen, getFullscreenState, initFullscreen } = await import('./fullscreen.js');
const { setIsFullscreen } = await import('../../solid/stores/ribbonStore.js');
const { getDialogs, closeDialog } = await import('../../solid/stores/dialogStore.js');

const melding = () => getDialogs().find((d) => d.name === 'message')?.data?.message;
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// The browser API in a given mode. `aanvragen` counts the requests.
let aanvragen = 0;
function browser({ toestaan = true, weiger = false, weigerUit = false, prefix = false, enabled } = {}) {
  delete window.__TAURI__;
  delete globalThis.__OPDS_HEADLESS__;
  for (const k of Object.keys(element)) delete element[k];
  for (const k of ['fullscreenElement', 'webkitFullscreenElement', 'fullscreenEnabled', 'webkitFullscreenEnabled',
    'exitFullscreen', 'webkitExitFullscreen']) delete document[k];
  aanvragen = 0;
  closeDialog('message');
  setIsFullscreen(false);
  const veld = prefix ? 'webkitFullscreenElement' : 'fullscreenElement';
  document[veld] = null;
  if (enabled !== undefined) document[prefix ? 'webkitFullscreenEnabled' : 'fullscreenEnabled'] = enabled;
  if (toestaan) {
    element[prefix ? 'webkitRequestFullscreen' : 'requestFullscreen'] = async () => {
      aanvragen++;
      if (weiger) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
      document[veld] = element;
    };
  }
  document[prefix ? 'webkitExitFullscreen' : 'exitFullscreen'] = async () => {
    if (weigerUit) throw new Error('Denied');
    document[veld] = null;
  };
}

function tauri({ weiger = false, achterlopend = false, headless = false } = {}) {
  closeDialog('message');
  setIsFullscreen(false);
  const venster = { stand: false, gevraagd: [] };
  window.__TAURI__ = {
    window: {
      getCurrentWindow: () => ({
        isFullscreen: async () => venster.stand,
        setFullscreen: async (aan) => {
          venster.gevraagd.push(aan);
          if (weiger) throw new Error('Window refused');
          if (achterlopend) setTimeout(() => { venster.stand = aan; }, 100);
          else venster.stand = aan;
        },
      }),
    },
  };
  if (headless) globalThis.__OPDS_HEADLESS__ = true;
  else delete globalThis.__OPDS_HEADLESS__;
  return venster;
}

test('browser: a refused request leaves the button off and says why', async () => {
  browser({ weiger: true });
  assert.equal(await toggleFullscreen(), false);
  assert.equal(getFullscreenState(), false, 'the button must not turn on');
  assert.equal(aanvragen, 1);
  await wacht(0);
  assert.equal(melding(), ribbon.view.fullscreenUnavailable);
});

test('browser: asking again after a refusal does not get stuck', async () => {
  browser({ weiger: true });
  await toggleFullscreen();
  closeDialog('message');
  assert.equal(await toggleFullscreen(), false);
  assert.equal(getFullscreenState(), false);
  assert.equal(aanvragen, 2, 'the second click asks again instead of trying to leave');
});

test('browser: an iframe without allow="fullscreen" is not asked, the user is told', async () => {
  browser({ enabled: false });
  assert.equal(await toggleFullscreen(), false);
  assert.equal(aanvragen, 0);
  assert.equal(getFullscreenState(), false);
  await wacht(0);
  assert.equal(melding(), ribbon.view.fullscreenUnavailable);
});

test('browser: without the Fullscreen API the button stays off', async () => {
  browser({ toestaan: false });
  assert.equal(await toggleFullscreen(), false);
  assert.equal(getFullscreenState(), false);
  await wacht(0);
  assert.ok(melding());
});

test('browser: an accepted request turns the button on, the next click leaves', async () => {
  browser();
  assert.equal(await toggleFullscreen(), true);
  assert.equal(getFullscreenState(), true);
  assert.equal(melding(), undefined, 'no message when it worked');
  assert.equal(await toggleFullscreen(), false);
  assert.equal(document.fullscreenElement, null);
  assert.equal(getFullscreenState(), false);
});

test('browser: a refused exit is not reported as done', async () => {
  browser({ weigerUit: true });
  await toggleFullscreen();
  assert.equal(await exitFullscreen(), false);
  assert.equal(getFullscreenState(), true);
});

test('browser: leaving with Esc or the browser UI turns the button off', async () => {
  browser();
  initFullscreen();
  await toggleFullscreen();
  assert.equal(getFullscreenState(), true);
  document.fullscreenElement = null;
  await vuur('fullscreenchange');
  assert.equal(getFullscreenState(), false);
});

test('browser: Safari with the webkit prefix works too', async () => {
  browser({ prefix: true });
  assert.equal(await toggleFullscreen(), true);
  assert.equal(getFullscreenState(), true);
  document.webkitFullscreenElement = null;
  await vuur('webkitfullscreenchange');
  assert.equal(getFullscreenState(), false);
});

test('a stale button state goes off on Esc (exitFullscreen)', async () => {
  browser();
  setIsFullscreen(true);
  assert.equal(await exitFullscreen(), false);
  assert.equal(getFullscreenState(), false);
});

test('desktop: a refused window request leaves the button off, without a browser message', async () => {
  const venster = tauri({ weiger: true });
  const fout = console.error;
  console.error = () => {};
  try {
    assert.equal(await toggleFullscreen(), false);
  } finally {
    console.error = fout;
  }
  assert.deepEqual(venster.gevraagd, [true]);
  assert.equal(getFullscreenState(), false);
  await wacht(0);
  assert.equal(melding(), undefined);
});

test('desktop: enter and leave follow the window', async () => {
  const venster = tauri();
  assert.equal(await toggleFullscreen(), true);
  assert.equal(getFullscreenState(), true);
  assert.equal(await exitFullscreen(), true);
  assert.equal(getFullscreenState(), false);
  assert.deepEqual(venster.gevraagd, [true, false]);
});

test('desktop: a window that is still animating is read again shortly after', async () => {
  tauri({ achterlopend: true });
  assert.equal(await toggleFullscreen(), false, 'not full screen yet right after the request');
  await wacht(400);
  assert.equal(getFullscreenState(), true);
});

test('headless test instance: full screen is skipped, the button stays off, no message', async () => {
  const venster = tauri({ headless: true });
  const waarschuw = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await toggleFullscreen(), false);
  } finally {
    console.warn = waarschuw;
  }
  assert.deepEqual(venster.gevraagd, []);
  assert.equal(getFullscreenState(), false);
  await wacht(0);
  assert.equal(melding(), undefined);
});

test('every locale explains a refused full screen', () => {
  const dir = new URL('../../i18n/locales/', import.meta.url);
  const talen = fs.readdirSync(dir);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const v = JSON.parse(fs.readFileSync(new URL(`${taal}/ribbon.json`, dir), 'utf8')).view || {};
    assert.equal(typeof v.fullscreenUnavailable, 'string', `${taal} view.fullscreenUnavailable`);
    assert.ok(v.fullscreenUnavailable.trim(), `${taal} empty`);
    if (taal !== 'en') assert.notEqual(v.fullscreenUnavailable, ribbon.view.fullscreenUnavailable, `${taal} is English`);
  }
});
