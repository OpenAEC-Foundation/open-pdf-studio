// mcp-tools.json naast de gehoste bundel (#977).
//
// Het contract van de OpenAEC SuperCloud vraagt de definities van de tools
// voor de assistent ook als bestand naast de bundel, zodat de SuperCloud ze
// kan controleren zonder de app te starten. Het zijn precies de definities die
// `window.__OPDS_APP__.definitions()` geeft (js/core/werkplek-app.js), gemaakt
// uit de publieke lijst van de desktop (mcp-stdio/tools.json). Alleen in de
// gehoste bouw (--mode hosted).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GAST_MODUS } from '../js/core/gehost.js';
import { werkplekDefinities } from '../js/core/werkplek-app.js';

export const MCP_TOOLS_BESTAND = 'mcp-tools.json';

/** De publieke toollijst van de desktop-app. */
export const DESKTOP_TOOLS = fileURLToPath(new URL('../../mcp-stdio/tools.json', import.meta.url));

/** De inhoud van mcp-tools.json. */
export function mcpToolsJson(desktopTools) {
  return `${JSON.stringify(werkplekDefinities(desktopTools), null, 2)}\n`;
}

export function werkplekMcpToolsPlugin({ bron = DESKTOP_TOOLS } = {}) {
  let modus = null;
  return {
    name: 'opds-werkplek-mcp-tools',
    apply: 'build',
    configResolved(config) {
      modus = config.mode;
    },
    generateBundle() {
      if (modus !== GAST_MODUS) return;
      const desktopTools = JSON.parse(fs.readFileSync(bron, 'utf8'));
      this.emitFile({ type: 'asset', fileName: MCP_TOOLS_BESTAND, source: mcpToolsJson(desktopTools) });
    },
  };
}
