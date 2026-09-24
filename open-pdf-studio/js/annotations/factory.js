import { state } from '../core/state.js';
import { normaliseerVormMaat } from './minimummaat.js';
import { layerForNewAnnotation } from './annotatie-lagen.js';

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
    // Unique identifier
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
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
  const result = {
    ...defaults,
    ...baseProps
  };

  // Annotatielagen (#468): een nieuwe markering landt op de huidige laag van
  // het actieve document, tenzij de aanroeper zelf een laag meegeeft (ook
  // expliciet geen: dan de standaardlaag). De standaardlaag is géén veld, zodat
  // een document zonder lagen dezelfde annotaties houdt als voorheen. De lader
  // zet na het omzetten zelf de laag uit het bestand (loader/annotatie-laag.js).
  if (!('layer' in baseProps)) {
    const laag = layerForNewAnnotation(state.documents?.[state.activeDocumentIndex]);
    if (laag) result.layer = laag;
  }
  if (!result.layer) delete result.layer;

  // Textbox: ensure leaders array exists (multi-leader feature)
  if (result.type === 'textbox' && !Array.isArray(result.leaders)) {
    result.leaders = [];
  }

  // Laatste wacht op elk aanmaakpad (tools, plakken, MCP-brug, laden): een
  // rechthoek-vorm komt nooit met breedte/hoogte nul, negatief of NaN in het
  // model. Een vorm mag wel willekeurig klein zijn (technische ondergrens).
  normaliseerVormMaat(result);

  return result;
}

// Deep clone annotation for undo/restore
export function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}
