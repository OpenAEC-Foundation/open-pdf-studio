// Save as IFCX is offered where saving happens.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { ifcxOpslaanLabel, ifcxOpslaanBezwaar } from './ifcx-opslaan.js';

test('the label is built from the translated Save As', () => {
  assert.equal(ifcxOpslaanLabel('Save As'), 'Save As IFCX…');
  assert.equal(ifcxOpslaanLabel('Opslaan als'), 'Opslaan als IFCX…');
  assert.equal(ifcxOpslaanLabel('Opslaan als...'), 'Opslaan als IFCX…');
  assert.equal(ifcxOpslaanLabel('Speichern unter…'), 'Speichern unter IFCX…');
  assert.equal(ifcxOpslaanLabel(''), 'Save As IFCX…');
});

test('without a document or with protected content it says why not', () => {
  assert.equal(ifcxOpslaanBezwaar(null), 'noDocumentOpen');
  assert.equal(ifcxOpslaanBezwaar({}), 'noDocumentOpen');
  assert.equal(ifcxOpslaanBezwaar({ pdfDoc: {} }, { beveiligd: true }), 'protectedPdfReadOnly');
  assert.equal(ifcxOpslaanBezwaar({ pdfDoc: {} }), null);
});

test('the reasons exist as translations', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../i18n/locales/en/common.json', import.meta.url), 'utf8'));
  for (const k of ['noDocumentOpen', 'protectedPdfReadOnly', 'saveAs']) assert.equal(typeof en[k], 'string', k);
});

test('the save button, the File menu and File > Export all start the same export', () => {
  const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(lees('../solid/components/TitleBar.jsx'), /opslaanAlsIfcx/);
  assert.match(lees('../solid/components/SaveSplitButton.jsx'), /onSaveAsIfcx/);
  assert.match(lees('../solid/components/app-menu/AppMenu.jsx'), /menu-save-as-ifcx/);
  assert.match(lees('../solid/components/app-menu/ExportPanel.jsx'), /opslaanAlsIfcx/);
});
