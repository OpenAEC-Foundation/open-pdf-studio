import { pdfjsRecord } from '../../pdf/pdfjs-record.js';
import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { isTauri, writeBinaryFile, readBinaryFile } from '../../core/platform.js';
import { slaOverInHeadless } from '../../core/headless.js';
import { biedDownloadAan, biedBijlageAan } from '../../core/extern-openen.js';
import { markDocumentModified } from '../chrome/tabs.js';
import { bijlageInhoud } from '../../annotations/bijlage-store.js';
import {
  wijzigingenVan, vrijeNaam, metToegevoegd, metVerwijderd, zichtbareBijlagen,
  isUitvoerbaarBestand, tijdelijkeBijlageNaam,
} from '../../pdf/bijlagen.js';
import {
  setAttachmentItems as setItems, setAttachmentCountText as setCountText,
  setAttachmentEmptyMessage as setEmptyMessage, setAttachmentSelectedKey as setSelectedKey,
  setAttachmentToolbarDisabled as setToolbarDisabled,
} from '../../bridge.js';

// Current state
// key -> { filename, content, description, createdAt, modifiedAt }. `content` is
// null voor een bestand uit de PDF tot het nodig is: PDF.js 6 stuurt de bytes
// niet meer mee met de lijst, getAttachmentContent() leest ze op verzoek.
let currentAttachments = {};
let currentPdfDoc = null;
let selectedKeyLocal = null;

// Initialize (no-op, kept for callers)
export function initAttachments() {
  return;
}

// Format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString();
  } catch { return ''; }
}

// De bytes van een bijlage: toegevoegde bestanden hebben ze bij zich, die uit
// de PDF worden één keer gelezen, op verzoek.
async function attachmentContent(key) {
  const att = currentAttachments[key];
  if (!att) return null;
  // Bijlage-annotatie (#376): de inhoud staat in de bijlage-store.
  if (att.annotation) return (await bijlageInhoud(att.annotation, getActiveDocument()))?.bytes || null;
  if (!att.content && currentPdfDoc && typeof currentPdfDoc.getAttachmentContent === 'function') {
    try {
      const bytes = await currentPdfDoc.getAttachmentContent(key);
      if (bytes) att.content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    } catch (e) {
      console.warn('Failed to read attachment:', e);
    }
  }
  return att.content || null;
}

// Update toolbar button states
function updateToolbarState() {
  const hasSelection = selectedKeyLocal !== null;
  const hasAttachments = Object.keys(currentAttachments).length > 0;
  const hasDoc = !!getActiveDocument()?.pdfDoc;

  setToolbarDisabled({
    add: !hasDoc,
    open: !hasSelection,
    save: !hasSelection,
    saveAll: !hasAttachments,
    delete: !hasSelection,
  });
}

// Select an attachment by key
export function selectAttachment(key) {
  selectedKeyLocal = key;
  setSelectedKey(key);
  updateToolbarState();
}

// Save a single attachment to disk
export async function saveAttachmentToDisk(filename, content) {
  if (isTauri() && window.__TAURI__?.dialog) {
    try {
      const savePath = await window.__TAURI__.dialog.save({
        defaultPath: filename,
        filters: [{ name: 'All Files', extensions: ['*'] }]
      });
      if (savePath) {
        await writeBinaryFile(savePath, content);
      }
    } catch (e) {
      console.error('Failed to save attachment:', e);
    }
  } else {
    biedDownloadAan(filename, content);
  }
}

// Bestanden die het systeem uitvoert in plaats van opent: eerst vragen
// (de lijst staat in pdf/bijlagen.js, daar ook getest).
export { isUitvoerbaarBestand };

// Open attachment in default application
export async function openAttachmentExternal(filename, content) {
  // Headless (testinstantie): geen ander programma naar voren halen.
  if (slaOverInHeadless(`open attachment ${filename}`)) return;
  if (isTauri() && window.__TAURI__?.fs && window.__TAURI__?.path && window.__TAURI__?.shell) {
    // Alleen de bestandsnaam: een naam uit een PDF mag niet buiten de
    // tijdelijke map schrijven.
    const veilig = tijdelijkeBijlageNaam(filename);
    if (isUitvoerbaarBestand(filename) || isUitvoerbaarBestand(veilig)) {
      const { showConfirm } = await import('../chrome/confirm-dialog.js');
      const ja = await showConfirm({
        title: i18next.t('leftPanel.openAttachmentRiskTitle'),
        message: i18next.t('leftPanel.openAttachmentRiskMessage', { name: filename }),
      });
      if (!ja) return;
    }
    try {
      const tempDir = await window.__TAURI__.path.tempDir();
      const tempPath = typeof window.__TAURI__.path.join === 'function'
        ? await window.__TAURI__.path.join(tempDir, veilig)
        : tempDir.replace(/[\\/]?$/, '/') + veilig;
      await writeBinaryFile(tempPath, content);
      await window.__TAURI__.shell.open(tempPath);
    } catch (e) {
      console.error('Failed to open attachment:', e);
      saveAttachmentToDisk(filename, content);
    }
  } else {
    // Webversie: een tabblad; als gast een download met een melding (#695).
    await biedBijlageAan(filename, content);
  }
}

// Open a specific attachment by key (for double-click from component)
export async function openAttachment(key) {
  if (!key || !currentAttachments[key]) return;
  const content = await attachmentContent(key);
  if (content) await openAttachmentExternal(currentAttachments[key].filename, content);
}

// Toolbar: Open selected attachment
export async function openSelectedAttachment() {
  await openAttachment(selectedKeyLocal);
}

// Toolbar: Save selected attachment
export async function saveSelectedAttachment() {
  if (!selectedKeyLocal || !currentAttachments[selectedKeyLocal]) return;
  const content = await attachmentContent(selectedKeyLocal);
  if (content) await saveAttachmentToDisk(currentAttachments[selectedKeyLocal].filename, content);
}

// Toolbar: Save all attachments
export async function saveAllAttachments() {
  try {
    for (const key of Object.keys(currentAttachments)) {
      const content = await attachmentContent(key);
      if (content) await saveAttachmentToDisk(currentAttachments[key].filename, content);
    }
  } catch (e) {
    console.error('Failed to save all attachments:', e);
  }
}

/**
 * Laat de gebruiker bestanden kiezen: op het bureaublad de dialoog van het
 * systeem, in de browser een <input type=file>. Geeft [{ name, bytes }], leeg
 * bij annuleren.
 * @param {{ multiple?: boolean }} [opties]
 */
export async function kiesBestanden({ multiple = true } = {}) {
  if (isTauri() && window.__TAURI__?.dialog) {
    const filePath = await window.__TAURI__.dialog.open({
      multiple,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });
    if (!filePath) return [];
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    const uit = [];
    for (const fp of paths) {
      const fileBytes = await readBinaryFile(fp);
      uit.push({ name: fp.split(/[\\/]/).pop(), bytes: new Uint8Array(fileBytes) });
    }
    return uit;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.onchange = async () => {
      const uit = [];
      for (const file of input.files) uit.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      resolve(uit);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

// Toolbar: Add attachment via file picker or browser input
export async function addAttachment() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) return;
  try {
    const gekozen = await kiesBestanden({ multiple: true });
    if (!gekozen.length || getActiveDocument() !== activeDoc) return;
    for (const { name, bytes } of gekozen) embedAttachment(activeDoc, name, bytes);
    updateAttachmentsList();
  } catch (e) {
    console.error('Failed to add attachment:', e);
  }
}

// Toolbar: Delete selected attachment
export async function deleteSelectedAttachment() {
  if (!selectedKeyLocal) return;
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) return;

  const annot = currentAttachments[selectedKeyLocal]?.annotation;
  if (annot) {
    // Bijlage-annotatie (#376): de annotatie gaat weg, met ongedaan maken.
    const { deleteAnnotationsWithUndo } = await import('../../annotations/mutations.js');
    if (!deleteAnnotationsWithUndo(activeDoc, [annot]).length) return;
    if (activeDoc.selectedAnnotations?.includes(annot)) {
      activeDoc.selectedAnnotations = [];
      activeDoc.selectedAnnotation = null;
    }
    const r = await import('../../annotations/rendering.js');
    if (activeDoc.viewMode === 'continuous') r.redrawContinuous(); else r.redrawAnnotations();
    markDocumentModified(activeDoc);
  } else {
    await removeAttachment(activeDoc, selectedKeyLocal);
  }
  selectedKeyLocal = null;
  setSelectedKey(null);
  updateAttachmentsList();
}

// Toevoegen en verwijderen veranderen alleen de bijlagenwijzigingen van het
// document; de saver schrijft ze in het bestand (pdf/bijlagen.js). De geopende
// PDF blijft zoals hij is: niets hoeft opnieuw geladen of getekend te worden.
function embedAttachment(activeDoc, filename, fileBytes) {
  const name = vrijeNaam(filename, Object.values(currentAttachments).map(a => a.filename).concat(Object.keys(currentAttachments)));
  const now = new Date().toISOString();
  activeDoc.bijlagenWijzigingen = metToegevoegd(wijzigingenVan(activeDoc), {
    naam: name, bytes: fileBytes, mime: guessMimeType(name), beschrijving: name, aangemaakt: now, gewijzigd: now,
  });
  // Een volgend bestand uit dezelfde keuze moet deze naam als bezet zien.
  currentAttachments[name] = { filename: name, content: fileBytes };
  markDocumentModified(activeDoc);
}

function removeAttachment(activeDoc, key) {
  activeDoc.bijlagenWijzigingen = metVerwijderd(wijzigingenVan(activeDoc), key);
  markDocumentModified(activeDoc);
}

// Guess MIME type from filename
export function guessMimeType(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const types = {
    pdf: 'application/pdf', txt: 'text/plain', html: 'text/html', htm: 'text/html',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', json: 'application/json', xml: 'application/xml',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip', csv: 'text/csv',
  };
  return types[ext] || 'application/octet-stream';
}

// Handle drag and drop of files (called from component)
export async function handleFileDrop(e) {
  e.preventDefault();

  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) return;

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await embedAttachment(activeDoc, file.name, bytes);
  }
  updateAttachmentsList();
}

// Load and display attachments from the active PDF document
export async function updateAttachmentsList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    currentAttachments = {};
    selectedKeyLocal = null;
    setItems([]);
    setCountText(i18next.t('leftPanel.attachmentsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noDocumentOpen'));
    setSelectedKey(null);
    updateToolbarState();
    return;
  }

  try {
    const pdfDoc = activeDoc.pdfDoc;
    let fromPdf = null;

    if (typeof pdfDoc.getAttachments === 'function') {
      fromPdf = pdfjsRecord(await pdfDoc.getAttachments());
    }
    if (getActiveDocument() !== activeDoc || activeDoc.pdfDoc !== pdfDoc) return;
    currentPdfDoc = pdfDoc;

    // De bijlagen in de PDF plus wat er sinds het openen bij kwam of af ging.
    const listed = zichtbareBijlagen(Object.entries(fromPdf || {}).map(([naam, att]) => ({
      naam,
      filename: att.filename || naam,
      content: att.content || null,
      description: att.description || null,
      createdAt: att.creationDate || null,
      modifiedAt: att.modDate || null,
    })), wijzigingenVan(activeDoc));
    const attachments = {};
    for (const att of listed) {
      attachments[att.naam] = att.nieuw
        ? { filename: att.naam, content: att.bytes, description: att.beschrijving || null, createdAt: att.aangemaakt || null, modifiedAt: att.gewijzigd || null }
        : att;
    }
    // Bijlage-annotaties (#376) op de pagina's, zoals andere lezers ze ook in
    // hun bijlagenlijst tonen: met het paginanummer erbij.
    for (const ann of (activeDoc.annotations || []).filter(a => a.type === 'fileAttachment')) {
      const a = ann.attachment || {};
      attachments[`annot:${ann.id}`] = {
        filename: a.name || 'attachment',
        content: null,
        size: a.size ?? null,
        description: ann.text || a.description || null,
        createdAt: a.createdAt || null,
        modifiedAt: a.modifiedAt || null,
        page: ann.page,
        annotation: ann,
      };
    }

    if (Object.keys(attachments).length === 0) {
      currentAttachments = {};
      selectedKeyLocal = null;
      setItems([]);
      setCountText(i18next.t('leftPanel.attachmentsCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noAttachments'));
      setSelectedKey(null);
      updateToolbarState();
      return;
    }

    // Store current attachments
    currentAttachments = {};
    const keys = Object.keys(attachments);
    keys.forEach(key => {
      const att = attachments[key];
      currentAttachments[key] = {
        filename: att.filename || key,
        content: att.content || null,
        description: att.description || null,
        createdAt: att.createdAt || null,
        modifiedAt: att.modifiedAt || null,
        size: att.size ?? null,
        page: att.page ?? null,
        annotation: att.annotation || null,
      };
    });

    // Validate selection
    if (selectedKeyLocal && !currentAttachments[selectedKeyLocal]) {
      selectedKeyLocal = null;
    }
    setSelectedKey(selectedKeyLocal);

    // Build items array for the store
    const itemsArray = keys.map(key => {
      const att = currentAttachments[key];
      // De grootte is bekend zodra de bytes dat zijn (toegevoegd, of gelezen).
      const grootte = att.content ? att.content.length : att.size;
      const parts = typeof grootte === 'number' ? [formatFileSize(grootte)] : [];
      if (att.page) parts.push(i18next.t('leftPanel.attachmentOnPage', { page: att.page }));
      if (att.createdAt) parts.push(i18next.t('leftPanel.attachmentCreated', { date: formatDate(att.createdAt) }));
      else if (att.modifiedAt) parts.push(i18next.t('leftPanel.attachmentModified', { date: formatDate(att.modifiedAt) }));
      const metaText = parts.join(' | ');

      return {
        key,
        filename: att.filename,
        description: (att.description && att.description !== att.filename) ? att.description : null,
        metaText,
      };
    });

    setItems(itemsArray);
    setCountText(i18next.t('leftPanel.attachmentsCount', { count: keys.length }));
    setEmptyMessage('');
  } catch (e) {
    console.warn('Failed to load attachments:', e);
    currentAttachments = {};
    selectedKeyLocal = null;
    setItems([]);
    setCountText(i18next.t('leftPanel.attachmentsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.couldNotLoadAttachments'));
    setSelectedKey(null);
  }

  updateToolbarState();
}
