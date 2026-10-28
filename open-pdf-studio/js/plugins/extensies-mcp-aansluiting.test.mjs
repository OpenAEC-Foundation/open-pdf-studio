// Aansluiting van #550/#551 over de lagen heen, naar het voorbeeld van
// annotatie-lagen-mcp.test.mjs: de drie MCP-tools staan in de brug, de
// Rust-lijst, de metatabel, tools.json en de manifest; de `ext:`-opdrachten
// zitten in app_run_command en app_list_commands; het lint tekent
// extensietabbladen binnen een ErrorBoundary; de i18n-sleutels staan in alle
// talen; de nieuwe CSS heeft geen eigen kleuren.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const TOOLS = [
  ['app_list_extensions', 'mcp:list-extensions', 'handleListExtensions', 'lees', 10],
  ['app_install_extension', 'mcp:install-extension', 'handleInstallExtension', 'wijzigt', 60],
  ['app_reload_extension', 'mcp:reload-extension', 'handleReloadExtension', 'voegt_toe', 30],
];

const sorteer = (v) => Array.isArray(v) ? v.map(sorteer)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorteer(v[k])])) : v;

/** De drie definities uit extensie_tools() in mcp_server.rs. */
function rustDefinities() {
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  const start = rs.indexOf('fn extensie_tools() -> Vec<Value> {');
  assert.ok(start > 0, 'extensie_tools() bestaat');
  const blok = rs.slice(start, rs.indexOf('\n}\n', start));
  return [...blok.matchAll(/json!\((\{[\s\S]*?\n {8}\})\)/g)].map((m) => JSON.parse(m[1]));
}

test('de brug verwijst met één regel per tool naar extension-mcp.js', () => {
  const brug = lees('../mcp-bridge.js');
  for (const [, gebeurtenis, handler] of TOOLS) {
    const regel = brug.split('\n').find((r) => r.includes(`'${gebeurtenis}'`));
    assert.ok(regel, `${gebeurtenis} staat in HANDLERS`);
    assert.match(regel, new RegExp(`import\\('\\./plugins/extension-mcp\\.js'\\)\\.then\\(\\(m\\) => m\\.${handler}\\(p\\)\\)`));
  }
});

test('Rust: lijst, dispatch, metatabel en de telling van het publieke profiel', () => {
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  const meta = lees('../../src-tauri/src/mcp_tool_meta.rs');
  const defs = rustDefinities();
  assert.deepEqual(defs.map((d) => d.name), TOOLS.map((t) => t[0]));
  assert.match(rs, /tools\.extend\(extensie_tools\(\)\)/);
  for (const [naam, gebeurtenis, , soort, seconden] of TOOLS) {
    assert.match(rs, new RegExp(`"${naam}"\\s+=> tool_app_request\\(state, "${gebeurtenis}",\\s+&arguments, Duration::from_secs\\(${seconden}\\)\\)`));
    assert.match(meta, new RegExp(`${soort}\\("${naam}", "[^"]+"\\)`));
  }
  assert.match(rs, /assert_eq!\(arr\.len\(\), 89\);/);
  assert.match(lees('../../../mcp-stdio/brug.test.mjs'), /assert\.equal\(lijst\.length, 89\);/);
  // De README noemt dezelfde telling (twee keer).
  const leesmij = lees('../../../mcp-stdio/README.md');
  assert.match(leesmij, /\(89 public tools:/);
  assert.match(leesmij, /OK — 89 tools available/);
  assert.doesNotMatch(leesmij, /\b62 (public )?tools\b/);
  assert.match(rs, /Extension actions appear as 'ext:<extensionId>:<itemId>'\./);
});

test('tools.json en de manifest lopen gelijk met de Rust-definities', () => {
  const tools = JSON.parse(lees('../../../mcp-stdio/tools.json'));
  const manifest = JSON.parse(lees('../../../mcpb/manifest.json'));
  const meta = lees('../../src-tauri/src/mcp_tool_meta.rs');
  for (const def of rustDefinities()) {
    const m = meta.match(new RegExp(`(lees|voegt_toe|wijzigt)\\("${def.name}", "([^"]+)"\\)`));
    const verwacht = sorteer({ ...def, annotations: { title: m[2], readOnlyHint: m[1] === 'lees', destructiveHint: m[1] === 'wijzigt', openWorldHint: false } });
    const opSchijf = tools.find((t) => t.name === def.name);
    assert.deepEqual(opSchijf, verwacht, `${def.name} in tools.json`);
    const inManifest = manifest.tools.find((t) => t.name === def.name);
    assert.ok(inManifest && def.description.startsWith(inManifest.description.replace(/\.$/, '')), `${def.name} in de manifest`);
  }
  assert.deepEqual(tools.slice(-3).map((t) => t.name), TOOLS.map((t) => t[0]), 'achteraan, in de volgorde van handle_tools_list');
  assert.match(tools.find((t) => t.name === 'app_list_commands').description, /Extension actions appear as 'ext:<extensionId>:<itemId>'\.$/);
  assert.equal(tools.find((t) => t.name === 'app_install_extension').annotations.destructiveHint, true);
});

test('app_run_command en app_list_commands kennen de ext:-opdrachten; de knopselector sluit ze uit', () => {
  const brug = lees('../mcp-bridge.js');
  const run = brug.slice(brug.indexOf('async function handleRunCommand'), brug.indexOf('// ─── Vectorknipsel'));
  assert.match(run, /if \(command\.startsWith\('ext:'\)\) \{[\s\S]*?voerExtensieOpdrachtUit\(command, \{ source: 'mcp' \}\)/);
  assert.ok(run.indexOf("startsWith('ext:')") < run.indexOf("startsWith('tool:')"), 'de ext:-tak staat bovenaan');
  const lijst = brug.slice(brug.indexOf('async function handleListCommands'), brug.indexOf('async function handleRunCommand'));
  assert.match(lijst, /\.\.\.lint, \.\.\.gereedschap, \.\.\.extensie/);
  assert.match(lijst, /extensionCommands: extensie\.length/);
  assert.match(brug, /const LINT_KNOP_SELECTOR = '\.ribbon-group \.ribbon-btn:not\(\[data-ext-command\]\)';/);
  assert.match(lees('../solid/components/ribbon/RibbonButton.jsx'), /data-ext-command=\{props\.extCommand\}/);
});

test('het lint tekent extensietabbladen binnen een ErrorBoundary, met tablist en tabpanel', () => {
  const ribbon = lees('../solid/components/ribbon/Ribbon.jsx');
  assert.match(ribbon, /<Match when=\{isExtensieTabblad\(activeTab\(\)\)\}>\s*<ErrorBoundary[\s\S]*?<ExtensionRibbonTab id=\{id\} \/>[\s\S]*?<\/ErrorBoundary>/);
  assert.match(ribbon, /t\('common\.extensionTabFailed'\)/);
  assert.match(ribbon, /role="tablist"/);
  assert.match(ribbon, /<ExtensionTabStrip /);
  assert.ok(ribbon.indexOf('<ExtensionTabStrip') > ribbon.indexOf("dataTab=\"help\""), 'na Instellingen');
  assert.ok(ribbon.indexOf('<ExtensionTabStrip') < ribbon.indexOf('contextualTabsVisible()}>'), 'vóór de contextuele tabbladen');
  const tab = lees('../solid/components/ribbon/RibbonTab.jsx');
  for (const a of ['role=', 'aria-selected=', 'aria-controls=', 'tabindex=']) assert.ok(tab.includes(a), a);
  // aria-controls wijst naar de echte inhoud van het actieve tabblad (#tab-<id>).
  assert.match(tab, /const paneelId = \(\) => props\.paneelId \?\? \(props\.dataTab \? `tab-\$\{props\.dataTab\}` : undefined\);/);
  assert.match(tab, /aria-controls=\{isTab\(\) && props\.isActive \? paneelId\(\) : undefined\}/);
  const strook = lees('../solid/components/ribbon/ExtensionRibbonTab.jsx');
  assert.match(strook, /t\('common\.moreTabs'\)/);
  assert.match(strook, /<div class="ribbon-content active ribbon-ext-content" id=\{`tab-\$\{props\.id\}`\} role="tabpanel" data-ext-tab=\{props\.id\}>/);
});

test('de inhoud van een tabblad blijft een direct kind van .ribbon-container (geen omhulling)', () => {
  // Bestaande extensies verbergen de ingebouwde inhoud met een kindselector
  // (`.x > .ribbon-content`); een omhulling rond de Switch breekt dat.
  const ribbon = lees('../solid/components/ribbon/Ribbon.jsx');
  assert.doesNotMatch(ribbon.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''), /ribbon-panel/);
  const eindStrook = '</button>\n      </div>';
  const tussen = ribbon.slice(ribbon.indexOf(eindStrook) + eindStrook.length, ribbon.indexOf('<Show when={!ribbonCollapsed()}>'));
  assert.doesNotMatch(tussen.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''), /<div/, 'geen omhulling vóór de inhoud');
  assert.match(ribbon, /<\/Switch>\n {6}<\/Show>\n {4}<\/>/, 'en ook niet erna');
  assert.doesNotMatch(lees('../../styles/ribbon.css'), /\.ribbon-panel\b/);
  assert.doesNotMatch(lees('../solid/components/ribbon/RibbonTab.jsx'), /'ribbon-panel'/);
});

test('de tabstrook laat pijltoetsen met een modificatietoets en al afgehandelde toetsen liggen', () => {
  const ribbon = lees('../solid/components/ribbon/Ribbon.jsx');
  assert.match(ribbon, /const opToets = \(e\) => \{\n\s*if \(e\.defaultPrevented \|\| e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey\) return;/);
});

test('de vier nieuwe sleutels staan in alle 40 talen', () => {
  const map = new URL('../i18n/locales/', import.meta.url);
  const talen = readdirSync(map).filter((d) => !d.includes('.'));
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const menu = JSON.parse(readFileSync(new URL(`${taal}/appMenu.json`, map), 'utf8'));
    const lint = JSON.parse(readFileSync(new URL(`${taal}/ribbon.json`, map), 'utf8'));
    for (const [waarde, naam] of [
      [menu.extensionsPanel?.activationFailed, 'appMenu extensionsPanel.activationFailed'],
      [menu.extensionsPanel?.viaMcp, 'appMenu extensionsPanel.viaMcp'],
      [lint.common?.moreTabs, 'ribbon common.moreTabs'],
      [lint.common?.extensionTabFailed, 'ribbon common.extensionTabFailed'],
    ]) {
      assert.equal(typeof waarde, 'string', `${taal}: ${naam}`);
      assert.ok(waarde.trim(), `${taal}: ${naam} leeg`);
    }
    assert.ok(menu.extensionsPanel.activationFailed.includes('{{error}}'), `${taal}: {{error}} in activationFailed`);
  }
  const en = JSON.parse(readFileSync(new URL('en/ribbon.json', map), 'utf8'));
  assert.equal(en.common.moreTabs, 'More tabs');
});

test('de nieuwe lintregels gebruiken alleen themavariabelen', () => {
  const css = lees('../../styles/ribbon.css');
  const regels = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, inhoud]) => ({ selectors: selector.split(',').map((s) => s.trim()).filter(Boolean), inhoud }));
  const nieuw = regels.filter((r) => r.selectors.some((s) => /ribbon-ext-|\.ribbon-panel\b/.test(s)));
  assert.ok(nieuw.length >= 10, 'de regels zijn gevonden');
  const kleur = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|:\s*(?:red|green|blue|black|white|gray|grey)\b/;
  for (const r of nieuw) {
    if (r.selectors.some((s) => s.startsWith('.measure-status-'))) continue; // hergebruikte statustinten
    assert.equal(kleur.test(r.inhoud), false, `hard gecodeerde kleur in ${r.selectors.join(', ')}`);
  }
  // De drie statustinten delen hun regel met .measure-status-*.
  for (const toon of ['success', 'warning', 'error']) {
    assert.ok(regels.some((r) => r.selectors.includes(`.measure-status-${toon}`) && r.selectors.includes(`.ribbon-ext-tone-${toon}`)), toon);
  }
});

test('plug-in-API, saver en native commando\'s zijn aangesloten', () => {
  const api = lees('./plugin-api.js');
  assert.match(api, /ribbonTabs: true/);
  assert.match(api, /registerRibbonTab\(descriptor\) \{\s*return lintRegister\.registreer\(scope, descriptor\);/);
  assert.match(api, /_cleanup\(\) \{\s*const waarschuwingen = scope\.ruimOp\(\);/);
  const saver = lees('../pdf/saver.js');
  const savePdf = saver.slice(saver.indexOf('export async function savePDF('), saver.indexOf('async function _savePDFNu('));
  // Opslaan en een wissel sluiten elkaar uit; het slot komt na de handtekeningvraag.
  assert.match(saver, /^import \{ metOpslagSlot \} from '\.\.\/plugins\/opslag-wissel-slot\.js';$/m);
  assert.match(savePdf, /_saveBezig = metOpslagSlot\(\(\) => _savePDFNu\(saveAsPath, activeDoc, \{ annulering: opties\.annulering \}\)\)\.finally\(/);
  assert.ok(savePdf.indexOf('bevestigOpslaanMetHandtekeningen') < savePdf.indexOf('metOpslagSlot('), 'na de handtekeningvraag');
  assert.doesNotMatch(saver, /wachtOpExtensieWissel/);
  const lib = lees('../../src-tauri/src/lib.rs');
  for (const c of ['extensie_lijst', 'extensie_inspecteer', 'extensie_installeer', 'extensie_bevestig', 'extensie_terugdraaien']) {
    assert.match(lib, new RegExp(`extensie_installatie::${c},`));
  }
  assert.match(lib, /fn uninstall_plugin[\s\S]*?controleer_bestaand_id\(&id\)\?/);
  assert.match(lib, /fn read_plugin_file[\s\S]*?controleer_bestaand_id\(&plugin_id\)\?/);
  assert.match(lib, /fn install_plugin[\s\S]*?valideer_extensie_id\(plugin_id\)/);
});

test('de live controle zet de extensie ook uit en kijkt dan naar tabblad, opdrachten en palet', () => {
  const verify = lees('../../../scripts/verify-extensies.mjs');
  const stap = verify.slice(verify.indexOf("stap = '9';"), verify.indexOf("stap = '10';"));
  assert.match(stap, /\.ext-uninstall-btn/);
  assert.match(stap, /\.ribbon-tab\[data-tab="\$\{TAB\}"\]`\)\)\.found === false/);
  assert.match(stap, /c\.command\.startsWith\(`ext:\$\{ID\}:`\)/);
  assert.match(stap, /aantalPaletten\(\) === 0/);
  // Het palet is zichtbaar, zodat de DOM-telling iets zegt; na herladen precies één.
  assert.match(verify, /defaultVisible: true, defaultMode: 'docked-right', cssClass: 'kozijnen-palet'/);
  assert.match(verify, /aantalPaletten\(\) === 1, 'precies één palet in de DOM'/);
  // Ook de CDP-poort wordt aan de lijst van verboden poorten getoetst.
  assert.match(verify, /\[\['MCP_PORT', poort\], \['CDP_PORT', cdpPoort\]\]/);
});
