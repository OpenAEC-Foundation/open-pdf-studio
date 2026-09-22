// Het antwoord van app_merge_pdf volgt wat het samenvoegen werkelijk deed (#400).

import { test } from "node:test";
import assert from "node:assert/strict";
import { nieuwMergeVerslag, mergeAntwoord, REDEN_VOORBEELD, REDEN_GEEN_PAGINAS } from "./merge-verslag.js";

const omgeving = (extra = {}) => ({
  filePaths: ["C:/t/plan.pdf"], position: "end", pagesBefore: 3, pagesAfter: 3, filePath: "C:/t/doc.pdf", ...extra,
});

test("a refused preview PDF is reported as not merged, with the reason", () => {
  const verslag = nieuwMergeVerslag();
  verslag.refused.push({ path: "C:/t/plan.pdf", reason: REDEN_VOORBEELD });
  const antwoord = mergeAntwoord(verslag, omgeving());
  assert.equal(antwoord.ok, false);
  assert.equal(antwoord.mergedFiles, 0);
  assert.deepEqual(antwoord.refused, [{ file: "C:/t/plan.pdf", reason: REDEN_VOORBEELD }]);
  assert.deepEqual(antwoord.failed, []);
  assert.match(antwoord.error, /plan\.pdf/);
  assert.match(antwoord.error, /preview/i);
  assert.equal(antwoord.pagesBefore, 3);
  assert.equal(antwoord.pagesAfter, 3);
});

test("a complete merge is reported with the number of files that really went in", () => {
  const verslag = nieuwMergeVerslag();
  verslag.merged.push("C:/t/a.pdf", "C:/t/b.pdf");
  verslag.pagesInserted = 5;
  const antwoord = mergeAntwoord(verslag, omgeving({ filePaths: ["C:/t/a.pdf", "C:/t/b.pdf"], pagesAfter: 8 }));
  assert.deepEqual(antwoord, {
    ok: true, position: "end", mergedFiles: 2, pagesInserted: 5, pagesBefore: 3, pagesAfter: 8, filePath: "C:/t/doc.pdf",
  });
});

test("a partial merge is not a success, and says which files stayed out", () => {
  const verslag = nieuwMergeVerslag();
  verslag.merged.push("C:/t/a.pdf");
  verslag.pagesInserted = 2;
  verslag.refused.push({ path: "C:/t/voorbeeld.pdf", reason: REDEN_VOORBEELD });
  verslag.refused.push({ path: "C:/t/leeg.pdf", reason: REDEN_GEEN_PAGINAS });
  verslag.failed.push({ path: "C:/t/kapot.pdf", error: "Failed to parse PDF" });
  const antwoord = mergeAntwoord(verslag, omgeving({
    filePaths: ["C:/t/a.pdf", "C:/t/voorbeeld.pdf", "C:/t/leeg.pdf", "C:/t/kapot.pdf"], pagesAfter: 5,
  }));
  assert.equal(antwoord.ok, false);
  assert.equal(antwoord.mergedFiles, 1);
  assert.equal(antwoord.pagesAfter, 5);
  assert.equal(antwoord.refused.length, 2);
  assert.deepEqual(antwoord.failed, [{ file: "C:/t/kapot.pdf", error: "Failed to parse PDF" }]);
  assert.match(antwoord.error, /3 of 4/);
});

test("a merge that could not start says why", () => {
  const verslag = nieuwMergeVerslag("no-bytes");
  const antwoord = mergeAntwoord(verslag, omgeving());
  assert.equal(antwoord.ok, false);
  assert.equal(antwoord.mergedFiles, 0);
  assert.match(antwoord.error, /no-bytes/);
});

test("without a report the page count decides", () => {
  assert.equal(mergeAntwoord(undefined, omgeving()).ok, false);
  assert.equal(mergeAntwoord(undefined, omgeving()).mergedFiles, 0);
  const gegroeid = mergeAntwoord(undefined, omgeving({ pagesAfter: 4 }));
  assert.equal(gegroeid.ok, true);
  assert.equal(gegroeid.mergedFiles, 1);
  // Een verslag dat "samengevoegd" zegt terwijl er geen pagina bijkwam, is geen succes.
  const verslag = nieuwMergeVerslag();
  verslag.merged.push("C:/t/plan.pdf");
  assert.equal(mergeAntwoord(verslag, omgeving()).ok, false);
});
