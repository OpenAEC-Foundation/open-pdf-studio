// De keuzelijst "Laag" in het eigenschappenpaneel (#377), en de bedrading
// van de laagstand naar opslaan, afdrukken en exporteren.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { laagKeuzeWaarde, leesLaagKeuze, laagKeuzeOpties } from './laag-keuze.js';
import { addLayer, ensureLayers, assignLayer, layerIdOf, isLayerHidden, updateLayer } from './annotatie-lagen.js';

function document() {
  const doc = { annotations: [] };
  ensureLayers(doc);
  const opm = addLayer(doc, { name: 'Opmerkingen' }).layer;
  addLayer(doc, { id: 'ocg-12-0', name: 'Wanden' });
  return { doc, opm };
}

test('de waarde van een annotatie: markeringslaag, laag van de tekening of standaard', () => {
  const { doc, opm } = document();
  assert.equal(laagKeuzeWaarde({}, doc), 'a:default');
  assert.equal(laagKeuzeWaarde({ layer: opm.id }, doc), `a:${opm.id}`);
  assert.equal(laagKeuzeWaarde({ layer: 'ocg-12-0' }, doc), 'o:12R');
  assert.equal(laagKeuzeWaarde({ layer: 'ocg-12-3' }), 'o:12R3');
  assert.equal(laagKeuzeWaarde({ layer: 'weg' }, doc), 'a:default', 'onbekende laag: standaard');
});

test('een keuze lezen', () => {
  assert.deepEqual(leesLaagKeuze('a:default'), { soort: 'annotatie', id: 'default' });
  assert.deepEqual(leesLaagKeuze('o:12R'), { soort: 'tekening', id: '12R' });
  assert.equal(leesLaagKeuze('mixed'), null);
  assert.equal(leesLaagKeuze(''), null);
});

test('de opties: markeringslagen apart, lagen van de tekening met de overgenomen laag erbij', () => {
  const { doc, opm } = document();
  const { markeringen, tekening } = laagKeuzeOpties(doc, [{ id: '7R', name: 'Stramien' }], 'Standaard');
  assert.deepEqual(markeringen, [
    { waarde: 'a:default', naam: 'Standaard' },
    { waarde: `a:${opm.id}`, naam: 'Opmerkingen' },
  ]);
  assert.deepEqual(tekening, [
    { waarde: 'o:7R', naam: 'Stramien' },
    { waarde: 'o:12R', naam: 'Wanden' },
  ]);
  // Staat de laag al bij de tekening, dan niet nog eens.
  const twee = laagKeuzeOpties(doc, [{ id: '12R', name: 'Wanden' }], 'Standaard');
  assert.deepEqual(twee.tekening, [{ waarde: 'o:12R', naam: 'Wanden' }]);
});

test('een annotatie op een laag van de tekening verdwijnt als die laag uit gaat', () => {
  const { doc } = document();
  const ann = { id: 'x' };
  doc.annotations.push(ann);
  assignLayer([ann], 'ocg-12-0');
  assert.equal(layerIdOf(ann), 'ocg-12-0');
  assert.equal(isLayerHidden(doc, ann), false);
  // Zoals ui/panels/layers.js (volgAnnotatieLagen) na het schakelen in het paneel Lagen.
  updateLayer(doc, 'ocg-12-0', { visible: false });
  assert.equal(isLayerHidden(doc, ann), true);
});

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('bedrading: opslaan, afdrukken, exporteren en het paneel volgen de laagstand', () => {
  const saver = lees('../pdf/saver.js');
  assert.match(saver, /const laagStandaard = standaardOmTeBewaren\(doc\);/);
  assert.match(saver, /schrijfStandaardLaagstand\(pdfDocLib, laagStandaard\)/);
  assert.match(saver, /lagenNaOpslaan\(activeDoc, \{ standBewaard: !!laagStandaard \}\)/);
  assert.match(lees('../pdf/exporter.js'), /\.\.\.pdfjsLaagOpties\(doc\)/);
  assert.match(lees('../pdf/print-job.js'), /bytesMetLaagstand\(doc, await bronBytesVan\(doc\)\)/);
  const lagen = lees('../ui/panels/layers.js');
  assert.match(lagen, /lagenLijst\(ocConfig, \{ overslaan: [^}]*boom \}\)/);
  assert.match(lagen, /if \(boom\?\.locked\?\.has\(id\)\)/);
  assert.match(lagen, /volgAnnotatieLagen\(activeDoc, eigenLaagConfig\(activeDoc\)\)/);
  const paneel = lees('../solid/components/left-panel/panels/LayersPanel.jsx');
  assert.match(paneel, /m\.setLayerStateAsDefault\(\)/);
  const eigenschappen = lees('../solid/components/properties-panel/GeneralSection.jsx');
  assert.match(eigenschappen, /<LayerField disabled=\{isLocked\(\)\} \/>/);
});

test('vertalingen: elke taal heeft de nieuwe sleutels, en niet de Engelse tekst', async () => {
  const { readdirSync } = await import('node:fs');
  const talen = readdirSync(new URL('../i18n/locales/', import.meta.url));
  const en = JSON.parse(lees('../i18n/locales/en/properties.json'));
  const sleutels = [
    ['general', 'layer'], ['general', 'layerMarkupGroup'], ['general', 'layerDocumentGroup'],
    ['leftPanel', 'layersSetDefault'], ['leftPanel', 'layersSetDefaultTitle'], ['leftPanel', 'layersDefaultPending'],
    ['leftPanel', 'layerLocked'], ['leftPanel', 'layerRadioGroup'],
  ];
  assert.ok(talen.length >= 37);
  for (const taal of talen) {
    const d = JSON.parse(lees(`../i18n/locales/${taal}/properties.json`));
    for (const [groep, sleutel] of sleutels) {
      const tekst = d[groep]?.[sleutel];
      assert.equal(typeof tekst, 'string', `${taal}: ${groep}.${sleutel}`);
      assert.ok(tekst.length > 0);
      if (taal !== 'en' && sleutel === 'layersSetDefaultTitle') assert.notEqual(tekst, en[groep][sleutel], `${taal}: vertaald`);
    }
  }
});
