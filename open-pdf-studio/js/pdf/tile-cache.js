// LRU cache for region-tile ImageBitmaps used at high zoom.
// Keys: `${filePath}|p${pageNum}|z${zoomBucket}|r${rotation}|reg${regionBucket}`
// regionBucket = "x,y" in PDF points snapped to 25%-viewport buffer grid.
// Smaller than bitmap-cache because tiles are bigger; LRU max 8.

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

export async function tileCacheSet(filePath, pageNum, zoomBucket, rotation, regionBucket, imageData, regionMeta) {
  const key = makeKey(filePath, pageNum, zoomBucket, rotation, regionBucket);
  while (CACHE.size >= MAX) {
    const firstKey = CACHE.keys().next().value;
    if (!firstKey) break;
    const old = CACHE.get(firstKey);
    try { old?.bitmap?.close?.(); } catch {}
    CACHE.delete(firstKey);
  }
  try {
    const bitmap = await createImageBitmap(imageData);
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
