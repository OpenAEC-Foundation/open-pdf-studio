# PDF to IFCX (beta): design proposal

Issue: #876. Status: **beta**. The export is under *File > Export > Export to IFCX (Beta)*
and in the MCP tool `app_export_ifcx`.

This document is the proposal the issue asks for: the IFCX structure we write, how
each part of a PDF maps onto it, the coordinate conventions, what is lost, and the
questions that need a decision from the product owner before the export leaves beta.
The code lives in `open-pdf-studio/js/pdf/`:

| File | Role |
|------|------|
| `ifcx-inhoud.js` | Reads one page: paths, text runs, image placements, PDF layers (pdf-lib, pure) |
| `ifcx-afbeelding.js` | Image XObject to JPEG / JPEG 2000 / PNG, or a reason why not |
| `ifcx-document.js` | The IFCX writer, the schemas of the own attributes and a structure validator |
| `ifcx-export.js` | App glue: byte cache, measurement scale, save dialog, writing |
| `ifcx-opdracht.js` | Arguments and answer of the MCP tool |
| `IfcxExportDialog.jsx` | The options dialog |

## Target format and validation

* **IFCX alpha** (`"ifcxVersion": "ifcx_alpha"`), the JSON serialisation of IFC5 as
  published by buildingSMART in the IFC5 development repository. The format is not
  final; this is the main reason the export is a beta.
* Two schema imports by URI:
  `https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx` (classes,
  `bsi::ifc::class`, `bsi::ifc::presentation::diffuseColor`) and
  `https://ifcx.dev/@openusd.org/usd@v1.ifcx` (`usd::xformop`,
  `usd::usdgeom::basiscurves`, `usd::usdgeom::mesh`, `usd::usdgeom::visibility`).
* Everything PDF-specific uses its own namespace `opds::pdf::*`, declared in the
  `schemas` block of every file, so a reader can check it without fetching anything.
* Validation in this beta: `valideerIfcx()` in `ifcx-document.js`, run by the unit tests
  on every generated file. It checks the header fields, the import list, unique node
  paths, that every `children` and `inherits` target exists, that there are no
  cycles, and that every attribute is from an imported namespace or matches its
  declared schema. Validation against the official IFCX JSON schema and loading in
  the buildingSMART viewer are open question 1.

### Consistency with the existing `.ifcreport`

`ifc-export.js` (ribbon *IFC report*) is unchanged. It remains a report *next to* the
PDF: the PDF as base64 plus one entity per annotation. The IFCX export is a
*conversion* of the PDF content. Both share the annotation mapping:
`ifc-entity.js` (`ifcEntityFor`) gives the IFC class, name and properties of an
annotation, so a wall is `IfcWall` in both files, a steel profile `IfcMember` with its
profile name, and so on. The report header fields (generator, created, source file,
units) reappear as `opds::pdf::document` on the root node.

## Document structure

```json
{
  "header":  { "id": "opds-ifcx-<root path>", "ifcxVersion": "ifcx_alpha",
               "dataVersion": "0.1.0", "author": "Open PDF Studio", "timestamp": "<ISO 8601>" },
  "imports": [ { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" },
               { "uri": "https://ifcx.dev/@openusd.org/usd@v1.ifcx" } ],
  "schemas": { "opds::pdf::document": { "uri": "…", "value": { "dataType": "Object", … } }, … },
  "data":    [ { "path": "<uuid>", "children": { "<name>": "<uuid>" },
                 "inherits": { "<name>": "<uuid>" }, "attributes": { … } }, … ]
}
```

Node tree (names are the keys in `children`):

```
<root>                      IfcProject, opds::pdf::document
├── sheet-001               opds::pdf::sheet, usd::xformop (scale + placement), sheet frame
│   ├── drawing             opds::pdf::layer kind=drawing
│   │   ├── pdf-layer-001   one group per PDF layer (only when the page has layers)
│   │   │   ├── path-000001 usd::usdgeom::basiscurves  (inherits a style node)
│   │   │   └── fill-000002 usd::usdgeom::mesh         (inherits a style node)
│   ├── text                opds::pdf::layer kind=text
│   │   └── text-000001     opds::pdf::text, usd::xformop
│   ├── raster              opds::pdf::layer kind=raster
│   │   └── image-0001      opds::pdf::placement, quad mesh (inherits the image node)
│   └── annotations         opds::pdf::layer kind=annotations
│       ├── layer-001       one group per annotation layer of the app (when there are several)
│       │   └── annotation-00001   bsi::ifc::class, opds::pdf::annotation, geometry
└── sheet-002 …
```

Nodes outside the tree, referenced through `inherits`:

* **style nodes**: one per distinct stroke/fill style (`bsi::ifc::class` IfcAnnotation,
  `bsi::ifc::presentation::diffuseColor`, `opds::pdf::style`). A CAD sheet with 50 000
  lines in six pens writes six style nodes, not 50 000 copies.
* **image nodes**: one per image XObject (`opds::pdf::image` with the data). A logo
  used on every page is stored once.

Paths are UUID-formatted: a random prefix per export plus a counter, so they are
unique without generating a UUID per node. Child names (`sheet-001`, `path-000001`)
are stable and sortable; the real page label lives in the attributes.

A complete small example (one page, scale 1:100, one line, one text, one measurement;
the `schemas` block shortened):

```json
{
 "header": { "id": "opds-ifcx-3f2a9c1e-7b4d-40a5-8000-000000000001", "ifcxVersion": "ifcx_alpha",
             "dataVersion": "0.1.0", "author": "Open PDF Studio", "timestamp": "2026-10-31T12:00:00.000Z" },
 "imports": [ { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" },
              { "uri": "https://ifcx.dev/@openusd.org/usd@v1.ifcx" } ],
 "schemas": { "…": "the 8 opds::pdf:: schemas" },
 "data": [
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000002",
    "attributes": { "bsi::ifc::class": { "code": "IfcAnnotation", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcAnnotation" },
                    "opds::pdf::style": { "stroke": [1, 0, 0], "lineWidth": 0.000706, "dashed": false },
                    "bsi::ifc::presentation::diffuseColor": [1, 0, 0] } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000003",
    "inherits": { "style": "3f2a9c1e-7b4d-40a5-8000-000000000002" },
    "attributes": { "usd::usdgeom::basiscurves": { "points": [[0.003528, 0.007056, 0], [0.038806, 0.007056, 0]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000004",
    "children": { "path-000001": "3f2a9c1e-7b4d-40a5-8000-000000000003" },
    "attributes": { "opds::pdf::layer": { "kind": "drawing", "name": "Drawing", "source": "pdf-content" } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000005",
    "attributes": { "bsi::ifc::class": { "code": "IfcAnnotation", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcAnnotation" },
                    "bsi::ifc::presentation::diffuseColor": [0, 0, 0] } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000006",
    "inherits": { "style": "3f2a9c1e-7b4d-40a5-8000-000000000005" },
    "attributes": { "opds::pdf::text": { "value": "A-101", "fontSize": 0.004233, "font": "Helvetica", "rotation": 0 },
                    "usd::xformop": { "transform": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0.007056, 0.088194, 0, 1]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000007",
    "children": { "text-000001": "3f2a9c1e-7b4d-40a5-8000-000000000006" },
    "attributes": { "opds::pdf::layer": { "kind": "text", "name": "Text", "source": "pdf-content" } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000008",
    "attributes": { "bsi::ifc::class": { "code": "IfcAnnotation", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcAnnotation" },
                    "opds::pdf::annotation": { "id": "m1", "type": "measureDistance", "author": "Ann",
                                               "measure": { "value": 2540, "unit": "mm", "text": "2540 mm" },
                                               "properties": { "measureText": "2540 mm" } },
                    "usd::usdgeom::basiscurves": { "points": [[0.003528, 0.070556, 0], [0.028928, 0.070556, 0]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000009",
    "children": { "annotation-00001": "3f2a9c1e-7b4d-40a5-8000-000000000008" },
    "attributes": { "opds::pdf::layer": { "kind": "annotations", "name": "Annotations", "source": "app-annotations" } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-00000000000a",
    "children": { "drawing": "3f2a9c1e-7b4d-40a5-8000-000000000004",
                  "text": "3f2a9c1e-7b4d-40a5-8000-000000000007",
                  "annotations": "3f2a9c1e-7b4d-40a5-8000-000000000009" },
    "attributes": {
      "opds::pdf::sheet": { "pageNumber": 1, "label": "A-101", "widthPt": 400, "heightPt": 300, "rotation": 0,
                            "cropBox": [0, 0, 400, 300], "scaleDenominator": 100, "scale": "1:100", "origin": [0, 0, 0],
                            "counts": { "paths": 1, "texts": 1, "images": 0, "annotations": 1 },
                            "skipped": { "inlineImages": 0, "shadings": 0, "invisibleText": 0, "undecodableText": 0, "nestedForms": 0 } },
      "usd::xformop": { "transform": [[100, 0, 0, 0], [0, 100, 0, 0], [0, 0, 100, 0], [0, 0, 0, 1]] },
      "usd::usdgeom::basiscurves": { "points": [[0, 0, 0], [0.141111, 0, 0], [0.141111, 0.105833, 0], [0, 0.105833, 0], [0, 0, 0]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000001",
    "children": { "sheet-001": "3f2a9c1e-7b4d-40a5-8000-00000000000a" },
    "attributes": { "bsi::ifc::class": { "code": "IfcProject", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcProject" },
                    "opds::pdf::document": { "fileName": "plan.pdf", "pageCount": 1, "exportedPages": [1],
                                             "generator": "open-pdf-studio", "created": "2026-10-31T12:00:00.000Z",
                                             "units": "m", "beta": true } } }
 ]
}
```

### Own attributes

| Attribute | On | Fields |
|-----------|----|--------|
| `opds::pdf::document` | root | fileName, pageCount, exportedPages, generator, created, units (`m`), beta |
| `opds::pdf::sheet` | sheet | pageNumber, label, widthPt, heightPt, rotation, cropBox, scaleDenominator, scale, origin, counts, truncated, skipped |
| `opds::pdf::layer` | layer / group | kind (`drawing`, `text`, `raster`, `annotations`), name, source (`pdf-content`, `pdf-ocg`, `app-annotations`, `annotation-layer`) |
| `opds::pdf::style` | style node | stroke `[r,g,b]`, fill `[r,g,b]`, lineWidth (m paper), dashed, fillRule |
| `opds::pdf::text` | text run | value, fontSize (m paper), font, rotation (degrees) |
| `opds::pdf::image` | image node | mimeType, widthPx, heightPx, encoding, data, byteLength, omitted |
| `opds::pdf::placement` | image placement | matrix `[a,b,c,d,e,f]`: the unit square of the image to sheet metres |
| `opds::pdf::annotation` | annotation | id, type, name, subject, author, text, layer, createdAt, modifiedAt, color, lineWidth, measure, replies, properties |

## Mapping

| PDF / app | IFCX |
|-----------|------|
| Page | sheet node: `opds::pdf::sheet`, frame as `basiscurves`, `usd::xformop` with the scale |
| Page label (`/PageLabels`) | `opds::pdf::sheet.label` |
| `/Rotate`, CropBox | applied to all geometry; recorded as `rotation`, `cropBox` |
| Measurement scale of the app | `scaleDenominator`, `scale`, and the scale in the sheet transform |
| Stroked path (`S`, `s`, `B`…) | one `basiscurves` node per subpath, curves flattened |
| Filled path (`f`, `f*`, `B`…) | one `mesh` node, one face per subpath, fill rule in the style |
| Stroke / fill colour, line width, dash | style node (`diffuseColor`, `opds::pdf::style`) |
| Text show operators (`Tj`, `TJ`, `'`, `"`) | one `opds::pdf::text` node per run, merged along the baseline |
| Image XObject | image node (data once) + placement node per use |
| Form XObject | followed with its `/Matrix` (max. 12 levels) |
| Optional content (`/OC` marked content, `/OC` on a form or image) | group node per PDF layer, `visibility: invisible` when off in the default view |
| App annotation | `bsi::ifc::class` from `ifcEntityFor`, `opds::pdf::annotation`, geometry |
| App annotation layer | group node in the annotations layer, with its visibility |

### Sheets

One node per exported page, in the `children` of the root under `sheet-NNN` (page
number). The sheet carries its paper size in points as shown (after `/Rotate`), the
CropBox in unrotated PDF user space, its rotation, the page label and, when the app
knows one, the measurement scale (`meetschaalOp`, the same lookup the DXF export
uses: scale regions, scale bars, calibration). The sheet outline is written as a
closed `basiscurves` so a viewer shows the paper edge.

### Vector data

Paths are read straight from the content streams with the same tokenizer the text
editor uses (`iterContentTokens` in `js/text/content-stream-text.js`, now also as a
generator so a heavy page is never held as one token array). The interpreter follows
`q`/`Q`, `cm`, colour operators (gray, RGB, CMYK converted to RGB, patterns become
"no colour"), `w`, `d`, the path operators `m l c v y h re` and the painting operators.
Curves are flattened in sheet space: one segment per 2 pt of control polygon,
2 to 48 segments per curve. Points are written in metres of paper.

Why polylines and not native curves: the alpha `basiscurves` of the USD schema has
no portable way to mix lines and Béziers in one curve, and every IFCX reader can draw
a polyline. Native curve data is open question 4.

Fills become `usd::usdgeom::mesh` nodes with one n-gon face per closed subpath; the
fill rule is kept in `opds::pdf::style.fillRule` so a reader can redo holes.

### Text

Text runs come from the same pass. Fonts are decoded with the existing font tables
(`buildFontInfos` in `saver/text-edit-inplace.js`: ToUnicode, simple encodings,
Type0 Identity with ToUnicode), glyph widths advance the position, and consecutive
show operators on one baseline with the same font, size and colour are merged into
one run (with a space for a gap). A run is a node with `opds::pdf::text` (string,
font size and font name) and a `usd::xformop` that puts its origin on the start of
the baseline and turns it with the text. Invisible text (render mode 3, OCR layers)
and text without a usable encoding are left out and counted in `skipped`.

### Raster

**Choice: embedded as base64**, not as sidecar files. One file is what users mail
and what the existing `.ifcreport` already does (it embeds the PDF as base64); an
IFCX without its images would silently lose content when copied alone. The cost is
size (base64 adds a third), which the limits below keep in check.

* JPEG (`DCTDecode`) and JPEG 2000 (`JPXDecode`) pass through unchanged.
* Flate/LZW/RunLength/ASCII-encoded samples in gray, RGB, CMYK (converted) and indexed
  colour at 1, 2, 4 or 8 bits become PNG; PNG predictors are undone.
* CCITT, JBIG2, a TIFF predictor, 16-bit samples, stencil masks and unknown colour
  spaces keep their placement with `data` absent and `omitted` set to the reason.
* A scanned page is simply a sheet with one image placement covering it.
* The image is stored once per XObject; each use is a placement node that inherits
  it, with `opds::pdf::placement.matrix` (the PDF image matrix in sheet metres) and a
  quad mesh of its corners so a viewer can show where it is.

Limits: an image over 40 megapixels is not decoded; one encoded image over 16 MB or
more than 96 MB of images in total keeps only its placement (`imageTooLarge`,
`rasterBudget`). Soft masks (transparency) are not applied.

### Annotations

All annotations of the app (markups, comments with their replies, measurements with
value, unit and text, stamps, drafting components) go to the sheet's `annotations`
layer, never into the drawing, text or raster layers, so a reader can switch them off
as one group. Each annotation node gets:

* `bsi::ifc::class` from the existing `.ifcreport` mapping (`ifc-entity.js`): walls
  `IfcWall`, floor systems `IfcSlab`, steel profiles `IfcMember`, spaces `IfcSpace`,
  grids `IfcGrid`, symbols their IFC category, the rest `IfcAnnotation`;
* `opds::pdf::annotation` with id, type, author, text, replies, measure and the
  properties of that same mapping (wall thickness, template and parameters, profile);
* geometry on the sheet: polyline for points/paths, a line for start/end, a closed
  outline (turned with the annotation) for boxes and stamps, an ellipse for circles,
  or only a position (`usd::xformop`) for a comment icon.

When the document has several annotation layers (#468), each becomes a group node in
the annotations layer with the layer name and its visibility.

## Coordinates and units

* Geometry is written in **metres of paper**: 1 pt = 0.0254 / 72 m, rounded to
  1e-6 m (one micrometre of paper).
* Sheet space: origin at the lower left of the page **as shown** (CropBox, `/Rotate`
  applied), x to the right, y up, z = 0. The interpreter starts with that display
  matrix, so all content is already on the sheet.
* App annotations are stored top-left with y down; they are flipped with the shown
  page height.
* **Scale**: the sheet's `usd::xformop` scales its content by N for a scale 1:N, so in
  the composed model a line is its real length in metres. Without a known scale the
  factor is 1 (paper size). Children never contain the scale themselves, so a reader
  that wants paper coordinates reads the child geometry directly.
* Sheets are laid out side by side along x (`opds::pdf::sheet.origin`), each after the
  previous sheet's scaled width plus 5 cm, so a viewer shows them next to each other.
* `usd::xformop.transform` is a 4x4 matrix in row-vector form with the translation
  in the last row, as in the IFC5 examples.

## Limits and memory

* Pages are read and written **one at a time**; a page's nodes are serialised as soon
  as the page is done. Peak memory is the output text plus one page of geometry.
* Per page at most **50 000 paths** (stroked subpaths plus fills), 20 000 text runs and
  500 image placements. Past the cap the interpreter only counts. The sheet records
  `truncated: { paths: <total> }` and the dialog and MCP answer say
  "page N: K of T paths exported". The MCP tool can raise the limit
  (`maxPathsPerPage`).
* The export yields to the interface between pages and can be cancelled by closing
  the dialog.

## Lossy

What the beta does not carry over:

* **Clipping paths** are ignored: content a PDF clips away (for example outside a
  viewport) appears in full.
* Curves become polylines; dash patterns are reduced to `dashed: true/false`; line
  caps, joins and miter limits are dropped.
* Even-odd and non-zero holes are not cut into the fill meshes (the rule is kept).
* Transparency (`/CA`, `/ca`, soft masks), blend modes, shadings (`sh`), patterns and
  inline images (`BI … EI`) are left out; shadings and inline images are counted.
* Text: glyph shapes, character spacing within a run, and text in fonts without a
  Unicode mapping. Text is placed at its baseline start, not justified.
* Images in CCITT/JBIG2/16-bit and stencil masks: placement only.
* Page content comes from the **last saved** state of the PDF (the byte cache); unsaved
  edits to page content are not in the export, annotations always are.
* Links, form fields, bookmarks and attachments are not exported.

## Round trip

Export only in the beta. Reading an IFCX back as a PDF overlay is possible later
(the sheet, layers and annotation ids are all there), but needs a decision on which
of the lossy parts must survive (open question 6).

## Open questions for the product owner

1. **Validation**: which reference do we test against: the IFCX JSON schema of
   buildingSMART, the IFC5 viewer, or both? Should CI load the file in a reference
   implementation?
2. **Sheet class**: IFC5 has no sheet concept yet. Keep the sheet as an unclassed
   node with `opds::pdf::sheet`, or classify it (for example as `IfcAnnotation` or a
   document reference)? Same question for the root (`IfcProject` now).
3. **Placement of sheets**: side by side along x (now), all at the origin (real-world
   coordinates of different storeys overlap), or at a georeference when the PDF has
   one (`/VP` with `/Measure /GEO`)?
4. **Curves**: polylines only (now), or also write native Bézier data in an own
   attribute for readers that can use it?
5. **Images**: base64 in the file (now) or sidecar files next to the `.ifcx`? What are
   acceptable size limits for a heavy scan set?
6. **Round trip**: should Open PDF Studio read IFCX back, and which parts must then
   survive (annotations only, or also the drawing)?
7. **Own namespace**: is `opds::pdf::*` the right prefix, and where should its schema
   URIs point (now this document)?
8. **Clipping**: apply clip paths (cut the geometry) or keep the full geometry and
   write the clip region as its own node?
9. **Path cap**: is 50 000 paths per page the right default, and should a cap
   simplify geometry (merge collinear segments, drop tiny segments) instead of cutting?
