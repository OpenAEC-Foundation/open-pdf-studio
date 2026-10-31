// Het verbindingssignaal van de AI-koppeling (MCP) in de statusbalk: de
// pure toestandslogica, los te testen. De store (solid/stores/
// mcpSignaalStore.js) voedt hem met de serverstatus (`mcp_status` en het
// event `mcp-status`) en met de activiteit die de server meldt (event
// `mcp-activity`, zie src-tauri/src/mcp_signaal.rs).
//
// Toestanden:
//  - 'uit'    de server draait niet                     → grijze punt
//  - 'rust'   server aan, 30 s geen activiteit          → open punt
//  - 'actief' een client meldde zich of riep een tool aan in de laatste 30 s
//                                                       → groene punt
// Bij elke binnenkomende aanroep licht het item kort op (puls).

/** Zo lang na de laatste activiteit heet de assistent verbonden. */
export const ACTIEF_VENSTER_MS = 30_000;
/** Zo lang licht het item op na een aanroep. */
export const PULS_MS = 600;

/**
 * @param {{
 *   serverAan: boolean,
 *   laatsteActiviteit?: number|null,  // ms, tijdstip van de laatste activiteit
 *   laatsteAanroep?: number|null,     // ms, tijdstip van de laatste tool-aanroep
 *   nu: number,
 *   venster?: number,
 *   pulsDuur?: number,
 * }} invoer
 * @returns {{ staat: 'uit'|'rust'|'actief', puls: boolean, volgendeWissel: number|null }}
 *   volgendeWissel: over hoeveel ms de uitkomst verandert (null = niet vanzelf)
 */
export function mcpIndicatorStaat({
  serverAan,
  laatsteActiviteit = null,
  laatsteAanroep = null,
  nu,
  venster = ACTIEF_VENSTER_MS,
  pulsDuur = PULS_MS,
}) {
  if (!serverAan) return { staat: 'uit', puls: false, volgendeWissel: null };
  const wissels = [];
  let staat = 'rust';
  if (Number.isFinite(laatsteActiviteit)) {
    const leeftijd = Math.max(0, nu - laatsteActiviteit);
    if (leeftijd < venster) {
      staat = 'actief';
      wissels.push(venster - leeftijd);
    }
  }
  let puls = false;
  if (Number.isFinite(laatsteAanroep)) {
    const leeftijd = Math.max(0, nu - laatsteAanroep);
    if (leeftijd < pulsDuur) {
      puls = true;
      wissels.push(pulsDuur - leeftijd);
    }
  }
  return { staat, puls, volgendeWissel: wissels.length ? Math.min(...wissels) : null };
}

/** Vertaalsleutel (namespace statusbar) van de toestand. */
export const TOESTAND_SLEUTEL = Object.freeze({
  uit: 'mcpSignal.off',
  rust: 'mcpSignal.idle',
  actief: 'mcpSignal.connected',
});

/**
 * Tekst van de tooltip, regel voor regel: toestand, poort, laatste tool.
 * @param {(key:string, opts?:object)=>string} t   vertaalfunctie (statusbar)
 * @param {{ staat:string, poort?:number|null, tool?:string|null, toolTijd?:number|null }} info
 * @param {(ms:number)=>string} tijdTekst
 */
export function mcpTooltip(t, { staat, poort = null, tool = null, toolTijd = null }, tijdTekst) {
  const regels = [t(TOESTAND_SLEUTEL[staat] || TOESTAND_SLEUTEL.uit)];
  if (staat !== 'uit' && poort != null) regels.push(t('mcpSignal.port', { port: poort }));
  if (tool) {
    regels.push(t('mcpSignal.lastTool', { tool, time: Number.isFinite(toolTijd) ? tijdTekst(toolTijd) : '' }));
  } else if (staat !== 'uit') {
    regels.push(t('mcpSignal.noTool'));
  }
  return regels.join('\n');
}

/**
 * Verwerk een `mcp-activity`-event tot de nieuwe laatste-activiteit.
 * Alleen soort en toolnaam tellen; al het andere in het event wordt genegeerd.
 * @param {{activiteit:number|null, aanroep:number|null, tool:string|null, toolTijd:number|null}} vorige
 * @param {{kind?:string, tool?:string|null}} event
 * @param {number} nu  ontvangsttijd (ms)
 */
export function verwerkActiviteit(vorige, event, nu) {
  const volgende = { ...vorige, activiteit: nu };
  if (event?.kind === 'call') {
    volgende.aanroep = nu;
    if (typeof event.tool === 'string' && event.tool) {
      volgende.tool = event.tool;
      volgende.toolTijd = nu;
    }
  }
  return volgende;
}
