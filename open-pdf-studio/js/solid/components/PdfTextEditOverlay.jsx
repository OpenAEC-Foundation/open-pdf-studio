import { Show, createEffect, untrack } from 'solid-js';
import {
  active, editorStyle, text, setText, setLineRuns, initialLines, initRevision,
  keyDownHandler, blurHandler, selectOnFocus, setSelectOnFocus, dragHandlers,
} from '../stores/pdfTextEditStore.js';
import { normalizeRuns, runsPlainText } from '../../text/text-edit-appearance.js';
import { parseEditorDom } from '../../text/editor-dom-parse.js';

// Contenteditable overlay voor het bewerken van bestaande PDF-tekst.
// Contenteditable (i.p.v. textarea) zodat inline opmaak — losse woorden vet of
// cursief via Ctrl+B / Ctrl+I — zichtbaar en uitleesbaar is. De DOM is tijdens
// het bewerken de bron van waarheid; elke invoer wordt geparseerd naar runs
// per regel ({ text, bold, italic }) in de store.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Bouw de initiële DOM: één <div> per regel; runs in <b>/<i>; lege regel <br>.
// Atomische tab-spacer: representeert een TAB-teken in de contenteditable.
// contenteditable="false" maakt hem 1 caret-eenheid (Backspace/Delete
// verwijdert de hele tab); de breedte wordt per spacer berekend zodat elke
// kolom exact op zijn eigen doel-x ligt (data-stop, in editor-px vanaf de
// regelrand) - het uniforme CSS-tab-size-raster kon maar 1 kolomafstand aan.
function tabSpacerHtml(stop) {
  const stopAttr = Number.isFinite(stop) ? ` data-stop="${Math.round(stop * 100) / 100}"` : '';
  return `<span class="pdf-tab-spacer" contenteditable="false"`
    + ` style="display:inline-block;min-width:4px"${stopAttr}></span>`;
}

function buildInitialHtml(lines, plainText) {
  const rows = lines || String(plainText ?? '').split('\n').map(t => [{ text: t, bold: false, italic: false }]);
  return rows.map(row => {
    const runs = Array.isArray(row) ? row : (row?.runs || []);
    const style = Array.isArray(row) ? null : (row?.style || null);
    const stops = (!Array.isArray(row) && Array.isArray(row?.tabStops)) ? row.tabStops : null;
    let tabIndex = 0;
    const inner = (runs || []).map(r => {
      const delen = String(r?.text ?? '').split('\t');
      let h = '';
      delen.forEach((deel, k) => {
        if (k > 0) {
          h += tabSpacerHtml(stops ? stops[tabIndex] : null);
          tabIndex += 1;
        }
        h += escapeHtml(deel);
      });
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

export default function PdfTextEditOverlay() {
  let editorRef;

  const syncFromDom = () => {
    if (!editorRef) return;
    const lines = parseEditorDom(editorRef);
    setLineRuns(lines);
    setText(lines.map(runsPlainText).join('\n'));
  };

  // Per-spacer-breedtes leggen: elke tab krijgt precies de breedte die het
  // volgende segment op zijn doel-x (data-stop) brengt. Spacers zonder
  // doel-x (nieuw getypte tab) springen naar de eerstvolgende raster-stop en
  // leggen die vast. Volgorde links-naar-rechts: latere spacers meten de
  // positie inclusief eerdere breedtes. Minimum 4px zodat hij klikbaar
  // blijft; loopt een segment over zijn kolom heen, dan schuift de volgende
  // kolom op (zelfde gedrag als de saver met de kolom-overloop-warn).
  const layoutTabSpacers = () => {
    if (!editorRef) return;
    const spacers = editorRef.querySelectorAll('.pdf-tab-spacer');
    if (!spacers.length) return;
    const st = editorStyle() || {};
    const grid = parseFloat(st['tab-size']) || 0;
    for (const sp of spacers) {
      const lijn = sp.closest('div') || editorRef;
      sp.style.width = '0px';
      const x = sp.getBoundingClientRect().left - lijn.getBoundingClientRect().left;
      let doel = Number(sp.dataset.stop);
      if (!Number.isFinite(doel)) {
        doel = grid > 1 ? (Math.floor(x / grid) + 1) * grid : x + 24;
        sp.dataset.stop = String(Math.round(doel * 100) / 100);
      }
      sp.style.width = `${Math.max(4, doel - x)}px`;
    }
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
    queueMicrotask(() => { layoutTabSpacers(); resizeToContent(); });
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
      document.execCommand('insertHTML', false, tabSpacerHtml(null));
      layoutTabSpacers();
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

  // ── Versleep-grip ──
  // Klein handvat linksboven naast de editor: slepen verplaatst het hele
  // tekstblok (live, via de tool-nudge die record én editor meebeweegt);
  // Escape tijdens het slepen breekt af en zet alles terug. Het handvat telt
  // als opmaak-UI (data-keep-text-editor) zodat pointerdown erop de editor
  // niet commit.
  const startGripDrag = (e) => {
    const h = dragHandlers();
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      if (!dx && !dy) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      try { h.onDragBy?.(dx, dy); } catch (_) { /* verplaatsing is best effort */ }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('keydown', key, true);
    };
    const stop = () => {
      cleanup();
      try { h.onDragEnd?.(); } catch (_) { /* best effort */ }
    };
    const key = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cleanup();
      try { h.onDragCancel?.(); } catch (_) { /* best effort */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('keydown', key, true);
  };

  const gripStyle = () => {
    const st = editorStyle() || {};
    const left = (parseFloat(st.left) || 0) - 16;
    const top = (parseFloat(st.top) || 0) - 2;
    return {
      position: st.position || 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: '12px',
      height: '20px',
      cursor: 'move',
      background: '#e8e8e8',
      border: '1px solid #999999',
      'box-sizing': 'border-box',
      'z-index': st['z-index'] || '1000',
      // drie streepjes als grip-indicatie
      'background-image': 'repeating-linear-gradient(to bottom, #999 0 1px, transparent 1px 4px)',
      'background-clip': 'content-box',
      padding: '3px 2px',
    };
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
          queueMicrotask(() => { layoutTabSpacers(); resizeToContent(); });
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      <Show when={dragHandlers()}>
        <div
          class="pdf-text-editor-grip"
          data-keep-text-editor="1"
          title="Sleep om het tekstblok te verplaatsen (Esc annuleert)"
          style={gripStyle()}
          onPointerDown={startGripDrag}
        />
      </Show>
    </Show>
  );
}
