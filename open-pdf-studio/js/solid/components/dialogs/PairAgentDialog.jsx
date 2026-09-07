// "Pair with agent" — hands the relay session code to the person so they can
// give it to an agent.
//
// Without this the code only reached the browser console, which made the
// shared-session loop technically working and practically unusable. Pairing
// happens once per session and needs a sentence of explanation, which is why
// it is a dialog; the ongoing connection state lives in the status-bar chip
// instead (SessionChip.jsx).

import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { session, connectionState, lastActivity } from '../../stores/sessionStore.js';

const STATE_TEXT = {
  paired:    { label: 'Paired',       hint: 'An agent is connected to this document.' },
  waiting:   { label: 'Waiting',      hint: 'No agent has connected yet. Give it the code below.' },
  lost:      { label: 'Reconnecting', hint: 'The connection dropped. Retrying automatically.' },
  displaced: { label: 'Taken over',   hint: 'Another tab claimed this session. Reload to start a new one.' },
};

/** Copy to clipboard with a short inline confirmation on the button itself. */
function CopyButton(props) {
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
    } catch {
      // Clipboard can be refused (permissions, insecure origin). The field is
      // selectable, so say what to do rather than failing silently.
      props.onError?.();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button class="pref-btn pref-btn-secondary pair-copy" classList={{ copied: copied() }} onClick={copy}>
      {copied() ? 'Copied' : (props.label || 'Copy')}
    </button>
  );
}

export default function PairAgentDialog() {
  const [copyFailed, setCopyFailed] = createSignal(false);
  const close = () => closeDialog('pair-agent');

  const state = () => STATE_TEXT[connectionState()] || STATE_TEXT.waiting;
  const endpoint = () => session()?.endpoint || '';

  const configJson = () => JSON.stringify({
    mcpServers: {
      'open-pdf-studio': { type: 'http', url: endpoint() },
    },
  }, null, 2);

  return (
    <Dialog
      title="Pair with agent"
      onClose={close}
      dialogClass="pair-agent-dialog"
      footer={(
        <>
          <CopyButton value={configJson()} label="Copy configuration" onError={() => setCopyFailed(true)} />
          <button class="pref-btn pref-btn-primary" onClick={close}>Close</button>
        </>
      )}
    >
      <Show
        when={session()}
        fallback={<p class="pair-intro">This document is not running a shared session.</p>}
      >
        <p class="pair-intro">
          An agent can draw in this document while you watch and mark it up. Give it the code
          below — it stays valid until you close this tab.
        </p>

        <div class="pair-status">
          <span class="pair-dot" data-state={connectionState()}></span>
          <span class="pair-status-text">
            <b>{state().label}</b>
            {' — '}
            {connectionState() === 'paired' && lastActivity()
              ? `${session().author} last did: ${lastActivity().description}`
              : state().hint}
          </span>
        </div>

        <div class="pair-field">
          <label for="pair-code">Session code</label>
          <div class="pair-row">
            <input id="pair-code" type="text" readonly value={session().code}
                   onFocus={(e) => e.currentTarget.select()} />
            <CopyButton value={session().code} onError={() => setCopyFailed(true)} />
          </div>
        </div>

        <div class="pair-field">
          <label for="pair-endpoint">Agent endpoint</label>
          <div class="pair-row">
            <input id="pair-endpoint" type="text" readonly value={endpoint()}
                   onFocus={(e) => e.currentTarget.select()} />
            <CopyButton value={endpoint()} onError={() => setCopyFailed(true)} />
          </div>
        </div>

        <div class="pair-field">
          <label for="pair-config">Agent configuration</label>
          <pre id="pair-config" class="pair-config">{configJson()}</pre>
          <p class="pair-note">
            The relay also requires its shared secret as a bearer token. Ask whoever runs the
            relay for it — it is not stored in this app.
          </p>
        </div>

        <Show when={copyFailed()}>
          <p class="pair-note pair-warn">
            The browser refused clipboard access. Click a field and copy it by hand.
          </p>
        </Show>
      </Show>
    </Dialog>
  );
}
