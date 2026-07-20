// Drives the in-app MCP server (POST /mcp) to test PDF text editing + snapshots.
//   node mcp-server/test-text-edit.mjs
import { writeFileSync } from 'node:fs';

const MCP = 'http://127.0.0.1:9223/mcp';
const TMP = 'C:/Users/rickd/AppData/Local/Temp';
let _id = 0;

async function rpc(method, params) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++_id, method, params }) });
  const jj = await r.json();
  if (jj.error) throw new Error(`${method} -> ${JSON.stringify(jj.error)}`);
  return jj.result;
}
async function tool(name, args) {
  const res = await rpc('tools/call', { name, arguments: args || {} });
  const c = res?.content?.[0];
  if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
  if (c?.type === 'image') return { png_base64: c.data };
  return res;
}
function saveShot(res, file) {
  const b64 = res?.png_base64 || res?.image || res?.base64 || res?.png;
  if (typeof b64 === 'string') {
    const data = b64.replace(/^data:image\/\w+;base64,/, '');
    try { writeFileSync(file, Buffer.from(data, 'base64')); return `saved ${file} (${Math.round(data.length / 1024)} KB)`; }
    catch (e) { return 'save err: ' + e.message; }
  }
  return 'GEEN afbeelding: ' + JSON.stringify(res).slice(0, 160);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (x) => JSON.stringify(x).slice(0, 500);
const txt = (list) => {
  const arr = Array.isArray(list) ? list : (list?.annotations || []);
  return arr.map((a) => `${a.type}#${(a.id || '').slice(-6)}="${a.text}"`).join(' | ');
};

(async () => {
  try {
    console.log('NEW_BLANK:', j(await tool('app_new_blank_pdf', { widthPt: 595, heightPt: 842 })));
    const vp = await tool('app_get_viewport_state', {});
    console.log('VP:', j(vp));

    const P = { x: 80, y: 80, width: 260, height: 60, text: 'Start 123' };
    console.log('CREATE:', j(await tool('app_create_annotation', { type: 'textbox', page: 1, props: P })));
    const before = await tool('app_list_annotations', {});
    console.log('BEFORE text:', txt(before));
    console.log('SHOT_BEFORE:', saveShot(await tool('app_screenshot_view', {}), TMP + '/opds-edit-before.png'));

    // Map the textbox centre to screen (client) coords. Blank docs bypass the
    // vector viewport, so use doc.scale + canvas origin, no offset.
    const active = !!vp.viewport?.active;
    const scale = active ? vp.viewport.zoom : (vp.doc?.scale ?? vp.viewport?.zoom ?? 1.5);
    const offX = active ? vp.viewport.offsetX : 0;
    const offY = active ? vp.viewport.offsetY : 0;
    const cx = (vp.canvas?.cssLeft || 0) + offX + (P.x + P.width / 2) * scale;
    const cy = (vp.canvas?.cssTop || 0) + offY + (P.y + P.height / 2) * scale;
    console.log(`COORDS: scale=${scale} canvas=(${vp.canvas?.cssLeft},${vp.canvas?.cssTop}) center=(${cx.toFixed(0)},${cy.toFixed(0)})`);

    await tool('app_set_tool', { tool: 'select' });
    console.log('DBLCLICK:', j(await tool('app_mouse_click', { x: cx, y: cy, double: true })));
    await sleep(1800); // give the inline textarea time to mount + autofocus
    console.log('TYPE:', j(await tool('app_type', { text: ' BEWERKT' })));
    await sleep(300);
    console.log('SHOT_EDITING:', saveShot(await tool('app_screenshot_view', {}), TMP + '/opds-edit-during.png'));
    // Commit by clicking away (blur). NB: Escape CANCELS in TextEditOverlay; blur COMMITS.
    console.log('CLICK_AWAY:', j(await tool('app_mouse_click', { x: cx, y: cy + 260 })));
    await sleep(400);

    const after = await tool('app_list_annotations', {});
    console.log('AFTER text (na klik-weg = commit):', txt(after));
    console.log('SHOT_AFTER:', saveShot(await tool('app_screenshot_view', {}), TMP + '/opds-edit-after.png'));
  } catch (e) {
    console.log('PROBE ERROR:', e.message);
  }
})();
