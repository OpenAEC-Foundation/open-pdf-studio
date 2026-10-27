# Guarded incremental saving (#679)

Status: **prototype behind an opt-in preference, off by default.**
Preferences > General > Saving > "Save annotation and form changes
incrementally (experimental)" (`incrementalSave`, default `false`).

Code: `open-pdf-studio/js/pdf/saver/incrementeel.js` (planner, classifier,
writer, self-check), wired into `js/pdf/saver.js`. Tests:
`js/pdf/saver/incrementeel.test.mjs` (writer and refusals in isolation) and
`js/pdf/incrementeel-opslaan-rondgang.test.mjs` (the real saver). Benchmark:
`open-pdf-studio/scripts/meet-incrementeel-opslaan.mjs` (local only, not in CI).

## 1. Problem and current save path

`savePDF` loads the base bytes into pdf-lib, applies the document model (all
annotations on loaded pages are removed and rebuilt from the model, form
values from the pdf.js AnnotationStorage, text edits, OCR layer, watermarks,
bookmarks, style presets, page labels, attachments), drops unreachable objects
(`saver/objecten-opruimen.js`) and serialises the whole file with
`pdfDocLib.save()`. The bytes are published with `writeBinaryFileAtomic`
(temporary file + rename), after the `stillCurrent()` checks, and the byte
cache, the Rust PDF cache and the dirty state are updated.

The atomic write protects against interrupted writes. It does not preserve the
previous byte sequence: every save is a new file. An incremental update
(ISO 32000-1 §7.5.6) appends changed and new objects, a new cross-reference
section and a trailer with `/Prev` behind the untouched original bytes.

## 2. Capability matrix

"Incremental" means: eligible when the preference is on and every guard passes.
Everything else is the existing full rewrite. The classifier is object based
(it does not trust the model's intent alone), plus a few explicit
model-level vetoes.

| Edit / situation | Incremental? | How it is decided |
|---|---|---|
| Add, change or delete markup annotations (box, circle, line, ink, polygon, text box, callout, note, stamp, highlight, ...) on loaded pages | **Yes** | New annotation dicts and appearance streams are new objects; the page dict may differ only in `/Annots` |
| Annotation layers (#468, `/OCProperties`) | **Yes** | Catalog may differ only in `/AcroForm` and `/OCProperties` |
| Fill in form fields (text, checkbox, radio, choice) | **Yes** | Field dicts, widgets, `/AcroForm`, `/DR` fonts are in the form zone |
| Text box fonts in `/AcroForm /DR` | **Yes** | Form zone |
| Bookmarks unchanged (outline rebuilt identically by the saver) | **Yes** | `herstelOngewijzigdeOutline` keeps the old outline objects when the rebuilt tree is equal item by item |
| Bookmarks added, removed, renamed, reordered, or an outline that does not round-trip (named dests, `/Fit` dests, collapsed items) | No | Catalog `/Outlines` changed |
| Text edits (cover-and-replace), OCR text layer, watermarks, headers/footers, vector snippets baked into content | No | Page `/Contents` / `/Resources` or content streams changed |
| Page rotation, insert, delete, reorder, crop | No | Page dict keys other than `/Annots`, or page tree changed |
| Page labels, style presets in the catalog, attachments added | No | Catalog keys outside the allow list |
| Attachments removed | No | Explicit veto (`bijlage-verwijderd`) and catalog `/Names` change |
| Redaction marks present or applied (`type: 'redaction'`, `redacted: true`) | **Never** | Explicit veto (`redactie`); removal must not stay recoverable |
| Hidden-information removal / sanitised copy (#646) | **Never** | Separate rewrite path (`hidden-information.js`); does not import the incremental writer (tested) |
| Any original object deleted from the pdf-lib context | No | `verwijderd-object`: the intent was removal |
| PDF/A document after "enable editing" | Expected no (not separately tested) | PDF/A metadata stripping changes the catalog, which the classifier refuses |
| Encrypted input (any `/Encrypt`) | No | `versleuteld`; the full path also refuses to load it (unchanged behaviour) |
| Malformed xref (wrong `startxref`, wrong offsets, `/Prev` loop, undecodable xref stream, object not where the xref says) | No | `xref-onjuist` / `geen-startxref`; the full rewrite rebuilds a clean file |
| Prior incremental revisions in the source | **Yes** | The whole `/Prev` chain is read and validated; one more section is appended |
| Source with xref streams and object streams | **Yes** | New section is an xref stream; new object numbers start above `/Size` and above every number the chain mentions |
| Hybrid source (classic table + `/XRefStm`) | **Yes** | New section is a classic table with `/Prev`; readers still reach the `/XRefStm` of the previous trailer |
| Linearized source | Yes (structurally) | Linearization hints become stale, as with any incremental update |
| Certified, DocMDP `P=1` | No | `docmdp-geen-wijzigingen`; full rewrite only after the existing signature warning |
| Certified, DocMDP `P=2` | Form filling only | Any written non-widget annotation, page dict or layer change refuses (`docmdp-alleen-formulier`) |
| Certified, DocMDP `P=3` | Form filling and annotations | Same guards as unsigned files |
| Field locked by FieldMDP (`/Lock` or a FieldMDP SigRef, `All`/`Include`/`Exclude`) | No for that field | `fieldmdp-vergrendeld` |
| Changing a signature dict or a signed `/FT /Sig` field | **Never** | `handtekening-gewijzigd` |
| Recovery snapshots, "flatten all" previews | No | They never take the save branch |

Every refusal is recorded in `doc.laatsteOpslagWijze = { wijze, reden, detail }`
and logged with `console.info`; the save then continues on the full-rewrite
path exactly as without the preference.

## 3. Backend choice

### Options considered

**A. JS incremental writer on top of pdf-lib (chosen).** Keep the existing saver
unchanged; snapshot the pdf-lib object table right after load, diff it right
before serialisation, and append only changed and new reachable objects plus a
new xref section (table or stream, matching the source) and a trailer with
`/Prev`.

**B. Rust writer on lopdf**, as in PR #783's `open-pdf-signatures/src/pdf_schrijven.rs`
(incremental update for signing, xref table or stream matching the source).

**C. MuPDF's incremental save** (WASM in the app's dependencies).

### Evidence

- The model-to-PDF conversion is ~3,400 lines of pdf-lib code in `saver.js` and
  `saver/*`. Option B would need that object graph shipped to Rust (a
  serialisation of every changed object over IPC, i.e. a second writer for the
  same objects) or a re-implementation of the saver. Option A reuses it as is,
  so incremental and full output contain the *same* objects. The real-saver test
  "incremental and full rewrite give back the same annotations" checks this.
- pdf-lib does not read cross-reference tables: it parses objects sequentially
  and keeps the last definition. That is why the planner has its own xref chain
  reader (tables, xref streams incl. PNG predictors, hybrid `/XRefStm`, `/Prev`
  chain) and validates every in-use offset before trusting pdf-lib's view.
  pdf-lib also numbers new objects from its own largest number, which can be
  below an object stream or xref stream number of the source; the planner
  raises the counter to `max(/Size - 1, highest number in the chain)` before
  any edit. Both behaviours follow from pdf-lib's parser (1.17.1) and are
  covered by tests ("new objects get numbers above /Size ...").
- Option C (MuPDF) has its own document model; the app's edits are in pdf-lib
  objects, so it would mean re-applying them in MuPDF. It is used here only as
  an *independent reader* in tests (`wasRepaired()`, `countVersions()`).
- The output format of A matches #783's Rust writer (uncompressed xref stream,
  `/W [1 4 2]` or wider, `/Prev`, same `/Root`, `/Info`, `/ID`), so both can
  coexist: signing stays in Rust, annotation/form saves in JS.
- Measured overhead of A is small (section 6): planner + diff + writer + self-check
  is roughly 10–90 ms on the repo's test files; on the large files the whole
  save is faster than the full serialiser because pdf-lib does not have to
  rewrite 5–25 MiB.

### Integration with open PRs (not depended upon)

- **#783 (digital signatures):** after an incremental save, its
  `wijzigingen.rs` classifier can report "additions only" for annotation/form
  changes. Once that is merged, the existing pre-save signature warning
  (`bevestigOpslaanMetHandtekeningen`) can be skipped when the plan is
  eligible and DocMDP allows the change. This prototype keeps the warning:
  preserved bytes do not mean the signature still validates for the new
  revision (DocMDP/FieldMDP semantics, viewer policy, LTV).
- **#773 (document security):** encrypted write-back re-encrypts the whole file
  in Rust. Incremental saving of encrypted files needs the new objects
  encrypted with the file key (and an unchanged `/Encrypt`), which belongs in
  `open-pdf-security`. Until then encrypted inputs are refused.

## 4. Design

1. **Load.** With the preference on, `PDFDocument.load(bytes, { updateMetadata: false })`.
2. **Prepare** (`bereidIncrementeelVoor`): read and validate the xref chain; refuse
   encrypted, malformed, or `/Root`/`/Info` mismatches; snapshot every object
   that the chain lists (dict string, or stream dict + content identity); raise
   the object counter above the chain; read signature state (`/Perms /DocMDP`,
   `/SigFlags`, signature fields, FieldMDP locks); refuse DocMDP `P=1`. Then
   `updateInfoDict()` is called, so `/Info` (Producer, ModDate) is updated
   exactly as before and shows up as a change. This step never throws.
3. **Edit.** The normal saver runs unchanged. In incremental mode, a rebuilt
   outline that is equal to the old one is replaced by the old reference.
4. **Classify** (`kiesObjecten`): walk the document from the trailer and tag
   every indirect object with the zones it hangs under (catalog, info, page
   tree, content, annotation, form, layers, other). `/P` of annotations and
   references back into pages from elsewhere do not leak zones. An existing
   object that changed is allowed only if it is the catalog with changes in
   `/AcroForm`/`/OCProperties` only, a page with changes in `/Annots` only, or
   any other object that hangs *only* under annotation/form/layers/info zones
   (and is not a font, signature, or page tree node). New objects must have a
   number not used by the chain. DocMDP and FieldMDP rules apply on top.
5. **Write** (`schrijfToevoeging`): original bytes + newline if needed + objects
   + xref section (stream if the newest source section is a stream, else a
   classic table) + trailer (`/Size`, `/Root`, `/Info`, `/ID` copied, `/Prev`)
   + `startxref` + `%%EOF`.
6. **Self-check** (`controleerToevoeging`): the prefix is byte-identical, the chain
   is exactly one section longer, `/Size` did not shrink, `/Root` is the same,
   and every new object is where the new xref says. Any failure falls back.
7. **Publish** through the unchanged path: `stillCurrent()` checks,
   unlock, `writeBinaryFileAtomic`, lock, Rust cache invalidation,
   `setCachedPdfBytes(savedBytes)`, `markDocumentSaved`. The next save
   appends to these bytes.

### What is retained

- **Atomic publication:** the whole file (prefix + update) is still written
  through `writeBinaryFileAtomic`; tested that no non-atomic write is used.
- **Conflict detection:** the same `stillCurrent()` checks and per-document save
  serialisation (#345); tested that a document change during save writes nothing.
- **Undo:** the model is not touched by the incremental path; tested that the
  model is unchanged and that a later save after removing an annotation
  (as undo would) appends another revision.
- **Revision/cache consistency:** the byte cache receives exactly the written
  bytes; text edits/OCR (which trigger `reloadFromBytes`) always take the full
  path, so the reload logic is unchanged.

## 5. Sensitive data and signatures

- Incremental updates leave every earlier revision in the file. Deleting an
  annotation incrementally hides it in the current revision only; the
  preference hint says so. A test demonstrates the deleted text is still in
  the bytes.
- Redaction and hidden-information removal therefore **never** use the append
  path: redaction annotations force a full rewrite in the saver, and the #646
  sanitiser (`removeHiddenInformation`) is a separate full rewrite that drops
  prior revisions. A test sanitises an incrementally saved file and checks the
  secret is gone, the output has one xref section and does not start with the
  source bytes.
- Note: an applied redaction in this app is currently an opaque box
  annotation; the underlying content is not removed by either path. That is a
  separate gap and not changed here.
- Signed/certified inputs are detected; see the matrix for DocMDP/FieldMDP.
  Bytes covered by an existing signature stay intact, but whether a validator
  accepts the new revision depends on its DocMDP/FieldMDP evaluation and is
  not verified here.

## 6. Benchmarks

Local measurement, not asserted in CI (`node scripts/meet-incrementeel-opslaan.mjs --keer=5`,
Node 24.19, AMD Ryzen 7 3700U, 8 threads). Each run: page 1 as the real
loader builds the model, plus one new rectangle; bookmarks as the loader reads
them; median of 5 saves of `savePDF` (load, model, serialise, no disk I/O).

| File | Source | Annots p.1 | Full: size | Full: time | Incremental: size (appended) | Incremental: time | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Barn Relocation ... for Permit.pdf | 25.53 MiB | 1 | 25.50 MiB | 279 ms | 25.53 MiB (+2.6 KiB) | 227 ms | incremental |
| 2885 Demo project.pdf | 37.68 MiB | 0 | 37.62 MiB | 240 ms | 37.62 MiB | 273 ms | full (catalog changed: Outlines) |
| 3131-CLT-Set.pdf | 1.42 MiB | 0 | 1.41 MiB | 33 ms | 1.41 MiB | 50 ms | full (catalog changed: Outlines) |
| Combinatie Raster, vector, tekening images.pdf | 682.8 KiB | 0 | 681.5 KiB | 12 ms | 684.3 KiB (+1.5 KiB) | 12 ms | incremental |
| NKD1a_opm_aw.pdf | 23.68 MiB | 0 | 23.69 MiB | 261 ms | 23.68 MiB (+1.1 KiB) | 180 ms | incremental |
| NKE2D2_opm_aw.pdf | 5.66 MiB | 1 | 5.66 MiB | 110 ms | 5.66 MiB (+1.8 KiB) | 91 ms | incremental |
| Technische tekening.pdf | 1.01 MiB | 9 | 990.9 KiB | 40 ms | 1.02 MiB (+10.9 KiB) | 40 ms | incremental |
| Tekst.pdf | 154.6 KiB | 0 | 89.1 KiB | 37 ms | 155.8 KiB (+1.2 KiB) | 43 ms | incremental |
| Text pdf gecombineerd.pdf | 1.59 MiB | 0 | 1.59 MiB | 100 ms | 1.59 MiB (+1.5 KiB) | 114 ms | incremental |
| Zware vector PDF.pdf | 17.07 MiB | 0 | 17.07 MiB | 210 ms | 17.07 MiB (+2.4 KiB) | 151 ms | incremental |
| rapport-constructie.pdf | 1.59 MiB | 0 | 1.59 MiB | 103 ms | 1.59 MiB (+1.5 KiB) | 122 ms | incremental |
| A2 - alle objecten.pdf | 18.3 KiB | 54 | 43.49 MiB | 2920 ms | 43.49 MiB | 3034 ms | full (redaction present) |
| tekstrotatie-extern.pdf | 6.8 KiB | 4 | 7.8 KiB | 9 ms | 13.3 KiB (+6.5 KiB) | 8 ms | incremental |
| tekstrotatie-referentie.pdf | 3.2 KiB | 5 | 3.8 KiB | 8 ms | 10.0 KiB (+6.7 KiB) | 8 ms | incremental |

Planner breakdown (separate probe): on a 25.5 MiB file with 259 objects the
chain read, snapshot, classification, writer and self-check take ~2 + 8 + 8 + 19
+ 19 ms against ~90 ms for `pdfDocLib.save()`; on a 1.6 MiB file with 1,791
objects ~2 + 22 + 54 + 1 + 2 ms against ~40–80 ms. Loading into pdf-lib
(70–170 ms) is the same for both paths and dominates.

Interpretation:

- **Latency:** no material gain. Large files save 17–31 % faster, small and
  object-rich files up to ~20 % slower (the diff compares every object). The
  whole file is still written to disk atomically, so disk I/O is unchanged.
- **Size:** the appended section is 1–11 KiB here, but the output is never
  smaller than the source; a full rewrite can compact (Tekst.pdf: 89 KiB
  rewritten vs 156 KiB incremental). Repeated incremental saves grow the file
  by every rebuilt annotation of the loaded pages each time, because the
  saver rebuilds all of them on every save.
- **Main benefit:** byte-for-byte preservation of earlier revisions (existing
  signatures cover unchanged bytes, external diff/sync tools see an append,
  untouched objects are not re-encoded by pdf-lib).
- The 43 MiB output for "A2 - alle objecten.pdf" is produced by the existing
  full-rewrite path in the node harness (source 18 KiB, 54 annotations); it is
  unrelated to this change and worth a separate look.

## 7. Test coverage (acceptance criteria)

| Criterion | Evidence |
|---|---|
| Capability matrix | Section 2 |
| Original byte prefix unchanged | `begintMet` in every positive test; self-check in the writer |
| Valid xref/trailer chain (`/Prev`, `/Size`, xref stream when the source uses one, hybrid) | Chain re-read with offset validation; MuPDF `wasRepaired() === false` and `countVersions()` +1; sources: hand-made table, xref stream, xref stream with PNG predictor, hybrid `/XRefStm`, pdf-lib with/without object streams, MuPDF object streams, MuPDF incremental revision |
| Repeated save/reopen in independent readers | 4 rounds in isolation, 3 rounds through the real saver and loader; pdf.js and MuPDF read every round; `qpdf --check` runs when qpdf is installed (it was not on the development machine) |
| Encrypted inputs | Refused (`versleuteld`); through the saver nothing is written (pdf-lib cannot load it, unchanged behaviour) |
| Prior incremental revisions | MuPDF-written revision and own chains |
| Object streams | Source objects in object streams; new numbers above object/xref stream numbers |
| Malformed input | Wrong `startxref`, missing `startxref`, shifted objects, `/Prev` loop: refused; the full rewrite repairs |
| Atomic publication, conflict detection, undo, cache consistency | Real-saver tests (section 4) |
| Never append for redaction/sanitisation (#646) | Redaction forces full rewrite; sanitiser output has no prior revision; sanitiser does not import the writer |
| Signed/certified inputs | DocMDP P=1/2/3, FieldMDP Include/All, signature dict change |
| Benchmarks and adoption criteria | Sections 6 and 8 |

## 8. Adoption criteria before enabling by default

1. Per-annotation dirty tracking in the saver, so unchanged annotations keep
   their objects (smaller updates; makes DocMDP `P=2` files with existing
   comments eligible).
2. Signature flow: with #783 merged, verify after an incremental save that
   existing signatures still validate and that its change classifier reports
   "additions only"; then skip the pre-save warning for eligible plans.
3. Run the planner in "shadow mode" (plan + self-check without writing) over a
   larger corpus of real-world PDFs, including files from other producers,
   linearized files and files with free-list reuse; zero self-check failures
   and zero `wasRepaired()` outputs from MuPDF and pdf.js.
4. `qpdf --check` in CI (or an equivalent strict checker) for the incremental
   tests.
5. A UI indication of the save mode and an explicit "Save as full rewrite"
   (compact) command, since the file only grows.
6. Encrypted incremental saves via `open-pdf-security` (#773), or keep them refused.
7. Manual check in the packaged app on Windows, macOS and Linux: save, reopen,
   save-and-continue (#345), closing with unsaved changes, recovery snapshots.

## 9. Not verified without running the app

- The preference checkbox in the Preferences dialog (rendering, persistence).
- The packaged app's atomic write, file locking and Rust cache invalidation
  with incremental bytes (tested with stubs only).
- Interaction with the signature verification panel after an incremental save
  of a really signed file (only synthetic signature dictionaries are tested).
- Real-world files from other producers beyond the repo's test PDFs.
