/**
 * Custom confirm dialog with "Don't show again" support.
 *
 * Usage:
 *   const confirmed = await showConfirm({
 *     title: t('deleteAnnotation.title'),
 *     message: t('deleteAnnotation.confirmSingle'),
 *     preferenceKey: 'confirmBeforeDelete'
 *   });
 *
 * If preferenceKey is provided and the corresponding preference is false,
 * the dialog is skipped and true is returned immediately.
 */

import { state } from '../../core/state.js';
import { openDialog } from '../../solid/stores/dialogStore.js';

export function showConfirm({ title, message, preferenceKey }) {
  // Check if user has disabled this confirmation
  if (preferenceKey && state.preferences[preferenceKey] === false) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    openDialog('confirm', { title, message, preferenceKey, resolve });
  });
}
