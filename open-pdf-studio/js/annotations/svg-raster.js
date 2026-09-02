// SVG rasteren naar een PNG — losgeweekt uit stamps.js zodat modules die
// alleen willen rasteren dat kunnen doen zonder stamps.js te importeren.
// stamps.js trekt namelijk ui/panels/properties-panel.js mee en die loopt via
// bridge.ts terug naar solid/stores/propertiesStore.js; een statische import
// vanuit propertiesStore zou daarmee een import-cyclus vormen.

// When an SVG references external images via <image href="http(s):..."> or
// <image xlink:href="...">, those sub-resources are NOT reliably loaded when the
// SVG itself is loaded as an <img src="blob:..."> (security context + onload
// timing race). Pre-fetch each external href and inline it as a data: URL so
// the rasterized PNG actually contains the symbol instead of a broken-image
// placeholder. NEN 1414 symbols rely on this.
async function inlineSvgExternalImages(svgString) {
  if (!/<image\b[^>]*\bhref=/i.test(svgString)) return svgString;
  const hrefRegex = /(<image\b[^>]*\b(?:xlink:href|href)=)(["'])([^"']+)\2/gi;
  const matches = [...svgString.matchAll(hrefRegex)];
  const replacements = await Promise.all(matches.map(async (m) => {
    const url = m[3];
    if (url.startsWith('data:')) return null; // already inline
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      return { match: m[0], replacement: m[1] + m[2] + dataUrl + m[2] };
    } catch (_) {
      return null;
    }
  }));
  let out = svgString;
  for (const r of replacements) if (r) out = out.replace(r.match, r.replacement);
  return out;
}

// Rasterize an SVG string to a PNG data URL for PDF embedding
export async function rasterizeSvg(svgString) {
  const inlined = await inlineSvgExternalImages(svgString);
  return new Promise((resolve) => {
    const blob = new Blob([inlined], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const svgImg = new Image();
    svgImg.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 3;
      // SVG without explicit width/height in xml may report naturalWidth=0 in
      // some engines — fall back to a sane default based on viewBox or 64.
      const naturalW = svgImg.naturalWidth || 64;
      const naturalH = svgImg.naturalHeight || 64;
      canvas.width = naturalW * scale;
      canvas.height = naturalH * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/png');
      // Create a proper rasterized PNG image for reliable canvas rendering
      const pngImg = new Image();
      pngImg.onload = () => resolve({ img: pngImg, dataUrl });
      pngImg.onerror = () => resolve({ img: svgImg, dataUrl });
      pngImg.src = dataUrl;
    };
    svgImg.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    svgImg.src = url;
  });
}
