// progressive-render.js
//
// Progressieve whole-page render voor ZWARE raster-pagina's (bv. grote CAD-
// tekeningen): rendert de pagina in tegels via de bestaande
// render_pdf_page_region-worker-pool en blit elke tegel op een accumulator
// zodra hij binnen is, zodat de tekening zichtbaar invult i.p.v. een seconden-
// lang zwart scherm. Alleen bereikt via de aftakking in bitmap-orchestrator.js;
// niet-zware pagina's raken deze code nooit.
//
// De zware app-modules (pdf-viewport, platform, page-bitmap-cache) worden
// DYNAMISCH geïmporteerd binnen de async-functies. Daardoor heeft dit bestand
// geen top-level browser-afhankelijkheden en laadt het onder plain node, zodat
// de pure functies (isHeavyBytes, computeTileGrid) los unit-testbaar zijn.

// Zware-pagina drempel: gecomprimeerde content-stream > 1 MB. Gevalideerd door
// de all-PDF-test zodat geen normale pagina onterecht als zwaar telt.
const HEAVY_CONTENT_BYTES = 1_000_000;
// PDFium / browser canvas axis-limiet (zelfde cap als bitmap-orchestrator).
const MAX_BITMAP_AXIS_PX = 4096;
// Ondergrens tegelgrootte in output-pixels. De werkelijke tegelgrootte schaalt
// mee met de bitmap (zie orchestrator) zodat het aantal tegels ~begrensd blijft
// (~10 per lange as, max ~80) i.p.v. honderden op een grote pagina. Laag genoeg
// dat óók de fit-zoom-accumulator (~500px) in ~4x3 tegels vult: dat spreidt het
// zware rasterwerk over alle workers én geeft zichtbare progressie.
const TILE_MIN_PX = 192;

/** Zwaar zodra de gecomprimeerde content-stream de drempel overschrijdt. */
export function isHeavyBytes(bytes) {
  return typeof bytes === 'number' && bytes > HEAVY_CONTENT_BYTES;
}

// ── [prog-perf]-instrumentatie (meting eind-van-run-gedrag) ──────────────
// Fase-timings + rAF-heartbeat (main-thread-gaten > 100 ms). Alles logt naar
// de console; de dump naar de detach-diag-log (uitleesbaar zonder MCP) staat
// UIT tenzij een test-rig `window.__progPerfDump = true` zet — normale
// sessies schrijven dus geen tempbestand vol.
const _perfBuf = [];
const PERF_BUF_MAX = 400;
let _perfHbActive = false;
let _perfHbLastActivity = 0;

export function perfMark(msg) {
  const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const line = `[prog-perf] @${Math.round(t)} ${msg}`;
  _perfBuf.push(line);
  if (_perfBuf.length > PERF_BUF_MAX) _perfBuf.splice(0, _perfBuf.length - PERF_BUF_MAX);
  try { console.log(line); } catch {}
  _perfHbLastActivity = t;
}

export function perfHeartbeat() {
  if (_perfHbActive || typeof requestAnimationFrame === 'undefined') return;
  _perfHbActive = true;
  let last = performance.now();
  _perfHbLastActivity = last;
  const step = (now) => {
    const gap = now - last;
    if (gap > 100) perfMark(`rAF-gat ${Math.round(gap)}ms`);
    last = now;
    if (now - _perfHbLastActivity < 12000) { requestAnimationFrame(step); return; }
    _perfHbActive = false;
    perfDump('hb-idle');
  };
  requestAnimationFrame(step);
}

export async function perfDump(reason) {
  if (typeof window === 'undefined' || !window.__progPerfDump) return;
  if (!_perfBuf.length) return;
  const lines = _perfBuf.splice(0, _perfBuf.length);
  try {
    const { invoke } = await import('../core/platform.js');
    for (let i = 0; i < lines.length; i += 40) {
      await invoke('detach_diag', { label: 'prog-perf', msg: `${reason}\n${lines.slice(i, i + 40).join('\n')}` });
    }
  } catch { /* meetcode mag nooit breken */ }
}
// ── einde instrumentatie ──

// Route A: pagina's waarvoor de display-list-scene niet werkt (image-zwaar,
// exotische features) vallen blijvend terug op het PDFium-pool-pad.
const _sceneBroken = new Set();

/**
 * Tegel-invoke met scene-first en per-pagina PDFium-fallback. De eigen
 * display-list-engine rastert tegels parallel uit één gecachete scene
 * (~140 MB op een 5M-ops blad) i.p.v. PDFium-parse-state van ~1,1 GB per
 * worker; zelfde wire-format ([w u32][h u32][rgba]) en dezelfde argumenten
 * als render_pdf_page_region.
 */
export async function invokeTileRegion(args) {
  const { invoke } = await import('../core/platform.js');
  const key = `${args.path}|${args.pageIndex}|${args.rotation || 0}`;
  const sceneWorthIt = (await pageContentBytes(args.path, args.pageIndex + 1)) > SCENE_CONTENT_BYTES;
  if (sceneWorthIt && !_sceneBroken.has(key)) {
    try {
      const res = await invoke('render_tile_scene_region', args);
      try {
        const { reportActiveEngine } = await import('../solid/stores/engineStatusStore.js');
        reportActiveEngine('scene', args.path, args.pageIndex + 1);
      } catch {}
      return res;
    } catch (e) {
      _sceneBroken.add(key);
      perfMark(`scene-fallback p${args.pageIndex + 1}: ${String(e).slice(0, 80)}`);
      console.log(`[prog] scene-fallback p${args.pageIndex + 1}: ${String(e).slice(0, 140)}`);
    }
  }
  // Tegels SPREIDEN over de pool (parallel). Het pinnen-op-één-worker was
  // bedoeld voor extreme bladen waar een koude worker seconden aan
  // content-stream moet parsen — MAAR die (MV-03-klasse, content > 6 MB) gaan
  // hierboven al naar de scene-engine. Dit PDFium-tegelpad wordt dus alleen
  // geraakt door gematigde bladen (content 1-6 MB, bv. NKD1a) waar het openen
  // van de pagina goedkoop is (~0,2 s) en de rendertijd per tegel domineert;
  // daar wint parallelisme over 4 workers ruim van serieel pinnen (gemeten
  // NKD1a p2: ~6 s serieel -> ~1,5 s gespreid).
  const res = await invoke('render_pdf_page_region', { ...args, spread: true });
  try {
    const { reportActiveEngine } = await import('../solid/stores/engineStatusStore.js');
    reportActiveEngine('pdfium', args.path, args.pageIndex + 1);
  } catch {}
  return res;
}

/**
 * Verdeel een w×h pixel-vlak in tegels van ~tilePx (laatste kolom/rij = rest).
 * Retour: [{ px, py, pw, ph }] in output-pixels (boven→onder, links→rechts).
 * Aaneensluitend en zonder gaten: dekt exact [0,w) × [0,h).
 */
export function computeTileGrid(w, h, tilePx) {
  const tiles = [];
  for (let py = 0; py < h; py += tilePx) {
    const ph = Math.min(tilePx, h - py);
    for (let px = 0; px < w; px += tilePx) {
      const pw = Math.min(tilePx, w - px);
      tiles.push({ px, py, pw, ph });
    }
  }
  return tiles;
}

// Content-groottes met cache per (filePath,pageNum): de RUWE bytes, zodat
// zowel de prog-drempel (1 MB) als de engine-keuze (scene vanaf
// SCENE_CONTENT_BYTES) uit één goedkope meting komen. Onbekend/niet-Tauri => 0.
const _contentBytesCache = new Map();

async function pageContentBytes(filePath, pageNum) {
  if (!filePath) return 0;
  const key = `${filePath}:${pageNum}`;
  if (_contentBytesCache.has(key)) return _contentBytesCache.get(key);
  let bytes = 0;
  try {
    const { isTauri, invoke } = await import('../core/platform.js');
    if (isTauri()) {
      const _s0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      bytes = Number(await invoke('page_content_size', { path: filePath, pageIndex: pageNum - 1 })) || 0;
      perfMark(`page_content_size p${pageNum} ${Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - _s0)}ms (${(bytes / 1048576).toFixed(1)}MB)`);
    }
  } catch {
    bytes = 0;
  }
  _contentBytesCache.set(key, bytes);
  return bytes;
}

/**
 * Is deze pagina "zwaar" genoeg voor het progressieve pad? Vraagt de
 * gecomprimeerde content-stream-lengte op via het Tauri-command
 * page_content_size (goedkoop, geen decompressie) en vergelijkt met de drempel.
 * Gecachet per (filePath,pageNum); buiten Tauri altijd false.
 */
export async function isHeavyPage(filePath, pageNum) {
  return isHeavyBytes(await pageContentBytes(filePath, pageNum));
}

// Engine-BELEID: PDFium is de basis-engine voor alles. De eigen engine
// (AEC-PDF v1, de parallelle tegel-scene) wordt uitsluitend ingezet waar
// performance dat afdwingt: extreme CAD-bladen in de MV-03-klasse (8,5 MB
// content → PDFium-parse 3-7 s en ~1,1 GB per worker; AEC-PDF v1 doet het
// volle blad in ~3 s met ~290 MB). Bewust hoog gelegd — AEC-PDF v1 wordt
// ondertussen doorontwikkeld tot volwaardige engine (clips, images, tekst-
// randgevallen) en de drempel zakt pas wanneer de corpus-benchmark
// (examples/corpus_diff.rs) dat per bladklasse aantoont.
const SCENE_CONTENT_BYTES = 6_000_000;

// Generatie-teller voor stale-guards: elke start bumpt hem; na elke await checken
// we of onze generatie nog actueel is voor we viewport-state muteren. Zo kan een
// tragere in-flight progressieve render nooit een nieuwere (zoom/pagina/tab) over-
// schrijven — analoog aan _bitmapGen in bitmap-orchestrator.js.
let _progGen = 0;

// In-flight-dedupe: renderPage vuurt tijdens één open meerdere keren (open,
// fit, her-render). Zonder dedupe herstart elke aanroep de progressieve run
// (verse witte accumulator overschrijft de bijna-volle!). Zelfde doelrun
// (pad+pagina+schaal+rotatie) → meteen terugkeren (aanroepers zijn
// fire-and-forget; de lopende run publiceert zelf).
let _inflightKey = null;

/** Loopt er op dit moment een progressieve run? Gebruikt door de pre-warm
 *  (bitmap-orchestrator) om interactie-werk voorrang te geven. */
export function progressiveRunActive() {
  return _inflightKey !== null;
}

// Herstart-demper: tijdens openen/fit wisselt de zoom een paar keer kort
// achter elkaar en zou elke wissel een verse run starten, terwijl de al
// ingediende tegels van de vorige run nog op de (gepinde) worker in de rij
// staan — die stale tegels kosten seconden per stuk. Een vervangende run
// wacht daarom kort; komt er binnen die tijd wéér een nieuwe schaal, dan
// wint die en vervalt deze stilletjes.
let _restartToken = 0;
const RESTART_DEBOUNCE_MS = 300;

/**
 * Progressieve whole-page render voor de actieve ZWARE raster-pagina. Rendert de
 * pagina tegel-voor-tegel via render_pdf_page_region (worker-pool) en publiceert
 * tussentijds een bijgewerkte viewport.currentBitmap zodat de tekening zichtbaar
 * invult. Het eind-composiet is pixel-equivalent aan de gewone whole-page render
 * (zelfde bucket + aaneensluitende regio's) en wordt in de page-bitmap-cache
 * gezet zodat zoom/pan/re-visit cache-hits blijven. Bij een tegel-fout valt hij
 * terug op één gewone render_pdf_page.
 */
export async function ensureProgressiveBitmapForCurrentView() {
  const { viewport } = await import('./pdf-viewport.js');
  const { invoke } = await import('../core/platform.js');
  const { computeZoomBucket, getBestAvailableBitmap, getCachedBitmap, setCachedBitmapEntry, ensureBitmap } =
    await import('./page-bitmap-cache.js');

  if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster') return;

  // Render-schaal: zoom*dpr, HARD gecapt op 4096 px langste as. Belangrijk: we
  // gebruiken de GECAPTE schaal direct, niet via computeZoomBucket — dat rondt
  // naar boven af en zou de cap overschrijden (bv. 6740 px i.p.v. 4096 op MV-03),
  // wat bij herhaald createImageBitmap tot een geheugen-crash leidde. cacheBucket
  // is enkel de cache-sleutel.
  const dpr = window.devicePixelRatio || 1;
  const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
  if (maxAxisPt <= 0) return;
  const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
  let renderScale = Math.min(viewport.zoom * dpr, capScale);
  const rotation = viewport.rotation || 0;
  // Leg pagina-identiteit vast: de render gebruikt deze locals, niet live
  // viewport-velden, zodat een tab-/paginawissel nooit de verkeerde pagina rendert.
  const filePath = viewport.filePath;
  const pageNum = viewport.pageNum;

  // Zelfde doelrun al bezig? Niet herstarten (zie _inflightKey).
  let runKey = `${filePath}:${pageNum}:${rotation}:${renderScale.toFixed(4)}`;
  perfMark(`aanroep zoom=${viewport.zoom.toFixed(3)} scale=${renderScale.toFixed(3)} inflight=${_inflightKey ? 'ja' : 'nee'}`);
  if (_inflightKey === runKey) return;
  // SNELPAD vóór de herstart-demper: is de doel-bucket al gecachet, dan is
  // deze zoomstand per direct toonbaar — zonder 300 ms demper en zonder een
  // verse run te starten. Een eventuele lopende run op een ANDERE schaal is
  // daarmee achterhaald: de gen-bump maakt hem stale zodat hij de zojuist
  // getoonde weergave niet later met een verkeerde schaal overschrijft.
  {
    const hitBucket = computeZoomBucket(renderScale);
    const hit = getCachedBitmap(filePath, pageNum, rotation, hitBucket);
    if (hit && hit.bitmap) {
      perfMark(`cache-hit-direct bucket=${hitBucket} scale=${renderScale.toFixed(3)}`);
      ++_progGen;
      _inflightKey = null;
      viewport.currentBitmap = hit.bitmap;
      viewport.dirty = true;
      return;
    }
  }
  // Vervangt deze aanroep een LOPENDE run op een andere schaal? Even dempen
  // (zie _restartToken) zodat een fit-/zoomcascade één echte run oplevert.
  // Ná de demping gaan we door met de dán actuele schaal — de laatste
  // aanroep rendert dus altijd de eindstand.
  if (_inflightKey !== null) {
    const tok = ++_restartToken;
    await new Promise((r) => setTimeout(r, RESTART_DEBOUNCE_MS));
    if (tok !== _restartToken) return; // alweer vervangen door een nieuwere
    if (!viewport.active || viewport.filePath !== filePath || viewport.pageNum !== pageNum) return;
    renderScale = Math.min(viewport.zoom * dpr, capScale);
    runKey = `${filePath}:${pageNum}:${rotation}:${renderScale.toFixed(4)}`;
    if (_inflightKey === runKey) return; // lopende run is al de juiste
  }
  const cacheBucket = computeZoomBucket(renderScale);
  const myGen = ++_progGen;
  _inflightKey = runKey;

  // Al gerenderd op deze bucket? Meteen tonen en klaar.
  const exact = getCachedBitmap(filePath, pageNum, rotation, cacheBucket);
  if (exact && exact.bitmap) {
    perfMark(`cache-hit bucket=${cacheBucket} scale=${renderScale.toFixed(3)}`);
    viewport.currentBitmap = exact.bitmap;
    viewport.dirty = true;
    _inflightKey = null;
    return;
  }
  // Anders: toon vast de best beschikbare (lagere bucket) terwijl we renderen.
  const fallback = getBestAvailableBitmap(filePath, pageNum, rotation, cacheBucket);
  if (fallback && fallback.bitmap) {
    viewport.currentBitmap = fallback.bitmap;
    viewport.dirty = true;
  }

  // Volledige bitmapmaat (≤ 4096 px per as door de cap hierboven).
  const fullW = Math.max(1, Math.round(viewport.pageW * renderScale));
  const fullH = Math.max(1, Math.round(viewport.pageH * renderScale));

  // Accumulator-canvas. Zonder OffscreenCanvas-ondersteuning: gewone render.
  let acc, actx;
  try {
    acc = new OffscreenCanvas(fullW, fullH);
    actx = acc.getContext('2d');
    actx.fillStyle = '#ffffff';
    actx.fillRect(0, 0, fullW, fullH);
    // Seed met de beste beschikbare bitmap: tussenstanden zijn dan altijd
    // "oude weergave + nieuwe tegels" en kunnen nooit terugvallen naar wit.
    if (fallback && fallback.bitmap) {
      try { actx.drawImage(fallback.bitmap, 0, 0, fullW, fullH); } catch {}
    }
  } catch {
    _inflightKey = null;
    const e = await ensureBitmap(filePath, pageNum, rotation, cacheBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  // Tegelgrootte schaalt mee zodat het aantal region-renders HARD begrensd
  // blijft (~4 op de lange as → ~12 totaal). Belangrijk: op extreme vector-
  // pagina's betaalt élke tegel een flink deel van de display-list-walk, dus
  // meer tegels = meer totaaltijd. 6-12 tegels geeft zichtbare progressie én
  // een begrensde totaaltijd, op elke schaal.
  const tilePx = Math.max(TILE_MIN_PX, Math.ceil(Math.max(fullW, fullH) / 4));
  const tiles = computeTileGrid(fullW, fullH, tilePx);
  let failed = false;
  let lastPublish = 0;         // throttle tussentijdse publicaties
  let lastIntermediate = null; // vorige tussenstand-bitmap (sluiten na swap)
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  let tilesDone = 0;
  console.log(`[prog] start ${fullW}x${fullH}px, ${tiles.length} tegels (tile=${tilePx}px) p${pageNum}`);
  perfMark(`run-start ${fullW}x${fullH} ${tiles.length} tegels p${pageNum} scale=${renderScale.toFixed(3)}`);
  perfHeartbeat();

  // Publiceer de accumulator als viewport-bitmap; sluit de vorige tussenstand
  // meteen na de swap zodat het geheugen begrensd blijft (elke ImageBitmap is
  // ~fullW*fullH*4 bytes; zonder sluiten stapelt dat op tot een OOM-crash). Veilig:
  // JS is single-threaded, dus geen RAF-frame tekent de oude bitmap na de swap.
  const publish = async () => {
    const _p0 = performance.now();
    const bmp = await createImageBitmap(acc);
    perfMark(`publish createImageBitmap ${fullW}x${fullH} ${Math.round(performance.now() - _p0)}ms`);
    if (myGen !== _progGen) { try { bmp.close && bmp.close(); } catch {} return; }
    viewport.currentBitmap = bmp;
    viewport.dirty = true;
    if (lastIntermediate) { try { lastIntermediate.close && lastIntermediate.close(); } catch {} }
    lastIntermediate = bmp;
  };

  const renderTile = async (t) => {
    if (myGen !== _progGen || failed) return;
    // output-pixel-tegel -> PDF-punt-regio (scale = renderScale => tegel = t.pw×t.ph px)
    const regionXPt = t.px / renderScale;
    const regionYPt = t.py / renderScale;
    const regionWPt = t.pw / renderScale;
    const regionHPt = t.ph / renderScale;
    let bytes;
    try {
      const _i0 = performance.now();
      const res = await invokeTileRegion({
        path: filePath, pageIndex: pageNum - 1,
        scale: renderScale, rotation,
        regionXPt, regionYPt, regionWPt, regionHPt,
      });
      bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
      perfMark(`tegel-invoke ${t.pw}x${t.ph} ${Math.round(performance.now() - _i0)}ms (${(bytes.length / 1048576).toFixed(1)}MB)`);
    } catch { failed = true; return; }
    if (myGen !== _progGen) return;
    if (!bytes || bytes.length <= 8) return;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const w = dv.getUint32(0, true);
    const h = dv.getUint32(4, true);
    if (w * h * 4 !== bytes.length - 8) return;
    const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * h * 4);
    const _b0 = performance.now();
    actx.putImageData(new ImageData(rgba, w, h), t.px, t.py);
    const _bMs = performance.now() - _b0;
    if (_bMs > 5) perfMark(`putImageData ${w}x${h} ${Math.round(_bMs)}ms`);
    tilesDone++;
    // Tussenstand publiceren: de EERSTE tegel direct (snelste eerste content),
    // daarna getthrottled zodat grote pagina's niet te veel volledige-canvas-
    // bitmaps maken.
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (tilesDone === 1) {
      console.log(`[prog] eerste tegel @${Math.round(now - t0)}ms`);
      lastPublish = now;
      await publish();
    } else if (now - lastPublish >= 300) {
      lastPublish = now;
      await publish();
    }
  };

  // De tegels worden GESPREID over de pool (zie invokeTileRegion: spread=true),
  // dus CONC bepaalt hoeveel workers tegelijk werken. CONC=4 = alle vier de
  // workers parallel op één blad; dat brengt een NKD1a-blad van ~6 s (serieel)
  // naar ~1,5 s. Hoger dan het aantal workers heeft geen zin en laat bij een
  // gen-wissel (paginawissel) meer niet-annuleerbare stale tegels achter.
  const CONC = 4;
  let idx = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (idx < tiles.length && myGen === _progGen && !failed) {
      const t = tiles[idx++];
      await renderTile(t);
    }
  });
  await Promise.all(workers);
  if (myGen !== _progGen) { perfMark(`run-STALE na ${tilesDone} tegels (scale=${renderScale.toFixed(3)})`); if (_inflightKey === runKey) _inflightKey = null; return; }

  if (failed) {
    // Terugval: één gewone whole-page render via de bestaande cache-weg.
    perfMark(`run-GEFAALD na ${tilesDone} tegels`);
    console.warn('[prog] tegel-fout — terugval naar whole-page render');
    if (_inflightKey === runKey) _inflightKey = null;
    const e = await ensureBitmap(filePath, pageNum, rotation, cacheBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  // Klaar: cache de volledige bitmap (zoom/pan/re-visit = cache-hit); sluit de
  // laatste tussenstand. De finalBmp blijft leven in de cache/viewport.
  const _f0 = performance.now();
  const finalBmp = await createImageBitmap(acc);
  perfMark(`finale createImageBitmap ${fullW}x${fullH} ${Math.round(performance.now() - _f0)}ms`);
  if (myGen !== _progGen) { try { finalBmp.close && finalBmp.close(); } catch {} if (_inflightKey === runKey) _inflightKey = null; return; }
  if (lastIntermediate) { try { lastIntermediate.close && lastIntermediate.close(); } catch {} }
  const _c0 = performance.now();
  setCachedBitmapEntry(filePath, pageNum, rotation, cacheBucket, finalBmp, fullW, fullH, renderScale);
  viewport.currentBitmap = finalBmp;
  viewport.dirty = true;
  perfMark(`setCachedBitmapEntry ${Math.round(performance.now() - _c0)}ms`);
  if (_inflightKey === runKey) _inflightKey = null;
  const tEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  console.log(`[prog] klaar @${Math.round(tEnd - t0)}ms (${tiles.length} tegels)`);
  perfMark(`run-klaar na ${Math.round(tEnd - t0)}ms`);

  // Thumbnail alsnog laten maken: die is voor zware pagina's uitgesteld
  // (zie left-panel renderThumbnailToDataURL) en knipt nu gratis uit de
  // zojuist gecachete whole-page-bitmap.
  try {
    const _t1 = performance.now();
    const lp = await import('../ui/panels/left-panel.js');
    lp.invalidateThumbnail(pageNum);
    perfMark(`invalidateThumbnail ${Math.round(performance.now() - _t1)}ms`);
  } catch { /* thumbnail is best-effort */ }

  // 300%-pre-cache: warm de zoom-tegels voor de huidige view alvast op zodat
  // gecentreerd inzoomen direct scherp is. Fire-and-forget; de pre-warm stopt
  // zelf bij tab-/paginawissel.
  try {
    const orch = await import('./bitmap-orchestrator.js');
    orch.prewarmZoomTiles(filePath, pageNum);
  } catch { /* pre-warm is best-effort */ }
}
