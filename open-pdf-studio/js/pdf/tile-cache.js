// LRU cache for region-tile ImageBitmaps used at high zoom.
// Keys: `${filePath}|p${pageNum}|z${zoomBucket}|r${rotation}|l${lineMode}|reg${regionBucket}`
// regionBucket = "x,y" in PDF points snapped to 25%-viewport buffer grid.
// lineMode = Thin Lines on/off (#595): getters default to the preference; a
// tile is stored under the mode in its regionMeta.thinLines (the mode it was
// rendered in), so a tile that arrives after a toggle never shows up.
// Smaller than bitmap-cache because tiles are bigger; LRU max 8.

import { findBestCoveringTile } from './tile-coverage.js';
import { thinLinesKey, thinLinesOn } from './thin-lines.js';
import { renderEngineOn } from './render-engine.js';

const CACHE = new Map();
const MAX = 8;

function makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket, thin, engine) {
  return `${filePath}|p${pageNum}|z${Math.round(zoomBucket * 10000)}|r${rotation || 0}|l${thinLinesKey(thin, engine)}|reg${regionBucket}`;
}

export function tileCacheGet(filePath, pageNum, zoomBucket, rotation, regionBucket, thin = thinLinesOn(), engine = renderEngineOn()) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket, thin, engine);
  const entry = CACHE.get(key);
  if (entry) {
    CACHE.delete(key);
    CACHE.set(key, entry);
  }
  return entry || null;
}

export function tileCacheFindCovering(filePath, pageNum, rotation, request, thin = thinLinesOn(), engine = renderEngineOn()) {
  const pagePrefix = `${filePath}|p${pageNum}|`;
  const rotationPart = `|r${rotation || 0}|l${thinLinesKey(thin, engine)}|`;
  const candidates = [];

  for (const [key, entry] of CACHE) {
    if (key.startsWith(pagePrefix) && key.includes(rotationPart)) {
      candidates.push({ key, entry, regionMeta: entry.regionMeta });
    }
  }

  const hit = findBestCoveringTile(candidates, request);
  if (!hit) return null;

  CACHE.delete(hit.key);
  CACHE.set(hit.key, hit.entry);
  return hit.entry;
}

export async function tileCacheSet(filePath, pageNum, zoomBucket, rotation, regionBucket, imageData, regionMeta) {
  const thin = regionMeta && regionMeta.thinLines !== undefined ? !!regionMeta.thinLines : thinLinesOn();
  // The engine the tile was rendered with, so a tile that lands after an
  // engine switch never shows up under the new engine.
  const engine = regionMeta && regionMeta.engine ? regionMeta.engine : renderEngineOn();
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket, thin, engine);
  const replaced = CACHE.get(key);
  while (!replaced && CACHE.size >= MAX) {
    const firstKey = CACHE.keys().next().value;
    if (!firstKey) break;
    const old = CACHE.get(firstKey);
    try { old?.bitmap?.close?.(); } catch {}
    CACHE.delete(firstKey);
  }
  try {
    const bitmap = await createImageBitmap(imageData);
    try { replaced?.bitmap?.close?.(); } catch {}
    CACHE.delete(key);
    CACHE.set(key, { bitmap, w: imageData.width, h: imageData.height, regionMeta });
  } catch (e) {
    console.warn('[tile-cache] createImageBitmap failed:', e);
  }
}

export function tileCacheClearForFile(filePath) {
  for (const k of Array.from(CACHE.keys())) {
    if (k.startsWith(filePath + '|')) {
      const e = CACHE.get(k);
      try { e?.bitmap?.close?.(); } catch {}
      CACHE.delete(k);
    }
  }
}

export function tileCacheClearAll() {
  for (const e of CACHE.values()) {
    try { e?.bitmap?.close?.(); } catch {}
  }
  CACHE.clear();
}
