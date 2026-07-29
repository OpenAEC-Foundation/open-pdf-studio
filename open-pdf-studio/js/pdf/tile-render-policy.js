export function tileRenderScaleForZoom(zoom, devicePixelRatio) {
  return zoom * devicePixelRatio;
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
