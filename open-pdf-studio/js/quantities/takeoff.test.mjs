// Verificatie voor: IFC-categorie-mapping + LENGTE-kolom voor lijnen/pijlen.
import { ifcCategoryForSymbol, ifcCategoryForParametric } from '../solid/data/ifcCategoryMap.js';
import { fieldByKey, fieldsForCategories } from './categories.js';
import { buildSchedule } from './engine.js';

let ok = true;
function check(cond, msg) { if (!cond) { ok = false; console.error('FAIL:', msg); } else { console.log('ok  :', msg); } }
function eq(a, b, msg) { check(a === b, `${msg} (verwacht ${b}, kreeg ${a})`); }

// --- A. IFC-categorie-mapping ---
eq(ifcCategoryForSymbol({ id: 'elektra-stopcontact', name: 'Stopcontact' }), 'IfcOutlet', 'stopcontact → IfcOutlet');
eq(ifcCategoryForSymbol({ id: 'elektra-enkelpolige-schakelaar', name: 'Enkelpolige schakelaar' }), 'IfcSwitchingDevice', 'schakelaar → IfcSwitchingDevice');
eq(ifcCategoryForSymbol({ id: 'elektra-verlichtingstoestel', name: 'Verlichtingstoestel' }), 'IfcLightFixture', 'verlichting → IfcLightFixture');
eq(ifcCategoryForSymbol({ id: 'elektra-data-2-voudig', name: 'Data 2-voudig' }), 'IfcCommunicationsAppliance', 'data → IfcCommunicationsAppliance');
eq(ifcCategoryForSymbol({ id: 'elektra-meterkast', name: 'Meterkast' }), 'IfcElectricDistributionBoard', 'meterkast → IfcElectricDistributionBoard');
eq(ifcCategoryForSymbol({ id: 'elektra-bewegingsdetector', name: 'Bewegingsdetector' }), 'IfcSensor', 'bewegingsdetector → IfcSensor');
eq(ifcCategoryForSymbol({ id: 'elektra-aansluitpunt-rm', name: 'Rookmelder (RM)' }), 'IfcSensor', 'rookmelder → IfcSensor');
eq(ifcCategoryForSymbol({ id: 'elektra-schel', name: 'Schel' }), 'IfcAlarm', 'schel → IfcAlarm');
eq(ifcCategoryForSymbol({ id: 'elektra-aansluitpunt-bel', name: 'Deurbel (BEL)' }), 'IfcAlarm', 'bel → IfcAlarm');
// NEN 1414 op prefix + trefwoord
eq(ifcCategoryForSymbol({ id: 'nen1414-Tb4.021', name: 'Sprinklerinstallatie' }), 'IfcFireSuppressionTerminal', 'sprinkler → IfcFireSuppressionTerminal');
eq(ifcCategoryForSymbol({ id: 'nen1414-Td01', name: 'Enkele deur' }), 'IfcDoor', 'nen deur → IfcDoor');
eq(ifcCategoryForSymbol({ id: 'nen1414-Tn01', name: 'Noodverlichting armatuur' }), 'IfcLightFixture', 'noodverlichting → IfcLightFixture');
// Sinds de expliciete NEN-mapping (nenIfcMap.js) is de brandmeldcentrale een
// paneel/regelaar in plaats van een signaalgever.
eq(ifcCategoryForSymbol({ id: 'nen1414-Tb01', name: 'Brandmeldcentrale (BMC)' }), 'IfcController', 'BMC → IfcController');
// Wand + parametrisch
eq(ifcCategoryForSymbol({ id: 'wand', name: 'Wand (IfcWall)', wall: { pattern: 'x' } }), 'IfcWall', 'wand → IfcWall');
eq(ifcCategoryForSymbol({ id: 'param-staal-hea', name: 'HEA', parametricId: 'staal-hea' }), 'IfcMember', 'HEA → IfcMember');
eq(ifcCategoryForSymbol({ id: 'ifc-space', name: 'Ruimte (IfcSpace)', parametricId: 'ifc-space' }), 'IfcSpace', 'ruimte → IfcSpace');
eq(ifcCategoryForParametric('vloer-kanaalplaatvloer'), 'IfcSlab', 'kanaalplaat → IfcSlab');
eq(ifcCategoryForParametric('bout'), 'IfcMechanicalFastener', 'bout → IfcMechanicalFastener');
eq(ifcCategoryForParametric('paal-aanzicht-type-1'), 'IfcPile', 'paal → IfcPile');
// Onbekend → default
eq(ifcCategoryForSymbol({ id: 'onbekend-xyz', name: 'Iets vaags' }), 'IfcBuildingElementProxy', 'onbekend → proxy default');

// --- B. ifcCategory is een selecteerbaar veld in alle categorieën ---
check(!!fieldByKey(['line-based'], 'ifcCategory'), 'ifcCategory veld beschikbaar (line-based)');
check(!!fieldByKey(['symbol'], 'ifcCategory'), 'ifcCategory veld beschikbaar (symbol)');
// Zonder geïnjecteerde vertaal-resolver valt het label terug op de Engelse basistekst.
check(fieldsForCategories(['symbol']).find(f => f.key === 'ifcCategory').label === 'IFC category', 'ifcCategory label = IFC category');

// --- C. LENGTE voor line/arrow uit coördinaten + schaal ---
// Lijn (0,0)→(300,400) = 500 px. Bij 100 px/m → 5.0 m.
const lineEls = [
  { type: 'line', page: 1, startX: 0, startY: 0, endX: 300, endY: 400, __pxPerUnit: 100 },
  { type: 'arrow', page: 1, startX: 0, startY: 0, endX: 100, endY: 0, __pxPerUnit: 100 }, // 100px → 1.0 m
];
const lenField = fieldByKey(['line-based'], 'length');
eq(lenField.get(lineEls[0]), 5, 'line 500px @100ppu → 5 m');
eq(lenField.get(lineEls[1]), 1, 'arrow 100px @100ppu → 1 m');

// Polyline via points-array: (0,0)-(0,300)-(400,300) = 300+400 = 700px @100 → 7 m
const poly = { type: 'polyline', page: 1, points: [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }], __pxPerUnit: 100 };
eq(lenField.get(poly), 7, 'polyline 700px @100ppu → 7 m');

// Meet-annotatie behoudt eigen measureValue (geen dubbeltelling van geometrie)
const md = { type: 'measureDistance', page: 1, measureValue: 12.5, startX: 0, startY: 0, endX: 9999, endY: 0 };
eq(lenField.get(md), 12.5, 'measureDistance gebruikt measureValue');

// Zonder schaal (px==unit, ppu=1): lengte == pixels
eq(lenField.get({ type: 'line', startX: 0, startY: 0, endX: 3, endY: 4 }), 5, 'geen schaal → pixels (3-4-5)');

// End-to-end via engine: som van lijn-lengtes in een groep
const res = buildSchedule(lineEls, {
  categories: ['line-based'], fields: ['type', 'length'],
  sort: [{ field: 'category', dir: 'asc', group: true }],
});
eq(res.groups[0].subtotals.length, 6, 'subtotaal lengte 5+1 = 6 m via engine');

console.log(ok ? '\nOK — alle takeoff-checks geslaagd' : '\nGEFAALD');
process.exit(ok ? 0 : 1);
