// Bewaakt de bedrading van de zijdematen van een meetvlak (GitHub #536) in de
// modules die in node niet (goed) te laden zijn: de tekenlus, de
// Solid-componenten, de voorkeuren en de taalbestanden. Het gedrag staat in
// vlak-zijden.test.mjs (plaatsing), vlak-maat.test.mjs (schaal, eenheid,
// paneel, gereedschapsstandaard), ../pdf/meetvlak-rondgang.test.mjs (opslaan
// en heropenen), ../core/standaardstijl-meetvlak.test.mjs (standaardstijl) en
// ../tools/tools/meetvlak-hoeksnap.test.mjs (vaste hoeken).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = new URL('../i18n/locales/', import.meta.url);

/** Het stuk broncode van `case '<soort>':` tot de volgende `case '...':` op dezelfde inspringing. */
function caseBlok(tekst, soort, inspringing) {
  const kop = `\n${inspringing}case '${soort}':`;
  const begin = tekst.indexOf(kop);
  assert.ok(begin >= 0, `case '${soort}' gevonden`);
  const rest = tekst.slice(begin + kop.length);
  const volgende = rest.search(new RegExp(`\\n${inspringing}(case '|default:)`));
  return rest.slice(0, volgende < 0 ? undefined : volgende);
}

test('het scherm tekent de zijdematen alleen als ze voor het vlak aanstaan', () => {
  const r = bron('./rendering.js');
  assert.match(r, /import \{[^}]*drawVlakZijdematen[^}]*\} from '\.\/rendering\/measurements\.js'/);
  assert.match(r, /import \{[^}]*vlakZijdeTeksten[^}]*\} from '\.\/measurement\.js'/);
  const blok = caseBlok(r, 'measureArea', '    ');
  assert.match(blok, /if \(annotation\.measureShowEdgeLengths === true\) \{\n\s+drawVlakZijdematen\(ctx, vlakZijdeTeksten\(annotation\), strokeColor\);/);
});

test('het eigenschappenpaneel heeft een vinkje voor de zijdematen van een meetvlak', () => {
  const m = bron('../solid/components/properties-panel/MeasurementSection.jsx');
  const vlak = m.slice(m.indexOf("annotProps.type === 'measureArea'"), m.indexOf("annotProps.type === 'measureDistance'"));
  assert.match(vlak, /t\('measurement\.showEdgeLengths'\)/);
  assert.match(vlak, /checked=\{annotProps\.measureShowEdgeLengths === true\}/);
  assert.match(vlak, /updateAnnotProp\('measureShowEdgeLengths', e\.target\.checked\)/);
});

test('de gereedschapsstandaard staat bij de andere standaarden van het meetvlak', () => {
  const a = bron('../solid/components/preferences/AnnotationsTab.jsx');
  const vlak = a.slice(a.indexOf("t('measurement.areaDefaults')"), a.indexOf("t('measurement.perimeterDefaults')"));
  assert.match(vlak, /p\.measureAreaShowEdgeLengths\[0\]\(\)/);
  assert.match(vlak, /p\.measureAreaShowEdgeLengths\[1\]\(e\.target\.checked\)/);
  assert.match(vlak, /t\('measurement\.showEdgeLengths'\)/);
  // Via het paneel met gereedschapsstandaarden (setAsDefaultStyle) en
  // 'standaardstijl toepassen' (applyDefaultStyle).
  const v = bron('../core/preferences.js');
  // De stijltabel per soort staat sinds #668 in stijl-mapping.js.
  assert.match(bron('../core/stijl-mapping.js'), /case 'measureArea':\n\s+return \{[^}]*edgeLengths: 'ShowEdgeLengths'/);
  // Het schrijven staat sinds #311 in style-prefs.js (gedeeld met de werkkist).
  assert.match(bron('../core/style-prefs.js'), /if \(m\.edgeLengths\) prefs\[p \+ m\.edgeLengths\] = annotation\.measureShowEdgeLengths === true;/);
  assert.match(v, /if \(m\.edgeLengths\) annotation\.measureShowEdgeLengths = prefs\[p \+ m\.edgeLengths\] === true;/);
  assert.match(bron('../core/constants.ts'), /\n\s+measureAreaShowEdgeLengths: false,/);
  assert.match(bron('../types/preferences.ts'), /\n\s+measureAreaShowEdgeLengths: boolean;/);
  assert.match(bron('../types/annotation.ts'), /\n\s+measureShowEdgeLengths\?: boolean;/);
});

test('alle talen hebben de tekst, vertaald', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  for (const bestand of ['properties.json', 'preferences.json']) {
    const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/${bestand}`, LOCALES), 'utf8'));
    const en = lees('en').measurement.showEdgeLengths;
    assert.equal(en, 'Show edge lengths');
    for (const taal of talen) {
      const tekst = lees(taal).measurement?.showEdgeLengths;
      assert.equal(typeof tekst, 'string', `${taal}/${bestand}: measurement.showEdgeLengths ontbreekt`);
      assert.ok(tekst.trim().length > 0, `${taal}/${bestand}: leeg`);
      if (taal !== 'en') assert.notEqual(tekst, en, `${taal}/${bestand}: nog Engels`);
    }
  }
});
