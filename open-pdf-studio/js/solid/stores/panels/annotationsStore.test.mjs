// Pure tests voor het statusfilter (Tonen > Status, #236/#333).
//
// isStatusHidden is de ENIGE rekenplek voor de afgeleide zichtbaarheid van
// het statusfilter; lijst (annotations-list.js) en canvas (view-filters.js →
// rendering/hit-test) leunen er allebei op. Deze tests pinnen de afspraken:
// hoofdletter-ongevoelig, geen status telt als 'none', lege set = alles
// zichtbaar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenStatuses, toggleHiddenStatus, isStatusHidden } from './annotationsStore.js';

// toggleHiddenStatus doet een lazy import van core/state + rendering voor de
// canvas-herteken; buiten de app faalt die import en wordt hij stil geslikt
// (.catch) — de set zelf is synchroon bijgewerkt, dus direct testbaar.

test('lege set: niets verborgen, ook niet zonder status', () => {
  assert.equal(hiddenStatuses().size, 0);
  assert.equal(isStatusHidden({ status: 'accepted' }), false);
  assert.equal(isStatusHidden({}), false);
  assert.equal(isStatusHidden(null), false);
});

test('uitgevinkte status verbergt hoofdletter-ongevoelig', () => {
  toggleHiddenStatus('accepted');
  assert.equal(isStatusHidden({ status: 'accepted' }), true);
  // Het contextmenu schrijft 'Accepted' (hoofdletter), de loader kleine
  // letters — beide moeten dezelfde uitkomst geven.
  assert.equal(isStatusHidden({ status: 'Accepted' }), true);
  assert.equal(isStatusHidden({ status: 'rejected' }), false);
  assert.equal(isStatusHidden({}), false);
  toggleHiddenStatus('accepted'); // terugzetten
  assert.equal(isStatusHidden({ status: 'accepted' }), false);
});

test("geen status telt als 'none'", () => {
  toggleHiddenStatus('none');
  assert.equal(isStatusHidden({}), true);
  assert.equal(isStatusHidden({ status: undefined }), true);
  assert.equal(isStatusHidden({ status: 'completed' }), false);
  toggleHiddenStatus('none');
  assert.equal(isStatusHidden({}), false);
});

// Filterbalk van het overzicht (#383): de store bewaart de invoer zoals hij
// getypt is; schoonmaken gebeurt bij het filteren (opmerkingen-overzicht.js).
test('filterbalk: bijwerken, actief-vlag en wissen', async () => {
  const { listFilter, updateListFilter, clearListFilter, anyListFilterActive } = await import('./annotationsStore.js');
  assert.equal(anyListFilterActive(), false);
  updateListFilter({ auteur: 'Anna' });
  updateListFilter({ paginaVan: '3' });
  assert.equal(listFilter().auteur, 'Anna');
  assert.equal(listFilter().paginaVan, '3');
  assert.equal(anyListFilterActive(), true);
  clearListFilter();
  assert.equal(listFilter().auteur, '');
  assert.equal(anyListFilterActive(), false);
  // Een uitgevinkte status telt ook als actief filter.
  toggleHiddenStatus('rejected');
  assert.equal(anyListFilterActive(), true);
  toggleHiddenStatus('rejected');
  assert.equal(anyListFilterActive(), false);
});
