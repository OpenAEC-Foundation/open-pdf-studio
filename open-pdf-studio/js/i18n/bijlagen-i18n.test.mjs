// De teksten van de bijlagen (#376) staan in elke taal, met dezelfde
// plaatshouders als het Engels.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const map = fileURLToPath(new URL('./locales/', import.meta.url));
const talen = readdirSync(map);
const json = (taal, ns) => JSON.parse(readFileSync(`${map}${taal}/${ns}.json`, 'utf8'));
const pad = (o, p) => p.split('.').reduce((v, k) => v?.[k], o);

const SLEUTELS = {
  common: ['leftPanel.attachmentOnPage', 'leftPanel.attachmentCreated', 'leftPanel.attachmentModified',
    'leftPanel.openAttachmentRiskTitle', 'leftPanel.openAttachmentRiskMessage'],
  ribbon: ['comment.fileAttachment', 'comment.fileAttachmentTitle'],
  properties: ['appearance.iconPaperclip', 'appearance.iconPushPin', 'appearance.iconGraph', 'appearance.iconTag',
    'attachment.file', 'attachment.size', 'attachment.open', 'attachment.saveAs', 'attachment.noContent',
    'types.fileAttachment'],
};
const plaatshouders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

test('every locale has the attachment strings with the English placeholders', () => {
  assert.ok(talen.length >= 40);
  for (const [ns, sleutels] of Object.entries(SLEUTELS)) {
    const en = json('en', ns);
    for (const taal of talen) {
      const t = json(taal, ns);
      for (const s of sleutels) {
        const waarde = pad(t, s);
        assert.equal(typeof waarde, 'string', `${taal}/${ns}: ${s}`);
        assert.ok(waarde.trim(), `${taal}/${ns}: ${s} is empty`);
        assert.deepEqual(plaatshouders(waarde), plaatshouders(pad(en, s)), `${taal}/${ns}: ${s} placeholders`);
      }
    }
  }
});

test('non-English locales translate the attachment tool', () => {
  const en = json('en', 'ribbon').comment.fileAttachmentTitle;
  const gelijk = talen.filter((t) => t !== 'en' && json(t, 'ribbon').comment.fileAttachmentTitle === en);
  assert.deepEqual(gelijk, []);
});
