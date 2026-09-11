// Logica van de stdio-brug, los van stdin/stdout zodat hij te testen is.
//
// Normaal stuurt de brug elk JSON-RPC-bericht ongewijzigd door naar de MCP-
// server in de draaiende app. Draait de app niet, dan antwoordt de brug zelf:
// initialize en tools/list uit de meegeleverde lijst (tools.json, de publieke
// lijst van de app), en een aanroep met een duidelijke instructie. Zo is de
// extensie in Claude Desktop niet leeg als Claude eerder start dan de app, en
// werkt ze zodra de app draait.

export const NIET_BEREIKBAAR =
  'Open PDF Studio is not reachable. Start Open PDF Studio and turn on ' +
  'Settings > General > AI link (MCP). The port there must match the port ' +
  "in this extension's settings (default 9223).";

const isNotificatie = (m) => m && typeof m === 'object' && !Array.isArray(m) && !('id' in m);
const antwoord = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result });
const fout = (id, code, message) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * @param {{ endpoint: string, tools: object[], versie: string, fetchFn?: typeof fetch }} opties
 * @returns {(regel: string) => Promise<string|null>} verwerkt één regel, geeft
 *   de te schrijven antwoordregel of null (geen antwoord)
 */
export function maakBrug({ endpoint, tools, versie, fetchFn = fetch }) {
  async function stuurDoor(body) {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    return res.text();
  }

  function terugval(msg) {
    const id = msg.id ?? null;
    switch (msg.method) {
      case 'initialize':
        return antwoord(id, {
          protocolVersion: msg.params?.protocolVersion || '2025-03-26',
          serverInfo: { name: 'open-pdf-studio', version: versie },
          capabilities: { tools: { listChanged: false } },
        });
      case 'tools/list':
        return antwoord(id, { tools });
      case 'tools/call':
        return antwoord(id, { content: [{ type: 'text', text: NIET_BEREIKBAAR }], isError: true });
      default:
        return fout(id, -32001, NIET_BEREIKBAAR);
    }
  }

  return async function verwerk(regel) {
    const tekst = String(regel ?? '').trim();
    if (!tekst) return null;
    let msg;
    try {
      msg = JSON.parse(tekst);
    } catch {
      return null;
    }

    // Ping lokaal, zodat de verbinding ook zonder app blijft leven.
    if (!Array.isArray(msg) && msg.method === 'ping' && 'id' in msg) return antwoord(msg.id, {});

    let uit;
    try {
      uit = await stuurDoor(tekst);
    } catch {
      if (isNotificatie(msg)) return null;
      return Array.isArray(msg) ? fout(null, -32001, NIET_BEREIKBAAR) : terugval(msg);
    }
    if (isNotificatie(msg)) return null;
    const schoon = (uit || '').trim();
    if (schoon) return schoon;
    return fout(Array.isArray(msg) ? null : (msg.id ?? null), -32002, `Empty response from ${endpoint}`);
  };
}
