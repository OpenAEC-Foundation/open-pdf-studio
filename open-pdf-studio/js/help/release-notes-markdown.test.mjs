// Release-notes komen van buiten de app en gaan als HTML in de dialoog: een
// link-URL mag het href-attribuut niet kunnen openbreken.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown } from './release-notes.js';

test('aanhalingstekens in een link blijven binnen het href-attribuut', () => {
  const html = renderMarkdown('[klik](https://example.org/"onfocus="location=name"autofocus="x)');
  assert.match(html, /<a href="https:\/\/example\.org\/&quot;onfocus=&quot;location=name&quot;autofocus=&quot;x"/);
  assert.ok(!/<a [^>]*\s(?:onfocus|autofocus)=/i.test(html), html);
});

test('gewone links en tekst blijven werken', () => {
  const html = renderMarkdown('Zie [notities](https://example.org/a?b=1&c=2) en "citaat" <b>.');
  assert.match(html, /<a href="https:\/\/example\.org\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">notities<\/a>/);
  assert.match(html, /&quot;citaat&quot; &lt;b&gt;/);
});
