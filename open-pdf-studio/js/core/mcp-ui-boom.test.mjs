// app_read_ui (#584): de toegankelijkheidsboom op een nagebootste DOM.

import assert from 'node:assert/strict';
import test from 'node:test';

import { bouwUiBoom, leesUiArgumenten, rolVan, kort, UI_GRENZEN, WACHTWOORD_MASKER } from './mcp-ui-boom.js';

// ─── Een kleine nagebootste DOM ──────────────────────────────────────────────
// Alleen wat de module leest: tagName, attributen, kinderen en een paar
// eigenschappen (disabled, checked, value, selected, labels, ...).

function tekst(data) {
  return { nodeType: 3, data, textContent: data };
}

function el(tagName, attrs = {}, inhoud = [], props = {}) {
  const knopen = inhoud.map((k) => (typeof k === 'string' ? tekst(k) : k));
  const klassen = String(attrs.class || '').split(/\s+/).filter(Boolean);
  const e = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id: attrs.id || '',
    childNodes: knopen,
    children: knopen.filter((k) => k.nodeType === 1),
    classList: { contains: (k) => klassen.includes(k) },
    getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? String(attrs[n]) : null),
    get textContent() { return knopen.map((k) => k.textContent).join(''); },
    ...props,
  };
  return e;
}

/** Zoek de eerste knoop (diep) die aan `pred` voldoet. */
function zoek(knopen, pred) {
  for (const k of knopen) {
    if (pred(k)) return k;
    const binnen = zoek(k.children || [], pred);
    if (binnen) return binnen;
  }
  return null;
}

// Een lint zoals Ribbon.jsx en ExtensionRibbonTab.jsx het tekenen.
function maakLint() {
  const select = el('select', { id: 'ext-acme.kozijn-maat', class: 'ribbon-form-select', 'data-ext-dropdown': 'ext:acme:maat' }, [
    el('option', {}, ['Klein'], { value: 'klein', selected: false }),
    el('option', {}, ['Groot'], { value: 'groot', selected: true }),
  ], { value: 'groot' });
  const label = el('label', { class: 'ribbon-input-label', for: 'ext-acme.kozijn-maat' }, ['Maat']);
  select.labels = [label];
  const lint = el('div', { class: 'ribbon-container' }, [
    el('div', { class: 'ribbon-tabs', role: 'tablist' }, [
      el('button', { class: 'ribbon-tab file-tab', id: 'file-tab' }, ['Bestand']),
      el('button', { class: 'ribbon-tab', 'data-tab': 'home', role: 'tab', 'aria-selected': 'false' }, ['Start']),
      el('div', { class: 'ribbon-ext-tabs' }, [
        el('button', { class: 'ribbon-tab ribbon-ext-tab active', 'data-tab': 'acme.kozijn', role: 'tab', 'aria-selected': 'true', title: 'Kozijnen' }, [
          el('span', { class: 'ribbon-ext-tab-icon', 'aria-hidden': 'true' }, [el('svg', {}, ['pictogram'])]),
          el('span', { class: 'ribbon-ext-tab-label' }, ['Kozijnen']),
        ]),
      ]),
    ]),
    el('div', { class: 'ribbon-content active ribbon-ext-content', id: 'tab-acme.kozijn', role: 'tabpanel', 'data-ext-tab': 'acme.kozijn' }, [
      el('div', { class: 'ribbon-group' }, [
        el('div', { class: 'ribbon-group-content' }, [
          el('button', { class: 'ribbon-btn active', 'data-ext-command': 'ext:acme:plaats', 'aria-pressed': 'true', title: 'Plaats een kozijn' }, [
            el('div', { class: 'ribbon-btn-icon' }, [el('svg', {}, ['x'])]),
            el('span', { class: 'ribbon-btn-label' }, ['Plaatsen']),
          ]),
          el('button', { class: 'ribbon-btn', id: 'btn-wis', title: 'Wissen' }, [el('span', { class: 'ribbon-btn-label' }, ['Wissen'])], { disabled: true }),
          el('div', { class: 'ribbon-ext-kolom' }, [
            el('div', { class: 'ribbon-input-row' }, [label, select]),
            el('div', { class: 'ribbon-ext-status', role: 'status', 'data-tone': 'success' }, [
              el('span', { class: 'ribbon-input-label' }, ['Stand']),
              el('span', { class: 'ribbon-ext-status-text' }, ['Gereed']),
            ]),
          ]),
        ]),
        el('div', { class: 'ribbon-group-label' }, ['Kozijn']),
      ]),
    ]),
  ]);
  return { lint, select, label };
}

const zoekOpIdIn = (wortel) => (id) => {
  const loop = (e) => {
    if (e.id === id) return e;
    for (const k of e.children || []) { const r = loop(k); if (r) return r; }
    return null;
  };
  return loop(wortel);
};

// ─── Argumenten ──────────────────────────────────────────────────────────────

test('argumenten: standaardgrenzen, afkappen en fouten', () => {
  assert.deepEqual(leesUiArgumenten({}), { selector: null, maxDepth: 12, maxNodes: 400, maxText: 80, includeHidden: false });
  assert.deepEqual(leesUiArgumenten({ selector: ' #left-panel ', maxDepth: 99, maxNodes: 0, maxText: 3, includeHidden: true }),
    { selector: '#left-panel', maxDepth: UI_GRENZEN.maxDepth.max, maxNodes: 1, maxText: 8, includeHidden: true });
  assert.equal(leesUiArgumenten({ maxNodes: 'veel' }).maxNodes, 400);
  assert.equal(leesUiArgumenten({ maxDepth: 2.6 }).maxDepth, 3);
  assert.match(leesUiArgumenten({ selector: '' }).error, /non-empty/);
  assert.match(leesUiArgumenten({ selector: 5 }).error, /non-empty/);
  assert.match(leesUiArgumenten({ includeHidden: 'ja' }).error, /boolean/);
});

test('rollen: expliciet, impliciet, invoertypen en de lintgroep', () => {
  assert.equal(rolVan(el('div', { role: 'tab' })), 'tab');
  assert.equal(rolVan(el('div', { role: 'presentation' })), null);
  assert.equal(rolVan(el('div')), null);
  assert.equal(rolVan(el('button')), 'button');
  assert.equal(rolVan(el('a', { href: '#' })), 'link');
  assert.equal(rolVan(el('a')), null);
  assert.equal(rolVan(el('input', {}, [], { type: 'checkbox' })), 'checkbox');
  assert.equal(rolVan(el('input', {}, [], { type: 'range' })), 'slider');
  assert.equal(rolVan(el('input', {}, [], { type: 'hidden' })), null);
  assert.equal(rolVan(el('input', {}, [], { type: 'text' })), 'textbox');
  assert.equal(rolVan(el('select', {}, [], { multiple: true })), 'listbox');
  assert.equal(rolVan(el('select')), 'combobox');
  assert.equal(rolVan(el('h2')), 'heading');
  assert.equal(rolVan(el('div', { class: 'ribbon-group' })), 'group');
});

test('kort kapt af met een beletselteken en maakt witruimte plat', () => {
  assert.equal(kort('  a \n b  ', 10), 'a b');
  assert.equal(kort('abcdefghij', 5), 'abcd…');
});

// ─── De boom ─────────────────────────────────────────────────────────────────

test('het lint: tabbladen met tab-id en opdracht, de groep met haar naam, knoppen met staat', () => {
  const { lint } = maakLint();
  const { regions, nodeCount, truncated } = bouwUiBoom([{ region: 'ribbon', elements: [lint] }], { zoekOpId: zoekOpIdIn(lint) });
  assert.equal(truncated, false);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].region, 'ribbon');
  const wortel = regions[0].nodes[0];
  assert.equal(wortel.role, 'region', 'een wortel zonder rol wordt een region');
  assert.equal(wortel.name, 'ribbon-container', 'met de eerste klasse als naam');

  const tablist = wortel.children[0];
  assert.equal(tablist.role, 'tablist');
  // De bestandsknop is een gewone knop; de tabbladen zijn tabs met hun id.
  assert.deepEqual(tablist.children.map((k) => [k.role, k.name, k.tab ?? null]), [
    ['button', 'Bestand', null], ['tab', 'Start', 'home'], ['tab', 'Kozijnen', 'acme.kozijn'],
  ]);
  const ext = tablist.children[2];
  assert.equal(ext.command, 'ribbon-tab:acme.kozijn');
  assert.deepEqual(ext.state, { selected: true, active: true });
  assert.equal(ext.description, undefined, 'titel gelijk aan de naam: geen beschrijving');
  assert.equal(ext.children, undefined, 'een tab toont geen kinderen; het pictogram telt niet mee');

  const paneel = wortel.children[1];
  assert.equal(paneel.role, 'tabpanel');
  assert.equal(paneel.id, 'tab-acme.kozijn');
  const groep = paneel.children[0];
  assert.equal(groep.role, 'group');
  assert.equal(groep.name, 'Kozijn');
  assert.ok(!zoek(groep.children, (k) => k.role === 'text' && k.name === 'Kozijn'), 'de groepsnaam staat er niet nog eens als tekst');

  const plaats = zoek(groep.children, (k) => k.name === 'Plaatsen');
  assert.deepEqual(plaats, {
    role: 'button', name: 'Plaatsen', description: 'Plaats een kozijn', command: 'ext:acme:plaats',
    state: { pressed: true, active: true },
  });
  const wis = zoek(groep.children, (k) => k.name === 'Wissen');
  assert.equal(wis.command, 'ribbon:#btn-wis');
  assert.equal(wis.id, 'btn-wis');
  assert.deepEqual(wis.state, { disabled: true });
  assert.ok(nodeCount > 10);
});

test('een keuzelijst van een extensie: naam uit het label, waarde, opties met hun opdracht', () => {
  const { lint } = maakLint();
  const { regions } = bouwUiBoom([{ region: 'ribbon', elements: [lint] }], { zoekOpId: zoekOpIdIn(lint) });
  const lijst = zoek(regions[0].nodes, (k) => k.role === 'combobox');
  assert.equal(lijst.name, 'Maat');
  assert.equal(lijst.value, 'groot');
  assert.equal(lijst.valueText, 'Groot');
  assert.equal(lijst.command, 'ext:acme:maat');
  assert.deepEqual(lijst.children.map((o) => [o.name, o.command, o.state.selected]), [
    ['Klein', 'ext:acme:maat=klein', false], ['Groot', 'ext:acme:maat=groot', true],
  ]);
  assert.ok(!zoek(regions[0].nodes, (k) => k.role === 'text' && k.name === 'Maat'), 'het label met for staat er niet los bij');
});

test('een statusregel: losse tekst van spans wordt tekstknopen onder de status', () => {
  const { lint } = maakLint();
  const { regions } = bouwUiBoom([{ region: 'ribbon', elements: [lint] }], { zoekOpId: zoekOpIdIn(lint) });
  const status = zoek(regions[0].nodes, (k) => k.role === 'status');
  assert.deepEqual(status.children, [{ role: 'text', name: 'Stand' }, { role: 'text', name: 'Gereed' }]);
});

test('verborgen elementen vallen weg, tenzij includeHidden; aria-hidden altijd', () => {
  const zichtbaar = el('button', {}, ['Zichtbaar']);
  const weg = el('button', { class: 'weg' }, ['Weg']);
  const ariaWeg = el('button', { 'aria-hidden': 'true' }, ['Aria']);
  const attrWeg = el('button', { hidden: '' }, ['Attribuut']);
  const paneel = el('div', { id: 'left-panel', 'aria-label': 'Linkerpaneel' }, [zichtbaar, weg, ariaWeg, attrWeg]);
  const isZichtbaar = (e) => e !== weg;
  const gewoon = bouwUiBoom([{ region: 'sidePanels', elements: [paneel] }], { isZichtbaar });
  assert.deepEqual(gewoon.regions[0].nodes[0].children.map((k) => k.name), ['Zichtbaar']);
  assert.equal(gewoon.regions[0].nodes[0].name, 'Linkerpaneel');
  const alles = bouwUiBoom([{ region: 'sidePanels', elements: [paneel] }], { isZichtbaar, includeHidden: true });
  const namen = alles.regions[0].nodes[0].children.map((k) => [k.name, k.state?.hidden === true]);
  assert.deepEqual(namen, [['Zichtbaar', false], ['Weg', true]]);
});

test('een verborgen wortel verschijnt wel, gemarkeerd en zonder kinderen', () => {
  const paneel = el('div', { id: 'x' }, [el('button', {}, ['Knop'])]);
  const { regions } = bouwUiBoom([{ region: 'selector', elements: [paneel] }], { isZichtbaar: () => false });
  assert.deepEqual(regions[0].nodes, [{ role: 'region', name: 'x', id: 'x', state: { hidden: true } }]);
});

test('aangevinkt, uitgeklapt, focus, alleen-lezen en invoerwaarden', () => {
  const vink = el('input', {}, [], { type: 'checkbox', checked: false, labels: [el('label', {}, ['Raster'])] });
  const veld = el('input', { placeholder: 'Zoeken' }, [], { type: 'text', value: 'kozijn', readOnly: true });
  const uitklap = el('button', { 'aria-expanded': 'false' }, ['Meer']);
  const schuif = el('div', { role: 'slider', 'aria-label': 'Dekking', 'aria-valuenow': '40', 'aria-valuetext': '40 %' });
  const paneel = el('div', {}, [vink, veld, uitklap, schuif]);
  const { regions } = bouwUiBoom([{ region: 'p', elements: [paneel] }], { actiefElement: veld });
  const [a, b, c, d] = regions[0].nodes[0].children;
  assert.deepEqual(a, { role: 'checkbox', name: 'Raster', state: { checked: false } });
  assert.deepEqual(b, { role: 'textbox', name: 'Zoeken', value: 'kozijn', state: { focused: true, readonly: true } });
  assert.deepEqual(c, { role: 'button', name: 'Meer', state: { expanded: false } });
  assert.deepEqual(d, { role: 'slider', name: 'Dekking', value: '40', valueText: '40 %' });
});

test('aria-labelledby wint van de inhoud; een kop krijgt zijn niveau', () => {
  const kop = el('span', { id: 'kop' }, ['Eigenschappen']);
  const dialoog = el('div', { role: 'dialog', 'aria-labelledby': 'kop' }, [kop, el('h3', {}, ['Lijn'])]);
  const wortel = el('div', {}, [dialoog]);
  const { regions } = bouwUiBoom([{ region: 'dialogs', elements: [dialoog] }], { zoekOpId: zoekOpIdIn(wortel) });
  const d = regions[0].nodes[0];
  assert.equal(d.role, 'dialog');
  assert.equal(d.name, 'Eigenschappen');
  assert.deepEqual(d.children[1], { role: 'heading', name: 'Lijn', level: 3 });
});

test('maxNodes kapt af en meldt dat; elk gebied deelt hetzelfde budget', () => {
  const knoppen = Array.from({ length: 20 }, (_, i) => el('button', {}, [`K${i}`]));
  const paneel = el('div', { id: 'p' }, knoppen);
  const ander = el('div', { id: 'q' }, [el('button', {}, ['Q'])]);
  const r = bouwUiBoom([{ region: 'a', elements: [paneel] }, { region: 'b', elements: [ander] }], { maxNodes: 5 });
  assert.equal(r.nodeCount, 5);
  assert.equal(r.truncated, true);
  assert.equal(r.regions[0].nodes[0].children.length, 4, 'wortel plus vier knoppen');
  assert.deepEqual(r.regions[1].nodes, [], 'het tweede gebied krijgt niets meer');
});

test('maxDepth markeert een afgekapte knoop', () => {
  const diep = el('div', { role: 'group', 'aria-label': 'G1' }, [el('div', { role: 'group', 'aria-label': 'G2' }, [el('button', {}, ['B'])])]);
  const r = bouwUiBoom([{ region: 'x', elements: [diep] }], { maxDepth: 2 });
  const g2 = r.regions[0].nodes[0].children[0];
  assert.equal(g2.name, 'G2');
  assert.equal(g2.truncated, true);
  assert.equal(g2.children, undefined);
  assert.equal(r.truncated, true);
});

test('maxText kort namen, beschrijvingen en waarden in', () => {
  const lang = 'Een heel lange knoptekst die niet in de uitvoer past';
  const r = bouwUiBoom([{ region: 'x', elements: [el('div', {}, [el('button', { title: `${lang}!` }, [lang])])] }], { maxText: 10 });
  const knop = r.regions[0].nodes[0].children[0];
  assert.equal(knop.name, 'Een heel …');
  assert.equal(knop.description, 'Een heel …');
});

test('scripts, stijlen en svg tellen niet mee; lege tekst ook niet', () => {
  const paneel = el('div', {}, ['  ', el('script', {}, ['x()']), el('style', {}, ['.a{}']), el('svg', {}, ['t']), 'Tekst']);
  const r = bouwUiBoom([{ region: 'x', elements: [paneel] }]);
  assert.deepEqual(r.regions[0].nodes[0].children, [{ role: 'text', name: 'Tekst' }]);
});

test('zonder gebieden of met lege gebieden: een lege, geldige uitkomst', () => {
  assert.deepEqual(bouwUiBoom([]), { regions: [], nodeCount: 0, truncated: false });
  assert.deepEqual(bouwUiBoom(null), { regions: [], nodeCount: 0, truncated: false });
  assert.deepEqual(bouwUiBoom([{ region: 'statusBar', elements: [] }]).regions, [{ region: 'statusBar', nodes: [] }]);
});

// ─── Aansluiting over de lagen heen ─────────────────────────────────────────
// De Rust-tests draaien lokaal niet; deze broncontroles bewaken dat het
// nieuwe gereedschap overal in dezelfde volgorde staat.

import { readFileSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sorteer = (v) => Array.isArray(v) ? v.map(sorteer)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorteer(v[k])])) : v;

/** De definitie uit read_ui_tool() in mcp_server.rs. */
function rustDefinitie() {
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  const start = rs.indexOf('fn read_ui_tool() -> Value {');
  assert.ok(start > 0, 'read_ui_tool() bestaat');
  const blok = rs.slice(start, rs.indexOf('\n}\n', start));
  return JSON.parse(blok.slice(blok.indexOf('json!(') + 'json!('.length, blok.lastIndexOf(')')));
}

test('app_read_ui: Rust-lijst direct na app_run_command, dispatch, metatabel (alleen lezen) en brug', () => {
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  const def = rustDefinitie();
  assert.equal(def.name, 'app_read_ui');
  assert.deepEqual(Object.keys(def.inputSchema.properties), ['selector', 'maxDepth', 'maxNodes', 'maxText', 'includeHidden']);
  for (const [naam, grens] of Object.entries(UI_GRENZEN)) {
    const p = def.inputSchema.properties[naam];
    assert.deepEqual([p.minimum, p.maximum, p.default], [grens.min, grens.max, grens.standaard], `${naam} gelijk aan UI_GRENZEN`);
  }
  assert.equal(def.inputSchema.additionalProperties, false);
  assert.match(rs, /"name": "app_run_command",[\s\S]*?\n {12}\},\n {12}read_ui_tool\(\),\n {12}\{\n {16}"name": "app_snippet_cut"/);
  assert.match(rs, /"app_read_ui" {12}=> tool_app_request\(state, "mcp:read-ui", {12}&arguments, Duration::from_secs\(10\)\)/);
  assert.match(lees('../../src-tauri/src/mcp_tool_meta.rs'), /lees\("app_list_commands", "List app commands"\),\n[^\n]*\n {4}lees\("app_read_ui", "Read interface state"\),/);
  const brug = lees('../mcp-bridge.js');
  assert.match(brug, /'mcp:run-command': {8}handleRunCommand,\n[^\n]*\n {2}'mcp:read-ui': {12}handleReadUi,/);
  const handler = brug.slice(brug.indexOf('async function handleReadUi'));
  assert.match(handler, /leesUiArgumenten\(params\)/);
  assert.match(handler, /bouwUiBoom\(gebieden, \{/);
});

test('app_read_ui in tools.json (direct na app_run_command) en de manifest; 90 publieke gereedschappen', () => {
  const tools = JSON.parse(lees('../../../mcp-stdio/tools.json'));
  assert.equal(tools.length, 90);
  const i = tools.findIndex((t) => t.name === 'app_run_command');
  assert.equal(tools[i + 1].name, 'app_read_ui');
  const def = rustDefinitie();
  assert.deepEqual(tools[i + 1], sorteer({
    ...def, annotations: { title: 'Read interface state', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }));
  const manifest = JSON.parse(lees('../../../mcpb/manifest.json'));
  assert.deepEqual(manifest.tools.map((t) => t.name), tools.map((t) => t.name));
  assert.ok(def.description.startsWith(manifest.tools[i + 1].description.replace(/\.$/, '')));
});

test('een tabknop die een extensie zelf in de DOM zet, met alleen aria-controls, krijgt tab-id en opdracht', () => {
  const lint = el('div', { class: 'ribbon-container' }, [
    el('div', { class: 'ribbon-tabs', role: 'tablist' }, [
      el('button', { class: 'ribbon-tab file-tab', id: 'file-tab' }, ['Bestand']),
      el('button', { class: 'ribbon-tab', 'data-tab': 'home', role: 'tab', 'aria-selected': 'false' }, ['Start']),
      el('button', { class: 'ribbon-tab active', type: 'button', role: 'tab', 'aria-controls': 'tab-inteco', 'aria-selected': 'true' }, ['Inteco']),
      el('button', { class: 'ribbon-tab', id: 'eigen-tab', role: 'tab' }, ['Eigen']),
    ]),
  ]);
  const { regions } = bouwUiBoom([{ region: 'ribbon', elements: [lint] }], { zoekOpId: zoekOpIdIn(lint) });
  const tablist = regions[0].nodes[0].children[0];
  assert.deepEqual(tablist.children.map((k) => [k.name, k.tab ?? null, k.command ?? null]), [
    ['Bestand', null, null],
    ['Start', 'home', 'ribbon-tab:home'],
    ['Inteco', 'inteco', 'ribbon-tab:inteco'],
    ['Eigen', '#eigen-tab', 'ribbon-tab:#eigen-tab'],
  ]);
});

test('een wachtwoordveld geeft nooit zijn inhoud prijs, alleen of het gevuld is', () => {
  const gevuld = el('input', { 'aria-label': 'Wachtwoord' }, [], { type: 'password', value: 'Geheim-123\u00e9' });
  const leeg = el('input', { 'aria-label': 'Herhalen' }, [], { type: 'password', value: '' });
  // Alleen het attribuut, zonder type-eigenschap (zoals een nagebootste DOM).
  const alleenAttribuut = el('input', { type: 'password', 'aria-label': 'Rechten' }, [], { value: 'Ander-geheim' });
  const paneel = el('div', {}, [gevuld, leeg, alleenAttribuut]);
  const uit = bouwUiBoom([{ region: 'dialoog', elements: [paneel] }], { actiefElement: gevuld });
  const [a, b, c] = uit.regions[0].nodes[0].children;
  assert.deepEqual(a, { role: 'textbox', name: 'Wachtwoord', value: WACHTWOORD_MASKER, state: { focused: true } });
  assert.deepEqual(b, { role: 'textbox', name: 'Herhalen', value: '' });
  assert.equal(c.value, WACHTWOORD_MASKER);
  const json = JSON.stringify(uit);
  assert.ok(!json.includes('Geheim') && !json.includes('geheim'), 'de inhoud van een wachtwoordveld staat in de boom');
});
