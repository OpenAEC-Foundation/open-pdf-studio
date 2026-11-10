// Allowlist-saneerder voor symbool-SVG's van buiten de app: bekende
// omzeilingen komen eruit zonder uitvoerbaar deel, en de meegeleverde
// bibliotheken komen er ongewijzigd doorheen (het palet ziet er hetzelfde uit).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  saneerSvg, saneerSvgDetail, svgAlsDataUrl,
  saneerSymbolen, saneerSymboolGroepen, saneerTypeOverrides,
} from './svg-veilig.js';
import { NL_CATEGORIES } from '../solid/data/nlSymbolLibrary.js';
import { GDT_CATEGORIES } from '../solid/data/gdtSymbolLibrary.js';
import { isSafeSymbolSvg, stampToSvg, collectionToGroup } from '../solid/data/symbolLibraryOnline.js';
import { parseLineworkCatalog, lineworkCatalogToGroup } from '../symbols/linework-catalog.js';
import { steelFamilyPreviewSvg } from '../symbols/steel-catalog.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const TOEGESTANE_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'pattern', 'marker', 'style', 'image',
]);

const decodeer = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
});

// Controleer de UITVOER los van de saneerder: alleen toegestane tags, geen
// on*-attributen, geen URL-schema's of externe url()'s, geen tags in tekst.
function assertOnschadelijk(uit, label) {
  if (uit === null) return;
  assert.equal(typeof uit, 'string', label);
  assert.ok(uit.startsWith('<svg'), `${label}: begint met <svg`);
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let rest = '';
  let pos = 0;
  for (const m of uit.matchAll(tag)) {
    rest += uit.slice(pos, m.index);
    pos = m.index + m[0].length;
    assert.ok(TOEGESTANE_TAGS.has(m[2]), `${label}: tag <${m[2]}> in ${uit}`);
    for (const a of m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)) {
      const naam = a[1].toLowerCase();
      const waarde = decodeer(a[2]).replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      assert.ok(!naam.startsWith('on'), `${label}: event-attribuut ${a[1]}`);
      assert.ok(!/(?:java|vb)script:|data:text|data:image\/svg|expression\(|@import/.test(waarde), `${label}: ${a[1]}="${a[2]}"`);
      if (naam === 'href' || naam === 'xlink:href') {
        assert.ok(/^#|^data:image\/(png|jpe?g|gif|webp|bmp);base64,/.test(waarde), `${label}: href ${a[2]}`);
      }
      for (const u of waarde.matchAll(/url\(['"]?(.)/g)) assert.equal(u[1], '#', `${label}: url() in ${a[1]}`);
    }
  }
  rest += uit.slice(pos);
  // Wat er buiten de tags overblijft is tekst: daarin geen ruwe < of >.
  assert.ok(!/[<>]/.test(rest), `${label}: ruwe < of > in tekst: ${uit}`);
  const tekst = decodeer(rest).toLowerCase();
  for (const css of uit.matchAll(/<style[^>]*>([^<]*)<\/style>/g)) {
    const c = decodeer(css[1]).toLowerCase();
    assert.ok(!/@|\\|url\((?!['"]?#)|expression|javascript/.test(c), `${label}: css ${c}`);
  }
  // Idempotent en zonder iets dat bij een tweede ronde nog weg zou moeten.
  const tweede = saneerSvgDetail(uit);
  assert.equal(tweede.svg, uit, `${label}: tweede ronde gelijk`);
  assert.deepEqual(tweede.verwijderd, [], `${label}: tweede ronde verwijdert niets`);
  return tekst;
}

const AANVALLEN = [
  ['svg/onload', '<svg/onload=alert(1)>'],
  ['svg/onload met attribuut', '<svg/onload="alert(1)"></svg>'],
  ['onload', '<svg onload="alert(1)"><path d="M0 0L1 1"/></svg>'],
  ['onload met tab', '<svg\tonload\t=\t"alert(1)"><path d="M0 0"/></svg>'],
  ['onload met regeleinde', '<svg\nonload\n=\n\'alert(1)\'><path d="M0 0"/></svg>'],
  ['onload zonder aanhalingstekens', '<svg onload=alert(1)><path d="M0 0"/></svg>'],
  ['onclick na schuine streep', '<svg><path/onclick="alert(1)"/></svg>'],
  ['hoofdletters ONLOAD', '<svg ONLOAD="alert(1)" OnClick="alert(2)"><rect width="1" height="1"/></svg>'],
  ['script', '<svg><script>alert(1)</script><path d="M0 0"/></svg>'],
  ['script met xlink', '<svg><script xlink:href="https://evil.example/x.js"/></svg>'],
  ['SCRIPT hoofdletters', '<svg><SCRIPT>alert(1)</SCRIPT></svg>'],
  ['SVG-wortel hoofdletters', '<SVG><script>alert(1)</script></SVG>'],
  ['svg:script', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>'],
  ['eigen prefix script', '<svg><x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script></svg>'],
  ['html:script', '<svg><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script></svg>'],
  ['xhtml-wortel', '<svg xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></svg>'],
  ['standaard-ns wissel', '<svg xmlns="http://www.w3.org/2000/svg"><g xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></g></svg>'],
  ['a href javascript', '<svg><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>'],
  ['a xlink:href javascript', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><text x="1" y="1">x</text></a></svg>'],
  ['a href data', '<svg><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><rect width="1" height="1"/></a></svg>'],
  ['entiteit &#58;', '<svg><a href="javascript&#58;alert(1)"><rect width="1" height="1"/></a></svg>'],
  ['entiteit &#x6A;', '<svg><a href="&#x6A;avascript:alert(1)"><rect width="1" height="1"/></a></svg>'],
  ['tab in schema', '<svg><a href="java&#x09;script:alert(1)"><rect width="1" height="1"/></a></svg>'],
  ['volledig gecodeerd', '<svg><a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)"><rect width="1" height="1"/></a></svg>'],
  ['dubbel gecodeerd', '<svg><use href="javascript&amp;#58;alert(1)"/></svg>'],
  ['animate href', '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text x="1" y="1">klik</text></a></svg>'],
  ['animate to', '<svg><animate attributeName="href" to="javascript:alert(1)" begin="0s"/></svg>'],
  ['set onmouseover', '<svg><set attributeName="onmouseover" to="alert(1)"/><rect width="1" height="1"/></svg>'],
  ['animateTransform/Motion', '<svg><animateTransform attributeName="transform" type="rotate" from="0" to="360"/><animateMotion path="M0 0"/></svg>'],
  ['use data', '<svg><use href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+#x"/></svg>'],
  ['use extern', '<svg><use xlink:href="https://evil.example/x.svg#a"/></svg>'],
  ['use protocol-relatief', '<svg><use href="//evil.example/x.svg#a"/></svg>'],
  ['foreignObject iframe', '<svg><foreignObject width="10" height="10"><iframe src="javascript:alert(1)"/></foreignObject></svg>'],
  ['foreignObject body', '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></foreignObject></svg>'],
  ['iframe/object/embed', '<svg><iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/><object data="x.html"/><embed src="x"/></svg>'],
  ['image extern', '<svg><image href="https://evil.example/pixel.png" width="1" height="1"/></svg>'],
  ['image javascript', '<svg><image href="javascript:alert(1)"/></svg>'],
  ['image svg-data', '<svg><image xlink:href="data:image/svg+xml,%3Csvg onload=alert(1)%3E" width="1" height="1"/></svg>'],
  ['image onerror', '<svg><image href="x" onerror="alert(1)"/></svg>'],
  ['feImage', '<svg><filter id="f"><feImage href="https://evil.example/x.png"/></filter><rect filter="url(#f)" width="1" height="1"/></svg>'],
  ['style @import', '<svg><style>@import url(https://evil.example/x.css);</style><rect width="1" height="1"/></svg>'],
  ['style url extern', '<svg><style>rect{fill:url(https://evil.example/x.png)}</style></svg>'],
  ['style url javascript', '<svg><style>*{background:url(javascript:alert(1))}</style></svg>'],
  ['style expression', '<svg><style>rect{width:expression(alert(1))}</style></svg>'],
  ['style backslash', '<svg><style>@\\69mport "x.css";rect{fill:u\\72l(http://x)}</style></svg>'],
  ['style commentaar in url', '<svg><style>rect{fill:ur/**/l(http://x)}</style></svg>'],
  ['style image-set', '<svg><style>rect{background:image-set("https://evil.example/x.png" 1x)}</style></svg>'],
  ['style uitbreken', '<svg><style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;</style></svg>'],
  ['style CDATA uitbreken', '<svg><style><![CDATA[</style><script>alert(1)</script>]]></style></svg>'],
  ['text CDATA', '<svg><text x="1" y="1"><![CDATA[</text><script>alert(1)</script>]]></text></svg>'],
  ['CDATA in svg', '<svg><![CDATA[<script>alert(1)</script>]]><rect width="1" height="1"/></svg>'],
  ['style-attribuut url', '<svg><rect style="fill:url(https://evil.example/x)" width="1" height="1"/></svg>'],
  ['style-attribuut javascript', '<svg><rect style="background-image:url(&quot;javascript:alert(1)&quot;)" width="1" height="1"/></svg>'],
  ['style-attribuut behavior', '<svg><rect style="behavior:url(#x);-moz-binding:url(x.xml#a)" width="1" height="1"/></svg>'],
  ['fill url javascript', '<svg><g fill="url(javascript:alert(1))" onclick="alert(2)"/></svg>'],
  ['commentaar', '<svg><!--<script>alert(1)</script>--><rect width="1" height="1"/></svg>'],
  ['stylesheet-PI', '<?xml-stylesheet href="https://evil.example/x.css" type="text/css"?><svg><rect width="1" height="1"/></svg>'],
  ['doctype met entiteit', '<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]><svg>&x;</svg>'],
  ['title met tag', '<svg><title><img src=x onerror=alert(1)></title></svg>'],
  ['title met element', '<svg><desc><img src="x" onerror="alert(1)"/></desc></svg>'],
  ['title met gecodeerde tag', '<svg><title>&lt;img src=x onerror=alert(1)&gt;</title></svg>'],
  ['text met gecodeerde tag', '<svg><text x="1" y="1">&lt;script&gt;alert(1)&lt;/script&gt;</text></svg>'],
  ['attribuut breekt uit', '<svg><path fill=\'red" onload="alert(1)\' d="M0 0"/></svg>'],
  ['xml:base', '<svg><a xml:base="javascript:alert(1)//" href="#x"><rect width="1" height="1"/></a></svg>'],
  ['handler', '<svg><handler xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load">alert(1)</handler></svg>'],
  ['ev:event', '<svg xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load" ev:handler="#x"><rect width="1" height="1"/></svg>'],
  ['gradient extern', '<svg><linearGradient id="g" href="https://evil.example/x.svg#g"/></svg>'],
  ['onbekend element', '<svg><discard/><listener/><math><mi>x</mi></math></svg>'],
  ['nul-teken in schema', '<svg><a href="java\u0000script:alert(1)"><rect width="1" height="1"/></a></svg>'],
  ['onzichtbaar teken in schema', '<svg><a href="java\u200bscript:alert(1)"><rect width="1" height="1"/></a></svg>'],
  ['twee wortels', '<svg></svg><script>alert(1)</script>'],
  ['niet afgesloten', '<svg><g><script>alert(1)</script>'],
  ['geen svg', '<html><body onload="alert(1)"></body></html>'],
  ['tekst', 'geen svg'],
];

test('bekende omzeilingen komen eruit zonder uitvoerbaar deel', () => {
  for (const [label, invoer] of AANVALLEN) {
    const uit = saneerSvg(invoer, { beeldOorsprong: 'http://tauri.localhost' });
    const tekst = assertOnschadelijk(uit, label);
    if (uit !== null) {
      assert.ok(!/<script/i.test(uit), `${label}: ${uit}`);
      // Gecodeerde tekst blijft gecodeerd; een tag in tekst kan nooit een
      // element worden.
      if (tekst && tekst.includes('<script')) assert.match(uit, /&lt;script/);
    }
  }
});

test('ongeldige of gevaarlijke structuren worden in zijn geheel geweigerd', () => {
  for (const s of [
    '<svg/onload=alert(1)>',
    '<svg onload=alert(1)></svg>',
    '<svg><path/onclick="x"/></svg>',
    '<SVG></SVG>',
    '<svg xmlns="http://www.w3.org/1999/xhtml"></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>',
    '<svg></svg><svg></svg>',
    '<svg><g></svg>',
    '<svg a="1" a="2"></svg>',
    '<svg a="<b>"></svg>',
    '',
    null,
    42,
  ]) {
    assert.equal(saneerSvg(s), null, String(s));
  }
});

test('wat er weg moest, wordt benoemd', () => {
  const r = saneerSvgDetail('<svg onload="x()"><script>y()</script><a href="javascript:z()"><rect width="1" height="1"/></a></svg>');
  assert.equal(r.svg, '<svg><rect width="1" height="1"/></svg>');
  // <a> gaat er met zijn attributen uit; alleen de kinderen blijven.
  assert.deepEqual(r.verwijderd, ['@onload', '<script>', '<a>']);
});

test('<a> wordt uitgepakt, <use> naar #id en lokale url() blijven', () => {
  const invoer = `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">`
    + '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient>'
    + '<clipPath id="c"><rect width="5" height="5"/></clipPath><symbol id="s"><circle r="2"/></symbol>'
    + '<marker id="m" refX="1" refY="1" orient="auto"><path d="M0 0L2 1L0 2z"/></marker></defs>'
    + '<a href="https://example.org"><rect width="10" height="10" fill="url(#g)" clip-path="url(#c)"/></a>'
    + '<use xlink:href="#s" x="5" y="5"/><use href="#s"/><line x1="0" y1="0" x2="5" y2="5" marker-end="url(#m)"/></svg>';
  const uit = saneerSvg(invoer);
  assertOnschadelijk(uit, 'lokaal');
  assert.match(uit, /<rect width="10" height="10" fill="url\(#g\)" clip-path="url\(#c\)"\/>/);
  assert.match(uit, /<use xlink:href="#s" x="5" y="5"\/>/);
  assert.match(uit, /<use href="#s"\/>/);
  assert.match(uit, /marker-end="url\(#m\)"/);
  assert.ok(!uit.includes('<a') && !uit.includes('example.org'));
});

test('xlink:href zonder declaratie krijgt de declaratie op de wortel', () => {
  const uit = saneerSvg('<svg><defs><path id="p" d="M0 0h1"/></defs><use xlink:href="#p"/></svg>');
  assert.equal(uit, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="p" d="M0 0h1"/></defs><use xlink:href="#p"/></svg>');
});

test('editor-metadata en vreemde namespaces vallen weg, de tekening blijft', () => {
  const invoer = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- gemaakt met een editor -->\n'
    + '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n'
    + `<svg ${NS} xmlns:ed="http://example.org/editor" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" width="64mm" height="64mm" viewBox="0 0 64 64" ed:version="1.2">`
    + '<metadata><rdf:RDF><rdf:Description/></rdf:RDF></metadata><ed:namedview/>'
    + '<g ed:label="laag 1" id="laag1"><path style="fill:none;stroke:#000000;stroke-width:2;font-family:\'Arial Black\'" d="M 10,10 H 54 V 54 Z" ed:nodetypes="cccc"/>'
    + '<text x="32" y="40" style="font-size:8px" xml:space="preserve"><tspan x="32" y="40">A&amp;B</tspan></text></g></svg>\n';
  const uit = saneerSvg(invoer);
  assertOnschadelijk(uit, 'editor');
  assert.equal(uit, `<svg ${NS} width="64mm" height="64mm" viewBox="0 0 64 64">`
    + '<g id="laag1"><path style="fill:none;stroke:#000000;stroke-width:2;font-family:\'Arial Black\'" d="M 10,10 H 54 V 54 Z"/>'
    + '<text x="32" y="40" style="font-size:8px" xml:space="preserve"><tspan x="32" y="40">A&amp;B</tspan></text></g></svg>');
});

test('veilige <style> blijft, zonderStijl haalt hem weg', () => {
  const invoer = `<svg ${NS} viewBox="0 0 10 10"><style>.a{fill:none;stroke:#000}.b > .c{fill:url(#g)}</style><rect class="a" width="1" height="1"/></svg>`;
  const uit = saneerSvg(invoer);
  assertOnschadelijk(uit, 'stijl');
  assert.match(uit, /<style>\.a\{fill:none;stroke:#000\}\.b &gt; \.c\{fill:url\(#g\)\}<\/style>/);
  assert.equal(saneerSvg(invoer, { zonderStijl: true }), `<svg ${NS} viewBox="0 0 10 10"><rect class="a" width="1" height="1"/></svg>`);
});

test('<image>: raster-data-URL en eigen assets blijven, de rest niet', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const geupload = `<svg viewBox="0 0 64 64" ${NS}><image href="${png}" width="64" height="64"/></svg>`;
  assert.equal(saneerSvg(geupload), geupload);
  // NEN 1414: <image> met de absolute asset-URL van de app (zie nen1414Library.js).
  const nen = `<svg viewBox="0 0 64 64" ${NS}><image href="http://tauri.localhost/assets/Tb01-Ab12cD.png" width="64" height="64"/></svg>`;
  assert.equal(saneerSvg(nen, { beeldOorsprong: 'http://tauri.localhost' }), nen);
  const nenDev = `<svg viewBox="0 0 64 64" ${NS}><image href="http://localhost:3041/assets/nen1414/Tb0.003.png" width="64" height="64"/></svg>`;
  assert.equal(saneerSvg(nenDev, { beeldOorsprong: 'http://localhost:3041' }), nenDev);
  // Andere oorsprong, ander pad of terugklimmen: weg.
  for (const href of [
    'https://evil.example/assets/x.png',
    'http://tauri.localhost/api/x.png',
    'http://tauri.localhost/assets/../x.png',
    'http://tauri.localhost/assets/x.svg',
    'data:image/png;base64,abc"onload="x',
    'asset://localhost/C:/Users/x.png',
  ]) {
    const uit = saneerSvg(`<svg ${NS}><image href="${href.replace(/"/g, '&quot;')}" width="1" height="1"/></svg>`, { beeldOorsprong: 'http://tauri.localhost' });
    assert.equal(uit, `<svg ${NS}></svg>`, href);
  }
});

test('de meegeleverde bibliotheken komen ongewijzigd door de saneerder', () => {
  let aantal = 0;
  for (const cat of [...NL_CATEGORIES, ...GDT_CATEGORIES]) {
    for (const s of cat.symbols) {
      if (typeof s.svg !== 'string') continue;
      const r = saneerSvgDetail(s.svg);
      assert.deepEqual(r.verwijderd, [], `${cat.id}/${s.id}`);
      assert.equal(r.svg, s.svg, `${cat.id}/${s.id}`);
      aantal++;
    }
  }
  assert.ok(aantal > 100, `verwacht > 100 symbolen, kreeg ${aantal}`);
  // De NL IFC Bouw-pictogrammen gebruiken patronen en clip-paden met url(#id).
  const ifc = NL_CATEGORIES.find((c) => c.id === 'nl-ifc-bouw');
  assert.ok(ifc.symbols.some((s) => /fill="url\(#/.test(s.svg) && saneerSvg(s.svg) === s.svg));
});

test('gegenereerde stempels, staalprofielen en catalogus-previews blijven gelijk', () => {
  for (const text of ['GOEDGEKEURD', 'A & B <C> "D"', 'Concept']) {
    const svg = stampToSvg({ text, color: '#0054a6' });
    // &quot; in tekst schrijft de saneerder als " (zelfde tekst, zelfde beeld).
    assert.equal(saneerSvg(svg), svg.replace(/&quot;/g, '"'), text);
    assert.equal(isSafeSymbolSvg(svg), true, text);
  }
  const profiel = steelFamilyPreviewSvg({
    shape: 'i', defaultSize: 'HEA100', sizes: [['HEA100', 96, 100, 5, 8, 12]],
  });
  assert.match(profiel, /<path d="M/);
  assert.equal(saneerSvg(profiel), profiel);
});

test('online collectie en catalogus-preview worden geschoond', () => {
  const groep = collectionToGroup('test', { name: { nl: 'Test' } }, {
    svgFiles: [
      { name: 'goed.svg', svg: `<svg viewBox="0 0 64 64" ${NS}><circle cx="32" cy="32" r="10"/></svg>` },
      { name: 'kwaad.svg', svg: `<svg viewBox="0 0 64 64" ${NS} onload="alert(1)"><circle cx="32" cy="32" r="10"/><script>alert(2)</script></svg>` },
      { name: 'kapot.svg', svg: '<svg/onload=alert(1)>' },
    ],
  }, 'nl');
  assert.deepEqual(groep.symbols.map((s) => s.id), ['lib-test-goed', 'lib-test-kwaad']);
  assert.equal(groep.symbols[1].svg, `<svg viewBox="0 0 64 64" ${NS}><circle cx="32" cy="32" r="10"/></svg>`);
  assert.equal(isSafeSymbolSvg(`<svg ${NS} onload="x()"/>`), false);

  const catalogus = parseLineworkCatalog({
    format: 'linework-variants', formatVersion: 1,
    families: [{
      id: 'f', preview: `<svg viewBox="0 0 64 64" ${NS}><rect width="9" height="9"/><foreignObject><iframe/></foreignObject></svg>`,
      variants: [{ id: 'v', label: 'V', w: 10, h: 10, paths: [{ p: [0, 0, 10, 10] }] }],
    }],
  });
  assert.equal(catalogus.families[0].preview, `<svg viewBox="0 0 64 64" ${NS}><rect width="9" height="9"/></svg>`);
  // Ook een bewaarde catalogus van voor de controle (preview nog ongeschoond).
  catalogus.families[0].preview = `<svg ${NS}><rect width="9" height="9" onclick="alert(1)"/></svg>`;
  const g = lineworkCatalogToGroup('c', null, catalogus, 'nl');
  assert.equal(g.symbols[0].svg, `<svg ${NS}><rect width="9" height="9"/></svg>`);
  assertOnschadelijk(g.symbols[0].svg, 'catalogus');
});

test('opgeslagen groepen en bewerkte typen worden geschoond, schone blijven identiek', () => {
  const schoon = `<svg viewBox="0 0 64 64" ${NS}><path d="M0 0L64 64" stroke="#000"/></svg>`;
  const groepen = [
    { id: 'custom-a', name: 'A', symbols: [{ id: 's1', name: 's1', svg: schoon }] },
    { id: 'lib-b', name: 'B', online: true, symbols: [
      { id: 's2', name: 's2', svg: `<svg ${NS}><script>alert(1)</script><rect width="1" height="1"/></svg>` },
      { id: 's3', name: 's3', svg: '<svg/onload=alert(1)>' },
      { id: 's4', name: 's4', parametricId: 'steel-x' },
    ] },
  ];
  const r = saneerSymboolGroepen(groepen);
  assert.equal(r.gewijzigd, true);
  assert.equal(r.groepen[0], groepen[0], 'schone groep blijft hetzelfde object');
  assert.deepEqual(r.groepen[1].symbols.map((s) => s.id), ['s2', 's4']);
  assert.equal(r.groepen[1].symbols[0].svg, `<svg ${NS}><rect width="1" height="1"/></svg>`);
  assert.equal(saneerSymboolGroepen([groepen[0]]).gewijzigd, false);
  assert.equal(saneerSymbolen([{ svg: schoon }]).gewijzigd, false);

  const o = saneerTypeOverrides({
    sym_a: { svg: schoon, name: 'A' },
    sym_b: { svg: `<svg ${NS}><g onclick="x()"/></svg>`, name: 'B' },
    sym_c: { svg: '<svg/onload=x()>', name: 'C' },
  });
  assert.equal(o.gewijzigd, true);
  assert.deepEqual(Object.keys(o.overrides), ['sym_a', 'sym_b']);
  assert.equal(o.overrides.sym_b.svg, `<svg ${NS}><g/></svg>`);
});

test('svgAlsDataUrl zet de SVG-namespace erbij als die ontbreekt', () => {
  const zonder = svgAlsDataUrl('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
  assert.ok(decodeURIComponent(zonder.slice(zonder.indexOf(',') + 1)).startsWith(`<svg ${NS} viewBox="0 0 1 1">`));
  const met = svgAlsDataUrl(`<svg ${NS} viewBox="0 0 1 1"/>`);
  assert.equal(decodeURIComponent(met.slice(met.indexOf(',') + 1)), `<svg ${NS} viewBox="0 0 1 1"/>`);
  assert.ok(met.startsWith('data:image/svg+xml;charset=utf-8,'));
});
