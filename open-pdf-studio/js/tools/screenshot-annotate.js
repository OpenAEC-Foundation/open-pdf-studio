// Screenshot Capture & Annotate mode.
//
// Turns Open PDF Studio into a lightweight screenshot annotator: it takes the
// bitmap that Windows (PrtScn / Snipping Tool) or any app placed on the
// clipboard, drops it onto a fresh page-sized canvas and hands it to the full
// annotation toolset. The resulting document is an ordinary (untitled) PDF, so
// every existing feature works for free — drawing tools, Save/Save-As (PDF
// export) and the Screenshot button (PNG/JPG export + copy back to clipboard).
//
// Two entry points:
//   * an in-app action ("Annotate clipboard screenshot", File menu) — the
//     reliable core path; the user makes a normal OS screenshot first, then
//     triggers this;
//   * an OPT-IN global PrtScn hotkey (Preferences → General) — the bonus path.
//     Registration is driven from `set_prtscn_hotkey` in Rust; on press the
//     backend brings the window forward and emits `prtscn-screenshot`, handled
//     here.
//
// Windows note: intercepting PrtScn via a global hotkey can suppress the OS's
// own "copy full screen to clipboard" behaviour, and on Windows 11 PrtScn may
// be bound to the Snipping Tool. That is exactly why the hotkey is opt-in and
// off by default, and why the in-app action (which reads whatever the user
// already captured) is the primary, always-reliable route.

import { isTauri, invoke } from '../core/platform.js';
import { state, getActiveDocument, imageCache } from '../core/state.js';
import { createBlankPDF } from '../pdf/loader.js';
import { generateImageId } from '../utils/helpers.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { layerForNewAnnotation } from '../annotations/annotatie-lagen.js';

// ─── Clipboard image → Blob ─────────────────────────────────────────────────
// Desktop reads through a small Rust command (clipboard-manager plugin), which
// is far more reliable than navigator.clipboard.read() inside WebView2. The
// browser fallback uses the async Clipboard API.
async function readClipboardImageBlob() {
  if (isTauri()) {
    try {
      const bytes = await invoke('read_clipboard_image_png');
      if (bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (u8.length > 0) return new Blob([u8], { type: 'image/png' });
      }
    } catch (e) {
      console.warn('[screenshot-annotate] clipboard read failed:', e);
    }
    return null;
  }

  // Browser fallback
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return await item.getType(type);
      }
    }
  } catch (e) {
    console.warn('[screenshot-annotate] navigator.clipboard.read failed:', e);
  }
  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Stamp the screenshot as a page-filling image annotation on the freshly
// created blank document. The blank page is sized 1:1 with the bitmap (1 pt per
// pixel), so an annotation at (0,0) with the image's pixel dimensions covers
// the page exactly.
async function placeImageFillingPage(blob, dataUrl, img) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  const imageId = generateImageId();
  imageCache.set(imageId, img);

  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const annotation = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    type: 'image',
    page: doc.currentPage || 1,
    x: 0,
    y: 0,
    width: w,
    height: h,
    rotation: 0,
    imageId,
    imageData: dataUrl, // data:image/... URL for PDF embedding on save
    originalWidth: w,
    originalHeight: h,
    lockAspectRatio: true,
    cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
    opacity: 1,
    locked: false,
    printable: true,
    author: state.defaultAuthor,
    subject: '',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
  // Een nieuwe markering landt op de huidige laag (#468), zoals via createAnnotation.
  const laag = layerForNewAnnotation(doc);
  if (laag) annotation.layer = laag;

  doc.annotations.push(annotation);
  recordAdd(annotation);
  doc.selectedAnnotation = annotation;
  doc.selectedAnnotations = [annotation];
  showProperties(annotation);

  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// ─── Core action ────────────────────────────────────────────────────────────
// Read the clipboard image, create a new document the size of the screenshot
// and drop the bitmap onto it, ready to annotate. `delayMs` gives the OS a
// moment to finish writing to the clipboard when triggered by the global
// hotkey.
export async function annotateClipboardScreenshot({ delayMs = 0 } = {}) {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

  updateStatusMessage('Reading screenshot from clipboard...');
  const blob = await readClipboardImageBlob();
  if (!blob) {
    updateStatusMessage('No image on the clipboard — take a screenshot first (PrtScn or Win+Shift+S)');
    return;
  }

  let img, dataUrl;
  try {
    const url = URL.createObjectURL(blob);
    img = await loadImage(url);
    URL.revokeObjectURL(url);
    dataUrl = await blobToDataUrl(blob);
  } catch (e) {
    console.error('[screenshot-annotate] failed to decode clipboard image:', e);
    updateStatusMessage('Could not read the clipboard image');
    return;
  }

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!(w > 0) || !(h > 0)) {
    updateStatusMessage('Clipboard image has no dimensions');
    return;
  }

  // New page sized 1:1 with the screenshot (points == pixels), then the
  // page-filling image annotation. Reuses the normal blank-document flow.
  try {
    await createBlankPDF(w, h, 1);
    await placeImageFillingPage(blob, dataUrl, img);
    updateStatusMessage('Screenshot ready — annotate, then Save (PDF) or Screenshot (PNG/JPG)');
  } catch (e) {
    console.error('[screenshot-annotate] failed to build annotate canvas:', e);
    updateStatusMessage('Failed to create the annotate canvas');
  }
}

// ─── Global hotkey wiring ────────────────────────────────────────────────────
let _listenerAttached = false;

// Push the current preference to the Rust backend, which (un)registers the
// PrtScn global hotkey. Safe to call repeatedly.
export async function applyPrintScreenHotkeyPref() {
  if (!isTauri()) return;
  try {
    await invoke('set_prtscn_hotkey', { enabled: !!state.preferences?.interceptPrintScreen });
  } catch (e) {
    console.warn('[screenshot-annotate] set_prtscn_hotkey failed:', e);
  }
}

// One-time init from the app startup sequence: listen for the backend's
// hotkey event and apply the persisted preference.
export async function initScreenshotAnnotate() {
  if (!isTauri()) return;
  if (!_listenerAttached) {
    try {
      await window.__TAURI__.event.listen('prtscn-screenshot', () => {
        // Small delay: give the OS time to finish putting the capture on the
        // clipboard before we read it.
        annotateClipboardScreenshot({ delayMs: 150 });
      });
      _listenerAttached = true;
    } catch (e) {
      console.warn('[screenshot-annotate] event listen failed:', e);
    }
  }
  await applyPrintScreenHotkeyPref();
}
