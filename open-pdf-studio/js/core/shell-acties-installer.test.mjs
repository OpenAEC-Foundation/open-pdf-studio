// De installer schrijft en verwijdert de Verkenner-acties (#945) uit één
// lijst: elk geschreven register-pad wordt bij het verwijderen ook weer
// opgeruimd, in dezelfde hive (SHCTX: HKLM per machine, HKCU per gebruiker).
// Broncontrole van src-tauri/nsis/hooks.nsh en strings.nsh; een installer
// draait hier niet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { AFBEELDING, CAD } from './shell-acties-logica.js';

const APP = new URL('../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, APP), 'utf8').replace(/\r\n/g, '\n');
const hooks = lees('src-tauri/nsis/hooks.nsh');
const strings = lees('src-tauri/nsis/strings.nsh');
const rust = lees('src-tauri/src/verkenner_acties.rs');

/** De body van `!macro NAAM ...` tot de bijbehorende `!macroend`. */
function macro(naam) {
  const m = hooks.match(new RegExp(`^!macro ${naam}\\b[^\\n]*\\n([\\s\\S]*?)^!macroend`, 'm'));
  assert.ok(m, `macro ${naam} gevonden`);
  return m[1];
}

/** Register-sleutels die een body raakt: [actie, sleutel] na invullen van de parameters. */
function sleutels(body, waarden) {
  const uit = [];
  for (const regel of body.split('\n')) {
    const m = regel.match(/^\s*(WriteRegStr|DeleteRegKey)\s+(\S+)\s+"([^"]+)"/);
    if (!m) continue;
    let sleutel = m[3].replace('${OPDS_SHELL_SFA}', 'Software\\Classes\\SystemFileAssociations');
    for (const [k, v] of Object.entries(waarden)) sleutel = sleutel.split(`\${${k}}`).join(v);
    uit.push({ actie: m[1], hive: m[2], sleutel });
  }
  return uit;
}

const lijst = [...macro('OPDS_SHELL_VERBS').matchAll(
  /!insertmacro OPDS_SHELL_VERB_\$\{_OP\} "([^"]+)" "([^"]+)" "([^"]+)" "([^"]+)"/g,
)].map(([, ext, key, label, flag]) => ({ ext, key, label, flag }));

test('de lijst dekt alle bestandstypen van het voorstel', () => {
  const combineren = lijst.filter((v) => v.key === 'OpenPDFStudio.Combine').map((v) => v.ext).sort();
  const omzetten = lijst.filter((v) => v.key === 'OpenPDFStudio.ConvertToPdf').map((v) => v.ext).sort();
  assert.deepEqual(omzetten, ['.bmp', '.dwg', '.dxf', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
  assert.deepEqual(combineren, ['.bmp', '.gif', '.jpeg', '.jpg', '.pdf', '.png', '.webp']);
  // De app herkent precies dezelfde typen.
  for (const { ext } of lijst) {
    assert.ok(ext === '.pdf' || AFBEELDING.test(`x${ext}`) || CAD.test(`x${ext}`), ext);
  }
  // Geen dubbele regels.
  assert.equal(new Set(lijst.map((v) => `${v.ext}|${v.key}`)).size, lijst.length);
});

test('elke vlag in de installer kent de app (verkenner_acties.rs)', () => {
  for (const { flag, key } of lijst) {
    assert.ok(rust.includes(`"${flag}"`), flag);
    const groep = key === 'OpenPDFStudio.Combine' ? 'COMBINEER_VLAGGEN' : 'OMZET_VLAGGEN';
    assert.match(rust, new RegExp(`${groep}[^\\n]*"${flag}"`), `${flag} in ${groep}`);
  }
});

test('schrijven en verwijderen raken dezelfde sleutels, in SHCTX', () => {
  const schrijf = macro('OPDS_SHELL_VERB_WRITE');
  const weg = macro('OPDS_SHELL_VERB_REMOVE');
  for (const v of lijst) {
    const waarden = { _EXT: v.ext, _KEY: v.key, _LABEL: v.label, _FLAG: v.flag };
    const geschreven = sleutels(schrijf, waarden);
    const verwijderd = sleutels(weg, waarden);
    assert.ok(geschreven.length >= 4, 'naam, MUIVerb, icoon en opdracht');
    for (const s of [...geschreven, ...verwijderd]) assert.equal(s.hive, 'SHCTX', `${s.actie} ${s.sleutel}`);
    const verbSleutel = `Software\\Classes\\SystemFileAssociations\\${v.ext}\\shell\\${v.key}`;
    // Alles wat geschreven wordt valt onder de verb-sleutel ...
    for (const s of geschreven) assert.ok(s.sleutel === verbSleutel || s.sleutel.startsWith(`${verbSleutel}\\`), s.sleutel);
    // ... en die sleutel gaat bij het verwijderen in zijn geheel weg.
    assert.ok(verwijderd.some((s) => s.actie === 'DeleteRegKey' && s.sleutel === verbSleutel), verbSleutel);
  }
  // De opdracht geeft de vlag en het bestand mee, met aanhalingstekens.
  assert.match(schrijf, /\\command" "" "\$\\"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe\$\\" \$\{_FLAG\} \$\\"%1\$\\""/);
  // Lege bovenliggende sleutels alleen weg als ze echt leeg zijn.
  assert.match(weg, /OPDS_DELETE_SHCTX_KEY_IF_EMPTY "\$\{OPDS_SHELL_SFA\}\\\$\{_EXT\}\\shell"/);
  const leeg = macro('OPDS_DELETE_SHCTX_KEY_IF_EMPTY');
  assert.match(leeg, /EnumRegKey \$R4 SHCTX/);
  assert.match(leeg, /EnumRegValue \$R5 SHCTX/);
});

test('installeren schrijft, verwijderen ruimt op (beide installer-varianten)', () => {
  assert.match(macro('NSIS_HOOK_POSTINSTALL'), /!insertmacro OPDS_SHELL_VERBS WRITE/);
  // Altijd: niet binnen de keuze "standaard-PDF-app".
  const post = macro('NSIS_HOOK_POSTINSTALL');
  assert.ok(post.indexOf('OPDS_SHELL_VERBS WRITE') < post.indexOf('$AssocPDFState'));
  assert.match(macro('NSIS_HOOK_PREUNINSTALL'), /!insertmacro OPDS_SHELL_VERBS REMOVE/);
  // Geen HKLM of HKCU hard gecodeerd voor de verbs: SHCTX volgt de installmodus.
  assert.doesNotMatch(macro('OPDS_SHELL_VERB_WRITE') + macro('OPDS_SHELL_VERB_REMOVE'), /\b(HKLM|HKCU)\b/);
});

test('de drie menunamen bestaan in elke installertaal', () => {
  for (const naam of ['opdsVerbCombine', 'opdsVerbConvert', 'opdsVerbConvertCombine']) {
    assert.ok(lijst.some((v) => v.label === `$(${naam})`), `${naam} gebruikt`);
    for (const taal of ['LANG_ENGLISH', 'LANG_DUTCH']) {
      assert.match(strings, new RegExp(`LangString ${naam} \\$\\{${taal}\\} "[^"]+\\(\\$\\{PRODUCTNAME\\}\\)"`), `${naam} ${taal}`);
    }
  }
  assert.match(strings, /LangString opdsVerbCombine \$\{LANG_ENGLISH\} "Combine into one PDF \(\$\{PRODUCTNAME\}\)"/);
});
