import { Show, createEffect, untrack } from 'solid-js';
import {
  active, editorStyle, text, setText, setLineRuns, initialLines, initRevision,
  keyDownHandler, blurHandler, selectOnFocus, setSelectOnFocus,
} from '../stores/pdfTextEditStore.js';
import { normalizeRuns, runsPlainText } from '../../text/text-edit-appearance.js';

// Contenteditable overlay voor het bewerken van bestaande PDF-tekst.
// Contenteditable (i.p.v. textarea) zodat inline opmaak — losse woorden vet of
// cursief via Ctrl+B / Ctrl+I — zichtbaar en uitleesbaar is. De DOM is tijdens
// het bewerken de bron van waarheid; elke invoer wordt geparseerd naar runs
// per regel ({ text, bold, italic }) in de store.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Bouw de initiële DOM: één <div> per regel; runs in <b>/<i>; lege regel <br>.
function buildInitialHtml(lines, plainText) {
  const rows = lines || String(plainText ?? '').split('\n').map(t => [{ text: t, bold: false, italic: false }]);
  return rows.map(row => {
    const runs = Array.isArray(row) ? row : (row?.runs || []);
    const style = Array.isArray(row) ? null : (row?.style || null);
    const inner = (runs || []).map(r => {
      let h = escapeHtml(String(r?.text ?? ''));
      if (r?.italic) h = `<i>${h}</i>`;
      if (r?.bold) h = `<b>${h}</b>`;
      if (r?.color) h = `<span style="color: ${escapeHtml(r.color)}">${h}</span>`;
      return h;
    }).join('');
    let st = '';
    if (style) {
      const parts = [];
      if (style.fontFamily) parts.push(`font-family: ${String(style.fontFamily).replace(/"/g, '&quot;')}`);
      if (Number(style.fontSizePx) > 0) parts.push(`font-size: ${Number(style.fontSizePx)}px`);
      if (style.color) parts.push(`color: ${style.color}`);
      if (parts.length) st = ` style="${parts.join('; ')}"`;
    }
    return `<div${st}>${inner || '<br>'}</div>`;
  }).join('');
}

// Parse de contenteditable-DOM naar runs per regel.
function parseEditorDom(root) {
  const lines = [[]];
  const pushRun = (text, bold, italic, color) => {
    if (text) lines[lines.length - 1].push({ text, bold, italic, ...(color ? { color } : {}) });
  };
  const isBlockTag = (t) => t === 'DIV' || t === 'P';
  const walk = (node, bold, italic, color) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = node.data.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push([]);
        pushRun(parts[i], bold, italic, color);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
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
    if (tag === 'FONT' && node.getAttribute('color')) c = cssColorToHex(node.getAttribute('color')) || c;
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
function cssColorToHex(css) {
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

export default function PdfTextEditOverlay() {
  let editorRef;

  const syncFromDom = () => {
    if (!editorRef) return;
    const lines = parseEditorDom(editorRef);
    setLineRuns(lines);
    setText(lines.map(runsPlainText).join('\n'));
  };

  const resizeToContent = () => {
    if (!editorRef) return;
    const base = editorStyle() || {};
    const minWidth = parseFloat(base.width) || 80;
    const minHeight = parseFloat(base.height) || 24;

    // white-space: pre keeps the live layout identical to the saved PDF: only
    // an explicit Enter creates a new line. Grow instead of introducing a
    // visual wrap that would disappear after saving.
    editorRef.style.width = `${minWidth}px`;
    editorRef.style.height = '0px';
    editorRef.style.height = `${Math.max(minHeight, editorRef.scrollHeight)}px`;
    editorRef.style.width = `${Math.max(minWidth, editorRef.scrollWidth + 2)}px`;
  };

  // (Her)opbouwen van de inhoud bij elke nieuwe editsessie.
  createEffect(() => {
    initRevision();
    if (!active() || !editorRef) return;
    try { document.execCommand('styleWithCSS', false, false); } catch (_) { /* optioneel */ }
    // untrack: de store-tekst wordt hier alleen als beginwaarde gelezen; de
    // eigen sync mag dit effect niet opnieuw laten draaien.
    editorRef.innerHTML = buildInitialHtml(initialLines(), untrack(text));
    syncFromDom();
    queueMicrotask(resizeToContent);
    editorRef.focus();
    if (selectOnFocus()) {
      try { document.execCommand('selectAll', false, null); } catch (_) { /* selectie is best effort */ }
      setSelectOnFocus(false);
    }
  });

  const handleKeyDown = (e) => {
    // Inline opmaak: Ctrl/Cmd+B en Ctrl/Cmd+I op de huidige selectie.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('bold');
      syncFromDom();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('italic');
      syncFromDom();
      return;
    }
    // Ctrl+S tijdens het typen: bewust negeren (geen native save-dialoog,
    // geen half-gesloten editor). Opslaan kan na commit (Ctrl+Enter) gewoon.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Ctrl+U: onderdrukken — native contenteditable-onderstreping zou een
    // <u>-run maken die het runs-model niet kent; onderstrepen gaat via het
    // eigenschappenpaneel (record-breed).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Tab-teken typen i.p.v. focus verplaatsen (kolomstructuur bewerkbaar).
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('insertText', false, '\t');
      syncFromDom();
      return;
    }
    // Verse sync voor de externe handler: die kan committen (Ctrl+Enter/
    // Escape) en moet de actuele runs zien, ook als een programmatische
    // mutatie geen input-event opleverde.
    syncFromDom();
    const handler = keyDownHandler();
    if (handler) handler(e);
  };

  const handleBlur = () => {
    syncFromDom(); // zelfde reden als bij keydown: blur kan committen
    const handler = blurHandler();
    if (handler) handler();
  };

  return (
    <Show when={active()}>
      <div
        ref={editorRef}
        class="pdf-text-editor"
        dir="auto"
        contenteditable="true"
        spellcheck={false}
        style={{ 'white-space': 'pre', ...editorStyle() }}
        onInput={() => {
          syncFromDom();
          queueMicrotask(resizeToContent);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </Show>
  );
}
