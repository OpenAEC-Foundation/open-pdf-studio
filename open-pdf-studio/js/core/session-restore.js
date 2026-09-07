// Restore a shared session's document after a browser reload.
//
// Runs once at startup, after the relay hands back a session code. If that
// code has a snapshot in OPFS, the document comes back exactly as it was —
// the agent's linework and the person's redlines together, with the undo
// floor intact so Ctrl-Z still cannot reach into a committed batch.
//
// The restore is deliberately silent. "My refresh did not lose anything" is
// the least surprising outcome there is, and a dialog on every reload to
// announce it would be worse than the problem.

import { state } from './state.js';
import { loadSnapshot, pruneSnapshots, countByAuthor } from './session-persistence.js';

/**
 * @param {string} code   relay session code
 * @param {string} author the agent's author name, for the summary only
 * @returns {Promise<null|{restored:number, agent:number, person:number}>}
 */
export async function restoreSession(code, author) {
  // Housekeeping first: an abandoned tab should not hold storage forever.
  pruneSnapshots(code).catch(() => {});

  const found = await loadSnapshot(code);
  if (!found) return null;

  const { snapshot, bytes } = found;

  // Never clobber work in progress. If this tab already has a document open,
  // the reload was not a data-loss event and the snapshot is not needed.
  if (state.documents?.length) return null;

  const { restoreDocumentFromSnapshot } = await import('../pdf/loader.js');
  const mounted = await restoreDocumentFromSnapshot(snapshot, bytes);
  if (!mounted) return null;

  const counts = countByAuthor(snapshot.annotations, author);
  console.log(
    `[session-restore] recovered ${counts.total} annotations ` +
    `(${counts.agent} from ${author || 'the agent'}, ${counts.person} yours)`,
  );

  return { restored: counts.total, agent: counts.agent, person: counts.person };
}
