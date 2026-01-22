import { state } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';

// Bring annotation to front (top of z-order)
export function bringToFront(annotation) {
  if (!annotation) return;

  const index = state.annotations.indexOf(annotation);
  if (index > -1) {
    state.annotations.splice(index, 1);
    state.annotations.push(annotation);
    annotation.modifiedAt = new Date().toISOString();

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Send annotation to back (bottom of z-order)
export function sendToBack(annotation) {
  if (!annotation) return;

  const index = state.annotations.indexOf(annotation);
  if (index > -1) {
    state.annotations.splice(index, 1);
    state.annotations.unshift(annotation);
    annotation.modifiedAt = new Date().toISOString();

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Move annotation forward (one step up in z-order)
export function bringForward(annotation) {
  if (!annotation) return;

  const index = state.annotations.indexOf(annotation);
  if (index > -1 && index < state.annotations.length - 1) {
    // Swap with next annotation
    [state.annotations[index], state.annotations[index + 1]] =
    [state.annotations[index + 1], state.annotations[index]];
    annotation.modifiedAt = new Date().toISOString();

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Move annotation backward (one step down in z-order)
export function sendBackward(annotation) {
  if (!annotation) return;

  const index = state.annotations.indexOf(annotation);
  if (index > 0) {
    // Swap with previous annotation
    [state.annotations[index], state.annotations[index - 1]] =
    [state.annotations[index - 1], state.annotations[index]];
    annotation.modifiedAt = new Date().toISOString();

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Rotate image annotation by degrees
export function rotateAnnotation(annotation, degrees) {
  if (!annotation || annotation.type !== 'image') return;
  if (annotation.locked) return;

  annotation.rotation = ((annotation.rotation || 0) + degrees) % 360;
  annotation.modifiedAt = new Date().toISOString();

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Flip image annotation horizontally
export function flipHorizontal(annotation) {
  if (!annotation || annotation.type !== 'image') return;
  if (annotation.locked) return;

  annotation.flipX = !annotation.flipX;
  annotation.modifiedAt = new Date().toISOString();

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Flip image annotation vertically
export function flipVertical(annotation) {
  if (!annotation || annotation.type !== 'image') return;
  if (annotation.locked) return;

  annotation.flipY = !annotation.flipY;
  annotation.modifiedAt = new Date().toISOString();

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}
