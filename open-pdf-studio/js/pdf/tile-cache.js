// LRU cache for region-tile ImageBitmaps used at high zoom.
// Keys: `${filePath}|p${pageNum}|z${zoomBucket}|r${rotation}|reg${regionBucket}`
// regionBucket = "x,y" in PDF points snapped to 25%-viewport buffer grid.
// Smaller than bitmap-cache because tiles are bigger; LRU max 8.

import { findBestCoveringTile } from './tile-coverage.js';

const CACHE = new Map();
const MAX = 8;

function makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket) {
  return `${filePath}|p${pageNum}|z${Math.round(zoomBucket * 10000)}|r${rotation || 0}|reg${regionBucket}`;
}

export function tileCacheGet(filePath, pageNum, zoomBucket, rotation, regionBucket) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket);
  const entry = CACHE.get(key);
  if (entry) {
    CACHE.delete(key);
    CACHE.set(key, entry);
  }
  return entry || null;
}

export function tileCacheFindCovering(filePath, pageNum, rotation, request) {
  const pagePrefix = `${filePath}|p${pageNum}|`;
  const rotationPart = `|r${rotation || 0}|`;
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
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket);
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
