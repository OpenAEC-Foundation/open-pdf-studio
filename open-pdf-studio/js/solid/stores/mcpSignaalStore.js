// Store achter het MCP-verbindingssignaal in de statusbalk. Luistert naar de
// events `mcp-status` (server aan/uit) en `mcp-activity` (aanmelding of
// tool-aanroep; alleen soort en toolnaam, nooit argumenten). De toestand zelf
// rekent core/mcp-signaal.js uit. Geen vaste klok: er staat alleen een timer
// tot het volgende moment waarop de toestand verandert (einde puls, einde
// venster van 30 s). Buiten Tauri doet de store niets.
import { createSignal } from 'solid-js';
import { mcpIndicatorStaat, verwerkActiviteit } from '../../core/mcp-signaal.js';

const [status, setStatus] = createSignal({ actief: false, poort: null });
const [laatste, setLaatste] = createSignal({ activiteit: null, aanroep: null, tool: null, toolTijd: null });
const [nu, setNu] = createSignal(Date.now());

let gestart = false;
let timer = null;

export function mcpIndicator() {
  const l = laatste();
  return mcpIndicatorStaat({
    serverAan: !!status().actief,
    laatsteActiviteit: l.activiteit,
    laatsteAanroep: l.aanroep,
    nu: nu(),
  });
}

export function mcpSignaalInfo() {
  return { poort: status().poort ?? null, tool: laatste().tool, toolTijd: laatste().toolTijd };
}

function planVolgendeWissel() {
  clearTimeout(timer);
  timer = null;
  const { volgendeWissel } = mcpIndicator();
  if (volgendeWissel == null) return;
  timer = setTimeout(() => {
    setNu(Date.now());
    planVolgendeWissel();
  }, volgendeWissel + 20);
}

function zetStatus(s) {
  if (!s || typeof s !== 'object') return;
  setStatus({ actief: !!s.actief, poort: s.poort ?? null });
  setNu(Date.now());
  planVolgendeWissel();
}

async function vraagStatus() {
  try {
    const { mcpStatus } = await import('../../core/mcp-koppeling.js');
    zetStatus(await mcpStatus());
  } catch { /* geen status: blijft 'uit' */ }
}

/** Eén keer starten (de statusbalk doet dat bij het opbouwen). */
export async function startMcpSignaal() {
  if (gestart) return;
  gestart = true;
  const { isTauri } = await import('../../core/platform.js');
  if (!isTauri()) return;
  const listen = window.__TAURI__?.event?.listen;
  if (typeof listen === 'function') {
    try {
      await listen('mcp-status', (e) => zetStatus(e?.payload));
      await listen('mcp-activity', (e) => {
        const ontvangen = Date.now();
        setLaatste((v) => verwerkActiviteit(v, e?.payload, ontvangen));
        setNu(ontvangen);
        planVolgendeWissel();
        // Activiteit terwijl we de server uit dachten: status opnieuw vragen.
        if (!status().actief) vraagStatus();
      });
    } catch (e) {
      console.warn('[mcp-signaal] luisteren mislukt:', e);
    }
  }
  await vraagStatus();
}
