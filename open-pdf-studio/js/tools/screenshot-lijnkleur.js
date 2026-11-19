// Map black ink to the selected colour and white paper to white.
// Process strips to bound temporary memory when exporting a high-DPI capture.
export function kleurOpname(canvas, kleur) {
  if (!/^#[0-9a-f]{6}$/i.test(kleur)) return;
  const rgb = [1, 3, 5].map(i => parseInt(kleur.slice(i, i + 2), 16));
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < canvas.height; y += 64) {
    const band = ctx.getImageData(0, y, canvas.width, Math.min(64, canvas.height - y));
    const pixels = band.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const licht = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
      pixels[i] = rgb[0] + licht * (255 - rgb[0]);
      pixels[i + 1] = rgb[1] + licht * (255 - rgb[1]);
      pixels[i + 2] = rgb[2] + licht * (255 - rgb[2]);
    }
    ctx.putImageData(band, 0, y);
  }
}
