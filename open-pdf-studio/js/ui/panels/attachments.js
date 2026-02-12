import { getActiveDocument } from '../../core/state.js';
import { isTauri, writeBinaryFile, readBinaryFile } from '../../core/platform.js';
import { PDFDocument, PDFName, PDFHexString, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { getCachedPdfBytes } from '../../pdf/loader.js';

const attachmentsContainer = document.getElementById('attachments-container');
const attachmentsCount = document.getElementById('attachments-count');

// Toolbar buttons
const addBtn = document.getElementById('attachments-add-btn');
const openBtn = document.getElementById('attachments-open-btn');
const saveBtn = document.getElementById('attachments-save-btn');
const saveAllBtn = document.getElementById('attachments-save-all-btn');
const deleteBtn = document.getElementById('attachments-delete-btn');

// Current state
let currentAttachments = {}; // key -> { filename, content, description, createdAt, modifiedAt }
let selectedKey = null;

// Initialize toolbar and drag-drop
export function initAttachments() {
  if (addBtn) addBtn.addEventListener('click', addAttachment);
  if (openBtn) openBtn.addEventListener('click', openSelectedAttachment);
  if (saveBtn) saveBtn.addEventListener('click', saveSelectedAttachment);
  if (saveAllBtn) saveAllBtn.addEventListener('click', saveAllAttachments);
  if (deleteBtn) deleteBtn.addEventListener('click', deleteSelectedAttachment);

  // Drag and drop on container
  if (attachmentsContainer) {
    attachmentsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      attachmentsContainer.classList.add('drag-over');
    });
    attachmentsContainer.addEventListener('dragleave', () => {
      attachmentsContainer.classList.remove('drag-over');
    });
    attachmentsContainer.addEventListener('drop', handleDrop);
  }
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

// File type icon SVG content
function getFileTypeIcon(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const icons = {
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    docx: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    xls: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6"/>',
    xlsx: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6"/>',
    png: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    jpg: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    jpeg: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    txt: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    zip: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 17 15 14"/>',
  };
  return icons[ext] || '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';
}

// Update toolbar button states
function updateToolbarState() {
  const hasSelection = selectedKey !== null;
  const hasAttachments = Object.keys(currentAttachments).length > 0;
  const hasDoc = !!getActiveDocument()?.pdfDoc;

  if (addBtn) addBtn.disabled = !hasDoc;
  if (openBtn) openBtn.disabled = !hasSelection;
  if (saveBtn) saveBtn.disabled = !hasSelection;
  if (saveAllBtn) saveAllBtn.disabled = !hasAttachments;
  if (deleteBtn) deleteBtn.disabled = !hasSelection;
}

// Select an attachment by key
function selectAttachment(key) {
  selectedKey = key;
  // Update visual selection
  if (attachmentsContainer) {
    attachmentsContainer.querySelectorAll('.attachment-list-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.key === key);
    });
  }
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
      // Write to temp directory and open
      const tempDir = await window.__TAURI__.path.tempDir();
      const tempPath = tempDir + filename;
      await writeBinaryFile(tempPath, content);
      await window.__TAURI__.shell.open(tempPath);
    } catch (e) {
      console.error('Failed to open attachment:', e);
      // Fallback to save
      saveAttachmentToDisk(filename, content);
    }
  } else {
    // Browser: open blob in new tab or download
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
    // Clean up after a delay
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

// Toolbar: Open selected attachment
async function openSelectedAttachment() {
  if (!selectedKey || !currentAttachments[selectedKey]) return;
  const att = currentAttachments[selectedKey];
  await openAttachmentExternal(att.filename, att.content);
}

// Toolbar: Save selected attachment
async function saveSelectedAttachment() {
  if (!selectedKey || !currentAttachments[selectedKey]) return;
  const att = currentAttachments[selectedKey];
  await saveAttachmentToDisk(att.filename, att.content);
}

// Toolbar: Save all attachments
async function saveAllAttachments() {
  if (isTauri() && window.__TAURI__?.dialog) {
    // Pick a directory to save all
    try {
      // Use folder picker if available, else save each individually
      for (const key of Object.keys(currentAttachments)) {
        const att = currentAttachments[key];
        await saveAttachmentToDisk(att.filename, att.content);
      }
    } catch (e) {
      console.error('Failed to save all attachments:', e);
    }
  } else {
    // Browser: download each
    for (const key of Object.keys(currentAttachments)) {
      const att = currentAttachments[key];
      await saveAttachmentToDisk(att.filename, att.content);
    }
  }
}

// Toolbar: Add attachment via file picker or browser input
async function addAttachment() {
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
    // Browser fallback: use hidden file input
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
async function deleteSelectedAttachment() {
  if (!selectedKey) return;
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) return;

  await removeAttachment(activeDoc, selectedKey);
  selectedKey = null;
  updateAttachmentsList();
}

// Embed a file into the PDF using pdf-lib
async function embedAttachment(activeDoc, filename, fileBytes) {
  try {
    // Load the current PDF bytes via pdf-lib
    let pdfBytes;
    if (activeDoc.filePath) {
      pdfBytes = getCachedPdfBytes(activeDoc.filePath);
      if (!pdfBytes && isTauri()) {
        pdfBytes = await readBinaryFile(activeDoc.filePath);
      }
    }
    if (!pdfBytes) {
      // Get bytes from the pdfDoc proxy
      pdfBytes = await activeDoc.pdfDoc.getData();
    }

    const pdfDocLib = await PDFDocument.load(pdfBytes);
    await pdfDocLib.attach(fileBytes, filename, {
      mimeType: guessMimeType(filename),
      description: filename,
      creationDate: new Date(),
      modificationDate: new Date(),
    });

    // Save and reload
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

    // Access the catalog and remove the embedded file
    const catalog = pdfDocLib.catalog;
    const namesDict = catalog.lookup(PDFName.of('Names'));
    if (namesDict instanceof PDFDict) {
      const embeddedFiles = namesDict.lookup(PDFName.of('EmbeddedFiles'));
      if (embeddedFiles instanceof PDFDict) {
        const namesArray = embeddedFiles.lookup(PDFName.of('Names'));
        if (namesArray instanceof PDFArray) {
          // Names array is [name1, ref1, name2, ref2, ...]
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
          // Rebuild the array
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

// Handle drag and drop of files
async function handleDrop(e) {
  e.preventDefault();
  attachmentsContainer.classList.remove('drag-over');

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

// Create a list item element for an attachment
function createAttachmentItem(key, attachment) {
  const { filename, content, description, createdAt, modifiedAt } = attachment;
  const size = content ? content.length : 0;

  const item = document.createElement('div');
  item.className = 'attachment-list-item';
  item.dataset.key = key;

  if (key === selectedKey) {
    item.classList.add('selected');
  }

  // File icon
  const icon = document.createElement('div');
  icon.className = 'attachment-list-icon';
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${getFileTypeIcon(filename)}</svg>`;
  item.appendChild(icon);

  // Info
  const info = document.createElement('div');
  info.className = 'attachment-list-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'attachment-list-name';
  nameEl.textContent = filename;
  nameEl.title = filename;
  info.appendChild(nameEl);

  // Description if available and different from filename
  if (description && description !== filename) {
    const descEl = document.createElement('div');
    descEl.className = 'attachment-list-desc';
    descEl.textContent = description;
    descEl.title = description;
    info.appendChild(descEl);
  }

  // Meta: size + dates
  let metaText = formatFileSize(size);
  if (createdAt) metaText += ` | Created: ${formatDate(createdAt)}`;
  else if (modifiedAt) metaText += ` | Modified: ${formatDate(modifiedAt)}`;

  const meta = document.createElement('div');
  meta.className = 'attachment-list-meta';
  meta.textContent = metaText;
  info.appendChild(meta);

  item.appendChild(info);

  // Click to select
  item.addEventListener('click', () => {
    selectAttachment(key);
  });

  // Double-click to open
  item.addEventListener('dblclick', () => {
    openAttachmentExternal(filename, content);
  });

  return item;
}

// Load and display attachments from the active PDF document
export async function updateAttachmentsList() {
  if (!attachmentsContainer) return;

  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    currentAttachments = {};
    selectedKey = null;
    attachmentsContainer.innerHTML = '<div class="attachments-empty">No document open</div>';
    if (attachmentsCount) attachmentsCount.textContent = '0 attachments';
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
      // Keep selectedKey only if still valid
      selectedKey = null;
      attachmentsContainer.innerHTML = '<div class="attachments-empty">No attachments in this document</div>';
      if (attachmentsCount) attachmentsCount.textContent = '0 attachments';
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
    if (selectedKey && !currentAttachments[selectedKey]) {
      selectedKey = null;
    }

    // Render
    attachmentsContainer.innerHTML = '';
    keys.forEach(key => {
      const item = createAttachmentItem(key, currentAttachments[key]);
      attachmentsContainer.appendChild(item);
    });

    if (attachmentsCount) {
      attachmentsCount.textContent = `${keys.length} attachment${keys.length !== 1 ? 's' : ''}`;
    }
  } catch (e) {
    console.warn('Failed to load attachments:', e);
    currentAttachments = {};
    selectedKey = null;
    attachmentsContainer.innerHTML = '<div class="attachments-empty">Could not load attachments</div>';
    if (attachmentsCount) attachmentsCount.textContent = '0 attachments';
  }

  updateToolbarState();
}
