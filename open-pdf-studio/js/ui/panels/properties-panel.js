import { state, getSelectionBounds } from '../../core/state.js';
import { annotationCtx, propertiesPanel } from '../dom-elements.js';
import { formatDate, getTypeDisplayName } from '../../utils/helpers.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { recordPropertyChange } from '../../core/undo-manager.js';
import { ensureFontInSelect } from '../../utils/fonts.js';

// Import property panel elements
import {
  propType, propColor, propLineWidth, propText, propFontSize,
  propSubject, propAuthor, propCreated, propModified,
  propOpacity, propLocked, propPrintable,
  propIcon, propIconGroup, propStrokeColor, propStrokeColorGroup,
  propFillColor, propFillColorGroup, propBorderStyle, propBorderStyleGroup,
  propTextGroup, propFontSizeGroup, propLineWidthGroup,
  propGeneralSection, propAppearanceSection, propContentSection, propActionsSection,
  propTextFormatSection, propParagraphSection, propTextColor, propFontFamily,
  propTextFontSize, propTextBold, propTextItalic, propTextUnderline,
  propTextStrikethrough, propAlignLeft, propAlignCenter, propAlignRight,
  propLineSpacing, propImageSection, propImageWidth, propImageHeight,
  propImageRotation,
  propLineEndingsSection, propArrowStart, propArrowEnd, propArrowHeadSize,
  propDimensionsSection, propArrowLength,
  propTextboxRotation
} from '../dom-elements.js';

// Update color display helper
export function updateColorDisplay(palette, color, preview, hex) {
  if (preview) preview.style.backgroundColor = color;
  if (hex) hex.textContent = color.toUpperCase();
}

// Show properties panel
export function showProperties(annotation) {
  state.selectedAnnotation = annotation;

  // Hide "no selection" message
  const noSel = document.getElementById('prop-no-selection');
  if (noSel) noSel.style.display = 'none';

  // Restore section visibility (may have been hidden by text editing mode)
  if (propGeneralSection) propGeneralSection.style.display = 'block';
  if (propAppearanceSection) propAppearanceSection.style.display = 'block';
  if (propActionsSection) propActionsSection.style.display = 'flex';

  // Check if annotation is locked - disable editing if so
  const isLocked = annotation.locked || false;

  // General section
  if (propType) propType.value = getTypeDisplayName(annotation.type);

  if (propSubject) {
    propSubject.value = annotation.subject || '';
    propSubject.disabled = isLocked;
  }

  if (propAuthor) {
    propAuthor.value = annotation.author || state.defaultAuthor;
    propAuthor.disabled = isLocked;
  }

  if (propCreated) {
    propCreated.value = formatDate(annotation.createdAt);
  }

  if (propModified) {
    propModified.value = formatDate(annotation.modifiedAt);
  }

  // Appearance section
  if (propColor) {
    propColor.value = annotation.color || '#000000';
    propColor.disabled = isLocked;
  }

  // Update color palette display
  const mainPalette = document.getElementById('main-color-palette');
  const mainPreview = document.getElementById('prop-color-preview');
  const mainHex = document.getElementById('prop-color-hex');
  if (mainPalette) {
    updateColorDisplay(mainPalette, annotation.color || '#000000', mainPreview, mainHex);
  }

  if (propLineWidth) {
    propLineWidth.value = annotation.lineWidth !== undefined ? annotation.lineWidth : 3;
    propLineWidth.disabled = isLocked;
  }

  // Opacity
  if (propOpacity) {
    const opacityVal = annotation.opacity !== undefined ? Math.round(annotation.opacity * 100) : 100;
    propOpacity.value = opacityVal;
    propOpacity.disabled = isLocked;
    const opacityValueSpan = document.getElementById('prop-opacity-value');
    if (opacityValueSpan) {
      opacityValueSpan.textContent = opacityVal + '%';
    }
  }

  // Icon selector (for comments/sticky notes)
  if (propIconGroup) {
    if (annotation.type === 'comment') {
      propIconGroup.style.display = 'flex';
      if (propIcon) {
        propIcon.value = annotation.icon || 'comment';
        propIcon.disabled = isLocked;
      }
    } else {
      propIconGroup.style.display = 'none';
    }
  }

  // Fill color (for shapes with fill)
  if (propFillColorGroup) {
    if (['highlight', 'box', 'circle', 'textbox', 'callout', 'arrow', 'line'].includes(annotation.type)) {
      propFillColorGroup.style.display = 'flex';
      const fillPreview = document.getElementById('prop-fill-color-preview');
      const fillHex = document.getElementById('prop-fill-color-hex');

      // Check if fill color is None (null/undefined/empty)
      if (!annotation.fillColor) {
        // Show "None" state
        if (fillPreview) {
          const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue('--theme-surface').trim() || '#fff';
          fillPreview.style.background = `linear-gradient(135deg, ${surfaceColor} 45%, #ff0000 45%, #ff0000 55%, ${surfaceColor} 55%)`;
        }
        if (fillHex) {
          fillHex.textContent = 'None';
        }
        if (propFillColor) {
          propFillColor.value = '#ffffff';
          propFillColor.disabled = isLocked;
        }
      } else {
        if (propFillColor) {
          propFillColor.value = annotation.fillColor;
          propFillColor.disabled = isLocked;
        }
        // Update fill color palette display
        const fillPalette = document.getElementById('fill-color-palette');
        if (fillPalette) {
          updateColorDisplay(fillPalette, annotation.fillColor, fillPreview, fillHex);
        }
      }
    } else {
      propFillColorGroup.style.display = 'none';
    }
  }

  // Stroke color (for shapes)
  if (propStrokeColorGroup) {
    if (['line', 'arrow', 'box', 'circle', 'draw', 'textbox', 'callout'].includes(annotation.type)) {
      propStrokeColorGroup.style.display = 'flex';
      if (propStrokeColor) {
        propStrokeColor.value = annotation.strokeColor || annotation.color || '#000000';
        propStrokeColor.disabled = isLocked;
      }
      // Update stroke color palette display
      const strokePalette = document.getElementById('stroke-color-palette');
      const strokePreview = document.getElementById('prop-stroke-color-preview');
      const strokeHex = document.getElementById('prop-stroke-color-hex');
      if (strokePalette) {
        updateColorDisplay(strokePalette, annotation.strokeColor || annotation.color || '#000000', strokePreview, strokeHex);
      }
    } else {
      propStrokeColorGroup.style.display = 'none';
    }
  }

  // Hide general color for types that use fill/stroke or images
  // Show general color for text markup annotations (highlight, strikethrough, underline)
  const propColorGroup = document.getElementById('prop-color-group');
  if (propColorGroup) {
    if (['line', 'arrow', 'box', 'circle', 'draw', 'highlight', 'image', 'textbox', 'callout'].includes(annotation.type)) {
      propColorGroup.style.display = 'none';
    } else if (['textHighlight', 'textStrikethrough', 'textUnderline'].includes(annotation.type)) {
      // Show color picker for text markup annotations
      propColorGroup.style.display = 'flex';
    } else {
      propColorGroup.style.display = 'flex';
    }
  }

  // Image-specific properties
  if (annotation.type === 'image') {
    if (propImageSection) propImageSection.style.display = 'block';
    if (propImageWidth) {
      propImageWidth.value = Math.round(annotation.width);
      propImageWidth.disabled = isLocked;
    }
    if (propImageHeight) {
      propImageHeight.value = Math.round(annotation.height);
      propImageHeight.disabled = isLocked;
    }
    if (propImageRotation) {
      propImageRotation.value = Math.round(annotation.rotation || 0);
      propImageRotation.disabled = isLocked;
    }
  } else {
    if (propImageSection) propImageSection.style.display = 'none';
  }

  // Content section (for text/comments)
  if (annotation.type === 'text' || annotation.type === 'comment') {
    if (propContentSection) propContentSection.style.display = 'block';
    if (propTextGroup) propTextGroup.style.display = 'flex';
    if (propText) {
      propText.value = annotation.text || '';
      propText.disabled = isLocked;
    }
  } else {
    if (propContentSection) propContentSection.style.display = 'none';
    if (propTextGroup) propTextGroup.style.display = 'none';
  }

  if (annotation.type === 'text') {
    if (propFontSizeGroup) propFontSizeGroup.style.display = 'flex';
    if (propFontSize) {
      propFontSize.value = annotation.fontSize || 16;
      propFontSize.disabled = isLocked;
    }
  } else {
    if (propFontSizeGroup) propFontSizeGroup.style.display = 'none';
  }

  // Text formatting section (for textbox/callout)
  if (propTextFormatSection) {
    if (['textbox', 'callout'].includes(annotation.type)) {
      propTextFormatSection.style.display = 'block';

      // Text color
      if (propTextColor) {
        const textColorValue = annotation.textColor || annotation.color || '#000000';
        propTextColor.value = textColorValue;
        propTextColor.disabled = isLocked;
        // Update text color palette display
        const textColorPalette = document.getElementById('text-color-palette');
        const textColorPreview = document.getElementById('prop-text-color-preview');
        const textColorHex = document.getElementById('prop-text-color-hex');
        if (textColorPalette) {
          updateColorDisplay(textColorPalette, textColorValue, textColorPreview, textColorHex);
        }
      }

      // Font family
      if (propFontFamily) {
        const ff = annotation.fontFamily || 'Arial';
        ensureFontInSelect(propFontFamily, ff);
        propFontFamily.value = ff;
        propFontFamily.disabled = isLocked;
      }

      // Font size
      if (propTextFontSize) {
        propTextFontSize.value = annotation.fontSize || 14;
        propTextFontSize.disabled = isLocked;
      }

      // Text styles (bold, italic, underline, strikethrough)
      if (propTextBold) {
        propTextBold.classList.toggle('active', annotation.fontBold || false);
        propTextBold.disabled = isLocked;
      }
      if (propTextItalic) {
        propTextItalic.classList.toggle('active', annotation.fontItalic || false);
        propTextItalic.disabled = isLocked;
      }
      if (propTextUnderline) {
        propTextUnderline.classList.toggle('active', annotation.fontUnderline || false);
        propTextUnderline.disabled = isLocked;
      }
      if (propTextStrikethrough) {
        propTextStrikethrough.classList.toggle('active', annotation.fontStrikethrough || false);
        propTextStrikethrough.disabled = isLocked;
      }
    } else {
      propTextFormatSection.style.display = 'none';
    }
  }

  // Paragraph section (for textbox/callout)
  if (propParagraphSection) {
    if (['textbox', 'callout'].includes(annotation.type)) {
      propParagraphSection.style.display = 'block';

      // Text alignment
      const align = annotation.textAlign || 'left';
      if (propAlignLeft) {
        propAlignLeft.classList.toggle('active', align === 'left');
        propAlignLeft.disabled = isLocked;
      }
      if (propAlignCenter) {
        propAlignCenter.classList.toggle('active', align === 'center');
        propAlignCenter.disabled = isLocked;
      }
      if (propAlignRight) {
        propAlignRight.classList.toggle('active', align === 'right');
        propAlignRight.disabled = isLocked;
      }

      // Line spacing
      if (propLineSpacing) {
        propLineSpacing.value = annotation.lineSpacing || '1.5';
        propLineSpacing.disabled = isLocked;
      }

      // Rotation
      if (propTextboxRotation) {
        propTextboxRotation.value = Math.round(annotation.rotation || 0);
        propTextboxRotation.disabled = isLocked;
      }
    } else {
      propParagraphSection.style.display = 'none';
    }
  }

  // Line width visibility and label
  if (['highlight', 'comment', 'image', 'textHighlight'].includes(annotation.type)) {
    if (propLineWidthGroup) propLineWidthGroup.style.display = 'none';
  } else {
    if (propLineWidthGroup) {
      propLineWidthGroup.style.display = 'flex';
      const lwLabel = propLineWidthGroup.querySelector('label');
      if (lwLabel) {
        lwLabel.textContent = ['textbox', 'callout', 'box', 'circle', 'polygon', 'cloud'].includes(annotation.type)
          ? 'Border Width' : 'Line Width';
      }
    }
  }

  // Line endings properties (arrow only)
  if (propLineEndingsSection) {
    if (annotation.type === 'arrow') {
      propLineEndingsSection.style.display = 'block';

      if (propArrowStart) {
        propArrowStart.value = annotation.startHead || 'none';
        propArrowStart.disabled = isLocked;
      }

      if (propArrowEnd) {
        propArrowEnd.value = annotation.endHead || 'open';
        propArrowEnd.disabled = isLocked;
      }

      if (propArrowHeadSize) {
        propArrowHeadSize.value = annotation.headSize || 12;
        propArrowHeadSize.disabled = isLocked;
      }
    } else {
      propLineEndingsSection.style.display = 'none';
    }
  }

  // Line/Arrow dimensions section
  if (propDimensionsSection) {
    if (annotation.type === 'arrow' || annotation.type === 'line') {
      propDimensionsSection.style.display = 'block';

      // Calculate arrow length
      if (propArrowLength) {
        const dx = annotation.endX - annotation.startX;
        const dy = annotation.endY - annotation.startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        propArrowLength.value = length.toFixed(2) + ' px';
      }
    } else {
      propDimensionsSection.style.display = 'none';
    }
  }

  // Border style visibility for arrow
  if (propBorderStyleGroup) {
    if (['textbox', 'callout', 'arrow', 'line'].includes(annotation.type)) {
      propBorderStyleGroup.style.display = 'flex';
      if (propBorderStyle) {
        propBorderStyle.value = annotation.borderStyle || 'solid';
        propBorderStyle.disabled = isLocked;
      }
    } else {
      propBorderStyleGroup.style.display = 'none';
    }
  }

  // Status properties (now in General section as dropdowns)
  if (propLocked) {
    propLocked.value = annotation.locked ? 'yes' : 'no';
  }

  if (propPrintable) {
    propPrintable.value = annotation.printable !== false ? 'yes' : 'no';
    propPrintable.disabled = isLocked;
  }

  // Read Only property
  const propReadOnly = document.getElementById('prop-readonly');
  if (propReadOnly) {
    propReadOnly.value = annotation.readOnly ? 'yes' : 'no';
    propReadOnly.disabled = isLocked;
  }

  // Marked property
  const propMarked = document.getElementById('prop-marked');
  if (propMarked) {
    propMarked.value = annotation.marked ? 'yes' : 'no';
    propMarked.disabled = isLocked;
  }

  // Alt Text
  const propAltText = document.getElementById('prop-alt-text');
  if (propAltText) {
    propAltText.value = annotation.altText || '';
    propAltText.disabled = isLocked;
  }

  // Status
  const propStatus = document.getElementById('prop-status');
  if (propStatus) {
    propStatus.value = annotation.status || 'none';
  }

  // Replies section
  const repliesSection = document.getElementById('prop-replies-section');
  if (repliesSection) {
    repliesSection.style.display = 'block';
    renderReplies(annotation);
  }

  propertiesPanel.classList.add('visible');
  redrawAnnotations();
}

// Render replies for an annotation
function renderReplies(annotation) {
  const list = document.getElementById('prop-replies-list');
  if (!list) return;
  list.innerHTML = '';

  const replies = annotation.replies || [];
  if (replies.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size: 11px; color: var(--theme-text-secondary); font-style: italic; padding: 4px 0;';
    empty.textContent = 'No replies yet.';
    list.appendChild(empty);
    return;
  }

  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    const item = document.createElement('div');
    item.style.cssText = 'padding: 4px 0; border-bottom: 1px solid var(--theme-border); font-size: 11px;';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; color: var(--theme-text-secondary);';
    header.innerHTML = `<strong>${reply.author || 'User'}</strong><span>${formatDate(reply.createdAt)}</span>`;
    item.appendChild(header);

    const text = document.createElement('div');
    text.style.cssText = 'color: var(--theme-text); margin-top: 2px;';
    text.textContent = reply.text;
    item.appendChild(text);

    // Delete reply button
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.style.cssText = 'border: none; background: none; color: #ef4444; cursor: pointer; font-size: 10px; padding: 2px 0;';
    delBtn.addEventListener('click', () => {
      annotation.replies.splice(i, 1);
      annotation.modifiedAt = new Date().toISOString();
      renderReplies(annotation);
    });
    item.appendChild(delBtn);

    list.appendChild(item);
  }
}

// Hide properties panel
export function hideProperties() {
  state.selectedAnnotation = null;
  // Keep the panel open but show document properties
  const noSel = document.getElementById('prop-no-selection');
  if (noSel) {
    noSel.style.display = 'block';
    populateDocInfo();
  }
  // Hide all annotation property sections
  if (propGeneralSection) propGeneralSection.style.display = 'none';
  if (propAppearanceSection) propAppearanceSection.style.display = 'none';
  if (propContentSection) propContentSection.style.display = 'none';
  if (propActionsSection) propActionsSection.style.display = 'none';
  if (propTextFormatSection) propTextFormatSection.style.display = 'none';
  if (propParagraphSection) propParagraphSection.style.display = 'none';
  if (propImageSection) propImageSection.style.display = 'none';
  if (propLineEndingsSection) propLineEndingsSection.style.display = 'none';
  if (propDimensionsSection) propDimensionsSection.style.display = 'none';
  const repliesSection = document.getElementById('prop-replies-section');
  if (repliesSection) repliesSection.style.display = 'none';
  const statusGroup = document.getElementById('prop-status-group');
  if (statusGroup) statusGroup.style.display = 'none';
  const altTextGroup = document.getElementById('prop-alt-text-group');
  if (altTextGroup) altTextGroup.style.display = 'none';
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Populate document info in the properties panel when no annotation is selected
async function populateDocInfo() {
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '-';
  };

  // File info
  const filePath = state.currentPdfPath || '';
  if (filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    setText('doc-info-filename', parts[parts.length - 1]);
    setText('doc-info-filepath', filePath);
  } else {
    setText('doc-info-filename', 'No file open');
    setText('doc-info-filepath', '-');
  }

  // Page info
  if (state.pdfDoc) {
    setText('doc-info-pages', `${state.currentPage} / ${state.pdfDoc.numPages}`);
    try {
      const page = await state.pdfDoc.getPage(state.currentPage);
      const vp = page.getViewport({ scale: 1 });
      const wMm = (vp.width / 72 * 25.4).toFixed(1);
      const hMm = (vp.height / 72 * 25.4).toFixed(1);
      setText('doc-info-pagesize', `${wMm} x ${hMm} mm`);
    } catch (e) {
      setText('doc-info-pagesize', '-');
    }

    // Metadata
    try {
      const metadata = await state.pdfDoc.getMetadata();
      const info = metadata.info || {};
      setText('doc-info-title', info.Title);
      setText('doc-info-author', info.Author);
      setText('doc-info-subject', info.Subject);
      setText('doc-info-creator', info.Creator);
      setText('doc-info-producer', info.Producer);
      setText('doc-info-version', info.PDFFormatVersion);
    } catch (e) { /* ignore */ }
  } else {
    setText('doc-info-pages', '-');
    setText('doc-info-pagesize', '-');
  }

  // Annotation counts
  const total = state.annotations.length;
  const onPage = state.annotations.filter(a => a.page === state.currentPage).length;
  setText('doc-info-annot-count', String(total));
  setText('doc-info-annot-page', `${onPage} (page ${state.currentPage})`);
}

// Close the properties panel entirely (X button)
export function closePropertiesPanel() {
  state.selectedAnnotation = null;
  propertiesPanel.classList.remove('visible');
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Update annotation properties from panel
export function updateAnnotationProperties() {
  if (!state.selectedAnnotation) return;
  recordPropertyChange(state.selectedAnnotation);

  const annotation = state.selectedAnnotation;

  // Check if locked - don't update if locked (except for lock toggle itself)
  if (annotation.locked && propLocked && propLocked.value === 'no') {
    // Allow unlocking
    annotation.locked = false;
    annotation.modifiedAt = new Date().toISOString();
    showProperties(annotation); // Refresh the panel to enable fields
    return;
  }

  if (annotation.locked) return;

  annotation.modifiedAt = new Date().toISOString();

  // General properties
  if (propSubject) annotation.subject = propSubject.value;
  if (propAuthor) annotation.author = propAuthor.value;

  // Appearance
  if (propColor) annotation.color = propColor.value;
  if (propLineWidth) annotation.lineWidth = parseFloat(propLineWidth.value);
  // Get opacity from slider
  if (propOpacity) {
    annotation.opacity = parseInt(propOpacity.value) / 100;
    const opacityValueSpan = document.getElementById('prop-opacity-value');
    if (opacityValueSpan) {
      opacityValueSpan.textContent = propOpacity.value + '%';
    }
  }

  // Type-specific properties
  if (propIcon && annotation.type === 'comment') annotation.icon = propIcon.value;
  if (propFillColor) annotation.fillColor = propFillColor.value;
  if (propStrokeColor) annotation.strokeColor = propStrokeColor.value;
  if (propBorderStyle) annotation.borderStyle = propBorderStyle.value;

  // Status
  const propStatus = document.getElementById('prop-status');
  if (propStatus) annotation.status = propStatus.value === 'none' ? undefined : propStatus.value;

  // Line ending properties (arrow only)
  if (annotation.type === 'arrow') {
    if (propArrowStart) annotation.startHead = propArrowStart.value;
    if (propArrowEnd) annotation.endHead = propArrowEnd.value;
    if (propArrowHeadSize) annotation.headSize = parseInt(propArrowHeadSize.value);
  }

  // Status properties
  if (propLocked) annotation.locked = propLocked.value === 'yes';
  if (propPrintable) annotation.printable = propPrintable.value === 'yes';

  const propReadOnly = document.getElementById('prop-readonly');
  if (propReadOnly) annotation.readOnly = propReadOnly.value === 'yes';

  const propMarked = document.getElementById('prop-marked');
  if (propMarked) annotation.marked = propMarked.value === 'yes';

  const propAltText = document.getElementById('prop-alt-text');
  if (propAltText) annotation.altText = propAltText.value || '';

  // Text properties
  if (propText && (annotation.type === 'text' || annotation.type === 'comment')) {
    annotation.text = propText.value;
  }
  if (propFontSize && annotation.type === 'text') {
    annotation.fontSize = parseInt(propFontSize.value);
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Update arrow properties
export function updateArrowProperties() {
  if (!state.selectedAnnotation || state.selectedAnnotation.type !== 'arrow') return;
  if (state.selectedAnnotation.locked) return;
  recordPropertyChange(state.selectedAnnotation);

  const annotation = state.selectedAnnotation;
  annotation.modifiedAt = new Date().toISOString();

  if (propArrowStart) annotation.startHead = propArrowStart.value;
  if (propArrowEnd) annotation.endHead = propArrowEnd.value;
  if (propArrowHeadSize) annotation.headSize = parseInt(propArrowHeadSize.value);

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Update text format properties
export function updateTextFormatProperties() {
  if (!state.selectedAnnotation || !['textbox', 'callout'].includes(state.selectedAnnotation.type)) return;
  if (state.selectedAnnotation.locked) return;
  recordPropertyChange(state.selectedAnnotation);

  const annotation = state.selectedAnnotation;
  annotation.modifiedAt = new Date().toISOString();

  if (propTextColor) {
    annotation.textColor = propTextColor.value;
    annotation.color = propTextColor.value; // Keep in sync
  }

  if (propFontFamily) {
    annotation.fontFamily = propFontFamily.value;
  }

  if (propTextFontSize) {
    annotation.fontSize = parseInt(propTextFontSize.value);
  }

  if (propLineSpacing) {
    annotation.lineSpacing = parseFloat(propLineSpacing.value);
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Show properties panel for multi-selection
export function showMultiSelectionProperties() {
  const selected = state.selectedAnnotations;
  if (!selected || selected.length < 2) return;

  // Hide "no selection" message
  const noSel = document.getElementById('prop-no-selection');
  if (noSel) noSel.style.display = 'none';

  // Show a summary in the properties panel
  if (propType) propType.value = `${selected.length} annotations selected`;

  if (propSubject) { propSubject.value = ''; propSubject.disabled = true; }
  if (propAuthor) { propAuthor.value = ''; propAuthor.disabled = true; }
  if (propCreated) { propCreated.value = ''; }
  if (propModified) { propModified.value = ''; }

  // Hide type-specific sections
  if (propContentSection) propContentSection.style.display = 'none';
  if (propTextFormatSection) propTextFormatSection.style.display = 'none';
  if (propParagraphSection) propParagraphSection.style.display = 'none';
  if (propImageSection) propImageSection.style.display = 'none';
  if (propLineEndingsSection) propLineEndingsSection.style.display = 'none';
  if (propDimensionsSection) propDimensionsSection.style.display = 'none';
  if (propTextGroup) propTextGroup.style.display = 'none';
  if (propFontSizeGroup) propFontSizeGroup.style.display = 'none';
  if (propIconGroup) propIconGroup.style.display = 'none';

  // Show shared appearance properties
  if (propGeneralSection) propGeneralSection.style.display = 'block';
  if (propAppearanceSection) propAppearanceSection.style.display = 'block';
  if (propActionsSection) propActionsSection.style.display = 'flex';

  // Show common opacity - use first annotation's value
  if (propOpacity) {
    const opacityVal = selected[0].opacity !== undefined ? Math.round(selected[0].opacity * 100) : 100;
    propOpacity.value = opacityVal;
    propOpacity.disabled = false;
    const opacityValueSpan = document.getElementById('prop-opacity-value');
    if (opacityValueSpan) opacityValueSpan.textContent = opacityVal + '%';
  }

  // Hide color pickers that don't apply uniformly
  const propColorGroup = document.getElementById('prop-color-group');
  if (propColorGroup) propColorGroup.style.display = 'none';
  if (propFillColorGroup) propFillColorGroup.style.display = 'none';
  if (propStrokeColorGroup) propStrokeColorGroup.style.display = 'none';
  if (propLineWidthGroup) propLineWidthGroup.style.display = 'none';
  if (propBorderStyleGroup) propBorderStyleGroup.style.display = 'none';

  propertiesPanel.classList.add('visible');
}
