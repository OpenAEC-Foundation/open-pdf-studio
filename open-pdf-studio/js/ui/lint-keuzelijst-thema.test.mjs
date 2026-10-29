// Keuzelijsten in het lint (#825): de opties moeten op een dekkende
// achtergrond staan. In het standaardthema is --theme-ribbon-input-bg bijna
// doorzichtig; de native lijst legt die over wit, met lichte tekst erop.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const lees = (pad) => fs.readFileSync(new URL(pad, import.meta.url), 'utf8');

test('opties van een lint-keuzelijst hebben een dekkende achtergrond', () => {
  const css = lees('../../styles/ribbon.css');
  const regel = css.slice(css.indexOf('.ribbon-form-select option,'));
  const blok = regel.slice(0, regel.indexOf('}'));
  assert.match(blok, /background-color: var\(--theme-ribbon-content-bg\)/);
  assert.doesNotMatch(blok, /--theme-ribbon-input-bg/);
  assert.match(css, /\[data-theme\]:not\(\[data-theme="light"\]\) \.ribbon-form-select \{\s*color-scheme: dark;/);
});

test('elk thema heeft een dekkende --theme-ribbon-content-bg', () => {
  const themas = lees('../../styles/themes.css');
  const waarden = [...themas.matchAll(/--theme-ribbon-content-bg:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(waarden.length >= 7, 'alle thema\'s');
  for (const w of waarden) {
    assert.match(w, /^#[0-9a-f]{3,6}$/i, `dekkend, geen rgba/transparent: ${w}`);
  }
});
