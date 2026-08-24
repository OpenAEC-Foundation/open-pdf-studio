// Component-kiezer voor een systeem-paneel: vervang het geselecteerde
// paneel door een symbool uit de bibliotheek (NEN 1414 / NL-IFC). De keuze
// schrijft via updateAnnotProp('sgPaneelComponent') op het geselecteerde
// paneel-sub-element van de actuele annotatie — het component HOORT bij het
// systeem (reist mee met oorsprong/rasterhoek, round-tript via de
// paneel-overrides). Zelfde modal-patroon als de andere dialogen
// (Windows-stijl, versleepbaar, sluit niet bij buiten-klik).
// NL-labels hardgecodeerd (conventie van deze componentfamilie).
import { createSignal, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { updateAnnotProp } from '../../stores/propertiesStore.js';
import { systeemSymbolList } from '../../../annotations/rendering/systeem-symbol-cache.js';

export default function SysteemPaneelComponentDialog() {
  const alle = systeemSymbolList();
  const [zoek, setZoek] = createSignal('');

  const lijst = () => {
    const q = zoek().trim().toLowerCase();
    if (!q) return alle;
    return alle.filter(s =>
      s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
      || (s.categorie || '').toLowerCase().includes(q));
  };

  function kies(sym) {
    updateAnnotProp('sgPaneelComponent', { symbolId: sym.id, naam: sym.name });
    closeDialog('systeem-paneel-component');
  }

  return (
    <Dialog
      title="Paneel vervangen door component"
      dialogClass="systeem-paneel-component-dialog"
      onClose={() => closeDialog('systeem-paneel-component')}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            onClick={() => closeDialog('systeem-paneel-component')}>Annuleren</button>
        </div>
      }
    >
      <div style="width:420px;font-size:12px">
        <div class="ai-login-field">
          <input type="text" class="ribbon-input" id="spc-zoek"
            placeholder="Zoeken (naam, id of categorie)…"
            style="width:100%;box-sizing:border-box"
            value={zoek()} onInput={(e) => setZoek(e.target.value)} />
        </div>
        <div style="max-height:50vh;overflow-y:auto;border:1px solid #d4d4d4;margin-top:6px">
          <For each={lijst()}>
            {(sym) => (
              <div class="spc-item"
                style="display:flex;align-items:center;gap:8px;padding:3px 6px;cursor:pointer;border-bottom:1px solid #eee"
                onClick={() => kies(sym)}
              >
                <span style="width:28px;height:28px;flex:none;display:inline-flex" innerHTML={sym.svg} />
                <span style="flex:1">{sym.name}</span>
                <span style="opacity:.6">{sym.categorie}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Dialog>
  );
}
