import { beeldSoort, laadAfbeeldingBytes } from './afbeelding-bron.js';

// Handtekeningen staan in de browseropslag. Bewaar geen cameraresolutie voor
// een klein ondertekenvak; behoud verhouding en transparantie bij verkleinen.
export async function signatureImageData(bytes) {
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Maximum 10 MB');
  const soort = beeldSoort(bytes);
  if (soort !== 'png' && soort !== 'jpeg') throw new Error('PNG / JPEG');
  const { img, dataUrl } = await laadAfbeeldingBytes(bytes);
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(soort === 'jpeg' ? 'image/jpeg' : 'image/png');
}
