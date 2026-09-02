// Parametric symbol template registry
// Templates describe parameter schemas and a render() function emitting
// draw commands. The annotation rendering layer (see js/annotations/rendering.js
// case 'parametricSymbol') walks those commands to draw on the canvas.

import { doorTemplate } from './templates/door.js';
import { windowTemplate } from './templates/window.js';
import { stairsTemplate } from './templates/stairs.js';
import { northTemplate } from './templates/north.js';
import { stramienTemplate } from './templates/stramien.js';
import { peilmaatTemplate } from './templates/peilmaat.js';
import { wandarceringTemplate } from './templates/wandarcering.js';
import { wapeningVerdelingTemplate } from './templates/wapening-verdeling.js';
import { beugelTemplate } from './templates/beugel.js';
import { heaTemplate, hebTemplate, ipeTemplate, unpTemplate, kokerTemplate } from './templates/staalprofiel.js';
import { vloerTemplates } from './templates/vloer-dxf.js';
import { ifcSpaceTemplate } from './templates/ifc-space.js';
import { houtBalkTemplate } from './templates/hout-balk.js';
import { paalType1Template, paalType2Template } from './templates/paal-aanzicht.js';
import { boutTemplate } from './templates/bout.js';
import { wapeningskorfTemplate } from './templates/wapeningskorf.js';
import { wapeningsstaafTemplate, netwapeningTemplate } from './templates/wapening-lijn.js';
import { sonderingTemplate } from './templates/sondering.js';
import { paalpuntniveauTemplate } from './templates/paalpuntniveau.js';
import { overspanningspijlVloerTemplate } from './templates/overspanningspijl-vloer.js';
import { stenenrijTemplate } from './templates/stenenrij.js';
import {
  opleggingTemplate, puntlastTemplate, qlastTemplate,
  beddingsverenTemplate, windverbandTemplate, scharnierVerbindingTemplate,
} from './templates/constructie-symbolen.js';
import {
  bouwkraanTemplate, draaicirkelTemplate, parkeervakTemplate, bouwkeetTemplate,
} from './templates/bouwplaats-symbolen.js';

const templates = new Map();

function register(t) {
  templates.set(t.id, t);
}

register(doorTemplate);
register(windowTemplate);
register(stairsTemplate);
register(northTemplate);
register(stramienTemplate);
register(peilmaatTemplate);
register(wandarceringTemplate);
register(wapeningVerdelingTemplate);
register(beugelTemplate);
register(heaTemplate);
register(hebTemplate);
register(ipeTemplate);
register(unpTemplate);
register(kokerTemplate);
for (const t of vloerTemplates) register(t);
register(ifcSpaceTemplate);
register(houtBalkTemplate);
register(paalType1Template);
register(paalType2Template);
register(boutTemplate);
register(wapeningskorfTemplate);
register(wapeningsstaafTemplate);
register(netwapeningTemplate);
register(sonderingTemplate);
register(paalpuntniveauTemplate);
register(overspanningspijlVloerTemplate);
register(stenenrijTemplate);
register(opleggingTemplate);
register(puntlastTemplate);
register(qlastTemplate);
register(beddingsverenTemplate);
register(windverbandTemplate);
register(scharnierVerbindingTemplate);
register(bouwkraanTemplate);
register(draaicirkelTemplate);
register(parkeervakTemplate);
register(bouwkeetTemplate);

// Runtime registration for catalog-driven templates (downloaded steel
// catalogs from the online symbol library — see symbols/steel-catalog-store.js).
// Same registry, so getTemplate/listTemplates/the picker/properties panel
// work identically for built-in and downloaded templates.
export function registerTemplate(t) {
  if (t && t.id) register(t);
}

export function unregisterTemplate(id) {
  templates.delete(id);
}

export function getTemplate(id) {
  return templates.get(id) || null;
}

export function listTemplates(category) {
  const all = [...templates.values()];
  if (!category) return all;
  return all.filter(t => t.category === category);
}

export function defaultParams(template) {
  if (!template || !Array.isArray(template.params)) return {};
  const out = {};
  for (const p of template.params) {
    out[p.key] = p.default;
  }
  return out;
}

export function listCategories() {
  const cats = new Set();
  for (const t of templates.values()) cats.add(t.category);
  return [...cats];
}
