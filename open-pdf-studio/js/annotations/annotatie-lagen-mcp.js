// De MCP-opdrachten voor annotatielagen (#468), zonder app-state: de regels
// voor app_list_layers, app_create_layer en app_set_layer, en voor het
// laag-argument van app_create_annotation, app_update_annotation en
// app_list_annotations. mcp-bridge.js haalt het document op, roept deze
// functies aan en doet daarna het hertekenen en bijwerken van het paneel.
//
// Een laag wordt genoemd op id of op naam (hoofdletters tellen niet); de
// standaardlaag ook op haar id 'default' en op haar weergavenaam. De
// foutteksten zijn Engels: ze gaan naar de assistent.

import {
  DEFAULT_LAYER_ID, layerRows, layerOf, resolveLayer, addLayer, renameLayer,
  updateLayer, setCurrentLayer,
} from './annotatie-lagen.js';

const HEX = /^#[0-9a-f]{6}$/i;
const SCHAKELAARS = ['visible', 'printable', 'locked'];

function fout(error) {
  return { ok: false, error };
}

// Een wijziging die niet in het document terug te lezen is, is mislukt: nooit
// ok:true zonder de laag zoals die in het document staat (#468).
const NIET_BEWAARD = 'the layer change was not stored in the document';

/** Samenvatting van alle lagen, in de volgorde van het paneel. */
export function lagenOverzicht(doc, defaultName) {
  return layerRows(doc, defaultName).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    visible: r.visible,
    printable: r.printable,
    locked: r.locked,
    count: r.count,
    current: r.current,
    default: r.isDefault,
  }));
}

function onbekend(doc, ref, defaultName) {
  const namen = layerRows(doc, defaultName).map((r) => r.name).join(', ');
  return fout(`unknown layer: ${ref} (layers: ${namen})`);
}

/**
 * Het laag-argument van een annotatie-opdracht: id of naam van een bestaande
 * laag. Weggelaten = niet gegeven (id undefined).
 */
export function laagArgument(doc, waarde, defaultName) {
  if (waarde === undefined || waarde === null) return { ok: true, id: undefined };
  if (typeof waarde !== 'string' || !waarde.trim()) return fout('layer must be a string: the id or name of a layer');
  const laag = resolveLayer(doc, waarde, { defaultName });
  if (!laag) return onbekend(doc, waarde, defaultName);
  return { ok: true, id: laag.id };
}

function controleer(args, toegestaan) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  for (const sleutel of Object.keys(args)) {
    if (!toegestaan.includes(sleutel)) return `unknown argument: ${sleutel}`;
  }
  for (const sleutel of SCHAKELAARS) {
    if (args[sleutel] !== undefined && typeof args[sleutel] !== 'boolean') return `${sleutel} must be a boolean`;
  }
  if (args.current !== undefined && typeof args.current !== 'boolean') return 'current must be a boolean';
  if (args.color !== undefined && args.color !== null && !(typeof args.color === 'string' && HEX.test(args.color))) {
    return 'color must be a hex colour like #ff0000, or null';
  }
  if (args.name !== undefined && typeof args.name !== 'string') return 'name must be a string';
  return null;
}

function samenvatting(doc, id, defaultName) {
  return lagenOverzicht(doc, defaultName).find((l) => l.id === id);
}

/** app_create_layer */
export function maakLaag(doc, args, defaultName) {
  if (!doc) return fout('no active document');
  const probleem = controleer(args, ['name', 'color', 'visible', 'printable', 'locked', 'current']);
  if (probleem) return fout(probleem);
  if (typeof args.name !== 'string' || !args.name.trim()) return fout('missing name');
  if (defaultName && args.name.trim().toLowerCase() === defaultName.toLowerCase()) {
    return fout(`a layer named ${args.name.trim()} already exists`);
  }
  const r = addLayer(doc, {
    name: args.name,
    color: args.color ?? null,
    visible: args.visible,
    printable: args.printable,
    locked: args.locked,
  });
  if (!r.ok) {
    if (r.error === 'name-taken') return fout(`a layer named ${args.name.trim()} already exists`);
    return fout(r.error === 'not-stored' ? NIET_BEWAARD : r.error);
  }
  if (args.current === true && !setCurrentLayer(doc, r.layer.id).ok) return fout(NIET_BEWAARD);
  const layer = samenvatting(doc, r.layer.id, defaultName);
  return layer ? { ok: true, layer } : fout(NIET_BEWAARD);
}

/** app_set_layer */
export function zetLaag(doc, args, defaultName) {
  if (!doc) return fout('no active document');
  const probleem = controleer(args, ['layer', 'name', 'color', 'visible', 'printable', 'locked', 'current']);
  if (probleem) return fout(probleem);
  if (typeof args.layer !== 'string' || !args.layer.trim()) return fout('missing layer: the id or name of a layer');
  const laag = resolveLayer(doc, args.layer, { defaultName });
  if (!laag) return onbekend(doc, args.layer, defaultName);
  if (args.current === false) return fout('current can only be set to true: make another layer current instead');
  const changed = [];
  if (args.name !== undefined) {
    if (laag.id === DEFAULT_LAYER_ID) return fout('the default layer cannot be renamed');
    const r = renameLayer(doc, laag.id, args.name);
    if (!r.ok) {
      if (r.error === 'name-taken') return fout(`a layer named ${args.name.trim()} already exists`);
      return fout(r.error === 'not-stored' ? NIET_BEWAARD : 'name must not be empty');
    }
    changed.push('name');
  }
  const patch = {};
  for (const sleutel of [...SCHAKELAARS, 'color']) {
    if (args[sleutel] !== undefined) {
      patch[sleutel] = args[sleutel];
      changed.push(sleutel);
    }
  }
  if (Object.keys(patch).length && !updateLayer(doc, laag.id, patch).ok) return fout(NIET_BEWAARD);
  if (args.current === true) {
    if (!setCurrentLayer(doc, laag.id).ok) return fout(NIET_BEWAARD);
    changed.push('current');
  }
  if (changed.length === 0) return fout('nothing to change: pass visible, printable, locked, color, name or current');
  const layer = samenvatting(doc, laag.id, defaultName);
  return layer ? { ok: true, layer, changed } : fout(NIET_BEWAARD);
}

/** De laagnaam voor de lijst van annotaties; niets voor de standaardlaag. */
export function annotatieLaagNaam(doc, ann, defaultName) {
  const laag = layerOf(doc, ann);
  if (!laag || laag.id === DEFAULT_LAYER_ID) return undefined;
  return laag.name || defaultName;
}

/** Annotaties van één laag (app_list_annotations met `layer`). */
export function filterOpLaag(doc, anns, waarde, defaultName) {
  const r = laagArgument(doc, waarde, defaultName);
  if (!r.ok) return r;
  if (r.id === undefined) return { ok: true, annotations: anns };
  return { ok: true, annotations: anns.filter((a) => layerOf(doc, a).id === r.id) };
}
