import test from 'node:test';
import assert from 'node:assert/strict';
import { createEscapeScope } from './dialog-escape.js';

const root = { contains: (t) => t === 'veld' || t === 'knop' };

test('a modal dialog always closes on Escape', () => {
  const scope = createEscapeScope();
  scope.pointerDown({ target: 'document' }, root);
  assert.equal(scope.sluitBijEscape(root, 'document'), true);
});

test('a non-modal dialog ignores Escape meant for the document behind it', () => {
  const scope = createEscapeScope({ modal: false });
  assert.equal(scope.sluitBijEscape(root, null), true, 'just opened');
  scope.pointerDown({ target: 'pagina' }, root);
  assert.equal(scope.sluitBijEscape(root, 'pagina'), false);
  assert.equal(scope.sluitBijEscape(root, 'veld'), true, 'focus back in the dialog');
  scope.pointerDown({ target: 'knop' }, root);
  assert.equal(scope.sluitBijEscape(root, null), true, 'clicked in the dialog');
});
