// Find bar navigation: after jumping to a result the view scrolls to the
// match, also when a scroll sync in the continuous view moved currentPage
// to a page in between; a newer navigation cancels the older one.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./find-bar.js', import.meta.url), 'utf8');
const start = source.indexOf('let navigationToken');
const rest = source.slice(start);
// Tot en met de eerste "}" aan het begin van een regel, ook bij CRLF.
const einde = rest.match(/\r?\n\}\r?\n/);
const body = rest.slice(0, einde.index + einde[0].length);

function harness({ highlightAfter = 0 } = {}) {
  const doc = { currentPage: 1, viewMode: 'continuous' };
  const timers = [];
  const scrolled = [];
  let lookups = 0;
  const deps = {
    getActiveDocument: () => doc,
    stopAlleWielScrollers() {},
    scrollGedrag: () => 'smooth',
    renderPage: async () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    document: {
      querySelector: () => ({
        // The smooth scroll passes page 3 on its way to page 5.
        scrollIntoView: () => { doc.currentPage = 3; },
      }),
    },
    scrollToMatch: (result) => {
      lookups++;
      if (lookups <= highlightAfter) return false;
      scrolled.push(result.pageNum);
      return true;
    },
  };
  const navigate = new Function('deps', `with (deps) { ${body}; return navigateToResult; }`)(deps);
  const runTimers = () => {
    while (timers.length) timers.shift()();
  };
  return { doc, navigate, runTimers, scrolled };
}

test('the match is scrolled into view although a scroll sync changed currentPage', async () => {
  const h = harness();
  await h.navigate({ pageNum: 5 });
  assert.equal(h.doc.currentPage, 3);
  h.runTimers();
  assert.deepEqual(h.scrolled, [5]);
});

test('the scroll waits for the match to be rendered', async () => {
  const h = harness({ highlightAfter: 2 });
  await h.navigate({ pageNum: 5 });
  h.runTimers();
  assert.deepEqual(h.scrolled, [5]);
});

test('a newer navigation cancels the scroll of an older one', async () => {
  const h = harness();
  await h.navigate({ pageNum: 5 });
  await h.navigate({ pageNum: 7 });
  h.runTimers();
  assert.deepEqual(h.scrolled, [7]);
});
