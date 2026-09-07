// Relay session state — the shared-session pairing surface reads from here.
//
// `js/mcp-transport.js` owns the connection and pushes state in through
// `publishSession` / `setSessionState`. Both UI surfaces (the status-bar chip
// and the Pair-with-agent dialog) are pure readers, so neither can affect the
// connection by rendering.
//
// A tab with no relay configured — the desktop build, or an ordinary browser
// tab — never publishes anything, so `session()` stays null and both surfaces
// stay hidden. That is the normal case.

import { createSignal } from 'solid-js';

/** @typedef {'waiting'|'paired'|'lost'|'displaced'} SessionState */

const [session, setSession] = createSignal(null);
const [connectionState, setConnectionState] = createSignal('waiting');
const [lastActivity, setLastActivity] = createSignal(null);
const [agentEverAttached, setAgentEverAttached] = createSignal(false);

export { session, connectionState, lastActivity, agentEverAttached };

/** Called by the transport once the relay confirms the session. */
export function publishSession({ code, author, endpoint }) {
  setSession({ code, author, endpoint, at: new Date().toISOString() });
}

/** Connection state transitions, driven by the socket. */
export function setSessionState(next) {
  setConnectionState(next);
}

/**
 * Record that the agent did something. Drives the "3 annotations drawn" line
 * and, more importantly, flips `agentEverAttached` — which is what decides
 * whether the pairing dialog still needs to open itself (see below).
 */
export function noteAgentActivity(description) {
  setAgentEverAttached(true);
  setLastActivity({ description, at: Date.now() });
}

/** Clear everything — the session was displaced or the transport stopped. */
export function clearSession() {
  setSession(null);
  setConnectionState('waiting');
  setLastActivity(null);
}

/**
 * Should the pairing dialog open by itself?
 *
 * Only when there is a session AND no agent has ever attached to it. A tab
 * that has already been paired does not need the dialog in the user's face on
 * every reload; a fresh one does, because otherwise the code is only in the
 * console and the feature is unusable.
 */
export function shouldAutoOpenPairing() {
  return !!session() && !agentEverAttached();
}
