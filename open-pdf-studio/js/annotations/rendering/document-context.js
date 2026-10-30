// Documentbron voor de synchrone tekenketen van een spiegelpaneel.
// Tools, opslaan en undo blijven het echte actieve document gebruiken.
import { getActiveDocument } from '../../core/state.js';
import { paneelDocument } from '../../pdf/split-view/paneel-weergave.js';
export function tekenDocument() { return paneelDocument() || getActiveDocument(); }
