// Printer enumeration cache. Filled lazily at app startup (see main.js) so
// the print dialog can show the OS default printer INSTANTLY instead of
// waiting on PowerShell/lpstat each time it opens.

import { createSignal } from 'solid-js';
import { isTauri } from '../../core/platform.js';

const [printers, setPrinters] = createSignal([]);
const [defaultPrinter, setDefaultPrinter] = createSignal('');
const [loaded, setLoaded] = createSignal(false);
// Why enumeration produced nothing. An empty list on its own cannot tell a
// machine without printers apart from one where the query itself failed
// (missing lp tooling, a confined package that cannot reach CUPS, a blocked
// shell). Reporting that difference is the only way the user — or a bug
// report — can act on it; see issue #326.
const [printerError, setPrinterError] = createSignal('');

export {
  printers as printerList,
  defaultPrinter as defaultPrinterName,
  loaded as printersLoaded,
  printerError as printerErrorMessage,
};

/** Enumerate printers (cached). Pass force=true to re-query. Safe to call
 *  repeatedly; concurrent calls share the in-flight promise. */
let _inflight = null;
export function loadPrinters(force = false) {
  if (loaded() && !force) return Promise.resolve(printers());
  if (_inflight) return _inflight;
  if (!isTauri()) return Promise.resolve([]);
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.resolve([]);
  _inflight = (async () => {
    try {
      const json = await inv('get_printers');
      // An empty response is not valid JSON. Treat it as "no printers"
      // rather than letting JSON.parse throw and look like a failure.
      const trimmed = String(json ?? '').trim();
      const parsed = trimmed ? JSON.parse(trimmed) : [];
      const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      setPrinters(list);
      const def = list.find(p => p.Default === true || p.Default === 'True');
      setDefaultPrinter(def?.Name || list[0]?.Name || '');
      setPrinterError('');
      setLoaded(true);
      return list;
    } catch (e) {
      const msg = e?.message ?? String(e);
      console.warn('[printers] enumeration failed:', e);
      setPrinters([]);
      setPrinterError(msg);
      return [];
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}
