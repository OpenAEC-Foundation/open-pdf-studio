const CLASSIC_ATTACHMENT_CACHE = /[\\/]INetCache[\\/]Content\.[^\\/]+[\\/]/i;
const PACKAGED_APP_CACHE = /(?:^|[\\/])[^\\/]+\.[A-Za-z]+ForWindows(?:_[^\\/]+)?(?:[\\/]|$)/i;

export function shouldSaveAsForTransientSourcePath(filePath) {
  if (typeof filePath !== 'string') return false;
  return CLASSIC_ATTACHMENT_CACHE.test(filePath) || PACKAGED_APP_CACHE.test(filePath);
}
