// bitmap-orchestrator.js
//
// Thin wrapper that reads viewport state and triggers async fills for the
// current view. Delegates the actual work:
//   - whole-page raster -> ensureBitmap() in page-bitmap-cache.js
//   - visible-region high-zoom augment -> invoke('render_pdf_page_region')
//     + tile-cache.js
//
// When a bitmap/tile arrives, we write it onto the viewport singleton and
// set viewport.dirty = true so the RAF loop in pdf-viewport.js paints it.
//
// Concurrency: each function bumps a module-private generation counter on
// entry. After every await we re-check that our generation is still current
// before mutating viewport state, so a slower in-flight request can't
// overwrite a newer one (e.g. zoom-in while a previous render is pending).

import { viewport } from './pdf-viewport.js';
import { computeZoomBucket, ensureBitmap, getBestAvailableBitmap } from './page-bitmap-cache.js';
import { tileCacheGet, tileCacheSet } from './tile-cache.js';
import { state } from '../core/state.js';
import { isHeavyPage, ensureProgressiveBitmapForCurrentView } from './progressive-render.js';


// PDFium / browser canvas axis limit. Above this, we cap the whole-page
// bitmap resolution and rely on the tile augment for crispness in the
// visible region.
const MAX_BITMAP_AXIS_PX = 4096;

// Tile region buffer: extend the visible region by this fraction on each
// side, and snap region origin to a grid of this step. Small pans within
// the buffer stay cache-hits.
const TILE_BUFFER_FRACTION = 0.25;

let _bitmapGen = 0;
let _tileGen = 0;

export async function ensureBitmapForCurrentView() {
    if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster') {
        viewport.currentBitmap = null;
        viewport.dirty = true;
        return;
    }

    // Additief pad: een ZWARE raster-pagina (grote content-stream) met de voorkeur
    // aan, vullen we progressief tegel-voor-tegel in i.p.v. één trage whole-page
    // render. Niet-zware pagina's of voorkeur uit → exact het bestaande pad hieronder.
    const _prefOn = !!(state.preferences && state.preferences.progressiveRender);
    const _heavy = _prefOn ? await isHeavyPage(viewport.filePath, viewport.pageNum) : false;
    if (_prefOn && _heavy) {
        console.log(`[prog-guard] zware pagina p${viewport.pageNum} → progressief pad`);
        _bitmapGen++; // maak een eventuele in-flight gewone render stale
        return ensureProgressiveBitmapForCurrentView();
    }

    const myGen = ++_bitmapGen;
    const dpr = window.devicePixelRatio || 1;
    const targetScale = viewport.zoom * dpr;

    // Cap so PDFium never has to render above the 4096 px axis limit.
    const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
    if (maxAxisPt <= 0) {
        viewport.currentBitmap = null;
        viewport.dirty = true;
        return;
    }
    const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
    const cappedBucket = computeZoomBucket(Math.min(targetScale, capScale));
    // computeZoomBucket is monotonic, so the capped bucket is always <= the requested one
    const useBucket = cappedBucket;

    // Synchronous: show the best already-cached bitmap immediately. Handles
    // the "zoom-in while async render is in flight" case — we never blank
    // out the page while we wait for the higher bucket.
    const fallback = getBestAvailableBitmap(viewport.filePath, viewport.pageNum, viewport.rotation, useBucket);
    if (fallback) {
        viewport.currentBitmap = fallback.bitmap;
        viewport.dirty = true;
    }

    // Async: fetch the exact bucket. ensureBitmap dedups concurrent calls.
    const entry = await ensureBitmap(viewport.filePath, viewport.pageNum, viewport.rotation, useBucket);
    if (myGen !== _bitmapGen) return;  // stale (newer zoom/page came in)
    if (entry && entry.bitmap) {
        viewport.currentBitmap = entry.bitmap;
        viewport.dirty = true;
    }
}

// Rustvenster voor de pre-warm: direct na "prog klaar" begint de gebruiker
// vaak juist te zoomen/pannen. Elke prewarm-regio kost ~0,3-1,9 s scene-CPU
// aan de Rust-kant (gemeten op MV-03); vuurt hij meteen, dan staat het échte
// interactie-werk (eerste tegel van de nieuwe run, on-demand zoomtegel) in de
// rij achter de prewarm — precies het "venster hangt nog even na het tilen"-
// gevoel. Daarom: pas starten na PREWARM_CALM_MS ononderbroken rust
// (zoom/offset/canvasmaat stabiel én geen lopende progressieve run) en
// helemaal opgeven na PREWARM_GIVEUP_MS onrust — de on-demand-render dekt
// het dan alsnog.
const PREWARM_CALM_MS = 1200;
const PREWARM_GIVEUP_MS = 10000;

/**
 * Pre-warm van zoom-tegels (300%-pre-cache voor zware pagina's): rendert vast
 * de tegel(s) die het tegel-pad zou opvragen bij gecentreerd inzoomen naar
 * ~150% en ~300%, en zet ze in de tile-cache onder exact dezelfde sleutels als
 * ensureTileForCurrentView. Gecentreerd inzoomen is daarna direct scherp
 * (cache-hit); ver pannen valt terug op de normale on-demand-render.
 * Aangeroepen door het progressieve pad ná de eerste volledige render;
 * fire-and-forget, wacht eerst op een rustvenster (zie PREWARM_CALM_MS) en
 * stopt stil bij tab-/paginawissel of hervatte gebruikersinteractie.
 */
export async function prewarmZoomTiles(filePath, pageNum) {
    const canvas = document.getElementById('pdf-canvas');
    if (!canvas || !viewport.active || viewport.filePath !== filePath || viewport.pageNum !== pageNum) return;

    // View-handtekening: wijzigt zodra de gebruiker zoomt/pant of het venster
    // van maat verandert — de goedkoopste betrouwbare "interactie"-detector
    // op deze plek (geen extra event-listeners nodig).
    const viewSig = () =>
        `${viewport.zoom.toFixed(4)}|${Math.round(viewport.offsetX)}|${Math.round(viewport.offsetY)}|${canvas.width}x${canvas.height}`;
    const { progressiveRunActive } = await import('./progressive-render.js');

    const tWait0 = performance.now();
    let sig = viewSig();
    let calmSince = tWait0;
    for (;;) {
        await new Promise((r) => setTimeout(r, 200));
        if (!viewport.active || viewport.filePath !== filePath || viewport.pageNum !== pageNum) return;
        const s = viewSig();
        if (s !== sig || progressiveRunActive()) {
            sig = s;
            calmSince = performance.now();
        }
        if (performance.now() - calmSince >= PREWARM_CALM_MS) break;
        if (performance.now() - tWait0 > PREWARM_GIVEUP_MS) return; // druk gebleven — overslaan
    }

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
    if (maxAxisPt <= 0 || cssW < 1 || cssH < 1) return;
    const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;

    // Huidig weergave-centrum in paginapunten: gecentreerd zoomen houdt dit
    // punt in beeld, dus daaromheen ligt de toekomstige zichtregio.
    const centerXpt = (cssW / 2 - viewport.offsetX) / viewport.zoom;
    const centerYpt = (cssH / 2 - viewport.offsetY) / viewport.zoom;

    // 1.5 en 3.0 landen (met dpr ~1.25) in zoom-buckets 2 en 4 — dat dekt
    // inzoomen tot ruim 300%.
    for (const zoom of [1.5, 3.0]) {
        if (zoom <= capScale) continue; // whole-page bitmap dekt dit bereik al
        if (!viewport.active || viewport.filePath !== filePath || viewport.pageNum !== pageNum) return;
        // Gebruiker weer bezig (view gewijzigd of nieuwe progressieve run)?
        // Dan direct stoppen — de interactie-render heeft voorrang op de
        // speculatieve pre-warm.
        if (viewSig() !== sig || progressiveRunActive()) return;

        // Zelfde formule als ensureTileForCurrentView, met hypothetische zoom.
        const visW = Math.min(viewport.pageW, cssW / zoom);
        const visH = Math.min(viewport.pageH, cssH / zoom);
        const visX = Math.max(0, Math.min(viewport.pageW - visW, centerXpt - visW / 2));
        const visY = Math.max(0, Math.min(viewport.pageH - visH, centerYpt - visH / 2));
        const bufW = visW * TILE_BUFFER_FRACTION;
        const bufH = visH * TILE_BUFFER_FRACTION;
        const region = {
            x: Math.max(0, visX - bufW),
            y: Math.max(0, visY - bufH),
            w: Math.min(viewport.pageW, visW + 2 * bufW),
            h: Math.min(viewport.pageH, visH + 2 * bufH),
        };
        const stepX = viewport.pageW * TILE_BUFFER_FRACTION;
        const stepY = viewport.pageH * TILE_BUFFER_FRACTION;
        const regionBucket = `${Math.round(Math.floor(region.x / stepX) * stepX * 100)},${Math.round(Math.floor(region.y / stepY) * stepY * 100)}`;
        const zoomBucket = computeZoomBucket(zoom * dpr);
        if (tileCacheGet(filePath, pageNum, zoomBucket, viewport.rotation, regionBucket)) continue;

        try {
            const { invokeTileRegion, perfMark } = await import('./progressive-render.js');
            const _pw0 = performance.now();
            const raw = await invokeTileRegion({
                path: filePath,
                pageIndex: pageNum - 1,
                scale: zoom,
                rotation: viewport.rotation || 0,
                regionXPt: region.x,
                regionYPt: region.y,
                regionWPt: region.w,
                regionHPt: region.h,
            });
            if (!viewport.active || viewport.filePath !== filePath || viewport.pageNum !== pageNum) return;
            const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
            perfMark(`prewarm-invoke z=${zoom} ${Math.round(performance.now() - _pw0)}ms (${(bytes.length / 1048576).toFixed(1)}MB)`);
            if (!bytes || bytes.length <= 8) continue;
            const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
            const w = dv.getUint32(0, true);
            const h = dv.getUint32(4, true);
            if (w * h * 4 !== bytes.length - 8) continue;
            const _pw1 = performance.now();
            const imageData = new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * h * 4), w, h);
            await tileCacheSet(filePath, pageNum, zoomBucket, viewport.rotation, regionBucket, imageData, {
                regionXpt: region.x,
                regionYpt: region.y,
                regionWpt: region.w,
                regionHpt: region.h,
                zoom,
            });
            perfMark(`prewarm-cacheSet z=${zoom} ${w}x${h} ${Math.round(performance.now() - _pw1)}ms`);
            console.log(`[tile-orch] prewarm z=${zoom} bucket=${zoomBucket} reg=${regionBucket} (${w}x${h})`);
        } catch (e) {
            console.warn('[tile-orch] prewarm faalde:', e);
            return;
        }
    }
}

export async function ensureTileForCurrentView(canvas) {
    if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster' || !canvas) {
        viewport.currentTile = null;
        viewport.currentTileMeta = null;
        return;
    }
    const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
    if (maxAxisPt <= 0) return;
    const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
    if (viewport.zoom <= capScale) {
        // Whole-page bitmap is sufficient; clear any stale tile so the
        // renderer doesn't draw a low-zoom tile on top of a fresh raster.
        viewport.currentTile = null;
        viewport.currentTileMeta = null;
        return;
    }

    const myGen = ++_tileGen;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    // Visible page region in CSS pixels.
    const visScreenLeft = Math.max(0, -viewport.offsetX);
    const visScreenTop = Math.max(0, -viewport.offsetY);
    const visScreenRight = Math.min(viewport.pageW * viewport.zoom, cssW - viewport.offsetX);
    const visScreenBottom = Math.min(viewport.pageH * viewport.zoom, cssH - viewport.offsetY);
    const visW = visScreenRight - visScreenLeft;
    const visH = visScreenBottom - visScreenTop;
    if (visW < 1 || visH < 1) {
        viewport.currentTile = null;
        viewport.currentTileMeta = null;
        return;
    }

    // Convert visible region to PDF points and add buffer for pan-within-
    // buffer cache hits.
    const visRegion = {
        x: visScreenLeft / viewport.zoom,
        y: visScreenTop / viewport.zoom,
        w: visW / viewport.zoom,
        h: visH / viewport.zoom,
    };
    const bufW = visRegion.w * TILE_BUFFER_FRACTION;
    const bufH = visRegion.h * TILE_BUFFER_FRACTION;
    const bufferedRegion = {
        x: Math.max(0, visRegion.x - bufW),
        y: Math.max(0, visRegion.y - bufH),
        w: Math.min(viewport.pageW, visRegion.w + 2 * bufW),
        h: Math.min(viewport.pageH, visRegion.h + 2 * bufH),
    };

    // Snap region origin to buffer-step grid for cache stability across pans.
    const stepX = viewport.pageW * TILE_BUFFER_FRACTION;
    const stepY = viewport.pageH * TILE_BUFFER_FRACTION;
    const snappedX = Math.floor(bufferedRegion.x / stepX) * stepX;
    const snappedY = Math.floor(bufferedRegion.y / stepY) * stepY;
    const regionBucket = `${Math.round(snappedX * 100)},${Math.round(snappedY * 100)}`;

    const zoomBucket = computeZoomBucket(viewport.zoom * dpr);

    // Cache hit?
    const hit = tileCacheGet(viewport.filePath, viewport.pageNum, zoomBucket, viewport.rotation, regionBucket);
    if (hit) {
        viewport.currentTile = hit.bitmap;
        viewport.currentTileMeta = hit.regionMeta;
        viewport.dirty = true;
        return;
    }

    // Cache miss: async Rust render of the region at the requested zoom.
    try {
        const { invokeTileRegion } = await import('./progressive-render.js');
        const rgbaData = await invokeTileRegion({
            path: viewport.filePath,
            pageIndex: viewport.pageNum - 1,
            scale: viewport.zoom,
            rotation: viewport.rotation || 0,
            regionXPt: bufferedRegion.x,
            regionYPt: bufferedRegion.y,
            regionWPt: bufferedRegion.w,
            regionHPt: bufferedRegion.h,
        });
        if (myGen !== _tileGen) return;
        const bytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
        if (!bytes || bytes.length <= 8) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        if (w * h * 4 !== bytes.length - 8) {
            console.warn('[tile-orch] size mismatch', w, h, bytes.length - 8);
            return;
        }
        const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
        const imageData = new ImageData(rgba, w, h);
        const regionMeta = {
            regionXpt: bufferedRegion.x,
            regionYpt: bufferedRegion.y,
            regionWpt: bufferedRegion.w,
            regionHpt: bufferedRegion.h,
            zoom: viewport.zoom,
        };
        await tileCacheSet(viewport.filePath, viewport.pageNum, zoomBucket, viewport.rotation, regionBucket, imageData, regionMeta);
        if (myGen !== _tileGen) return;
        const cached = tileCacheGet(viewport.filePath, viewport.pageNum, zoomBucket, viewport.rotation, regionBucket);
        if (cached && cached.bitmap) {
            viewport.currentTile = cached.bitmap;
            viewport.currentTileMeta = cached.regionMeta;
            viewport.dirty = true;
            console.log(`[tile-orch] cached p${viewport.pageNum} @ z=${viewport.zoom.toFixed(2)} reg=${regionBucket}`);
        }
    } catch (e) {
        console.warn('[tile-orch] render failed:', e);
    }
}
