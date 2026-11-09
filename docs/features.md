# Features

The full list of what Open PDF Studio does. The [README](../README.md) gives the
overview; this page has the detail. Features marked *desktop* need the desktop
app and are not available in the [browser version](https://open-pdf-studio.open-aec.com/)
(the list of those is in `open-pdf-studio/js/core/webfuncties.js`).

## Annotations and markup

- **Text markup:** highlight, underline, strikethrough.
- **Shapes:** rectangle, ellipse, polygon, cloud, cloud polyline, line, arrow, polyline.
- **Hatch fill patterns** for shape fills: cross-hatch, diagonal, dots and more.
- **Freehand drawing:** pen tool with configurable colour, width and opacity.
- **Text annotations:** text box, callout with leader line, sticky notes with popup editing.
- **Stamps:** built-in stamps (Approved, Rejected, Draft, Confidential, Final and more)
  and dynamic stamps that fill in the date and the user.
- **Images:** insert from a file, paste from the clipboard or drag and drop, with
  non-destructive cropping.
- **Signatures:** draw multi-stroke signatures and keep them for reuse.
- **Redaction:** mark areas and apply them to remove the text, images, vector
  graphics, annotations and form fields under them from the file. Saving then
  rewrites the whole file without earlier versions.

## Measurement

- Distance, area, perimeter and angle measurement.
- Scale calibration with mm, cm, m, inches, feet and points.
- A drawing that carries its own measuring scale (a PDF viewport with a measure
  dictionary, as CAD plots and the DWG/DXF import write it) is measured to scale
  right away, without calibrating.
- Per-line scale override, with fallback to the document scale.
- Quick scale: right-click a dimension line and type a value (for example `12.3m`)
  to recalibrate.
- Draggable dimension text and end points with live recalculation.
- Object snapping to end points, midpoints, centres and edges, and angle snapping.

## CAD drawings (DWG and DXF) — *desktop*

- **Import** a DWG or DXF through File > Import, Open, or drag and drop.
- Choose layers, model space or a layout with viewports, area, scale, paper,
  orientation, margins and placement.
- Appearance: colours as in the file, all black, greyscale, black and white or a
  single colour; lineweights from the file, a colour table or a fixed width;
  linetypes, hatch patterns, dimensions, attributes and points.
- External references and images are loaded from the drawing's folder or from
  search paths you pick.
- A live preview renders with the real converter.
- The result is a **vector PDF**: CAD layers become PDF layers and every viewport
  carries its own measuring scale, so measuring is correct right away.
- Target: a new document, a new page, or an **underlay** on the current page, as
  vector or image, to scale, below the existing content.
- **Export** a page back to DXF or DWG with the PDF layers as CAD layers, at real
  size according to the measuring scale, with your markups on their own layers,
  and optionally in the drawing's original model coordinates.

## AI connection (MCP) — *desktop*

- The app has a built-in MCP server. It is on for a new installation and can be
  switched off under Settings > General. It listens on `127.0.0.1` only.
- 94 public tools (`mcp-stdio/tools.json`): open and save documents, navigate,
  create and edit annotations, set the measuring scale, take off quantities and
  place schedules, import and export CAD, print to a PDF file, and more.
- `open-pdf-studio.mcpb`, attached to every release, installs the connection in
  MCP clients that support `.mcpb` bundles. `mcp-stdio/` is a small stdio bridge
  for other clients; see [mcp-stdio/README.md](../mcp-stdio/README.md).
- A small indicator in the status bar shows the connection: grey when the server
  is off, an open dot when it is on and idle, green while an assistant was active
  in the last 30 seconds, with a short highlight on every tool call. Its tooltip
  names the port and the last tool.
- A Python library drives the same tools: [docs/python-library.md](python-library.md).

## Text recognition (OCR) — *desktop*

- Make scanned pages searchable and selectable with an invisible text layer.
- Current page or the whole document, with automatic language detection or a
  chosen language.
- The Android build ships without OCR.

## Digital signatures — *desktop*

- A bar above the page shows, per signature, whether it is valid, whether the
  certificate is trusted, and whether the document changed after signing.
- A detail dialog shows the certificate chain and the timestamp; "show the signed
  version" opens the document as it was when signed.
- Reads PKCS#12 and validates against the system certificate store.

## PDF compare

- Compare two PDF revisions in a compare tab, without leaving your workspace.
- Side by side, overlay and split-line modes with synchronised scrolling, panning
  and zoom.
- Automatic change detection classifies differences as added, removed or modified.
- A change list with counts; click a change to jump to it. A compare report can
  be exported.
- Manual alignment offset (dx, dy, rotation, scale) for drawings that shifted
  between revisions, and automatic alignment.
- Page-pair navigation for multi-page documents.

## Symbol palettes

- Symbol libraries to place on the page, for repetitive markup.
- Built-in libraries, including Dutch (NL) construction, electrical, sanitary and
  kitchen sets, the NEN 1414 safety sets and a GD&T and machining set; more
  collections can be downloaded online.
- A symbol scale for placing, searchable and collapsible categories, groups to
  switch on or off.
- Custom symbol groups saved with your preferences.
- Dockable to either side of the canvas or floating.

## Quantities and counting

- Count tool with named tally categories for counting objects on a drawing.
- A live quantities schedule that adds up counts, lengths and areas, with
  grouping, sorting, filtering, subtotals and grand totals.
- Configurable columns, formatting and table appearance.
- Place the schedule back on the page as a table, or export it as CSV or PDF.
- Round trip of tags: a saved schedule exports with an ID column; edit the
  label, IFC category, location or count category in a spreadsheet and import
  the CSV to update the markups (one undo step).

## Screenshot and cropping

- Capture a full page or a selected region as an image; copy it or save it.
- Auto-detect and trim white space around page content.

## Text editing

- Edit existing PDF text inline.
- Add new text with font, size and colour.

## Page management

- Insert blank pages (standard or custom sizes) or pages from another file.
- Delete, extract, split and replace pages.
- **Edit Pages**: a page organiser with thumbnails to reorder, rotate, delete and
  insert pages; nothing changes until you apply.
- **Straighten** a skewed scan by drawing a line along something that should be level.
- **Shift page content** by dragging the preview or typing an offset in
  millimetres, for one page, all pages, or the odd or even pages from a chosen page.
- Merge several PDFs into one.
- Page rotation (90, 180, 270 degrees).

## Watermarks, headers and footers

- Text and image watermarks with opacity, rotation and position.
- Headers and footers with variables (`{page}`, `{pages}`, `{date}`, `{time}`, `{filename}`).
- Apply to all pages or to page ranges.

## Forms

- Fill interactive PDF forms (AcroForm and XFA).
- Create text fields, check boxes and radio buttons.
- JavaScript validation.

## Printing — *desktop*

- A print dialog with live preview that shows the sheet, its orientation and the
  resulting scale.
- **Save as PDF** at the top of the printer list writes the print as vector with
  the sheet in the chosen orientation.
- Paper and orientation follow the document; large and extended sheets (A1, A0,
  A3 extended up to A0 extended) are supported.
- Print to scale (1:1 on the sheet), fit, shrink or a custom percentage, within
  the printable area.
- A page perpendicular to the sheet is turned a quarter so that it fills the sheet.
- Page range, odd or even pages, reverse order, copies and collation.
- Print the document only, the markups only, or both; print as image.
- Virtual printer installation on Windows.

## Export

- Pages as PNG or JPEG (72, 150, 300 or 600 DPI).
- Raster PDF, and a flattened copy for sharing.
- Annotations as XFDF (import and export) and as BCF 2.1 issues (import and export).
- PDF/A validation and saving as PDF/A ([docs/pdfa.md](pdfa.md)), PDF/X export.
- Text and tables to DOCX, ODT and XLSX.
- IFCX export, beta ([docs/ifcx-export.md](ifcx-export.md)).

## Find and search

- Text search with match case and whole word options.
- Search the **page text, the annotations, or both** (text boxes, callouts, sticky
  notes, stamp text and measurement labels).
- A result list under the search bar shows the hits per page and jumps to them.
- All matches highlighted with a count; F3 goes to the next one.

## Format and styles

- A style gallery for quick annotation styling.
- Fill colour, stroke colour, line width, opacity and border style.
- Blend modes for annotations.
- Default styles per annotation type.

## Selecting and arranging

- Select several annotations with a selection rectangle or Ctrl+click and edit
  their shared properties.
- Align (left, centre, right, top, middle, bottom), distribute horizontally and
  vertically, and match width, height or both.
- Flip, rotate, and change the drawing order (bring to front or back, forward or
  backward).
- Snap to end points, midpoints, centres, edges and vertices of the line being
  drawn, with a configurable snap radius and angle increments, and an optional grid.

## Viewing and navigation

- Native rendering through a multi-process PDFium worker pool, off the UI thread
  and isolated from crashes, with progressive tiles for very large CAD drawings
  (desktop; the browser and Android versions render with PDF.js).
- View modes: single page, continuous, facing and book, and a split view with
  two panes.
- Zoom: fit page, fit width, actual size, a custom percentage, and mouse-wheel
  zoom around the cursor.
- PDF/A detection with read-only protection.
- A left panel with thumbnails, bookmarks, annotations, attachments, signatures,
  layers, form fields, destinations, links and tags.

## Bookmarks

- Create, edit and delete bookmarks in a tree with expand and collapse.
- Custom colours and bold or italic text.

## Documents and workspace

- Several PDFs in tabs.
- Named sessions to save and restore a workspace.
- Open a PDF from a URL.
- Bookmarked folders for quick access, and recent files with pinning.
- A prompt for unsaved changes, document properties, and file locking against
  outside writes.

## Ribbon

- Tabs: Home, View, Drawing, Annotation, Edit & Combine PDFs and Settings, plus
  the File menu.
- Contextual tabs Format and Arrange appear when annotations are selected.
- Keyboard shortcuts can be changed: [docs/keyboard-shortcuts.md](keyboard-shortcuts.md).

## Look and language

- Seven colour themes: Default, Light, Dark, Blue, Amber Navy, Warm Ember and
  High Contrast.
- 40 languages, including right-to-left languages (Arabic, Farsi, Hebrew, Urdu).
  The translations are in `open-pdf-studio/js/i18n/locales/`.

## Undo and redo

- Up to 100 steps per document, covering annotations, page operations,
  watermarks and text edits.

## Updates — *desktop*

- A built-in update check with download progress, skip-this-version and remind-later.
- Installs and restarts automatically.
- Off in managed mode (`OPENAEC_BEHEERD=1`), where the platform supplies updates;
  see [docs/managed-deployments.md](managed-deployments.md).
