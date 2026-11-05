// De omgeving van `window.__OPDS_APP__` (core/werkplek-app.js, #977): de
// publieke toollijst van de desktop-app (mcp-stdio/tools.json, gegenereerd
// door de Rust-server) en de `mcp:*`-handlers van js/mcp-bridge.js, hier
// rechtstreeks in de browser uitgevoerd.
//
// Een eigen chunk: core/werkplek-app-start.js laadt hem pas bij de eerste
// aanroep van de assistent.

import desktopTools from '../../../mcp-stdio/tools.json';
import { runAppEvent } from '../mcp-bridge.js';
import { getActiveDocument } from './state.js';
import { maakWerkplekApp } from './werkplek-app.js';

function selectie() {
  return (getActiveDocument()?.selectedAnnotations || []).map((a) => a?.id).filter((id) => id != null);
}

export function maakApp() {
  return maakWerkplekApp({ desktopTools, voerUit: runAppEvent, selectie });
}
