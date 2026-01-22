import { state } from '../core/state.js';

// Create annotation with default properties
// All annotations share these common properties (General section):
// - id, type, page: core identification
// - author, subject: metadata
// - createdAt, modifiedAt: timestamps
// - locked, printable, readOnly, marked: status flags
// - opacity: appearance (common to all)
// Type-specific properties are added by each tool when creating the annotation
export function createAnnotation(baseProps) {
  const now = new Date().toISOString();

  // Default values - these will be overridden by baseProps if provided
  const defaults = {
    // Metadata
    author: state.defaultAuthor,
    subject: '',
    // Timestamps
    createdAt: now,
    modifiedAt: now,
    // Appearance (common)
    opacity: baseProps.type === 'highlight' ? 0.3 : 1.0,
    // Status flags (General section)
    locked: false,
    printable: true,
    readOnly: false,
    marked: false,
    // Type-specific defaults
    icon: baseProps.type === 'comment' ? 'comment' : undefined
  };

  // Merge defaults with baseProps - baseProps takes precedence
  return {
    ...defaults,
    ...baseProps
  };
}

// Deep clone annotation for undo/restore
export function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}
