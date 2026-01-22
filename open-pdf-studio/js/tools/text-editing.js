import { state } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { showProperties } from '../ui/properties-panel.js';

// Start inline text editing for textbox/callout
export function startTextEditing(annotation) {
  if (state.isEditingText) {
    finishTextEditing();
  }

  if (!['textbox', 'callout'].includes(annotation.type)) return;
  if (annotation.locked) return;

  // Get canvas element dynamically (not from import, which may be null)
  const canvas = document.getElementById('annotation-canvas');
  if (!canvas) return;

  state.isEditingText = true;
  state.editingAnnotation = annotation;

  // Create textarea overlay
  const textarea = document.createElement('textarea');
  textarea.className = 'inline-text-editor';
  textarea.value = annotation.text || '';

  // Get canvas position
  const canvasRect = canvas.getBoundingClientRect();

  // Calculate position based on annotation
  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const scaledWidth = width * state.scale;
  const scaledHeight = height * state.scale;

  // Calculate center position of the annotation
  const centerX = canvasRect.left + (annotation.x + width / 2) * state.scale;
  const centerY = canvasRect.top + (annotation.y + height / 2) * state.scale;

  // Style the textarea - position by center using transform
  textarea.style.position = 'fixed';
  textarea.style.left = `${centerX}px`;
  textarea.style.top = `${centerY}px`;
  textarea.style.width = `${scaledWidth}px`;
  textarea.style.height = `${scaledHeight}px`;
  textarea.style.fontSize = `${(annotation.fontSize || 14) * state.scale}px`;
  textarea.style.fontFamily = annotation.fontFamily || 'Arial';
  textarea.style.color = annotation.textColor || annotation.color || '#000000';
  textarea.style.backgroundColor = annotation.fillColor && annotation.fillColor !== 'transparent'
    ? annotation.fillColor : '#ffffff';
  textarea.style.border = `${(annotation.lineWidth || 1) * state.scale}px solid ${annotation.strokeColor || '#000000'}`;
  textarea.style.padding = '5px';
  textarea.style.boxSizing = 'border-box';
  textarea.style.resize = 'none';
  textarea.style.outline = 'none';
  textarea.style.zIndex = '10000';
  textarea.style.overflow = 'hidden';

  // Apply transform: center the element and optionally rotate
  if (annotation.rotation) {
    textarea.style.transform = `translate(-50%, -50%) rotate(${annotation.rotation}deg)`;
  } else {
    textarea.style.transform = 'translate(-50%, -50%)';
  }

  // Apply text styles
  if (annotation.fontBold) textarea.style.fontWeight = 'bold';
  if (annotation.fontItalic) textarea.style.fontStyle = 'italic';
  if (annotation.textAlign) textarea.style.textAlign = annotation.textAlign;
  if (annotation.lineSpacing) textarea.style.lineHeight = annotation.lineSpacing;

  // Add to document
  document.body.appendChild(textarea);
  state.textEditElement = textarea;

  // Focus and select all
  textarea.focus();
  textarea.select();

  // Handle keydown events
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Cancel editing
      state.textEditElement.value = annotation.text || '';
      finishTextEditing();
    }
    // Don't propagate keyboard events during editing
    e.stopPropagation();
  });

  // Add blur listener after a short delay to prevent immediate blur from mouseup
  setTimeout(() => {
    if (state.textEditElement === textarea) {
      textarea.addEventListener('blur', finishTextEditing);
    }
  }, 100);
}

// Finish inline text editing
export function finishTextEditing() {
  if (!state.isEditingText || !state.editingAnnotation) return;

  const annotation = state.editingAnnotation;
  const textarea = state.textEditElement;

  if (textarea) {
    // Update annotation text
    annotation.text = textarea.value;
    annotation.modifiedAt = new Date().toISOString();

    // Remove textarea
    textarea.remove();
  }

  // Reset state
  state.isEditingText = false;
  state.editingAnnotation = null;
  state.textEditElement = null;

  // Refresh display
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  // Update properties panel
  if (state.selectedAnnotation === annotation) {
    showProperties(annotation);
  }
}

// Add text annotation at position
export function addTextAnnotation(x, y) {
  const text = prompt('Enter text:');
  if (text) {
    const annotation = {
      type: 'text',
      page: state.currentPage,
      x: x,
      y: y,
      text: text,
      fontSize: state.preferences?.defaultFontSize || 16,
      color: state.preferences?.defaultAnnotationColor || '#000000',
      author: state.defaultAuthor,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      locked: false,
      printable: true
    };

    state.annotations.push(annotation);

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Add comment/sticky note at position
export function addComment(x, y) {
  const text = prompt('Enter comment:');
  if (text !== null) { // Allow empty comments
    const annotation = {
      type: 'comment',
      page: state.currentPage,
      x: x,
      y: y,
      width: 24,
      height: 24,
      text: text,
      color: '#FFFF00',
      fillColor: '#FFFF00',
      icon: 'comment',
      author: state.defaultAuthor,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      locked: false,
      printable: true
    };

    state.annotations.push(annotation);

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}
