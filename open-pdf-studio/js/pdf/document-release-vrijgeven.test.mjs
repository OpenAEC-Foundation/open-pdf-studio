// Wat geefDocumentVrij bij het sluiten echt vrijgeeft (#705): naast de bytes,
// vectorbuffers en paginabitmaps ook de tegels van hoge zoom, de
// JS-bitmapcache, de voorvertoningen en de snap-geometrie van het bestand.

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./document-release-test-hooks.mjs', import.meta.url);
const { geefDocumentVrij } = await import('./document-release.js');

const aanroepen = () => globalThis.__vrijTest?.aanroepen ?? [];
const reset = () => { globalThis.__vrijTest = { aanroepen: [] }; };
const metPad = (naam, pad) => aanroepen().some(([n, a]) => n === naam && a === pad);

test('sluiten geeft alle caches van het pad vrij, ook tegels, voorvertoningen en snap-geometrie', async () => {
  reset();
  let vernietigd = false;
  const dicht = { id: 3, filePath: 'C:/t/MV-03.pdf', pdfDoc: { destroy: async () => { vernietigd = true; } } };
  await geefDocumentVrij(dicht, []);
  assert.equal(vernietigd, true, 'de PDF.js-instantie gaat dicht');
  for (const naam of [
    'clearCachedPdfBytes', 'invalidateDocumentCache', 'invalidateDocumentBitmaps', 'forgetContentBytes',
    'vergeetWeergaveStand', 'tileCacheClearForFile', 'clearBitmapJSCacheForFile', 'clearLowResCacheForFile',
    'vergeetSnapGeometrie',
  ]) {
    assert.ok(metPad(naam, 'C:/t/MV-03.pdf'), `${naam} voor het gesloten pad`);
  }
  // Wat onder het id van het document staat (nooit opgeslagen) ook.
  assert.ok(metPad('vergeetSnapGeometrie', '__memory__3'));
  assert.ok(metPad('clearCachedPdfBytes', '__memory__3'));
});

test('een ander tabblad op hetzelfde bestand houdt tegels en snap-geometrie in leven', async () => {
  reset();
  const dicht = { id: 1, filePath: 'C:/t/a.pdf', pdfDoc: { destroy: async () => {} } };
  await geefDocumentVrij(dicht, [{ id: 2, filePath: 'C:/t/a.pdf', pdfDoc: {} }]);
  for (const naam of ['tileCacheClearForFile', 'clearBitmapJSCacheForFile', 'clearLowResCacheForFile', 'vergeetSnapGeometrie']) {
    assert.equal(metPad(naam, 'C:/t/a.pdf'), false, `${naam} niet voor een pad dat nog open is`);
  }
});

test('sluiten geeft de paginabeelden van het tweede paneel van de gesplitste weergave vrij (#715)', async () => {
  reset();
  const dicht = { id: 7, filePath: null, pdfDoc: { destroy: async () => {} } };
  await geefDocumentVrij(dicht, []);
  assert.ok(aanroepen().some(([n, d]) => n === 'vergeetPaneelBeelden' && d === dicht),
    'vergeetPaneelBeelden met het gesloten document');
});

test('sluiten laat het renderwerk van het pad vallen; een ander tabblad op hetzelfde bestand niet (#506)', async () => {
  reset();
  const { renderQueue, isRenderCancelled } = await import('./render-queue.js');
  let klaar;
  const lopend = renderQueue.schedule(() => new Promise((r) => { klaar = r; }), { docKey: 'C:/t/zwaar.pdf' });
  await Promise.resolve();
  await geefDocumentVrij({ id: 9, filePath: 'C:/t/zwaar.pdf', pdfDoc: { destroy: async () => {} } }, []);
  klaar({ close() {} });
  await assert.rejects(lopend, (e) => isRenderCancelled(e), 'het resultaat van een gesloten document vervalt');

  let klaar2;
  const gedeeld = renderQueue.schedule(() => new Promise((r) => { klaar2 = r; }), { docKey: 'C:/t/gedeeld.pdf' });
  await Promise.resolve();
  await geefDocumentVrij(
    { id: 10, filePath: 'C:/t/gedeeld.pdf', pdfDoc: { destroy: async () => {} } },
    [{ id: 11, filePath: 'C:/t/gedeeld.pdf', pdfDoc: {} }],
  );
  klaar2('beeld');
  assert.equal(await gedeeld, 'beeld');
});
