import { state } from '../../core/state.js';
import { recordPropertyChange } from '../../core/undo-manager.js';
import {
  propColor, propLineWidth, propText, propFontSize,
  propSubject, propAuthor, propOpacity, propIcon, propLocked, propPrintable,
  propFillColor, propStrokeColor, propBorderStyle, propertiesPanel,
  propTextColor, propFontFamily, propTextFontSize, propLineSpacing,
  propTextBold, propTextItalic, propTextUnderline, propTextStrikethrough,
  propAlignLeft, propAlignCenter, propAlignRight,
  propImageWidth, propImageHeight, propImageRotation, propImageReset,
  propArrowStart, propArrowEnd, propArrowHeadSize,
  propTextboxRotation
} from '../dom-elements.js';
import { showProperties, hideProperties, closePropertiesPanel, updateAnnotationProperties, updateTextFormatProperties, updateArrowProperties } from '../panels/properties-panel.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

// Setup properties panel event listeners
export function setupPropertiesPanelEvents() {
  propColor?.addEventListener('input', updateAnnotationProperties);
  propLineWidth?.addEventListener('input', updateAnnotationProperties);
  propText?.addEventListener('input', updateAnnotationProperties);
  propFontSize?.addEventListener('input', updateAnnotationProperties);
  propSubject?.addEventListener('input', updateAnnotationProperties);
  propAuthor?.addEventListener('input', updateAnnotationProperties);
  // Track Ctrl key state for opacity snapping
  let ctrlKeyDown = false;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control') ctrlKeyDown = true;
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control') ctrlKeyDown = false;
  });

  propOpacity?.addEventListener('input', () => {
    // Snap to nearest 10 only when Ctrl is held
    if (ctrlKeyDown) {
      const snapped = Math.round(propOpacity.value / 10) * 10;
      propOpacity.value = snapped;
    }
    updateAnnotationProperties();
  });
  propIcon?.addEventListener('change', updateAnnotationProperties);
  propLocked?.addEventListener('change', updateAnnotationProperties);
  propPrintable?.addEventListener('change', updateAnnotationProperties);
  propFillColor?.addEventListener('input', updateAnnotationProperties);
  propStrokeColor?.addEventListener('input', updateAnnotationProperties);
  propBorderStyle?.addEventListener('change', updateAnnotationProperties);

  const propReadOnly = document.getElementById('prop-readonly');
  const propMarked = document.getElementById('prop-marked');
  propReadOnly?.addEventListener('change', updateAnnotationProperties);
  propMarked?.addEventListener('change', updateAnnotationProperties);

  // Text formatting
  propTextColor?.addEventListener('input', updateTextFormatProperties);
  propFontFamily?.addEventListener('change', updateTextFormatProperties);
  propTextFontSize?.addEventListener('change', updateTextFormatProperties);
  propLineSpacing?.addEventListener('change', updateTextFormatProperties);

  // Text style buttons
  propTextBold?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontBold = !state.selectedAnnotation.fontBold;
      propTextBold.classList.toggle('active', state.selectedAnnotation.fontBold);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextItalic?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontItalic = !state.selectedAnnotation.fontItalic;
      propTextItalic.classList.toggle('active', state.selectedAnnotation.fontItalic);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextUnderline?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontUnderline = !state.selectedAnnotation.fontUnderline;
      propTextUnderline.classList.toggle('active', state.selectedAnnotation.fontUnderline);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propTextStrikethrough?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.fontStrikethrough = !state.selectedAnnotation.fontStrikethrough;
      propTextStrikethrough.classList.toggle('active', state.selectedAnnotation.fontStrikethrough);
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  // Text alignment buttons
  propAlignLeft?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.textAlign = 'left';
      propAlignLeft.classList.add('active');
      propAlignCenter?.classList.remove('active');
      propAlignRight?.classList.remove('active');
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propAlignCenter?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.textAlign = 'center';
      propAlignLeft?.classList.remove('active');
      propAlignCenter.classList.add('active');
      propAlignRight?.classList.remove('active');
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propAlignRight?.addEventListener('click', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.textAlign = 'right';
      propAlignLeft?.classList.remove('active');
      propAlignCenter?.classList.remove('active');
      propAlignRight.classList.add('active');
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  // Image properties
  propImageWidth?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.width = parseInt(propImageWidth.value) || 20;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageHeight?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.height = parseInt(propImageHeight.value) || 20;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageRotation?.addEventListener('input', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.rotation = parseInt(propImageRotation.value) || 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  propImageReset?.addEventListener('click', () => {
    if (state.selectedAnnotation && state.selectedAnnotation.type === 'image') {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.width = state.selectedAnnotation.originalWidth;
      state.selectedAnnotation.height = state.selectedAnnotation.originalHeight;
      state.selectedAnnotation.rotation = 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      showProperties(state.selectedAnnotation);
      redrawAnnotations();
    }
  });

  // Textbox rotation
  propTextboxRotation?.addEventListener('input', () => {
    if (state.selectedAnnotation && ['textbox', 'callout'].includes(state.selectedAnnotation.type)) {
      recordPropertyChange(state.selectedAnnotation);
      state.selectedAnnotation.rotation = parseInt(propTextboxRotation.value) || 0;
      state.selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });

  // Arrow properties
  propArrowStart?.addEventListener('change', updateArrowProperties);
  propArrowEnd?.addEventListener('change', updateArrowProperties);
  propArrowHeadSize?.addEventListener('input', updateArrowProperties);


  // Status change
  document.getElementById('prop-status')?.addEventListener('change', () => {
    updateAnnotationProperties();
  });

  // Alt text change
  document.getElementById('prop-alt-text')?.addEventListener('input', () => {
    updateAnnotationProperties();
  });

  // Reply add button
  document.getElementById('prop-reply-add')?.addEventListener('click', () => {
    const input = document.getElementById('prop-reply-input');
    if (!input || !input.value.trim() || !state.selectedAnnotation) return;
    if (!state.selectedAnnotation.replies) state.selectedAnnotation.replies = [];
    state.selectedAnnotation.replies.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      author: state.defaultAuthor || 'User',
      text: input.value.trim(),
      createdAt: new Date().toISOString()
    });
    state.selectedAnnotation.modifiedAt = new Date().toISOString();
    input.value = '';
    showProperties(state.selectedAnnotation);
  });

  // Reply input Enter key
  document.getElementById('prop-reply-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('prop-reply-add')?.click();
    }
  });

  // X button (top right) - closes panel entirely
  document.getElementById('prop-panel-close')?.addEventListener('click', closePropertiesPanel);

  // Prevent clicks in properties panel from propagating
  propertiesPanel?.addEventListener('mousedown', (e) => e.stopPropagation());
  propertiesPanel?.addEventListener('click', (e) => e.stopPropagation());

  // Collapsible sections
  propertiesPanel?.querySelectorAll('.property-section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });
}
