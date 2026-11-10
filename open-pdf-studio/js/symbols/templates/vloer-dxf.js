// Parametric floor CROSS-SECTIONS (vloerdoorsneden) — dynamic-block style,
// geometry converted from the local DXF floor library (see
// scripts/dxf-vloeren-convert.mjs → data/vbi-vloeren.js, mm, y-down).
//
// Same contract as the steel profiles: fixed real-world size (maat × schaal,
// no graphic resize handles), scale-region aware via realSizeMm, snappable
// corners/centre. Drawn as LINEWORK (no solid fill) exactly like the source
// sections.
//
// Bij de start staat alleen de index (families, labels, maten) klaar; de
// geometrie (data/vbi-vloeren.js, ~150 KB) is een eigen chunk die laadt bij
// het eerste tekenen van een vloer (#454). Tot dan tekent render() de
// omtrek van de doorsnede en na het laden volgt een hertekening
// (bijVloerGeometrieGeladen). Wie een uitvoer maakt (opslaan, exporteren)
// wacht eerst op laadVloerGeometrie() (registry.laadTemplateDataVoor).

import { VLOER_INDEX } from '../data/vbi-vloeren-index.js';

// familie-id → (variant-id → paths), na het laden.
let _geometrie = null;
let _lading = null;
const _naLaden = new Set();

/** Laadt de vloergeometrie (één keer); de belofte geeft true als hij er is. */
export function laadVloerGeometrie(laad = () => import('../data/vbi-vloeren.js')) {
  if (_geometrie) return Promise.resolve(true);
  if (_lading) return _lading;
  _lading = Promise.resolve()
    .then(laad)
    .then(({ VLOER_FAMILIES }) => {
      _geometrie = new Map(VLOER_FAMILIES.map((f) => [f.id, new Map(f.variants.map((v) => [v.id, v.paths]))]));
      for (const fn of _naLaden) {
        try { fn(); } catch (_) { /* hertekenen is optioneel */ }
      }
      return true;
    }, (fout) => {
      console.warn('[vloeren] geometrie kon niet laden', fout);
      _lading = null;
      return false;
    });
  return _lading;
}

export function vloerGeometrieGeladen() {
  return _geometrie != null;
}

/** Laat `fn` lopen zodra de geometrie geladen is (hertekenen). */
export function bijVloerGeometrieGeladen(fn) {
  if (typeof fn === 'function') _naLaden.add(fn);
  return () => _naLaden.delete(fn);
}

/** Alleen voor tests: terug naar de toestand van vóór het laden. */
export function _vergeetVloerGeometrie() {
  _geometrie = null;
  _lading = null;
}

const _snapPoints = (params, bbox) => {
  const { x, y, width: w, height: h } = bbox;
  return [
    { kind: 'center', x: x + w / 2, y: y + h / 2 },
    { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
    { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
    { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
    { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
  ];
};

function _schaalOf(params) {
  const v = parseFloat(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

// Signed polygon area (shoelace) — used to find the OUTER concrete contour.
function _polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function _vloerTemplate(family) {
  const byId = new Map(family.variants.map(v => [v.id, v]));
  const byLabel = new Map(family.variants.map(v => [v.label, v]));
  const defaultLabel = family.variants[0]?.label;
  const lookup = (maat) => byLabel.get(maat) || byId.get(maat) || byLabel.get(defaultLabel);

  return {
    id: `vloer-${family.id}`,
    name: family.name,
    nameEn: family.name,
    category: 'NL Vloeren',
    defaultSize: { width: 120, height: 30 },
    fixedSize: true,
    params: [
      {
        key: 'maat', label: 'Type', labelEn: 'Type', type: 'enum',
        options: family.variants.map(v => v.label),
        default: defaultLabel,
      },
      { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
      { key: 'toonLabel', label: 'Naam tonen', labelEn: 'Show label', type: 'boolean', default: false },
    ],
    realSizeMm(params) {
      const v = lookup(params?.maat);
      if (!v) return null;
      const f = _schaalOf(params);
      return { width: v.w * f, height: v.h * f };
    },
    snapPoints: _snapPoints,
    laadData: () => laadVloerGeometrie(),
    dataGeladen: vloerGeometrieGeladen,
    render(params, bbox) {
      const v = lookup(params?.maat);
      if (!v) return [];
      const s = Math.min(bbox.width / v.w, bbox.height / v.h);
      const x0 = bbox.x + (bbox.width - v.w * s) / 2;
      const y0 = bbox.y + (bbox.height - v.h * s) / 2;
      const paths = _geometrie?.get(family.id)?.get(v.id);
      if (!paths) {
        // Geometrie nog niet geladen: de omtrek van de doorsnede, tot de
        // hertekening na het laden.
        laadVloerGeometrie();
        const w = v.w * s, h = v.h * s;
        return [{ kind: 'polyline', points: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }], close: true }];
      }
      const toPts = (path) => {
        const pts = [];
        for (let i = 0; i + 1 < path.p.length; i += 2) {
          pts.push({ x: x0 + path.p[i] * s, y: y0 + path.p[i + 1] * s });
        }
        return pts;
      };
      const cmds = [];

      // Concrete = PREFAB convention: solid grey rgb(128,128,128) with the
      // standard diagonal hatch on top (same one as filledArea). Evenodd:
      // channel contours inside the plate cut themselves out. Largest loop
      // first so the hatch generator covers the full plate extent. The
      // walker multiplies by the scale-region factor (filledArea
      // convention); 45 = noticeably denser than the default 100 — beton
      // sections use a fine diagonal hatch.
      const concreteLoops = paths
        .filter(p => p.c && p.m === 'c')
        .map(toPts)
        .map(pts => ({ pts, area: Math.abs(_polyArea(pts)) }))
        .sort((a, b) => b.area - a.area)
        .map(o => o.pts);
      if (concreteLoops.length) {
        cmds.push({
          kind: 'hatch',
          loops: concreteLoops,
          pattern: 'solid',
          color: '#808080',
          scale: 100,
          angle: 0,
        });
        cmds.push({
          kind: 'hatch',
          loops: concreteLoops,
          pattern: 'diagonal-left',
          scale: 180,
          angle: 0,
        });
      }

      // Insulation layers (e.g. under an isolatieplaatvloer): EPS look —
      // EPS background + the same thickness-spanning 60° zigzag as
      // insulation walls.
      for (const path of paths) {
        if (path.c && path.m === 'i') {
          cmds.push({
            kind: 'zigzag',
            loop: toPts(path),
            bg: '#dbdbe3',
            color: '#94949f',
          });
        }
      }

      // All contours as linework (concrete, insulation and the rest).
      for (const path of paths) {
        cmds.push({ kind: 'polyline', points: toPts(path), close: !!path.c });
      }

      if (params?.toonLabel) {
        const size = Math.max(9, Math.min(14, bbox.height * 0.3));
        cmds.push({
          kind: 'text',
          x: bbox.x + bbox.width / 2,
          y: bbox.y - size * 0.8,
          text: `${family.name} ${v.label}`,
          size,
        });
      }
      return cmds;
    },
  };
}

export const vloerTemplates = VLOER_INDEX.map(_vloerTemplate);
