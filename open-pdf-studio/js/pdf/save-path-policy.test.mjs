import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldSaveAsForTransientSourcePath } from './save-path-policy.mjs';

test('routes classic mail-client cache files to Save As', () => {
  const path = String.raw`C:\Users\example\AppData\Local\Vendor\Windows\INetCache\Content.Mail\A1B2\document.pdf`;
  assert.equal(shouldSaveAsForTransientSourcePath(path), true);
});

test('routes packaged mail-client cache files to Save As', () => {
  const path = String.raw`C:\Users\example\AppData\Local\Packages\Vendor.MailClientForWindows_123\LocalCache\document.pdf`;
  assert.equal(shouldSaveAsForTransientSourcePath(path), true);
});

test('keeps ordinary document paths on the normal Save path', () => {
  const path = String.raw`C:\Users\example\Documents\document.pdf`;
  assert.equal(shouldSaveAsForTransientSourcePath(path), false);
});

test('does not classify missing paths as transient', () => {
  assert.equal(shouldSaveAsForTransientSourcePath(null), false);
  assert.equal(shouldSaveAsForTransientSourcePath(undefined), false);
});
