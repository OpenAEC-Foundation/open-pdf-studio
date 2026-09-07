// Status-bar chip for the relay session.
//
// Pairing is a one-time act that needs explaining, which is the dialog's job
// (PairAgentDialog.jsx). Connection state is continuous and needs no words,
// which is this. A dismissed dialog still has to leave the person some way to
// see whether the thing is connected — that is the whole reason both exist.
//
// Renders nothing at all when there is no session: the desktop build and an
// ordinary browser tab have no relay, and a permanently dim "not paired"
// readout would be clutter that never becomes useful.

import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { session, connectionState, lastActivity } from '../stores/sessionStore.js';
import { openDialog } from '../stores/dialogStore.js';

const CHIP_TEXT = {
  paired:    (s) => `${s.author} · paired`,
  waiting:   () => 'waiting for agent',
  lost:      () => 'reconnecting…',
  displaced: () => 'session taken over',
};

export default function SessionChip() {
  const [open, setOpen] = createSignal(false);
  let rootRef;

  // Close on an outside click. The popover is a transient readout, not a
  // modal, so it should not trap anything.
  const onDocMouseDown = (e) => {
    if (open() && rootRef && !rootRef.contains(e.target)) setOpen(false);
  };
  const onKeyDown = (e) => { if (e.key === 'Escape' && open()) setOpen(false); };

  onMount(() => {
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onKeyDown);
  });

  const label = () => (CHIP_TEXT[connectionState()] || CHIP_TEXT.waiting)(session() || {});

  return (
    <Show when={session()}>
      <div class="session-chip-root" ref={rootRef}>
        <Show when={open()}>
          <div class="session-popover" role="dialog" aria-label="Agent session">
            <div class="session-popover-head">
              <span>Agent session</span>
              <button class="session-popover-close" onClick={() => setOpen(false)} aria-label="Close">
                <svg width="9" height="9" viewBox="0 0 10 10">
                  <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2" />
                  <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2" />
                </svg>
              </button>
            </div>
            <div class="session-popover-body">
              <div class="session-popover-status">
                <span class="pair-dot" data-state={connectionState()}></span>
                <span>
                  {connectionState() === 'paired' && lastActivity()
                    ? `Last: ${lastActivity().description}`
                    : label()}
                </span>
              </div>
              <div class="session-popover-code">
                <input type="text" readonly value={session().code}
                       onFocus={(e) => e.currentTarget.select()} />
              </div>
              <button
                class="pref-btn pref-btn-secondary session-popover-more"
                onClick={() => { setOpen(false); openDialog('pair-agent'); }}
              >
                Pairing details…
              </button>
            </div>
          </div>
        </Show>

        <button
          class="status-item session-chip"
          tabIndex={-1}
          title="Agent session — click for the pairing code"
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <span class="pair-dot" data-state={connectionState()}></span>
          <span class="status-item-value">{label()}</span>
        </button>
      </div>
    </Show>
  );
}
