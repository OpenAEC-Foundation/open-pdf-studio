import { Show, createEffect, createMemo, untrack, onCleanup } from 'solid-js';
import {
  active, overlayStyle, text, setText, setLineRuns, initialRuns, onCommit, onCancel,
  hideTextEditOverlay, heightGrowth, setHeightGrowth, setEditorFormatHandler,
} from '../stores/textEditOverlayStore.js';
import { state } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { parseEditorDom } from '../../text/editor-dom-parse.js';
import { runsPlainText } from '../../text/text-edit-appearance.js';

// Inline editor voor tekstvlakken (textbox/callout).
//
// Contenteditable in plaats van textarea, zodat een DEEL van de tekst vet of
// cursief kan zijn (Ctrl+B / Ctrl+I op de selectie, of de knoppen in het
// eigenschappenpaneel). De DOM is tijdens het bewerken de bron van waarheid;
// elke invoer wordt geparseerd naar runs per regel ({ text, bold, italic })
// in de store, en de commit levert tekst én runs aan text-editing.js.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Eén <div> per regel; runs in <b>/<i>; lege regel <br>. Zonder runs krijgt
// elke regel de basisstijl van het vlak (fontBold/fontItalic) als run, zodat
// de parser na het bewerken absolute runs teruggeeft.
function buildInitialHtml(lines, plainText, base) {
  const rows = Array.isArray(lines) && lines.length
    ? lines
    : String(plainText ?? '').split('\n').map(t => (t ? [{ text: t, bold: base.bold, italic: base.italic }] : []));
  return rows.map(runs => {
    const inner = (runs || []).map(r => {
      let h = escapeHtml(String(r?.text ?? ''));
      if (r?.italic) h = `<i>${h}</i>`;
      if (r?.bold) h = `<b>${h}</b>`;
      return h;
    }).join('');
    return `<div>${inner || '<br>'}</div>`;
  }).join('');
}

export default function TextEditOverlay() {
  let editorRef;

  const syncFromDom = () => {
    if (!editorRef) return;
    const lines = parseEditorDom(editorRef);
    setLineRuns(lines);
    setText(lines.map(runsPlainText).join('\n'));
  };

  function autoGrow() {
    if (!editorRef) return;
    const overflow = editorRef.scrollHeight - editorRef.clientHeight;
    if (overflow > 0) setHeightGrowth(g => g + overflow);
  }

  // Vet/cursief op de selectie; zonder selectie op het woord onder de caret.
  // Onderstrepen blijft record-breed (het runs-model kent geen <u>).
  function applyFormat(prop, value) {
    if (!editorRef) return false;
    const ann = state.editingAnnotation;
    if (prop === 'fontUnderline') {
      if (ann) { ann.fontUnderline = value ?? !ann.fontUnderline; redraw(); }
      return true;
    }
    if (prop !== 'fontBold' && prop !== 'fontItalic') return false;
    editorRef.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.isCollapsed) {
      // Geen selectie: het hele woord onder de caret.
      try { sel.modify('move', 'backward', 'word'); sel.modify('extend', 'forward', 'word'); } catch (_) { /* best effort */ }
    }
    const cmd = prop === 'fontBold' ? 'bold' : 'italic';
    const nu = document.queryCommandState(cmd);
    if (value === undefined || value === null || !!value !== nu) document.execCommand(cmd);
    syncFromDom();
    redraw();
    return true;
  }

  function redraw() {
    if (state.documents?.[state.activeDocumentIndex]?.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
  }

  createEffect(() => {
    if (!active() || !editorRef) return;
    try { document.execCommand('styleWithCSS', false, false); } catch (_) { /* optioneel */ }
    const ann = state.editingAnnotation;
    const base = { bold: !!ann?.fontBold, italic: !!ann?.fontItalic };
    editorRef.innerHTML = buildInitialHtml(untrack(initialRuns), untrack(text), base);
    syncFromDom();
    editorRef.focus();
    try { document.execCommand('selectAll', false, null); } catch (_) { /* best effort */ }
    requestAnimationFrame(() => autoGrow());
  });

  setEditorFormatHandler(applyFormat);
  onCleanup(() => setEditorFormatHandler(null));

  const handleBlur = () => {
    if (!active()) return;
    syncFromDom();
    const commitFn = onCommit();
    if (commitFn) commitFn(text());
    hideTextEditOverlay();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const cancelFn = onCancel();
      if (cancelFn) cancelFn();
      hideTextEditOverlay();
      // Escape verlaat de hele plaats-tekst-flow: terug naar selecteren, zodat
      // de volgende klik niet weer een tekstvlak neerzet.
      import('../../tools/manager.js').then(m => m.setTool && m.setTool('select')).catch(() => {});
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); e.stopPropagation(); applyFormat('fontBold'); return; }
      if (k === 'i') { e.preventDefault(); e.stopPropagation(); applyFormat('fontItalic'); return; }
      if (k === 'u') { e.preventDefault(); e.stopPropagation(); applyFormat('fontUnderline'); return; }
    }
    // Toetsen niet doorgeven tijdens het bewerken.
    e.stopPropagation();
  };

  const handleInput = () => {
    syncFromDom();
    requestAnimationFrame(() => autoGrow());
  };

  // Plakken als platte tekst (geen vreemde opmaak uit het klembord).
  const handlePaste = (e) => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
    document.execCommand('insertText', false, t);
  };

  // Wrapper (positie/maat/clip) los van de editorstijl (font/kleuren).
  const wrapperStyle = createMemo(() => {
    const s = overlayStyle();
    const growth = heightGrowth();
    const baseH = parseFloat(s.height) || 0;
    const baseTop = parseFloat(s.top) || 0;
    return {
      position: s.position,
      left: s.left,
      top: `${baseTop + growth / 2}px`,
      width: s.width,
      height: `${baseH + growth}px`,
      transform: s.transform,
      'z-index': s['z-index'],
      overflow: 'hidden',
      'pointer-events': 'auto',
    };
  });

  const editorStyle = createMemo(() => {
    const s = overlayStyle();
    const ts = { ...s };
    delete ts.position;
    delete ts.left;
    delete ts.top;
    delete ts.transform;
    delete ts['z-index'];
    delete ts['--text-offset'];
    // De basisstijl van het vlak is via de runs in de DOM zichtbaar; het
    // element zelf blijft 'normal' zodat <b>/<i> het verschil maken.
    ts['font-weight'] = 'normal';
    ts['font-style'] = 'normal';
    const ann = state.editingAnnotation;
    if (ann) {
      ts['text-decoration'] = ann.fontUnderline ? 'underline' : 'none';
      if (ann.textColor) ts.color = ann.textColor;
      if (ann.fontFamily) {
        const raw = ann.fontFamily;
        const q = v => `"${v.replace(/"/g, '\\"')}"`;
        const exp = raw.replace(/([a-z])([A-Z])/g, '$1 $2');
        const ch = [];
        if (exp !== raw) ch.push(q(exp));
        ch.push(/[\s"',]/.test(raw) ? q(raw) : raw);
        ch.push('sans-serif');
        ts['font-family'] = ch.join(', ');
      }
    }
    ts.position = 'absolute';
    ts.left = '0';
    ts.top = '0';
    ts.width = '100%';
    ts.height = '100%';
    ts['white-space'] = 'pre-wrap';
    ts['overflow-wrap'] = 'break-word';
    ts['overflow-y'] = 'hidden';
    return ts;
  });

  return (
    <Show when={active()}>
      <div style={wrapperStyle()}>
        <div
          ref={editorRef}
          class="inline-text-editor"
          dir="auto"
          contenteditable="true"
          spellcheck={false}
          style={editorStyle()}
          onInput={handleInput}
          onPaste={handlePaste}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </div>
    </Show>
  );
}
