// ── Contenteditable-DOM → runs per regel (puur) ──
//
// Geëxtraheerd uit PdfTextEditOverlay zodat de parse unit-testbaar is met
// nagebootste DOM-knopen. Gebruikt alleen: nodeType (3=tekst, 1=element),
// data, childNodes, tagName, classList.contains, style, getAttribute,
// previousSibling/nextSibling, parentElement.
//
// BELANGRIJK gedragscontract: ALLE child-knopen worden in documentvolgorde
// meegenomen — ook kale tekstknopen die de browser bij het typen aan het
// einde van een regel (of zelfs op root-niveau na de laatste regel-div)
// neerzet. Zo'n knoop hoort bij de dan-geopende regel; hem overslaan zou een
// zojuist getypte toevoeging stilletjes laten verdwijnen bij commit.

import { normalizeRuns } from './text-edit-appearance.js';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export function parseEditorDom(root) {
  const lines = [[]];
  const pushRun = (text, bold, italic, color) => {
    if (text) lines[lines.length - 1].push({ text, bold, italic, ...(color ? { color } : {}) });
  };
  const isBlockTag = (t) => t === 'DIV' || t === 'P';
  const walk = (node, bold, italic, color) => {
    if (node.nodeType === TEXT_NODE) {
      // \r-varianten normaliseren: ook een letterlijke CR (of CRLF) — uit
      // synthetische invoer of geplakte tekst — telt als regeleinde; anders
      // belandt hij als onzichtbaar teken IN de run en plakt de saver twee
      // regels op een baseline aaneen.
      const parts = String(node.data ?? '').split(/\r\n?|\n/);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push([]);
        pushRun(parts[i], bold, italic, color);
      }
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    if (node.classList && node.classList.contains('pdf-tab-spacer')) {
      pushRun('\t', bold, italic, color);
      return;
    }
    const tag = node.tagName;
    if (tag === 'BR') {
      // In een leeg blok is <br> slechts de placeholder: het blok zelf heeft
      // de regel al geopend.
      const p = node.parentElement;
      const soleInBlock = p && p !== root && isBlockTag(p.tagName)
        && !node.previousSibling && !node.nextSibling;
      if (!soleInBlock) lines.push([]);
      return;
    }
    let b = bold;
    let i = italic;
    let c = color;
    if (tag === 'B' || (tag === 'STRONG')) b = true;
    if (tag === 'I' || (tag === 'EM')) i = true;
    const st = node.style;
    if (st && st.fontWeight) {
      if (st.fontWeight === 'bold' || parseInt(st.fontWeight, 10) >= 600) b = true;
      else if (st.fontWeight === 'normal') b = false;
    }
    if (st && st.fontStyle) {
      if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') i = true;
      else if (st.fontStyle === 'normal') i = false;
    }
    const isBlock = isBlockTag(tag);
    // Kleur op de regel-div is de per-regel basisstijl (geen run-kleur);
    // kleur op inline elementen (span/font/b/i) is wel een run-kleur.
    if (tag === 'FONT' && typeof node.getAttribute === 'function' && node.getAttribute('color')) {
      c = cssColorToHex(node.getAttribute('color')) || c;
    }
    if (!isBlock && st && st.color) c = cssColorToHex(st.color) || c;
    if (isBlock && !(lines.length === 1 && lines[0].length === 0)) {
      lines.push([]);
    }
    for (const child of node.childNodes) walk(child, b, i, c);
  };
  for (const child of root.childNodes) walk(child, false, false, null);
  return lines.map(normalizeRuns);
}

// 'rgb(r, g, b)' of '#rgb'/'#rrggbb' -> '#rrggbb' (lowercase).
export function cssColorToHex(css) {
  const v = String(css || '').trim();
  if (!v) return null;
  const m = v.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) {
    const h = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return null;
}
