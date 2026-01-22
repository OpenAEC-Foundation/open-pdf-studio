import { state } from '../core/state.js';
import { annotationCtx, propertiesPanel } from './dom-elements.js';
import { formatDate, getTypeDisplayName } from '../utils/helpers.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';

// Import property panel elements
import {
  propType, propColor, propLineWidth, propText, propFontSize,
  propSubject, propAuthor, propCreated, propModified,
  propOpacity, propLocked, propPrintable,
  propIcon, propIconGroup, propStrokeColor, propStrokeColorGroup,
  propFillColor, propFillColorGroup, propBorderStyle, propBorderStyleGroup,
  propTextGroup, propFontSizeGroup, propLineWidthGroup, propDelete,
  propGeneralSection, propAppearanceSection, propContentSection, propActionsSection,
  propTextFormatSection, propParagraphSection, propTextColor, propFontFamily,
  propTextFontSize, propTextBold, propTextItalic, propTextUnderline,
  propTextStrikethrough, propAlignLeft, propAlignCenter, propAlignRight,
  propLineSpacing, propImageSection, propImageWidth, propImageHeight,
  propImageRotation,
  propLineEndingsSection, propArrowStart, propArrowEnd, propArrowHeadSize,
  propDimensionsSection, propArrowLength
} from './dom-elements.js';

// Update color display helper
export function updateColorDisplay(palette, color, preview, hex) {
  if (preview) preview.style.backgroundColor = color;
  if (hex) hex.textContent = color.toUpperCase();
}

// Show properties panel
export function showProperties(annotation) {
  state.selectedAnnotation = annotation;

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
    propLineWidth.value = annotation.lineWidth || 3;
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
    if (['highlight', 'box', 'circle', 'textbox', 'callout', 'arrow'].includes(annotation.type)) {
      propFillColorGroup.style.display = 'flex';
      const fillPreview = document.getElementById('prop-fill-color-preview');
      const fillHex = document.getElementById('prop-fill-color-hex');

      // Check if fill color is None (null/undefined/empty)
      if (!annotation.fillColor) {
        // Show "None" state
        if (fillPreview) {
          fillPreview.style.background = 'linear-gradient(135deg, #fff 45%, #ff0000 45%, #ff0000 55%, #fff 55%)';
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
  const propColorGroup = document.getElementById('prop-color-group');
  if (propColorGroup) {
    if (['line', 'arrow', 'box', 'circle', 'draw', 'highlight', 'image', 'textbox', 'callout'].includes(annotation.type)) {
      propColorGroup.style.display = 'none';
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
        propFontFamily.value = annotation.fontFamily || 'Arial';
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
    } else {
      propParagraphSection.style.display = 'none';
    }
  }

  // Line width visibility
  if (['highlight', 'comment', 'image'].includes(annotation.type)) {
    if (propLineWidthGroup) propLineWidthGroup.style.display = 'none';
  } else {
    if (propLineWidthGroup) propLineWidthGroup.style.display = 'flex';
  }

  // Arrow-specific properties (Line Endings section)
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

  // Arrow dimensions section
  if (propDimensionsSection) {
    if (annotation.type === 'arrow') {
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
    if (['textbox', 'callout', 'arrow'].includes(annotation.type)) {
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

  // Disable delete button if locked
  if (propDelete) {
    propDelete.disabled = isLocked;
    propDelete.style.opacity = isLocked ? '0.5' : '1';
    propDelete.style.cursor = isLocked ? 'not-allowed' : 'pointer';
  }

  propertiesPanel.classList.add('visible');
  redrawAnnotations();
}

// Hide properties panel
export function hideProperties() {
  state.selectedAnnotation = null;
  propertiesPanel.classList.remove('visible');
  redrawAnnotations();
}

// Update annotation properties from panel
export function updateAnnotationProperties() {
  if (!state.selectedAnnotation) return;

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
  if (propLineWidth) annotation.lineWidth = parseInt(propLineWidth.value);
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

  // Arrow-specific properties
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
