import { getActiveDocument } from '../../core/state.js';
import { isTauri, writeBinaryFile, readBinaryFile } from '../../core/platform.js';
import { PDFDocument, PDFName, PDFHexString, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { getCachedPdfBytes } from '../../pdf/loader.js';
import { setItems, setCountText, setEmptyMessage, setSelectedKey, setToolbarDisabled } from '../../solid/stores/panels/attachmentsStore.js';

// Current state
let currentAttachments = {}; // key -> { filename, content, description, createdAt, modifiedAt }
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
async function saveAttachmentToDisk(filename, content) {
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
    const blob = new Blob([content]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Open attachment in default application
async function openAttachmentExternal(filename, content) {
  if (isTauri() && window.__TAURI__?.fs && window.__TAURI__?.path && window.__TAURI__?.shell) {
    try {
      const tempDir = await window.__TAURI__.path.tempDir();
      const tempPath = tempDir + filename;
      await writeBinaryFile(tempPath, content);
      await window.__TAURI__.shell.open(tempPath);
    } catch (e) {
      console.error('Failed to open attachment:', e);
      saveAttachmentToDisk(filename, content);
    }
  } else {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      pdf: 'application/pdf', txt: 'text/plain', html: 'text/html', htm: 'text/html',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      svg: 'image/svg+xml', json: 'application/json', xml: 'application/xml',
    };
    const mime = mimeTypes[ext] || 'application/octet-stream';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

// Open a specific attachment by key (for double-click from component)
export async function openAttachment(key) {
  if (!key || !currentAttachments[key]) return;
  const att = currentAttachments[key];
  await openAttachmentExternal(att.filename, att.content);
}

// Toolbar: Open selected attachment
export async function openSelectedAttachment() {
  if (!selectedKeyLocal || !currentAttachments[selectedKeyLocal]) return;
  const att = currentAttachments[selectedKeyLocal];
  await openAttachmentExternal(att.filename, att.content);
}

// Toolbar: Save selected attachment
export async function saveSelectedAttachment() {
  if (!selectedKeyLocal || !currentAttachments[selectedKeyLocal]) return;
  const att = currentAttachments[selectedKeyLocal];
  await saveAttachmentToDisk(att.filename, att.content);
}

// Toolbar: Save all attachments
export async function saveAllAttachments() {
  if (isTauri() && window.__TAURI__?.dialog) {
    try {
      for (const key of Object.keys(currentAttachments)) {
        const att = currentAttachments[key];
        await saveAttachmentToDisk(att.filename, att.content);
      }
    } catch (e) {
      console.error('Failed to save all attachments:', e);
    }
  } else {
    for (const key of Object.keys(currentAttachments)) {
      const att = currentAttachments[key];
      await saveAttachmentToDisk(att.filename, att.content);
    }
  }
}

// Toolbar: Add attachment via file picker or browser input
export async function addAttachment() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) return;

  if (isTauri() && window.__TAURI__?.dialog) {
    try {
      const filePath = await window.__TAURI__.dialog.open({
        multiple: true,
        filters: [{ name: 'All Files', extensions: ['*'] }]
      });
      if (!filePath) return;
      const paths = Array.isArray(filePath) ? filePath : [filePath];
      for (const fp of paths) {
        const fileBytes = await readBinaryFile(fp);
        const name = fp.split(/[\\/]/).pop();
        await embedAttachment(activeDoc, name, new Uint8Array(fileBytes));
      }
      updateAttachmentsList();
    } catch (e) {
      console.error('Failed to add attachment:', e);
    }
  } else {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async () => {
      for (const file of input.files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await embedAttachment(activeDoc, file.name, bytes);
      }
      updateAttachmentsList();
    };
    input.click();
  }
}

// Toolbar: Delete selected attachment
export async function deleteSelectedAttachment() {
  if (!selectedKeyLocal) return;
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) return;

  await removeAttachment(activeDoc, selectedKeyLocal);
  selectedKeyLocal = null;
  setSelectedKey(null);
  updateAttachmentsList();
}

// Embed a file into the PDF using pdf-lib
async function embedAttachment(activeDoc, filename, fileBytes) {
  try {
    let pdfBytes;
    if (activeDoc.filePath) {
      pdfBytes = getCachedPdfBytes(activeDoc.filePath);
      if (!pdfBytes && isTauri()) {
        pdfBytes = await readBinaryFile(activeDoc.filePath);
      }
    }
    if (!pdfBytes) {
      pdfBytes = await activeDoc.pdfDoc.getData();
    }

    const pdfDocLib = await PDFDocument.load(pdfBytes);
    await pdfDocLib.attach(fileBytes, filename, {
      mimeType: guessMimeType(filename),
      description: filename,
      creationDate: new Date(),
      modificationDate: new Date(),
    });

    const savedBytes = await pdfDocLib.save();
    await reloadDocumentFromBytes(activeDoc, savedBytes);
    activeDoc.modified = true;
  } catch (e) {
    console.error('Failed to embed attachment:', e);
  }
}

// Remove an attachment from the PDF using pdf-lib
async function removeAttachment(activeDoc, key) {
  try {
    let pdfBytes;
    if (activeDoc.filePath) {
      pdfBytes = getCachedPdfBytes(activeDoc.filePath);
      if (!pdfBytes && isTauri()) {
        pdfBytes = await readBinaryFile(activeDoc.filePath);
      }
    }
    if (!pdfBytes) {
      pdfBytes = await activeDoc.pdfDoc.getData();
    }

    const pdfDocLib = await PDFDocument.load(pdfBytes);

    const catalog = pdfDocLib.catalog;
    const namesDict = catalog.lookup(PDFName.of('Names'));
    if (namesDict instanceof PDFDict) {
      const embeddedFiles = namesDict.lookup(PDFName.of('EmbeddedFiles'));
      if (embeddedFiles instanceof PDFDict) {
        const namesArray = embeddedFiles.lookup(PDFName.of('Names'));
        if (namesArray instanceof PDFArray) {
          const newEntries = [];
          for (let i = 0; i < namesArray.size(); i += 2) {
            const nameObj = namesArray.lookup(i);
            const nameStr = nameObj instanceof PDFHexString ? nameObj.decodeText() :
                            nameObj instanceof PDFString ? nameObj.decodeText() :
                            String(nameObj);
            if (nameStr !== key) {
              newEntries.push(namesArray.get(i), namesArray.get(i + 1));
            }
          }
          const newArray = PDFArray.withContext(pdfDocLib.context);
          newEntries.forEach(e => newArray.push(e));
          embeddedFiles.set(PDFName.of('Names'), newArray);
        }
      }
    }

    const savedBytes = await pdfDocLib.save();
    await reloadDocumentFromBytes(activeDoc, savedBytes);
    activeDoc.modified = true;
  } catch (e) {
    console.error('Failed to remove attachment:', e);
  }
}

// Reload the pdf.js document from new bytes
async function reloadDocumentFromBytes(activeDoc, bytes) {
  const pdfjsLib = await import('pdfjs-dist');
  const newDoc = await pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: '/pdfjs/web/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    isEvalSupported: false,
  }).promise;
  activeDoc.pdfDoc = newDoc;
}

// Guess MIME type from filename
function guessMimeType(filename) {
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
    setCountText('0 attachments');
    setEmptyMessage('No document open');
    setSelectedKey(null);
    updateToolbarState();
    return;
  }

  try {
    const pdfDoc = activeDoc.pdfDoc;
    let attachments = null;

    if (typeof pdfDoc.getAttachments === 'function') {
      attachments = await pdfDoc.getAttachments();
    }

    if (!attachments || Object.keys(attachments).length === 0) {
      currentAttachments = {};
      selectedKeyLocal = null;
      setItems([]);
      setCountText('0 attachments');
      setEmptyMessage('No attachments in this document');
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
        content: att.content,
        description: att.description || null,
        createdAt: att.creationDate || null,
        modifiedAt: att.modDate || null,
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
      const size = att.content ? att.content.length : 0;
      let metaText = formatFileSize(size);
      if (att.createdAt) metaText += ` | Created: ${formatDate(att.createdAt)}`;
      else if (att.modifiedAt) metaText += ` | Modified: ${formatDate(att.modifiedAt)}`;

      return {
        key,
        filename: att.filename,
        description: (att.description && att.description !== att.filename) ? att.description : null,
        metaText,
      };
    });

    setItems(itemsArray);
    setCountText(`${keys.length} attachment${keys.length !== 1 ? 's' : ''}`);
    setEmptyMessage('');
  } catch (e) {
    console.warn('Failed to load attachments:', e);
    currentAttachments = {};
    selectedKeyLocal = null;
    setItems([]);
    setCountText('0 attachments');
    setEmptyMessage('Could not load attachments');
    setSelectedKey(null);
  }

  updateToolbarState();
}
