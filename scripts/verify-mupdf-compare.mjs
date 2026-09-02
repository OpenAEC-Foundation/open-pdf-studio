// Vergelijkings-sweep: rendert per verificatie-PDF een paginaselectie zowel in
// de live rig (--mcp-server, poort 9223) als via een onafhankelijke externe
// render-engine (MuPDF, via scripts/mupdf_compare_helper.py) en vergelijkt
// beide per pagina objectief op inkt-percentage en 8x8-occupancy-overeenkomst.
//
// Paginaselectie: alle pagina's bij <=10 pagina's, anders p1 + 4 gelijkmatig
// verdeeld + laatste pagina.
//
// Een pagina wordt AFWIJKEND gevlagd bij occupancy-overeenkomst < 0.85 of
// |inkt-verschil| > 8 procentpunt; gevlagde pagina's worden daarna handmatig
// beoordeeld (echte bug / meetartefact / bestandseigenaardigheid).
//
// Gebruik:
//   node scripts/verify-mupdf-compare.mjs [output-dir] [dir1] [dir2] ...
//   node scripts/verify-mupdf-compare.mjs --recompare <output-dir>
// Zonder argumenten: tests/protocol/results/mupdf-compare-<timestamp>/ en de
// twee standaard-verificatiemappen. --recompare herberekent alle vergelijkingen
// offline op de al opgeslagen PNG's (na drempel-kalibratie in de helper) en
// schrijft report.json/report.md opnieuw — de rig is daarvoor niet nodig.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');

const REPO = 'C:/Users/rickd/Documents/GitHub/open-pdf-studio';
const HELPER = path.join(REPO, 'scripts', 'mupdf_compare_helper.py');
const MCP = 'http://127.0.0.1:9223/mcp';
const DEFAULT_DIRS = [
  'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden',
  `${REPO}/test pdf-bestanden/Originele bestanden`,
];
const RECOMPARE = process.argv[2] === '--recompare';
const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const OUT = (RECOMPARE ? process.argv[3] : process.argv[2])
  || path.join(REPO, 'tests', 'protocol', 'results', `mupdf-compare-${ts}`);
const DIRS = !RECOMPARE && process.argv.length > 3 ? process.argv.slice(3) : DEFAULT_DIRS;
fs.mkdirSync(OUT, { recursive: true });

// Zware bestanden: één keer voorverwarmen en ruimere wachttijden hanteren.
const HEAVY = /MV-03|Barn Relocation|Zware vector|5491|2885/i;
// Vlagregels (zie kalibratie-toelichting in mupdf_compare_helper.py):
// - occ_miss >= 3        : inhoud aanwezig in referentie maar leeg in de app
// - occ_match < 0.85     : totale cel-overeenkomst (miss+extra) te laag
// - ink_diff < -8        : app rendert fors lichter dan de referentie
// - ink_diff > 20        : app rendert extreem donkerder (sanity-grens; matige
//                          positieve verschillen zijn lijndikte-beleid)
const FLAG_MISS = 3;
const FLAG_OCC = 0.85;
const FLAG_INK_NEG = -8;
const FLAG_INK_POS = 20;
const isFlagged = (cmp) => !!cmp.error || cmp.occ_miss >= FLAG_MISS || cmp.occ_match < FLAG_OCC
  || cmp.ink_diff < FLAG_INK_NEG || cmp.ink_diff > FLAG_INK_POS;

async function tool(name, args) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json();
  const t = j?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (f) => f.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 50);
function py(args) {
  const out = execFileSync('python', [HELPER, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.trim().split('\n').pop());
}

function writeReports(rows) {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  const md = ['# MuPDF-vergelijkings-sweep', '', `Uitvoer: ${OUT}`, '',
    '| Bestand | Map | Pagina\'s | Getest | Gevlagd | Detail |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    if (!r.tested) { md.push(`| ${r.file} | ${r.dir} | - | - | - | ${r.status} |`); continue; }
    const det = r.tested.map((p) => `p${p.page}:${p.flagged ? 'AFWIJKEND' : 'ok'}(miss=${p.occ_miss ?? '?'},extra=${p.occ_extra ?? '?'},dink=${p.ink_diff ?? '?'}${p.classificatie ? ',' + p.classificatie : ''})`).join(' ');
    md.push(`| ${r.file} | ${path.basename(r.dir)} | ${r.pages} | ${r.tested.length} | ${r.tested.filter((p) => p.flagged).length} | ${det} |`);
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
}

// Herbereken alle vergelijkingen offline op de bewaarde PNG's en herschrijf de
// rapporten. Handmatige classificaties (veld `classificatie`) blijven staan.
if (RECOMPARE) {
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
  for (const r of rows) {
    if (!r.tested) continue;
    const fileDir = path.join(OUT, r.tag);
    for (const p of r.tested) {
      const ref = path.join(fileDir, `ref-p${p.page}.png`);
      const app = path.join(fileDir, `app-p${p.page}.png`);
      if (!fs.existsSync(ref) || !fs.existsSync(app)) continue;
      let cmp;
      try { cmp = py(['compare', ref, app]); }
      catch (e) { cmp = { error: String(e).slice(0, 200) }; }
      Object.assign(p, cmp);
      p.flagged = isFlagged(cmp);
      console.log(`${r.tag} p${p.page} ${p.flagged ? 'AFWIJKEND' : 'ok'} miss=${cmp.occ_miss} extra=${cmp.occ_extra} dink=${cmp.ink_diff}`);
    }
    r.status = r.tested.some((p) => p.flagged) ? 'AFWIJKEND' : 'OK';
  }
  writeReports(rows);
  console.log(`Herberekend: ${rows.filter((r) => r.status === 'OK').length}/${rows.length} OK`);
  process.exit(0);
}

// Paginaselectie volgens protocol: alles bij <=10, anders p1 + 4 verdeeld + laatste.
function selectPages(n) {
  if (n <= 10) return Array.from({ length: n }, (_, i) => i + 1);
  const sel = new Set([1, n]);
  for (let k = 1; k <= 4; k++) sel.add(1 + Math.round((k * (n - 1)) / 5));
  return [...sel].sort((a, b) => a - b);
}

(async () => {
  const browser = await playwright.chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];
  const ink = () => page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    if (!c || !c.width) return -1;
    const x = c.getContext('2d');
    let d; try { d = x.getImageData(0, 0, c.width, c.height).data; } catch { return -1; }
    let n = 0, t = 0;
    for (let k = 0; k < d.length; k += 4 * 17) { t++; if (d[k + 3] > 0 && !(d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245)) n++; }
    return +(100 * n / t).toFixed(2);
  });
  // Via de MCP-brug, niet via import() in evaluate: een tweede import van
  // state.ts (andere module-URL door Vite-HMR-invalidatie) draait de
  // module-initialisatie opnieuw en crasht op een dubbele defineProperty.
  const numPages = async () => {
    const tabs = await tool('app_list_tabs', {});
    return tabs?.tabs?.find((t) => t.active)?.pageCount || 0;
  };
  // Wacht tot de canvas-inkt stabiel is: minstens `need` opeenvolgende metingen
  // binnen 0.15 procentpunt, met een langere horizon voor zware bestanden.
  // refBlank: pagina's die volgens de referentie-engine (vrijwel) leeg zijn
  // hoeven niet de volle timeout uit te zitten.
  const waitStable = async (heavy, refBlank) => {
    const max = refBlank ? 8 : heavy ? 45 : 20;
    const need = heavy ? 3 : 2;
    let prev = -9, stable = 0, last = -1;
    for (let i = 0; i < max; i++) {
      await sleep(900);
      const v = await ink();
      last = v;
      if (v >= 0 && Math.abs(v - prev) <= 0.15) stable++; else stable = 0;
      prev = v;
      if (stable >= need && (v > 0.15 || refBlank)) break;
    }
    return last;
  };
  const shoot = async (dest) => {
    await sleep(1500); // settle: laat een eventuele schaal-herrender landen
    const s = await tool('app_screenshot_view', { width: 1280 });
    const b64 = s?.png_base64 || s?.image || (typeof s === 'string' ? s : null);
    if (!b64) return false;
    fs.writeFileSync(dest, Buffer.from(b64.split(',').pop(), 'base64'));
    return true;
  };
  const closeActiveTab = async () => {
    const tabs = await tool('app_list_tabs', {});
    const idx = tabs?.tabs?.find((t) => t.active)?.index;
    if (idx !== undefined) await tool('app_close_tab', { index: idx, force: true });
  };

  await tool('app_set_window_size', { width: 1400, height: 900 }).catch(() => {});
  // Eventueel nog openstaande tabs sluiten (force: nooit iets opslaan).
  for (let g = 0; g < 8; g++) {
    const tabs = await tool('app_list_tabs', {});
    if (!tabs?.tabs?.length) break;
    await tool('app_close_tab', { index: tabs.tabs[0].index, force: true });
    await sleep(300);
  }

  // Voorverwarm de zware bestanden: eerste open bouwt caches/side-tables op.
  const preheat = [];
  for (const dir of DIRS) {
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.pdf') && HEAVY.test(f) && !preheat.some((p) => path.basename(p) === f)) {
        preheat.push(`${dir}/${f}`);
      }
    }
  }
  for (const p of preheat) {
    console.log(`voorverwarmen: ${path.basename(p)}`);
    await tool('app_open_pdf', { path: p });
    let pc = 0;
    for (let i = 0; i < 90 && !pc; i++) { await sleep(700); pc = await numPages(); }
    await waitStable(true, false);
    await closeActiveTab();
    await sleep(500);
  }

  const rows = [];
  let dirIdx = 0;
  for (const dir of DIRS) {
    dirIdx++;
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
    console.log(`\n=== ${dir} (${files.length} bestanden) ===`);
    for (const f of files) {
      const t0 = Date.now();
      const heavy = HEAVY.test(f);
      const tag = `d${dirIdx}-${safe(f)}`;
      const fileDir = path.join(OUT, tag);
      fs.mkdirSync(fileDir, { recursive: true });
      const src = `${dir}/${f}`;

      // Referentie-kant: paginaselectie + MuPDF-renders.
      let info, refs;
      try {
        info = py(['info', src]);
        const pages = selectPages(info.pages);
        refs = py(['render', src, fileDir, pages.join(',')]);
        info.selected = pages;
      } catch (e) {
        console.log(`REF-FAIL   ${f}: ${String(e).slice(0, 120)}`);
        rows.push({ dir, file: f, status: 'REF-FAIL' });
        continue;
      }

      // App-kant: openen en per pagina screenshotten.
      await tool('app_clear_caches', {}); await sleep(300);
      await tool('app_open_pdf', { path: src });
      let pc = 0;
      for (let i = 0; i < 150 && !pc; i++) { await sleep(700); pc = await numPages(); }
      if (!pc) {
        console.log(`OPEN-FAIL  ${f}`);
        rows.push({ dir, file: f, status: 'OPEN-FAIL' });
        continue;
      }
      if (pc !== info.pages) console.log(`  LET OP: paginatelling app=${pc} ref=${info.pages}`);

      const pageRows = [];
      for (const pno of info.selected) {
        const ref = refs[String(pno)];
        await tool('app_go_to_page', { page: pno });
        await sleep(400);
        // Fit-page met verificatie: de canvas moet daadwerkelijk op de
        // fit-schaal staan vóór (en ná) het wachten op render-stabiliteit.
        // Zonder deze check kan de screenshot een pre-fit render (100%-zoom,
        // pagina deels buiten beeld) vangen — dat gaf vals-positieve
        // "ontbrekende inhoud" onderaan lange pagina's.
        const fitOk = async () => {
          const vp = await tool('app_get_viewport_state', {});
          const s = vp?.doc?.scale, v = vp?.viewport;
          if (!s || !v?.pageW || !vp?.canvas) return false;
          const dpr = vp.devicePixelRatio || 1;
          const expW = v.pageW * s * dpr;
          const expH = v.pageH * s * dpr;
          // Fit-page: pagina past binnen de canvas-backing-store (kleine marge)...
          if (expW > vp.canvas.width + 4 || expH > vp.canvas.height + 4) return false;
          // ...én staat gecentreerd. Zonder deze check kan de screenshot een
          // tussentoestand vangen waarin de pagina deels buiten beeld staat
          // (stale scroll-offset direct na go_to_page + fit op grote pagina's).
          const cx = (vp.canvas.cssWidth - v.pageW * s) / 2;
          const cy = (vp.canvas.cssHeight - v.pageH * s) / 2;
          return Math.abs((v.offsetX ?? 0) - cx) < 4 && Math.abs((v.offsetY ?? 0) - cy) < 4;
        };
        for (let attempt = 0; attempt < 5; attempt++) {
          await tool('app_fit_page', {});
          await sleep(500);
          if (await fitOk()) break;
        }
        let appInk = await waitStable(heavy, ref.ink < 0.05);
        if (!(await fitOk())) { // schaal alsnog gedreven tijdens het wachten
          await tool('app_fit_page', {});
          await sleep(500);
          appInk = await waitStable(heavy, ref.ink < 0.05);
        }
        const shotPath = path.join(fileDir, `app-p${pno}.png`);
        const ok = await shoot(shotPath);
        let cmp = { error: 'geen screenshot' };
        if (ok) {
          try { cmp = py(['compare', path.join(fileDir, `ref-p${pno}.png`), shotPath]); }
          catch (e) { cmp = { error: String(e).slice(0, 200) }; }
        }
        const flagged = isFlagged(cmp);
        pageRows.push({ page: pno, canvas_ink: appInk, ...cmp, flagged });
        const m = cmp.error ? `FOUT ${cmp.error}` :
          `miss=${cmp.occ_miss} extra=${cmp.occ_extra} ink ref=${cmp.ink_ref}% app=${cmp.ink_app}% diff=${cmp.ink_diff}`;
        console.log(`  p${String(pno).padStart(3)} ${flagged ? 'AFWIJKEND' : 'ok       '} ${m}`);
      }
      await closeActiveTab();
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      const nFlag = pageRows.filter((r) => r.flagged).length;
      console.log(`${(nFlag ? 'AFWIJKEND' : 'OK').padEnd(9)} ${f.slice(0, 52).padEnd(52)} ${pageRows.length} pag., ${nFlag} gevlagd, ${secs}s`);
      rows.push({ dir, file: f, tag, status: nFlag ? 'AFWIJKEND' : 'OK', pages: info.pages, tested: pageRows });
    }
  }

  writeReports(rows);
  const nOk = rows.filter((r) => r.status === 'OK').length;
  console.log(`\nKlaar: ${nOk}/${rows.length} bestanden zonder vlag. Rapport: ${OUT}`);
  await browser.close();
  process.exit(0);
})();
