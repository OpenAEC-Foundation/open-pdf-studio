import { state, getActiveDocument } from '../core/state.js';
import { createAnnotation, cloneAnnotation } from './factory.js';
import { recordBulkAdd } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { isTauri, readBinaryFile, writeBinaryFile, saveFileDialog, openFileDialog } from '../core/platform.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';
import { ifcCategoryForParametric } from '../solid/data/ifcCategoryMap.js';

// Export annotations to XFDF XML format
export function exportToXFDF() {
  const doc = getActiveDocument();
  const annotations = doc?.annotations || [];
  if (annotations.length === 0) {
    showMessage(i18next.t('noAnnotationsToExport'));
    return;
  }

  const fileName = doc?.filePath ? doc.filePath.split(/[\\/]/).pop() : 'document.pdf';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">\n';
  xml += `  <f href="${escapeXml(fileName)}"/>\n`;
  xml += '  <annots>\n';

  for (const ann of annotations) {
    xml += annotationToXFDF(ann);
  }

  xml += '  </annots>\n';
  xml += '</xfdf>\n';

  return xml;
}

// Export and save to file
export async function exportXFDFToFile() {
  const xml = exportToXFDF();
  if (!xml) return;

  if (!isTauri()) {
    // Fallback: download as file in browser
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'annotations.xfdf';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const doc = getActiveDocument();
  const baseName = doc?.filePath ? doc.filePath.replace(/\.pdf$/i, '') : 'annotations';
  const savePath = await saveFileDialog(baseName + '.xfdf');
  if (savePath) {
    const encoder = new TextEncoder();
    await writeBinaryFile(savePath, encoder.encode(xml));
    updateStatusMessage('Annotations exported to XFDF');
  }
}

// Import annotations from XFDF file
export async function importXFDFFromFile() {
  if (!isTauri()) {
    showMessage(i18next.t('importRequiresTauri'));
    return;
  }

  const filePath = await openFileDialog(['xfdf', 'xml']);
  if (!filePath) return;

  const data = await readBinaryFile(filePath);
  const decoder = new TextDecoder();
  const xml = decoder.decode(data);

  importFromXFDF(xml);
}

// Parse XFDF XML and add annotations
export function importFromXFDF(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    showMessage(i18next.t('invalidXfdfFile'));
    return;
  }

  const annots = doc.querySelector('annots');
  if (!annots) {
    showMessage(i18next.t('noAnnotationsInXfdf'));
    return;
  }

  const newAnnotations = [];
  const activeDoc = getActiveDocument();

  // First pass: parse non-leader annotations and index textboxes by their id (name attr).
  const textboxByName = new Map();
  const pendingLeaders = [];
  for (const el of annots.children) {
    const tag = el.localName || el.tagName;
    if (tag === 'polyline' && el.getAttribute('opstype') === 'textboxLeader') {
      pendingLeaders.push(el);
      continue;
    }
    const ann = xfdfElementToAnnotation(el);
    if (ann) {
      // Preserve original id from XFDF "name" attribute for IRT linkage
      const xfdfName = el.getAttribute('name');
      if (xfdfName) {
        ann.id = xfdfName;
        if (ann.type === 'textbox') textboxByName.set(xfdfName, ann);
      }
      if (activeDoc) activeDoc.annotations.push(ann);
      newAnnotations.push(ann);
    }
  }
  // Second pass: attach leader polylines to their parent textbox.
  for (const el of pendingLeaders) {
    const parentName = el.getAttribute('inreplyto');
    const parent = parentName ? textboxByName.get(parentName) : null;
    if (!parent) continue;
    const vertsTxt = el.querySelector('vertices')?.textContent || '';
    const pts = vertsTxt.split(/[;\s]+/).map(p => {
      const [x, y] = p.split(',').map(Number);
      return { x, y };
    }).filter(p => !isNaN(p.x));
    if (pts.length < 2) continue;
    const tail = el.getAttribute('tail');
    const endStyle = tail === 'Circle' ? 'circle' : 'arrow';
    if (!Array.isArray(parent.leaders)) parent.leaders = [];
    parent.leaders.push({
      id: el.getAttribute('leaderid') || (Date.now().toString(36) + Math.random().toString(36).substr(2, 6)),
      kneeX: pts[Math.max(0, pts.length - 2)].x,
      kneeY: pts[Math.max(0, pts.length - 2)].y,
      tipX: pts[pts.length - 1].x,
      tipY: pts[pts.length - 1].y,
      endStyle,
    });
  }

  if (newAnnotations.length > 0) {
    recordBulkAdd(newAnnotations);
    if (getActiveDocument()?.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
    updateStatusMessage(`Imported ${newAnnotations.length} annotations from XFDF`);
  } else {
    updateStatusMessage('No compatible annotations found in XFDF');
  }
}

// Convert a single annotation to XFDF XML element
function annotationToXFDF(ann) {
  const attrs = commonAttrs(ann);

  switch (ann.type) {
    case 'highlight':
    case 'textHighlight':
      return `    <highlight ${attrs} color="${colorToXFDF(ann.color)}" opacity="${ann.opacity || 0.3}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </highlight>\n`;

    case 'textStrikethrough':
      return `    <strikeout ${attrs} color="${colorToXFDF(ann.color)}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </strikeout>\n`;

    case 'textUnderline':
      return `    <underline ${attrs} color="${colorToXFDF(ann.color)}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </underline>\n`;

    case 'box':
    case 'mask':
      return `    <square ${attrs} color="${colorToXFDF(ann.strokeColor || ann.color)}"` +
             (ann.fillColor ? ` interior-color="${colorToXFDF(ann.fillColor)}"` : '') +
             ` width="${ann.lineWidth ?? 2}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </square>\n`;

    case 'scaleRegion':
      return `    <square ${attrs} color="${colorToXFDF(ann.color || '#ff9800')}"` +
             ` width="${ann.lineWidth ?? 1.5}"` +
             ` opstype="scaleRegion"` +
             ` opsscalestring="${escapeXml(ann.scaleString || '1:100')}"` +
             ` opsunits="${escapeXml(ann.units || 'mm')}"` +
             ` opslabel="${escapeXml(ann.label || '')}">\n` +
             `      <contents>${escapeXml(ann.label || '')}</contents>\n` +
             `    </square>\n`;

    case 'circle':
      return `    <circle ${attrs} color="${colorToXFDF(ann.strokeColor || ann.color)}"` +
             (ann.fillColor ? ` interior-color="${colorToXFDF(ann.fillColor)}"` : '') +
             ` width="${ann.lineWidth ?? 2}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </circle>\n`;

    case 'line':
      return `    <line ${attrs} color="${colorToXFDF(ann.strokeColor || ann.color)}"` +
             ` start="${ann.startX},${ann.startY}" end="${ann.endX},${ann.endY}"` +
             ` width="${ann.lineWidth ?? 2}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </line>\n`;

    case 'arrow':
      return `    <line ${attrs} color="${colorToXFDF(ann.strokeColor || ann.color)}"` +
             ` start="${ann.startX},${ann.startY}" end="${ann.endX},${ann.endY}"` +
             ` width="${ann.lineWidth ?? 2}" head="${ann.startHead || 'none'}" tail="${ann.endHead || 'open'}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </line>\n`;

    case 'draw':
      if (!ann.path || ann.path.length < 2) return '';
      const inkPoints = ann.path.map(p => `${p.x},${p.y}`).join(';');
      return `    <ink ${attrs} color="${colorToXFDF(ann.strokeColor || ann.color)}" width="${ann.lineWidth ?? 2}">\n` +
             `      <inklist><gesture>${inkPoints}</gesture></inklist>\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </ink>\n`;

    case 'comment':
      return `    <text ${attrs} color="${colorToXFDF(ann.color)}" icon="${ann.icon || 'comment'}">\n` +
             `      <contents>${escapeXml(ann.text || '')}</contents>\n` +
             (ann.replies ? ann.replies.map(r => replyToXFDF(r)).join('') : '') +
             `    </text>\n`;

    case 'textbox':
    case 'callout': {
      let out = `    <freetext ${attrs} color="${colorToXFDF(ann.strokeColor || ann.color)}"` +
             (ann.fillColor ? ` interior-color="${colorToXFDF(ann.fillColor)}"` : '') +
             ` fontsize="${ann.fontSize || 14}" name="${escapeXml(ann.id)}">\n` +
             `      <contents>${escapeXml(ann.text || '')}</contents>\n` +
             `    </freetext>\n`;
      if (ann.type === 'textbox' && Array.isArray(ann.leaders)) {
        for (const l of ann.leaders) {
          // Approximate anchor at knee (renderer recomputes side on load anyway)
          const verts = `${l.kneeX},${l.kneeY};${l.kneeX},${l.kneeY};${l.tipX},${l.tipY}`;
          const xs = [l.kneeX, l.tipX]; const ys = [l.kneeY, l.tipY];
          const r = `${Math.min(...xs)},${Math.min(...ys)},${Math.max(...xs)},${Math.max(...ys)}`;
          out += `    <polyline page="${ann.page - 1}" rect="${r}" inreplyto="${escapeXml(ann.id)}"` +
                 ` color="${colorToXFDF(ann.strokeColor || ann.color || '#000000')}"` +
                 ` width="${ann.lineWidth ?? 1}" head="None" tail="${l.endStyle === 'circle' ? 'Circle' : 'OpenArrow'}"` +
                 ` opstype="textboxLeader" leaderid="${escapeXml(l.id)}">\n` +
                 `      <vertices>${verts}</vertices>\n` +
                 `    </polyline>\n`;
        }
      }
      return out;
    }

    case 'stamp':
      return `    <stamp ${attrs} icon="${escapeXml(ann.stampName || 'Draft')}">\n` +
             `      <contents>${escapeXml(ann.stampText || '')}</contents>\n` +
             `    </stamp>\n`;

    case 'parametricSymbol': {
      // Stored as <square> with private OPS attributes so non-supporting viewers
      // see at least the bbox. The symbol shape is reconstructed on load.
      const paramsJson = JSON.stringify(ann.params || {});
      return `    <square ${attrs} color="${colorToXFDF(ann.strokeColor || ann.color)}"` +
             ` width="${ann.lineWidth ?? 1}"` +
             ` opstype="parametricSymbol"` +
             ` opssymbolid="${escapeXml(ann.symbolId || '')}"` +
             ` opsifccategory="${escapeXml(ann.ifcCategory || ifcCategoryForParametric(ann.symbolId))}"` +
             ` opsparams="${escapeXml(paramsJson)}">\n` +
             `      <contents>${escapeXml(ann.subject || '')}</contents>\n` +
             `    </square>\n`;
    }

    default:
      return '';
  }
}

// Parse XFDF element to annotation
function xfdfElementToAnnotation(el) {
  const tagName = el.localName || el.tagName;
  const page = parseInt(el.getAttribute('page')) || 1;
  const rect = parseRect(el.getAttribute('rect'));
  if (!rect) return null;

  const baseProps = {
    page: page,
    author: el.getAttribute('title') || 'User',
    subject: el.getAttribute('subject') || '',
    createdAt: el.getAttribute('creationdate') || new Date().toISOString(),
    modifiedAt: el.getAttribute('date') || new Date().toISOString(),
    opacity: parseFloat(el.getAttribute('opacity')) || 1.0
  };

  const contents = el.querySelector('contents')?.textContent || '';
  const color = xfdfColorToHex(el.getAttribute('color'));
  const interiorColor = xfdfColorToHex(el.getAttribute('interior-color'));
  const width = parseFloat(el.getAttribute('width')) || 2;

  // Parse replies
  const replies = [];
  el.querySelectorAll('popup, text[inreplyto]').forEach(replyEl => {
    replies.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      author: replyEl.getAttribute('title') || 'User',
      text: replyEl.querySelector('contents')?.textContent || '',
      createdAt: replyEl.getAttribute('date') || new Date().toISOString()
    });
  });

  switch (tagName) {
    case 'highlight':
      return createAnnotation({ ...baseProps, type: 'textHighlight', x: rect.x, y: rect.y, width: rect.w, height: rect.h, color, fillColor: color, replies: replies.length > 0 ? replies : undefined });
    case 'strikeout':
      return createAnnotation({ ...baseProps, type: 'textStrikethrough', x: rect.x, y: rect.y, width: rect.w, height: rect.h, color, strokeColor: color, replies: replies.length > 0 ? replies : undefined });
    case 'underline':
      return createAnnotation({ ...baseProps, type: 'textUnderline', x: rect.x, y: rect.y, width: rect.w, height: rect.h, color, strokeColor: color, replies: replies.length > 0 ? replies : undefined });
    case 'square': {
      // Detect parametricSymbol round-trip
      const opstype = el.getAttribute('opstype');
      if (opstype === 'scaleRegion') {
        return createAnnotation({
          ...baseProps,
          type: 'scaleRegion',
          x: rect.x, y: rect.y, width: rect.w, height: rect.h,
          scaleString: el.getAttribute('opsscalestring') || '1:100',
          units: el.getAttribute('opsunits') || 'mm',
          label: el.getAttribute('opslabel') || '',
          color: color || '#ff9800',
          lineWidth: width || 1.5,
          borderStyle: 'dashed',
          opacity: 1,
          replies: replies.length > 0 ? replies : undefined
        });
      }
      if (opstype === 'parametricSymbol') {
        const symbolId = el.getAttribute('opssymbolid') || '';
        let params = {};
        try {
          const raw = el.getAttribute('opsparams');
          if (raw) params = JSON.parse(raw);
        } catch (_) { /* ignore */ }
        return createAnnotation({
          ...baseProps,
          type: 'parametricSymbol',
          x: rect.x, y: rect.y, width: rect.w, height: rect.h,
          symbolId,
          params,
          ifcCategory: el.getAttribute('opsifccategory') || ifcCategoryForParametric(symbolId),
          color, strokeColor: color, lineWidth: width,
          subject: contents,
          replies: replies.length > 0 ? replies : undefined
        });
      }
      return createAnnotation({ ...baseProps, type: 'box', x: rect.x, y: rect.y, width: rect.w, height: rect.h, color, strokeColor: color, fillColor: interiorColor, lineWidth: width, subject: contents, replies: replies.length > 0 ? replies : undefined });
    }
    case 'circle':
      return createAnnotation({ ...baseProps, type: 'circle', x: rect.x, y: rect.y, width: rect.w, height: rect.h, color, strokeColor: color, fillColor: interiorColor, lineWidth: width, subject: contents, replies: replies.length > 0 ? replies : undefined });
    case 'line': {
      const start = el.getAttribute('start')?.split(',').map(Number) || [rect.x, rect.y];
      const end = el.getAttribute('end')?.split(',').map(Number) || [rect.x + rect.w, rect.y + rect.h];
      const head = el.getAttribute('head') || 'none';
      const tail = el.getAttribute('tail') || 'none';
      const isArrow = head !== 'none' || tail !== 'none';
      return createAnnotation({ ...baseProps, type: isArrow ? 'arrow' : 'line', startX: start[0], startY: start[1], endX: end[0], endY: end[1], color, strokeColor: color, lineWidth: width, startHead: head, endHead: tail, subject: contents, replies: replies.length > 0 ? replies : undefined });
    }
    case 'ink': {
      const gesture = el.querySelector('gesture')?.textContent || '';
      const path = gesture.split(';').map(p => { const [x, y] = p.split(',').map(Number); return { x, y }; }).filter(p => !isNaN(p.x));
      if (path.length < 2) return null;
      return createAnnotation({ ...baseProps, type: 'draw', path, color, strokeColor: color, lineWidth: width, subject: contents, replies: replies.length > 0 ? replies : undefined });
    }
    case 'text':
      return createAnnotation({ ...baseProps, type: 'comment', x: rect.x, y: rect.y, width: 24, height: 24, text: contents, color, fillColor: color, icon: el.getAttribute('icon') || 'comment', replies: replies.length > 0 ? replies : undefined });
    case 'freetext':
      return createAnnotation({ ...baseProps, type: 'textbox', x: rect.x, y: rect.y, width: rect.w, height: rect.h, text: contents, color, strokeColor: color, fillColor: interiorColor || '#FFFFD0', fontSize: parseInt(el.getAttribute('fontsize')) || 14, textColor: '#000000', replies: replies.length > 0 ? replies : undefined });
    case 'stamp':
      return createAnnotation({ ...baseProps, type: 'stamp', x: rect.x, y: rect.y, width: rect.w, height: rect.h, stampName: el.getAttribute('icon') || 'Draft', stampText: contents, color: color || '#ef4444', stampColor: color || '#ef4444', replies: replies.length > 0 ? replies : undefined });
    default:
      return null;
  }
}

// Helper functions
function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function colorToXFDF(hex) {
  if (!hex) return '#000000';
  return hex.toUpperCase();
}

function xfdfColorToHex(color) {
  if (!color) return '#000000';
  if (color.startsWith('#')) return color;
  // Handle comma-separated RGB (0-1 range)
  const parts = color.split(',').map(Number);
  if (parts.length === 3) {
    const r = Math.round(parts[0] * 255);
    const g = Math.round(parts[1] * 255);
    const b = Math.round(parts[2] * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return color;
}

function parseRect(rectStr) {
  if (!rectStr) return null;
  const parts = rectStr.split(',').map(Number);
  if (parts.length < 4) return null;
  return { x: parts[0], y: parts[1], w: parts[2] - parts[0], h: parts[3] - parts[1] };
}

function commonAttrs(ann) {
  let rect;
  if (ann.x !== undefined) {
    rect = `${ann.x},${ann.y},${ann.x + (ann.width || 0)},${ann.y + (ann.height || 0)}`;
  } else if (ann.startX !== undefined) {
    const x1 = Math.min(ann.startX, ann.endX);
    const y1 = Math.min(ann.startY, ann.endY);
    const x2 = Math.max(ann.startX, ann.endX);
    const y2 = Math.max(ann.startY, ann.endY);
    rect = `${x1},${y1},${x2},${y2}`;
  } else {
    rect = '0,0,0,0';
  }

  return `page="${ann.page - 1}" rect="${rect}" title="${escapeXml(ann.author || 'User')}" subject="${escapeXml(ann.subject || '')}" date="${ann.modifiedAt || ''}" creationdate="${ann.createdAt || ''}"`;
}

function replyToXFDF(reply) {
  return `      <text title="${escapeXml(reply.author || 'User')}" date="${reply.createdAt || ''}">\n` +
         `        <contents>${escapeXml(reply.text || '')}</contents>\n` +
         `      </text>\n`;
}
