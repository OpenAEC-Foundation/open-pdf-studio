const STORAGE_KEY = 'savedSessions';
const MAX_SESSIONS = 20;

import { state } from '../core/state.js';
import { createTab } from '../ui/chrome/tabs.js';
import { loadPDFIfNeeded } from '../pdf/loader.js';

/**
 * Get all saved sessions from localStorage.
 * @returns {Array<{name: string, timestamp: number, files: string[]}>}
 */
export function getSavedSessions() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to read saved sessions:', e);
  }
  return [];
}

/**
 * Save the current set of open documents as a named session.
 * @param {string} name - Session name
 */
export function saveCurrentSession(name) {
  try {
    const files = state.documents
      .filter(doc => doc.filePath)
      .map(doc => doc.filePath);

    if (files.length === 0) return false;

    let sessions = getSavedSessions();

    // Replace if same name exists
    sessions = sessions.filter(s => s.name !== name);

    sessions.unshift({
      name,
      timestamp: Date.now(),
      files
    });

    // Cap at max
    if (sessions.length > MAX_SESSIONS) {
      sessions = sessions.slice(0, MAX_SESSIONS);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    return true;
  } catch (e) {
    console.warn('Failed to save session:', e);
    return false;
  }
}

/**
 * Delete a saved session by name.
 * @param {string} name - Session name to delete
 */
export function deleteSession(name) {
  try {
    let sessions = getSavedSessions();
    sessions = sessions.filter(s => s.name !== name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('Failed to delete session:', e);
  }
}

/**
 * Restore a saved session — open all files from it.
 * @param {{name: string, timestamp: number, files: string[]}} session
 */
export async function restoreSession(session) {
  for (const filePath of session.files) {
    const { index } = createTab(filePath);
    await loadPDFIfNeeded(filePath, index);
  }
}
