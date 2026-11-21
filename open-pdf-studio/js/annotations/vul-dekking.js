// Aparte dekking voor lijn en vulling van gesloten vormen (#685).
//
// Een rechthoek, ellips, veelhoek of wolk kan een volledig dekkende rand met
// een doorschijnende vulling hebben (of andersom). Het model:
//   - `opacity`      de dekking van de lijn (PDF /CA), zoals altijd;
//   - `fillOpacity`  de dekking van vulling en arcering (PDF /ca). Zonder
//                    eigen waarde volgt de vulling `opacity`: een ouder
//                    bestand met één dekking ziet er precies zo uit als
//                    voorheen.
//
// Pure module: geen app-imports, zodat paneel, lint, tekenen, saver en tests
// dezelfde regels delen.

/** Soorten met een eigen dekking voor vulling en arcering. */
export const VORMEN_MET_VULDEKKING = new Set(['box', 'circle', 'polygon', 'cloud']);

/** Heeft deze soort aparte dekkingen voor lijn en vulling? */
export function heeftVulDekking(type) {
  return VORMEN_MET_VULDEKKING.has(type);
}

function alfa(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
}

/** De dekking van de lijn (0..1). */
export function lijnDekking(ann) {
  return alfa(ann?.opacity) ?? 1;
}

/**
 * De dekking van de vulling (0..1): de eigen waarde, anders die van de lijn.
 */
export function vulDekking(ann) {
  return alfa(ann?.fillOpacity) ?? lijnDekking(ann);
}

/**
 * De eigen vul-dekking van een vorm als die afwijkt van de lijn, anders null.
 * Alleen dan hoeven tekenen en opslaan iets extra's te doen.
 */
export function eigenVulDekking(ann) {
  if (!ann || !heeftVulDekking(ann.type)) return null;
  const vul = alfa(ann.fillOpacity);
  if (vul === null) return null;
  return vul === lijnDekking(ann) ? null : vul;
}

/**
 * De eigen vul-dekking uit de stijlvoorkeuren van een gereedschap
 * (`<voorvoegsel>FillOpacity`, in procenten), als veld voor een nieuwe
 * annotatie; zonder voorkeur niets, dan volgt de vulling de dekking.
 * `factor` schaalt mee zoals de dekking (de ellips tekent op de helft).
 */
export function vulDekkingUitVoorkeur(prefs, voorvoegsel, factor = 1) {
  const pct = prefs?.[`${voorvoegsel}FillOpacity`];
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return {};
  return { fillOpacity: Math.max(0, Math.min(100, pct)) / 100 * factor };
}

/**
 * Zet de dekking van de lijn. Heeft de vorm nog geen eigen vul-dekking, dan
 * houdt de vulling de dekking die ze nu heeft: met twee aparte velden mag een
 * wijziging van de lijn de vulling niet meenemen.
 */
export function zetLijnDekking(ann, waarde) {
  if (!ann) return;
  if (heeftVulDekking(ann.type) && alfa(ann.fillOpacity) === null) {
    ann.fillOpacity = lijnDekking(ann);
  }
  ann.opacity = waarde;
}

/** PDF bewaart RGB en dekking apart; bestaande stijlen bevatten beide in de CSS-kleur. */
export function normaliseerVulkleur(ann) {
  const kleur = ann.fillColor;
  if (typeof kleur !== 'string') return ann;
  const hex = /^#([a-f\d]{6})([a-f\d]{2})$/i.exec(kleur);
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d*\.?\d+)\s*\)$/i.exec(kleur);
  if (!hex && !rgba) return ann;
  const rgb = hex ? hex[1] : rgba.slice(1, 4).map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('');
  const alpha = hex ? parseInt(hex[2], 16) / 255 : Math.min(1, Number(rgba[4]));
  return { ...ann, fillColor: '#' + rgb, fillOpacity: vulDekking(ann) * alpha };
}
