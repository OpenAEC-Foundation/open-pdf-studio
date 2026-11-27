// Getekende en geïmporteerde handtekeningen delen dezelfde opslag (#1267).
import { leesOpslagJson, schrijfOpslagJson } from '../core/opslag.js';

const STORAGE_KEY = 'pdfEditorSignatures';
const MAX_SAVED = 5;

export function getSavedSignatures() {
  try {
    const saved = leesOpslagJson(STORAGE_KEY, []);
    return Array.isArray(saved) ? saved.filter((s) => typeof s?.dataUrl === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSignatureToStorage(dataUrl) {
  const signatures = getSavedSignatures();
  signatures.push({ dataUrl, createdAt: new Date().toISOString() });
  while (signatures.length > MAX_SAVED) signatures.shift();
  schrijfOpslagJson(STORAGE_KEY, signatures);
  return signatures;
}

export function deleteSavedSignature(index) {
  const signatures = getSavedSignatures();
  signatures.splice(index, 1);
  schrijfOpslagJson(STORAGE_KEY, signatures);
  return signatures;
}

