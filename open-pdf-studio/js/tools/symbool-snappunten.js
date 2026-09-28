// Snappunten van een parametrisch symbool, in paginacoördinaten.
//
// Een symbool met een vak draait de renderer om het midden van dat vak
// (annotation.rotation, graden, met de klok mee op het scherm; zie
// rendering.js). De template levert zijn snappunten in het ONgedraaide vak,
// net als de terugval op de hoeken en middens van het vak. Hier draaien ze op
// één plek mee, zodat een deur in een verticale wand op zijn getekende hoeken
// snapt en niet op de lege plek ernaast. Spiegelen doet een template zelf, in
// het ongedraaide vak; dat zit dus al in zijn punten.
//
// Een tweepuntssymbool (stramien) heeft echte eindpunten: die draaien niet.

import { twoPointEndpoints } from '../symbols/two-point.js';

function templateSoort(kind) {
  if (kind === 'midpoint') return 'midpoint';
  if (kind === 'center') return 'center';
  return 'endpoint';
}

// De hoeken, de middens van de randen en het midden van het vak.
function vakPunten(x, y, w, h, { endpoints, midpoints, centers }) {
  if (w === undefined || h === undefined) return [];
  const punten = [];
  if (endpoints) {
    punten.push(
      { x, y, type: 'corner' },
      { x: x + w, y, type: 'corner' },
      { x, y: y + h, type: 'corner' },
      { x: x + w, y: y + h, type: 'corner' },
    );
  }
  if (midpoints) {
    punten.push(
      { x: x + w / 2, y, type: 'midpoint' },
      { x: x + w / 2, y: y + h, type: 'midpoint' },
      { x, y: y + h / 2, type: 'midpoint' },
      { x: x + w, y: y + h / 2, type: 'midpoint' },
    );
  }
  if (centers) punten.push({ x: x + w / 2, y: y + h / 2, type: 'center' });
  return punten;
}

/**
 * Snapkandidaten van een parametrisch symbool.
 * @param {object} ann  de annotatie (x, y, width, height, rotation, params)
 * @param {object|null} tpl  zijn template, of null als die onbekend is
 * @param {{endpoints?: boolean, midpoints?: boolean, centers?: boolean}} soorten
 * @returns {{x: number, y: number, type: string}[]}
 */
export function symboolSnappunten(ann, tpl, { endpoints = false, midpoints = false, centers = false } = {}) {
  if (tpl?.placement === 'two-point') {
    const p = twoPointEndpoints(ann);
    const punten = [];
    if (endpoints) {
      punten.push({ x: p.startX, y: p.startY, type: 'endpoint' }, { x: p.endX, y: p.endY, type: 'endpoint' });
    }
    if (midpoints) punten.push({ x: (p.startX + p.endX) / 2, y: (p.startY + p.endY) / 2, type: 'midpoint' });
    return punten;
  }

  let punten;
  if (tpl && typeof tpl.snapPoints === 'function') {
    const gevraagd = { endpoint: endpoints, midpoint: midpoints, center: centers };
    punten = (tpl.snapPoints(ann.params || {}, {
      x: ann.x, y: ann.y, width: ann.width, height: ann.height,
    }) || [])
      .map((p) => ({ x: p.x, y: p.y, type: templateSoort(p.kind) }))
      .filter((p) => gevraagd[p.type]);
  } else {
    punten = vakPunten(ann.x, ann.y, ann.width, ann.height, { endpoints, midpoints, centers });
  }

  const hoek = (Number(ann.rotation) || 0) * Math.PI / 180;
  if (!hoek) return punten;
  const cos = Math.cos(hoek);
  const sin = Math.sin(hoek);
  const cx = ann.x + ann.width / 2;
  const cy = ann.y + ann.height / 2;
  return punten.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, type: p.type };
  });
}
