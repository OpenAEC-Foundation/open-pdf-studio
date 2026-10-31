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
import { heaTemplate, hebTemplate, ipeTemplate, unpTemplate, kokerTemplate, hoeklijnTemplate } from './templates/staalprofiel.js';
import { vloerTemplates } from './templates/vloer-dxf.js';
import { ifcSpaceTemplate } from './templates/ifc-space.js';
import { ruimteTagTemplate } from './templates/ruimtetag.js';
import { houtBalkTemplate } from './templates/hout-balk.js';
import { paalType1Template, paalType2Template } from './templates/paal-aanzicht.js';
import { boutTemplate } from './templates/bout.js';
import { ankerTemplate } from './templates/ankers.js';
import { wapeningskorfTemplate } from './templates/wapeningskorf.js';
import { wapeningsstaafTemplate, netwapeningTemplate } from './templates/wapening-lijn.js';
import { sonderingTemplate } from './templates/sondering.js';
// Constructieve tekengereedschappen (#312): wapening en staalverbindingen.
import { wapeningsdetailTemplate } from './templates/wapeningsdetail.js';
import { wapeningsnetTemplate } from './templates/wapeningsnet.js';
import { staafPlattegrondTemplate } from './templates/staaf-plattegrond.js';
import { vloerVorstrandTemplate } from './templates/vloer-vorstrand.js';
import { kopplaatTemplate, voetplaatTemplate } from './templates/staalverbindingen.js';
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
import { SANITAIR_TEMPLATES } from './templates/sanitair.js';
import { KEUKEN_TEMPLATES } from './templates/keuken.js';
import { vliesgevelTemplate, kozijnTemplate } from './templates/gevelelement.js';

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
register(hoeklijnTemplate);
for (const t of vloerTemplates) register(t);
register(ifcSpaceTemplate);
register(ruimteTagTemplate);
register(houtBalkTemplate);
register(paalType1Template);
register(paalType2Template);
register(boutTemplate);
register(ankerTemplate);
register(wapeningskorfTemplate);
register(wapeningsstaafTemplate);
register(netwapeningTemplate);
register(wapeningsdetailTemplate);
register(wapeningsnetTemplate);
register(staafPlattegrondTemplate);
register(vloerVorstrandTemplate);
register(kopplaatTemplate);
register(voetplaatTemplate);
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
for (const t of SANITAIR_TEMPLATES) register(t);
for (const t of KEUKEN_TEMPLATES) register(t);
// Gevelelement (#475): vliesgevel en kozijn, één object met twee voorinstellingen.
register(vliesgevelTemplate);
register(kozijnTemplate);

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
    // Een lijst- of objectstandaard (de onderdelen van een aanrecht) als
    // kopie: anders deelt elk geplaatst symbool dezelfde array met het
    // template, en één wijziging zou ze allemaal raken.
    out[p.key] = p.default !== null && typeof p.default === 'object'
      ? JSON.parse(JSON.stringify(p.default))
      : p.default;
  }
  return out;
}

/**
 * Waarde voor een lijst-parameter (type 'list', zoals de onderdelen van een
 * aanrecht). De parameter mag zijn eigen normalisatie meebrengen; zonder die
 * wordt het een kopie van de objecten. Geen array: undefined (de standaard
 * blijft staan).
 */
export function normalizeListParam(def, raw, params = {}) {
  if (!Array.isArray(raw)) return undefined;
  if (def && typeof def.normalize === 'function') return def.normalize(raw, params);
  return raw.map((o) => (o && typeof o === 'object' ? { ...o } : o));
}

/**
 * Alle lijst-parameters van een template genormaliseerd (de rest blijft zoals
 * hij is). Voor de MCP-kant: wat de assistent aanmaakt of bijwerkt, staat er
 * daarna precies zo in als het getekend wordt. Waarden in een oudere
 * schrijfwijze (een kokermaat "Koker 100x100x5") worden eerst bijgewerkt.
 */
export function normalizeParams(template, params = {}) {
  const out = { ...migrateParams(template, params || {}) };
  if (!template || !Array.isArray(template.params)) return out;
  for (const def of template.params) {
    if (def.type !== 'list' || !(def.key in out)) continue;
    const lijst = normalizeListParam(def, out[def.key], out);
    if (lijst !== undefined) out[def.key] = lijst;
    else delete out[def.key];
  }
  return out;
}

/**
 * Parameters uit een ouder bestand naar de huidige waarden van het template
 * (bijvoorbeeld een kokermaat "Koker 100x100x5" → "K100/5"). Een template
 * zonder migrateParams laat ze ongemoeid.
 */
export function migrateParams(template, params) {
  if (!template || typeof template.migrateParams !== 'function' || !params) return params;
  return template.migrateParams(params);
}

/**
 * Extra zoektermen van een parametrisch symbool voor het symbolenpalet: de
 * maten uit de keuzelijst `maat` plus wat het template zelf opgeeft
 * (`zoektermen`, zoals de oude schrijfwijze van een kokermaat).
 */
export function searchTermsFor(templateId) {
  const tpl = getTemplate(templateId);
  if (!tpl) return [];
  const termen = [];
  const maat = (tpl.params || []).find(p => p.key === 'maat');
  for (const o of maat?.options || []) termen.push(typeof o === 'string' ? o : (o?.label || o?.value));
  if (Array.isArray(tpl.zoektermen)) termen.push(...tpl.zoektermen);
  return termen.filter(t => typeof t === 'string' && t);
}

export function listCategories() {
  const cats = new Set();
  for (const t of templates.values()) cats.add(t.category);
  return [...cats];
}
