# OpenPDFStudio - Missing Features (vs PDF-XChange & Foxit)

## CRITICAL (expected by most users)

- [ ] **Print** - Button exists but not implemented
- [ ] **Text editing** - Edit existing PDF text in place
- [ ] **Page management** - Insert, delete, extract, reorder, swap pages (buttons exist, not implemented)
- [ ] **OCR** - Make scanned PDFs searchable
- [ ] **Continuous scroll view** - Currently disabled / "coming soon"
- [ ] **Bookmarks editing** - Add, edit, delete bookmarks (currently read-only)

## HIGH (power users expect these)

- [ ] **Document comparison** - Side-by-side diff with change highlighting
- [ ] **Merge / combine PDFs** - Combine multiple files into one
- [ ] **Split document** - Split by page range, file size, or bookmarks
- [ ] **Watermarks / headers / footers** - Add text or image overlays
- [ ] **Bates numbering** - Sequential numbering for legal documents
- [ ] **Flatten annotations** - Merge annotations into page content
- [ ] **Crop pages** - Crop to selection or white margins
- [ ] **Spell checker** - Built-in spell check for text annotations and form fields
- [ ] **Password / encryption** - Protect PDFs with passwords and encryption (40-bit RC4, 128-bit AES, 256-bit AES)
- [ ] **Digital signature creation** - Certificate-based digital signatures (PAdES), not just drawn signatures
- [ ] **Find & Replace** - Currently find only, no replace
- [ ] **Image editing** - Edit, replace, resize existing images in PDF content

## MEDIUM (competitive differentiators)

- [ ] **Convert to Word / Excel / PowerPoint** - Export PDF to Office formats
- [ ] **Create PDF from Office / images** - Currently only blank document creation
- [ ] **Form creation (full)** - Full form designer with all field types (currently only Text, Checkbox, Radio)
- [ ] **Comment summary / export** - Generate printable comment summary (currently XFDF export only)
- [ ] **Optimize / compress PDF** - Reduce file size, recompress images
- [ ] **Caret annotation** - Insertion mark annotation type
- [ ] **File attachment annotations** - Create file attachment annotations (currently view only)
- [ ] **Layers editing** - Add, merge, flatten layers (currently toggle visibility only)
- [ ] **Accessibility checker** - PDF/UA compliance checking (currently Tags panel only)
- [ ] **Batch processing** - Apply operations to multiple files at once
- [ ] **Cloud storage integration** - Google Drive, OneDrive, Dropbox, SharePoint

## Existing Strengths

- Full annotation suite (24 types) with rich styling and properties
- XFDF import/export
- Measurement tools with scale calibration
- Multi-tab document interface
- Form filling with JavaScript validation
- Draw-based signatures with save/restore
- Dark / Light / System / Blue / High Contrast themes
- Auto-updater with GitHub releases
- Export as images (PNG/JPEG) and raster PDF
- Smart alignment guides and grid snapping
- Multi-selection with alignment and distribution tools
- Undo/redo (100 levels per document)
- File locking (prevents concurrent writes)
- Session save/restore
