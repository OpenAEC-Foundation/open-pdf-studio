// Het MCP-verbindingssignaal in de statusbalk: toestand (uit/rust/actief),
// het venster van 30 s, de korte puls, de tooltip en de koppeling in de
// statusbalk en de Rust-kant.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
  mcpIndicatorStaat, mcpTooltip, verwerkActiviteit,
  ACTIEF_VENSTER_MS, PULS_MS, TOESTAND_SLEUTEL,
} from './mcp-signaal.js';

const T0 = 1_700_000_000_000;

test('server uit: grijs, geen puls, ook met recente activiteit', () => {
  assert.deepEqual(
    mcpIndicatorStaat({ serverAan: false, laatsteActiviteit: T0, laatsteAanroep: T0, nu: T0 }),
    { staat: 'uit', puls: false, volgendeWissel: null },
  );
});

test('server aan zonder activiteit: rust, niets gepland', () => {
  assert.deepEqual(
    mcpIndicatorStaat({ serverAan: true, nu: T0 }),
    { staat: 'rust', puls: false, volgendeWissel: null },
  );
});

test('activiteit binnen 30 s: actief; daarna weer rust', () => {
  const vlak = mcpIndicatorStaat({ serverAan: true, laatsteActiviteit: T0, nu: T0 + 1000 });
  assert.equal(vlak.staat, 'actief');
  assert.equal(vlak.volgendeWissel, ACTIEF_VENSTER_MS - 1000);
  const rand = mcpIndicatorStaat({ serverAan: true, laatsteActiviteit: T0, nu: T0 + ACTIEF_VENSTER_MS - 1 });
  assert.equal(rand.staat, 'actief');
  const na = mcpIndicatorStaat({ serverAan: true, laatsteActiviteit: T0, nu: T0 + ACTIEF_VENSTER_MS });
  assert.equal(na.staat, 'rust');
  assert.equal(na.volgendeWissel, null);
  assert.equal(ACTIEF_VENSTER_MS, 30_000);
});

test('een aanmelding (initialize) maakt actief maar geeft geen puls', () => {
  const s = mcpIndicatorStaat({ serverAan: true, laatsteActiviteit: T0, laatsteAanroep: null, nu: T0 });
  assert.equal(s.staat, 'actief');
  assert.equal(s.puls, false);
});

test('een tool-aanroep geeft een korte puls; de eerstvolgende wissel is het einde ervan', () => {
  const s = mcpIndicatorStaat({ serverAan: true, laatsteActiviteit: T0, laatsteAanroep: T0, nu: T0 + 100 });
  assert.equal(s.staat, 'actief');
  assert.equal(s.puls, true);
  assert.equal(s.volgendeWissel, PULS_MS - 100);
  const later = mcpIndicatorStaat({ serverAan: true, laatsteActiviteit: T0, laatsteAanroep: T0, nu: T0 + PULS_MS });
  assert.equal(later.puls, false);
  assert.equal(later.staat, 'actief');
  assert.equal(later.volgendeWissel, ACTIEF_VENSTER_MS - PULS_MS);
  assert.ok(PULS_MS > 0 && PULS_MS <= 1000, 'de puls blijft kort');
});

test('een klok die terugspringt geeft geen negatieve wachttijd', () => {
  const s = mcpIndicatorStaat({ serverAan: true, laatsteActiviteit: T0, laatsteAanroep: T0, nu: T0 - 5000 });
  assert.equal(s.staat, 'actief');
  assert.ok(s.volgendeWissel > 0);
});

test('verwerkActiviteit: connect telt als activiteit, call ook als aanroep met toolnaam', () => {
  const leeg = { activiteit: null, aanroep: null, tool: null, toolTijd: null };
  const na1 = verwerkActiviteit(leeg, { kind: 'connect', tool: null, port: 9223, at: 1 }, T0);
  assert.deepEqual(na1, { activiteit: T0, aanroep: null, tool: null, toolTijd: null });
  const na2 = verwerkActiviteit(na1, { kind: 'call', tool: 'app_get_page_text' }, T0 + 5);
  assert.deepEqual(na2, { activiteit: T0 + 5, aanroep: T0 + 5, tool: 'app_get_page_text', toolTijd: T0 + 5 });
  // Een aanroep zonder (geldige) naam houdt de vorige naam vast.
  const na3 = verwerkActiviteit(na2, { kind: 'call', tool: null }, T0 + 9);
  assert.equal(na3.tool, 'app_get_page_text');
  assert.equal(na3.toolTijd, T0 + 5);
  assert.equal(na3.aanroep, T0 + 9);
});

test('tooltip: toestand, poort en laatste tool', () => {
  const t = (k, o) => (o ? `${k}${JSON.stringify(o)}` : k);
  const tijd = (ms) => `T${ms}`;
  assert.equal(mcpTooltip(t, { staat: 'uit', poort: 9223 }, tijd), 'mcpSignal.off');
  assert.equal(
    mcpTooltip(t, { staat: 'rust', poort: 9223 }, tijd),
    'mcpSignal.idle\nmcpSignal.port{"port":9223}\nmcpSignal.noTool',
  );
  assert.equal(
    mcpTooltip(t, { staat: 'actief', poort: 9223, tool: 'app_open_pdf', toolTijd: 5 }, tijd),
    'mcpSignal.connected\nmcpSignal.port{"port":9223}\nmcpSignal.lastTool{"tool":"app_open_pdf","time":"T5"}',
  );
  assert.deepEqual(Object.keys(TOESTAND_SLEUTEL).sort(), ['actief', 'rust', 'uit']);
});

const LOCALES = new URL('../i18n/locales/', import.meta.url);
const SLEUTELS = ['label', 'connected', 'idle', 'off', 'port', 'lastTool', 'noTool'];

test('elke taal heeft de signaalteksten, met de invulplekken', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const d = JSON.parse(readFileSync(new URL(`${taal}/statusbar.json`, LOCALES), 'utf8')).mcpSignal;
    assert.deepEqual(Object.keys(d || {}).sort(), [...SLEUTELS].sort(), taal);
    for (const k of SLEUTELS) assert.ok(typeof d[k] === 'string' && d[k].trim(), `${taal} ${k} leeg`);
    assert.ok(d.port.includes('{{port}}'), `${taal} port`);
    assert.ok(d.lastTool.includes('{{tool}}') && d.lastTool.includes('{{time}}'), `${taal} lastTool`);
    if (taal !== 'en') {
      const en = JSON.parse(readFileSync(new URL('en/statusbar.json', LOCALES), 'utf8')).mcpSignal;
      for (const k of SLEUTELS) {
        if (k === 'port') continue; // "Port" is in meerdere talen gewoon "Port"
        assert.notEqual(d[k], en[k], `${taal} ${k} is niet vertaald`);
      }
    }
  }
});

const lees = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('statusbalk: het signaal staat er alleen in de bureaubladschil', () => {
  const bron = lees('../solid/components/StatusBar.jsx');
  assert.match(bron, /<Show when=\{isTauri\(\)\}>\s*<McpSignaal/);
  assert.match(bron, /startMcpSignaal\(\)/);
  const css = lees('../../styles/status-bar.css');
  assert.match(css, /\.status-mcp-actief \.status-mcp-dot/);
  assert.match(css, /\.status-mcp-uit \.status-mcp-dot/);
  // Geen animatie en geen eigen cursor: alleen een klasse die kort aan staat.
  const blok = css.slice(css.indexOf('.status-mcp {'));
  assert.doesNotMatch(blok.slice(0, blok.indexOf('.status-zoom-level')), /animation|transition|cursor:\s*pointer/);
});

test('Rust meldt elke tool-aanroep en aanmelding, zonder argumenten', () => {
  const server = lees('../../src-tauri/src/mcp_server.rs');
  assert.match(server, /"initialize" => crate::mcp_signaal::meld\(state\.app_handle\.as_ref\(\), "connect", None/);
  assert.match(server, /crate::mcp_signaal::meld\(state\.app_handle\.as_ref\(\), "call", naam, state\.poort\)/);
  const signaal = lees('../../src-tauri/src/mcp_signaal.rs');
  assert.match(signaal, /EVENT_ACTIVITEIT: &str = "mcp-activity"/);
  assert.match(signaal, /EVENT_STATUS: &str = "mcp-status"/);
  assert.doesNotMatch(signaal.slice(signaal.indexOf('pub struct Activiteit'), signaal.indexOf('pub fn veilige_toolnaam')), /arguments|params/);
  const koppeling = lees('../../src-tauri/src/mcp_koppeling.rs');
  assert.match(koppeling, /meld_status\(&app, status\)/);
  const store = lees('../solid/stores/mcpSignaalStore.js');
  assert.match(store, /listen\('mcp-activity'/);
  assert.match(store, /listen\('mcp-status'/);
});
