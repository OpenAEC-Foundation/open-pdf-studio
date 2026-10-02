export function tileRenderScaleForZoom(zoom, devicePixelRatio) {
  return zoom * devicePixelRatio;
}

export function needsVisibleTile(zoom, devicePixelRatio, wholePageCapScale) {
  return tileRenderScaleForZoom(zoom, devicePixelRatio) > wholePageCapScale + 0.001;
}

// A tile rendered above the screen's physical resolution is drawn shrunk by a
// non-integer factor (e.g. a 300% coverage tile shown at 200%), which blurs
// thin strokes. Only an (almost) exact render is 1:1 and sharp.
export function tileNeedsExactRender(renderScale, zoom, devicePixelRatio) {
  return Number.isFinite(renderScale)
    && renderScale > tileRenderScaleForZoom(zoom, devicePixelRatio) * 1.02;
}

export function prewarmCoveragePlan({ zooms, devicePixelRatio }) {
  const sortedZooms = zooms
    .filter((zoom) => Number.isFinite(zoom) && zoom > 0)
    .sort((a, b) => a - b);
  if (!sortedZooms.length) return null;

  const regionZoom = sortedZooms[0];
  const supportZoom = sortedZooms[sortedZooms.length - 1];
  return {
    regionZoom,
    supportZoom,
    renderScale: tileRenderScaleForZoom(supportZoom, devicePixelRatio),
  };
}

export function tileCoverageRenderScale({
  zoom,
  devicePixelRatio,
  regionWpt,
  regionHpt,
  regionZoom = 1.5,
  supportZoom = 3,
  maxBitmapAxisPx = 4096,
}) {
  const currentScale = tileRenderScaleForZoom(zoom, devicePixelRatio);
  if (zoom < regionZoom || zoom > supportZoom) return currentScale;

  const coverageScale = tileRenderScaleForZoom(supportZoom, devicePixelRatio);
  const coverageFits =
    regionWpt * coverageScale <= maxBitmapAxisPx
    && regionHpt * coverageScale <= maxBitmapAxisPx;
  return coverageFits ? coverageScale : currentScale;
}

export function prewarmTileRenderScale({
  regionZoom,
  supportZoom = regionZoom,
  devicePixelRatio,
  zoomBucket,
}) {
  const regionScale = tileRenderScaleForZoom(regionZoom, devicePixelRatio);
  const supportScale = tileRenderScaleForZoom(supportZoom, devicePixelRatio);
  const lowerBucketBound = zoomBucket / 2;
  const sharesBucket =
    supportScale > lowerBucketBound + 0.001
    && supportScale <= zoomBucket + 0.001;
  return sharesBucket ? supportScale : regionScale;
}

export function tileSupportsZoom(renderScale, zoom, devicePixelRatio) {
  return Number.isFinite(renderScale)
    && renderScale + 0.001 >= zoom * devicePixelRatio;
}
