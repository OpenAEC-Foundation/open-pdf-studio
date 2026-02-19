import { createSignal, onMount, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { systemFontList } from '../../stores/fontStore.js';

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72];

export default function TextAnnotationDialog(props) {
  const onResult = props.data?.onResult;

  const [fontFamily, setFontFamily] = createSignal('Arial');
  const [fontSize, setFontSize] = createSignal(16);
  const [bold, setBold] = createSignal(false);
  const [italic, setItalic] = createSignal(false);
  const [underline, setUnderline] = createSignal(false);
  const [align, setAlign] = createSignal('left');
  const [color, setColor] = createSignal('#000000');
  const [text, setText] = createSignal('');

  let textareaRef;

  onMount(() => {
    if (textareaRef) {
      textareaRef.focus();
    }
  });

  const close = () => {
    onResult?.(null);
    closeDialog('text-annotation');
  };

  const handleOk = () => {
    const value = text();
    if (!value.trim()) {
      onResult?.(null);
      closeDialog('text-annotation');
      return;
    }
    onResult?.({
      text: value,
      fontFamily: fontFamily(),
      fontSize: fontSize(),
      fontBold: bold(),
      fontItalic: italic(),
      fontUnderline: underline(),
      textAlign: align(),
      color: color(),
    });
    closeDialog('text-annotation');
  };

  const handleKeyDown = (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleOk();
    } else if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      setBold(!bold());
    } else if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      setItalic(!italic());
    } else if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      setUnderline(!underline());
    }
  };

  const setAlignValue = (value) => {
    setAlign(value);
  };

  const previewStyle = () => ({
    'font-family': fontFamily(),
    'font-size': fontSize() + 'px',
    'font-weight': bold() ? 'bold' : 'normal',
    'font-style': italic() ? 'italic' : 'normal',
    'text-decoration': underline() ? 'underline' : 'none',
    'text-align': align(),
    'color': color(),
  });

  const textareaStyle = () => ({
    'font-family': fontFamily(),
    'font-size': fontSize() + 'px',
    'font-weight': bold() ? 'bold' : 'normal',
    'font-style': italic() ? 'italic' : 'normal',
    'text-decoration': underline() ? 'underline' : 'none',
    'text-align': align(),
    'color': color(),
  });

  const footer = (
    <div class="text-annot-footer" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:0;">
      <div class="text-annot-char-count">
        <span>{() => text().length}</span> characters
      </div>
      <div class="text-annot-footer-right">
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
        <button class="pref-btn pref-btn-primary" onClick={handleOk}>OK</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title="Add Text"
      overlayClass="text-annot-overlay"
      dialogClass="text-annot-dialog"
      headerClass="text-annot-header"
      bodyClass="text-annot-body"
      footerClass="text-annot-footer"
      onClose={close}
      footer={footer}
    >
      {/* Toolbar */}
      <div class="text-annot-toolbar" onKeyDown={handleKeyDown}>
        <div class="text-annot-toolbar-group">
          <select
            id="text-annot-font-family"
            title="Font Family"
            value={fontFamily()}
            onChange={(e) => setFontFamily(e.target.value)}
          >
            <For each={systemFontList()}>
              {(font) => <option value={font} style={{ 'font-family': `'${font}', sans-serif` }}>{font}</option>}
            </For>
          </select>
          <select
            id="text-annot-font-size"
            title="Font Size"
            value={fontSize()}
            onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
          >
            {FONT_SIZES.map((s) => (
              <option value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div class="text-annot-toolbar-separator" />

        <div class="text-annot-toolbar-group">
          <button
            type="button"
            class="text-annot-toolbar-btn"
            classList={{ active: bold() }}
            title="Bold (Ctrl+B)"
            onClick={() => setBold(!bold())}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" />
            </svg>
          </button>
          <button
            type="button"
            class="text-annot-toolbar-btn"
            classList={{ active: italic() }}
            title="Italic (Ctrl+I)"
            onClick={() => setItalic(!italic())}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" />
            </svg>
          </button>
          <button
            type="button"
            class="text-annot-toolbar-btn"
            classList={{ active: underline() }}
            title="Underline (Ctrl+U)"
            onClick={() => setUnderline(!underline())}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" />
            </svg>
          </button>
        </div>

        <div class="text-annot-toolbar-separator" />

        <div class="text-annot-toolbar-group">
          <button
            type="button"
            class="text-annot-toolbar-btn"
            classList={{ active: align() === 'left' }}
            title="Align Left"
            onClick={() => setAlignValue('left')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z" />
            </svg>
          </button>
          <button
            type="button"
            class="text-annot-toolbar-btn"
            classList={{ active: align() === 'center' }}
            title="Align Center"
            onClick={() => setAlignValue('center')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z" />
            </svg>
          </button>
          <button
            type="button"
            class="text-annot-toolbar-btn"
            classList={{ active: align() === 'right' }}
            title="Align Right"
            onClick={() => setAlignValue('right')}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z" />
            </svg>
          </button>
        </div>

        <div class="text-annot-toolbar-separator" />

        <div class="text-annot-toolbar-group">
          <div class="text-annot-color-picker">
            <label title="Text Color">
              <div
                class="text-annot-color-swatch"
                style={{ background: color() }}
              />
              <input
                type="color"
                value={color()}
                onInput={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        id="text-annot-input"
        placeholder="Type your text here..."
        spellcheck={true}
        value={text()}
        style={textareaStyle()}
        onInput={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      {/* Preview */}
      <div class="text-annot-preview-label">Preview:</div>
      <div class="text-annot-preview" style={previewStyle()}>
        {() => text() || 'Sample text'}
      </div>
    </Dialog>
  );
}
