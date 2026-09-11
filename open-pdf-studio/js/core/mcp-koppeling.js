// De AI-koppeling (MCP-server) volgens de instelling aan- of uitzetten.
// De Rust-kant (mcp_koppeling.rs) start de server in het publieke profiel en
// geeft de status terug: { actief, poort, bron, fout }.
import { state } from './state.js';
import { isTauri, invoke } from './platform.js';

export async function pasMcpInstellingToe() {
  if (!isTauri()) return null;
  try {
    return await invoke('mcp_instellen', {
      aan: !!state.preferences.mcpEnabled,
      poort: Number(state.preferences.mcpPort) || 9223,
    });
  } catch (e) {
    return { actief: false, poort: null, bron: null, fout: String(e?.message || e) };
  }
}

export async function mcpStatus() {
  if (!isTauri()) return null;
  try {
    return await invoke('mcp_status');
  } catch {
    return null;
  }
}
