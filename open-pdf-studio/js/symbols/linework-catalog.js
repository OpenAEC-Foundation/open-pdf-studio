// Catalog-driven parametric symbols met VASTE geometrie.
//
// Tegenhanger van steel-catalog.js. Daar wordt de geometrie in code getekend
// uit maten (h/b/tw/tf); hier komt hij als lijnwerk uit de catalogus mee. Dat
// is het verschil tussen een genormeerd profiel en een fabrikantproduct: van
// een schroef of een beugel mag je het lijnwerk niet zelf verzinnen, want dan
// is het niet meer de tekening van de fabrikant.
//
// Gedrag is verder identiek aan de vloerdoorsneden (templates/vloer-dxf.js):
// vaste werkelijke maat via de meetschaal, maat-keuze in het
// eigenschappenpaneel, snappunten op de bbox.
//
// Pure module (geen Solid/Tauri/app-state) zodat hij in node testbaar is:
// zie linework-catalog.test.mjs. De registratie- en persistentielijm zit in
// linework-catalog-store.js.

// Alleen gebruikt als een familie geen eigen preview meelevert.
const FALLBACK_PREVIEW = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="26" width="52" height="12"/><path d="M6 32h52"/></svg>';

export const LINEWORK_TEMPLATE_PREFIX = 'linework-';
export const LINEWORK_FORMAT = 'linework-variants';
const SUPPORTED_VERSIONS = new Set([1]);

export function lineworkTemplateId(collectionId, familyId) {
  return `${LINEWORK_TEMPLATE_PREFIX}${collectionId}-${familyId}`;
}

// --- Parse / valideren ------------------------------------------------------

function _num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

function _variant(v, familyId) {
  const id = v && (v.id || v.label);
  if (!id) throw new Error(`variant zonder id of label in familie '${familyId}'`);
  const w = _num(v.w), h = _num(v.h);
  if (!(w > 0) || !(h > 0)) {
    throw new Error(`variant '${id}' heeft geen bruikbare maat (w/h in mm)`);
  }
  const paths = Array.isArray(v.paths) ? v.paths : [];
  const schoon = [];
  for (const p of paths) {
    const co = Array.isArray(p && p.p) ? p.p.map(_num) : [];
    // Minimaal twee punten, en een even aantal getallen (x,y-paren).
    if (co.length < 4 || co.length % 2 !== 0 || co.some(Number.isNaN)) continue;
    schoon.push({ c: !!p.c, p: co });
  }
  // Bogen blijven bogen: de renderer kent een echt arc-commando, dus er wordt
  // hier NIET gepolygoniseerd. Een benadering zou de fabrikantgeometrie
  // aantasten en is bij het terugmeten niet meer te herstellen.
  const bogen = [];
  for (const a of (Array.isArray(v.arcs) ? v.arcs : [])) {
    const cx = _num(a && a.cx), cy = _num(a && a.cy), r = _num(a && a.r);
    const a0 = _num(a && a.a0), a1 = _num(a && a.a1);
    if (!(r > 0) || [cx, cy, a0, a1].some(Number.isNaN)) continue;
    bogen.push({ cx, cy, r, a0, a1, ccw: !!a.ccw });
  }
  // Stempeling: letters die fysiek op het onderdeel staan (bij HBS PLATE de
  // `H B S P` in de kopcirkel). Die horen bij het product, niet bij het blad,
  // en mogen dus niet wegvallen. Positioneel exact; de glyphvorm hangt af van
  // het lettertype van de kijker.
  const teksten = [];
  for (const t of (Array.isArray(v.texts) ? v.texts : [])) {
    const x = _num(t && t.x), y = _num(t && t.y), s = _num(t && t.s);
    const tekst = t && t.t != null ? String(t.t) : '';
    if (!tekst || [x, y].some(Number.isNaN)) continue;
    teksten.push({ x, y, t: tekst, s: s > 0 ? s : 2, bold: !!t.bold });
  }
  if (!schoon.length && !bogen.length && !teksten.length) {
    throw new Error(`variant '${id}' bevat geen bruikbare geometrie`);
  }
  return { id: String(id), label: String(v.label || id), w, h, paths: schoon, arcs: bogen, texts: teksten };
}

/**
 * Normaliseer een `linework-variants`-catalogus.
 *
 * @returns {object|null} null wanneer dit een ander parametrisch formaat is —
 *   de aanroeper slaat onbekende formaten over. Gooit bij een catalogus die
 *   wél dit formaat claimt maar niet klopt, zodat een fout niet stil
 *   wegvalt in de SVG-fallback.
 */
export function parseLineworkCatalog(raw) {
  if (!raw || typeof raw !== 'object' || raw.format !== LINEWORK_FORMAT) return null;
  if (!SUPPORTED_VERSIONS.has(raw.formatVersion)) {
    throw new Error(`onbekende formatVersion ${raw.formatVersion} voor ${LINEWORK_FORMAT}`);
  }
  if (!Array.isArray(raw.families) || !raw.families.length) {
    throw new Error('catalogus zonder families');
  }
  const families = raw.families.map((f) => {
    if (!f || !f.id) throw new Error('familie zonder id');
    const variants = (Array.isArray(f.variants) ? f.variants : []).map(v => _variant(v, f.id));
    if (!variants.length) throw new Error(`familie '${f.id}' zonder varianten`);
    return {
      id: String(f.id),
      name: f.name || f.id,
      category: f.category || null,
      // Miniatuur voor het palet: de bron-SVG van de standaardmaat. Zonder
      // deze zou elke familie hetzelfde generieke icoon krijgen.
      preview: typeof f.preview === 'string' && f.preview.trim() ? f.preview : null,
      defaultSize: f.defaultSize != null ? String(f.defaultSize) : variants[0].label,
      variants,
    };
  });
  return { format: LINEWORK_FORMAT, formatVersion: raw.formatVersion, units: raw.units || 'mm', label: raw.label || null, families };
}

// --- Template ---------------------------------------------------------------

function _schaalOf(params) {
  const v = parseFloat(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function _snapPoints(_params, bbox) {
  const { x, y, width: w, height: h } = bbox;
  return [
    { kind: 'center', x: x + w / 2, y: y + h / 2 },
    { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
    { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
    { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
    { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
  ];
}

function _naam(n, lang) {
  if (!n) return '';
  if (typeof n === 'string') return n;
  const kort = String(lang || 'en').slice(0, 2).toLowerCase();
  return n[kort] || n.en || Object.values(n)[0] || '';
}

function _template(collectionId, family, categorie, lang) {
  const perLabel = new Map(family.variants.map(v => [v.label, v]));
  const perId = new Map(family.variants.map(v => [v.id, v]));
  const standaard = perLabel.get(family.defaultSize) || perId.get(family.defaultSize) || family.variants[0];
  const kies = (maat) => perLabel.get(maat) || perId.get(maat) || standaard;
  const naam = _naam(family.name, lang);

  return {
    id: lineworkTemplateId(collectionId, family.id),
    name: naam,
    preview: family.preview || null,
    // Alleen een Engelse naam meegeven als die echt afwijkt: het
    // eigenschappenpaneel toont "naam / nameEn" en zou anders de naam
    // dubbel laten zien.
    nameEn: _naam(family.name, 'en') !== naam ? _naam(family.name, 'en') : undefined,
    category: categorie,
    defaultSize: { width: 120, height: 30 },
    // Geen grafische resize-grepen: de maat komt uit de catalogus, net als
    // bij de staalprofielen en de vloerdoorsneden.
    fixedSize: true,
    params: [
      {
        key: 'maat', label: 'Maat', labelEn: 'Size', type: 'enum',
        options: family.variants.map(v => v.label),
        default: standaard.label,
      },
      { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
      { key: 'toonLabel', label: 'Naam tonen', labelEn: 'Show label', type: 'boolean', default: false },
    ],
    realSizeMm(params) {
      const v = kies(params?.maat);
      if (!v) return null;
      const f = _schaalOf(params);
      return { width: v.w * f, height: v.h * f };
    },
    snapPoints: _snapPoints,
    render(params, bbox) {
      const v = kies(params?.maat);
      if (!v || !(bbox.width > 0) || !(bbox.height > 0)) return [];
      // Krapste as bepaalt de schaal; de rest wordt gecentreerd, zodat de
      // verhouding van de fabrikanttekening hoe dan ook blijft staan.
      const s = Math.min(bbox.width / v.w, bbox.height / v.h);
      const x0 = bbox.x + (bbox.width - v.w * s) / 2;
      const y0 = bbox.y + (bbox.height - v.h * s) / 2;
      const cmds = [];
      for (const pad of v.paths) {
        const pts = [];
        for (let i = 0; i + 1 < pad.p.length; i += 2) {
          pts.push({ x: x0 + pad.p[i] * s, y: y0 + pad.p[i + 1] * s });
        }
        cmds.push({ kind: 'polyline', points: pts, close: pad.c });
      }
      // Uniforme schaal zonder rotatie of spiegeling: middelpunt en straal
      // schalen mee, de hoeken blijven ongemoeid.
      for (const b of v.arcs) {
        cmds.push({
          kind: 'arc',
          cx: x0 + b.cx * s,
          cy: y0 + b.cy * s,
          r: b.r * s,
          a0: b.a0,
          a1: b.a1,
          ccw: b.ccw,
        });
      }
      for (const t of v.texts) {
        cmds.push({
          kind: 'text',
          x: x0 + t.x * s,
          y: y0 + t.y * s,
          text: t.t,
          size: t.s * s,
          bold: t.bold,
        });
      }
      if (params?.toonLabel) {
        const size = Math.max(9, Math.min(14, bbox.height * 0.3));
        cmds.push({
          kind: 'text',
          x: bbox.x + bbox.width / 2,
          y: bbox.y - size * 0.8,
          text: `${naam} ${v.label}`.trim(),
          size,
        });
      }
      return cmds;
    },
  };
}

/** Eén template per familie, klaar om te registreren. */
export function lineworkCatalogTemplates(collectionId, catalog, lang) {
  if (!catalog || !Array.isArray(catalog.families)) return [];
  const categorie = _naam(catalog.label, lang) || collectionId;
  return catalog.families.map(f => _template(collectionId, f, f.category || categorie, lang));
}

/** Palette-groep voor een geregistreerde catalogus (parametrische ingangen). */
export function lineworkCatalogToGroup(collectionId, meta, catalog, lang) {
  const templates = lineworkCatalogTemplates(collectionId, catalog, lang);
  return {
    id: `lib-${collectionId}`,
    name: _naam((meta && meta.name) || catalog.label, lang) || collectionId,
    collectionId,
    online: true,
    version: (meta && meta.version) || '1.0.0',
    industry: [].concat((meta && meta.sector) || 'aec'),
    country: [].concat((meta && meta.country) || []),
    symbols: templates.map(t => ({
      id: t.id,
      name: t.name,
      parametricId: t.id,
      svg: t.preview || FALLBACK_PREVIEW,
    })),
  };
}
