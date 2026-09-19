import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// page-manager.js pulls in the whole app (state, renderer, pdf.js) and cannot
// be imported under plain node, so this is a guard rail on its source.
const source = readFileSync(new URL("./page-manager.js", import.meta.url), "utf8");
const start = source.indexOf("export async function reloadFromBytes");
const body = source.slice(start, source.indexOf("\n}\n", start));

test("replacing the document bytes drops the caches that are not keyed by path", () => {
  assert.ok(start > 0, "reloadFromBytes not found");
  const snap = body.indexOf("clearPdfVectorCache()");
  const text = body.indexOf("clearTextCache(doc.id)");
  const render = body.indexOf("await setViewMode(");
  assert.ok(snap > 0, "snap-to-content geometry (keyed by page number) must be cleared");
  assert.ok(text > 0, "search text (keyed by document id) must be cleared");
  // The re-render prefetches the snap geometry again; clearing after it would
  // leave the cache empty until the next page change.
  assert.ok(render > snap && render > text, "clear the caches before the re-render");
});
