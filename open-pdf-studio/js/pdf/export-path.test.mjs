import assert from 'node:assert/strict';
import test from 'node:test';
import { joinExportPath } from './export-path.js';

test('multi-page image paths stay inside the selected folder on Linux and Windows', () => {
  assert.equal(joinExportPath('/tmp/pages', 'page0002.png'), '/tmp/pages/page0002.png');
  assert.equal(joinExportPath('/tmp/pages/', 'page0002.png'), '/tmp/pages/page0002.png');
  assert.equal(joinExportPath('/', 'page0002.png'), '/page0002.png');
  assert.equal(joinExportPath('C:\\Users\\Me\\Pages\\', 'page0002.png'), 'C:\\Users\\Me\\Pages\\page0002.png');
});
