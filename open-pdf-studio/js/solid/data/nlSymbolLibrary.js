// NL drafting category for the tool palette — PARAMETRIC components.
// Unlike the stamp categories (static SVG), these entries reference a
// parametric template id (symbols/registry.js). Clicking one activates the
// parametricSymbol tool so the placed annotation stays editable (number,
// value, orientation, …) via the properties panel.

// Elektra-legendasymbolen (NLRS) — statische SVG-stempels, gegenereerd uit de
// lokale elektra-renvooi-DXF (zie scripts/dxf-elektra-convert.mjs).
import { ELEKTRA_SYMBOLS } from './elektraSymbols.js';

const stramienPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><circle cx="32" cy="12" r="9"/><text x="32" y="16" font-size="11" font-weight="bold" text-anchor="middle" fill="#000" stroke="none">1</text><line x1="32" y1="21" x2="32" y2="30"/><line x1="32" y1="34" x2="32" y2="36"/><line x1="32" y1="40" x2="32" y2="49"/><line x1="32" y1="53" x2="32" y2="55"/><line x1="32" y1="59" x2="32" y2="62"/></svg>`;

const peilmaatPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><text x="32" y="22" font-size="12" text-anchor="middle" fill="#000" stroke="none">P = 0</text><line x1="6" y1="30" x2="58" y2="30"/><polyline points="24,30 32,46 40,30" /></svg>`;

const wandarceringPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><line x1="4" y1="24" x2="60" y2="24"/><line x1="4" y1="40" x2="60" y2="40"/><line x1="8" y1="40" x2="17" y2="24"/><line x1="18" y1="40" x2="27" y2="24"/><line x1="28" y1="40" x2="37" y2="24"/><line x1="38" y1="40" x2="47" y2="24"/><line x1="48" y1="40" x2="57" y2="24"/></svg>`;

const wapeningVerdelingPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><line x1="6" y1="18" x2="44" y2="18"/><line x1="16" y1="18" x2="10" y2="40"/><line x1="27" y1="18" x2="21" y2="40"/><line x1="38" y1="18" x2="32" y2="40"/><circle cx="10" cy="42" r="2.6" fill="#000"/><circle cx="21" cy="42" r="2.6" fill="#000"/><circle cx="32" cy="42" r="2.6" fill="#000"/><text x="52" y="22" font-size="11" text-anchor="middle" fill="#000" stroke="none">3Ø12</text></svg>`;

const beugelPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="8" width="32" height="44"/><line x1="20" y1="12" x2="34" y2="12"/><line x1="34" y1="12" x2="34" y2="26"/><text x="51" y="36" font-size="9" text-anchor="middle" fill="#000" stroke="none">Ø8-250</text></svg>`;

// NL Constructie — steel cross-section previews: SOLID black (zoals de
// echte doorsneden renderen), realistischer dan kale contouren.
const heaPreview = `<svg viewBox="0 0 64 64"><path d="M12 10 H52 V18 H37 V46 H52 V54 H12 V46 H27 V18 H12 Z" fill="#1a1a1a" stroke="#000" stroke-width="1"/></svg>`;
const hebPreview = `<svg viewBox="0 0 64 64"><path d="M12 8 H52 V19 H38 V45 H52 V56 H12 V45 H26 V19 H12 Z" fill="#1a1a1a" stroke="#000" stroke-width="1"/></svg>`;
const ipePreview = `<svg viewBox="0 0 64 64"><path d="M20 8 H44 V14 H34.5 V50 H44 V56 H20 V50 H29.5 V14 H20 Z" fill="#1a1a1a" stroke="#000" stroke-width="1"/></svg>`;
const kokerPreview = `<svg viewBox="0 0 64 64"><path d="M14 14 h36 v36 h-36 Z M21 21 h22 v22 h-22 Z" fill="#1a1a1a" fill-rule="evenodd" stroke="#000" stroke-width="1"/></svg>`;
const unpPreview = `<svg viewBox="0 0 64 64"><path d="M22 10 H46 V17 H29 V47 H46 V54 H22 Z" fill="#1a1a1a" stroke="#000" stroke-width="1"/></svg>`;

// NL Vloeren — realistische doorsnede-previews: grijs beton + diagonale
// arcering, witte kanalen, EPS-laag waar van toepassing.
const kanaalplaatPreview = `<svg viewBox="0 0 64 64"><defs><pattern id="kpDiag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#8a8a8a"/><line x1="0" y1="0" x2="0" y2="6" stroke="#3c3c3c" stroke-width="1"/></pattern></defs><rect x="3" y="20" width="58" height="24" fill="url(#kpDiag)" stroke="#000" stroke-width="1.5"/><ellipse cx="13" cy="32" rx="6" ry="7.5" fill="#fff" stroke="#000" stroke-width="1"/><ellipse cx="32" cy="32" rx="6" ry="7.5" fill="#fff" stroke="#000" stroke-width="1"/><ellipse cx="51" cy="32" rx="6" ry="7.5" fill="#fff" stroke="#000" stroke-width="1"/></svg>`;
const isolatieplaatPreview = `<svg viewBox="0 0 64 64"><defs><pattern id="ipDiag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#8a8a8a"/><line x1="0" y1="0" x2="0" y2="6" stroke="#3c3c3c" stroke-width="1"/></pattern></defs><rect x="3" y="14" width="58" height="16" fill="url(#ipDiag)" stroke="#000" stroke-width="1.5"/><rect x="3" y="30" width="58" height="18" fill="#dbdbe3" stroke="#000" stroke-width="1.5"/><polyline points="3,46 10,32 17,46 24,32 31,46 38,32 45,46 52,32 59,46" fill="none" stroke="#94949f" stroke-width="1"/></svg>`;
const psIsolatiePreview = `<svg viewBox="0 0 64 64"><defs><pattern id="psDiag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#8a8a8a"/><line x1="0" y1="0" x2="0" y2="6" stroke="#3c3c3c" stroke-width="1"/></pattern></defs><path d="M3 22 H61 V42 H47 V32 H17 V42 H3 Z" fill="#dbdbe3" stroke="#000" stroke-width="1.5"/><rect x="3" y="14" width="58" height="10" fill="url(#psDiag)" stroke="#000" stroke-width="1.5"/></svg>`;

// NL Wanden — realistische wand-preview: baksteenrood met zwarte lijnparen
// (de echte metselwerk-arcering in het klein).
const wandMetselwerkPreview = `<svg viewBox="0 0 64 64"><rect x="4" y="22" width="56" height="20" fill="#CD7C61" stroke="#000" stroke-width="1.5"/><g stroke="#000" stroke-width="1"><line x1="12" y1="42" x2="32" y2="22"/><line x1="16" y1="42" x2="36" y2="22"/><line x1="34" y1="42" x2="54" y2="22"/><line x1="38" y1="42" x2="58" y2="22"/></g></svg>`;
const wandIsolatiePreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="24" width="52" height="16"/><path d="M8 32 q4 -7 8 0 q4 7 8 0 q4 -7 8 0 q4 7 8 0 q4 -7 8 0 q4 7 8 0" stroke-width="1.4"/></svg>`;
const wandKzsPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="24" width="52" height="16"/><line x1="12" y1="24" x2="8" y2="40" stroke-width="1.2"/><line x1="20" y1="24" x2="16" y2="40" stroke-width="1.2"/><line x1="28" y1="24" x2="24" y2="40" stroke-width="1.2"/><line x1="36" y1="24" x2="32" y2="40" stroke-width="1.2"/><line x1="44" y1="24" x2="40" y2="40" stroke-width="1.2"/><line x1="52" y1="24" x2="48" y2="40" stroke-width="1.2"/></svg>`;
const wandBetonPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="24" width="52" height="16"/><line x1="16" y1="24" x2="8" y2="40" stroke-width="1.2"/><line x1="30" y1="24" x2="22" y2="40" stroke-width="1.2"/><line x1="44" y1="24" x2="36" y2="40" stroke-width="1.2"/><circle cx="22" cy="30" r="1.2" fill="#000"/><circle cx="36" cy="35" r="1.2" fill="#000"/><circle cx="48" cy="29" r="1.2" fill="#000"/></svg>`;

const ifcSpacePreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="8" y="12" width="48" height="40" stroke-dasharray="5 3"/><text x="32" y="36" font-size="10" text-anchor="middle" fill="#000" stroke="none">Ruimte</text></svg>`;
// Maskeer (wipeout): wit afdekvlak over een "tekening" (grijze lijntjes
// eronder maken zichtbaar dat het vlak afdekt), streep-punt-rand.
const maskeerPreview = `<svg viewBox="0 0 64 64"><g stroke="#9a9a9a" stroke-width="1.4"><line x1="4" y1="12" x2="60" y2="12"/><line x1="4" y1="20" x2="60" y2="20"/><line x1="4" y1="28" x2="60" y2="28"/><line x1="4" y1="36" x2="60" y2="36"/><line x1="4" y1="44" x2="60" y2="44"/><line x1="4" y1="52" x2="60" y2="52"/></g><rect x="14" y="18" width="36" height="28" fill="#fff"/><line x1="14" y1="18" x2="14" y2="46" stroke="#555" stroke-width="1.6" stroke-dasharray="7 3 2 3"/></svg>`;
const houtBalkPreview = `<svg viewBox="0 0 64 64"><rect x="12" y="10" width="40" height="44" fill="#ead9b0" stroke="#000" stroke-width="2"/><line x1="14" y1="26" x2="28" y2="12" stroke="#b8a37a" stroke-width="1"/><line x1="14" y1="44" x2="46" y2="12" stroke="#b8a37a" stroke-width="1"/><line x1="22" y1="52" x2="50" y2="24" stroke="#b8a37a" stroke-width="1"/><text x="32" y="36" font-size="9" text-anchor="middle" fill="#000">45x70</text></svg>`;
// Stavenreeks: aanhaallijn met uitloop, drie steile poten naar gevulde punten
// (de staven) en het wapeningsteken — de vorm zoals het gereedschap tekent.
const stavenreeksPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><line x1="8" y1="20" x2="56" y2="20"/><line x1="10" y1="20" x2="4" y2="40"/><line x1="26" y1="20" x2="20" y2="40"/><line x1="42" y1="20" x2="36" y2="40"/><circle cx="4" cy="41" r="3.2" fill="#000" stroke="none"/><circle cx="20" cy="41" r="3.2" fill="#000" stroke="none"/><circle cx="36" cy="41" r="3.2" fill="#000" stroke="none"/><g stroke-width="1.6"><circle cx="48" cy="50" r="5"/><line x1="43" y1="60" x2="55" y2="39"/><line x1="49" y1="45" x2="57" y2="45"/><line x1="51" y1="41" x2="59" y2="41"/></g></svg>`;
// Paal-aanzicht: schacht met gestreepte kop boven maaiveld en gebogen punt
// met half-gevulde lens — het klassieke heipaal-symbool in het klein.
const paalPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><line x1="24" y1="10" x2="24" y2="4" stroke-dasharray="3 2"/><line x1="24" y1="4" x2="40" y2="4" stroke-dasharray="3 2"/><line x1="40" y1="4" x2="40" y2="10" stroke-dasharray="3 2"/><line x1="24" y1="10" x2="24" y2="50"/><line x1="40" y1="10" x2="40" y2="50"/><path d="M24 50 Q28 56 32 50"/><path d="M32 50 Q36 56 40 50 Q36 44 32 50 Z" fill="#000"/></svg>`;
// Bout: zeskantkop + ring + schacht met schroefdraad-streepjes.
const boutPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.6"><rect x="4" y="24" width="8" height="16"/><line x1="4" y1="29" x2="12" y2="29"/><line x1="4" y1="35" x2="12" y2="35"/><line x1="12" y1="20" x2="12" y2="44"/><line x1="15" y1="20" x2="15" y2="44"/><line x1="12" y1="20" x2="15" y2="20"/><line x1="12" y1="44" x2="15" y2="44"/><line x1="15" y1="27" x2="58" y2="27"/><line x1="15" y1="37" x2="58" y2="37"/><line x1="15" y1="30" x2="60" y2="30" stroke-dasharray="4 3"/><line x1="15" y1="34" x2="60" y2="34" stroke-dasharray="4 3"/><line x1="58" y1="27" x2="60" y2="30"/><line x1="58" y1="37" x2="60" y2="34"/></svg>`;
// Wapeningskorf: betonomtrek met beugel (dubbele lijn + haak rechtsboven),
// gevulde staafpunten boven/onder/zij en een label met het wapeningsteken —
// de doorsnede zoals het sjabloon hem tekent.
const wapeningskorfPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="4" y="10" width="34" height="44"/><rect x="8" y="14" width="26" height="36" stroke-width="1.4"/><rect x="10" y="16" width="22" height="32" stroke-width="1.4"/><line x1="32" y1="16" x2="27" y2="21" stroke-width="1.4"/><line x1="34" y1="14" x2="29" y2="19" stroke-width="1.4"/><g fill="#000" stroke="none"><circle cx="13" cy="19" r="2.4"/><circle cx="21" cy="19" r="2.4"/><circle cx="29" cy="19" r="2.4"/><circle cx="13" cy="45" r="2.6"/><circle cx="21" cy="45" r="2.6"/><circle cx="29" cy="45" r="2.6"/><circle cx="13" cy="32" r="2"/><circle cx="29" cy="32" r="2"/></g><line x1="29" y1="19" x2="44" y2="10" stroke-width="1.2"/><line x1="29" y1="45" x2="44" y2="52" stroke-width="1.2"/><g stroke-width="1.2"><circle cx="52" cy="12" r="2.6"/><line x1="50" y1="17" x2="55" y2="6"/><line x1="52" y1="9" x2="56" y2="9"/><line x1="53.5" y1="7" x2="57.5" y2="7"/></g><text x="45" y="15" font-size="9" fill="#000" stroke="none">3</text><text x="56" y="15" font-size="9" fill="#000" stroke="none">12</text></svg>`;

const wapeningsstaafPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.7"><text x="32" y="23" font-size="10" text-anchor="middle" fill="#000" stroke="none">3 Ø8, lg=1600</text><line x1="4" y1="38" x2="60" y2="38"/><path d="M14 38 19 31 24 38Z" fill="#000"/></svg>`;
const netwapeningPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.7"><text x="32" y="23" font-size="9" text-anchor="middle" fill="#000" stroke="none">Ø8-150, lg=1600</text><line x1="4" y1="38" x2="60" y2="38"/><path d="M14 38 19 31 24 38Z" fill="#000"/></svg>`;
const sonderingPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.7"><path d="M12 24 H36 L24 53 Z" fill="#000"/><line x1="8" y1="53" x2="40" y2="53"/><text x="47" y="25" font-size="19" font-weight="bold" text-anchor="middle" fill="#000" stroke="none">1</text></svg>`;
const paalpuntniveauPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.5"><rect x="3" y="18" width="58" height="28"/><text x="32" y="35" font-size="7" font-weight="bold" text-anchor="middle" fill="#000" stroke="none">PUNTNIVEAU: 14.0 m+</text></svg>`;
const overspanningspijlPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.5"><text x="32" y="24" font-size="8" text-anchor="middle" fill="#000" stroke="none">Overspanning vloer</text><line x1="8" y1="40" x2="56" y2="40"/><polyline points="14,36 8,40 14,44"/><polyline points="50,36 56,40 50,44"/></svg>`;
const stenenrijPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.4"><rect x="22" y="3" width="20" height="10"/><rect x="22" y="15" width="20" height="10"/><rect x="22" y="27" width="20" height="10"/><rect x="22" y="39" width="20" height="10"/><rect x="22" y="51" width="20" height="10"/></svg>`;
// Betonbalk: balk met knik in plattegrond — twee randlijnen met verstek,
// dunne streep-punt-hartlijn en een haakse eindkap links.
// Systeemraster: contourveld gevuld met een geclipt platenraster.
const systeemrasterPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M6 10 H58 V54 H30 V38 H6 Z"/><g stroke-width="0.9"><line x1="19" y1="10" x2="19" y2="38"/><line x1="32" y1="10" x2="32" y2="54"/><line x1="45" y1="10" x2="45" y2="54"/><line x1="6" y1="24" x2="58" y2="24"/><line x1="30" y1="38" x2="58" y2="38"/></g></svg>`;

const betonbalkPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M4 22 H36 L52 38 V61"/><path d="M4 42 H28 L38 52 V61"/><line x1="4" y1="22" x2="4" y2="42"/><path d="M4 32 H32 L45 45 V61" stroke-width="0.9" stroke-dasharray="6 3 1.5 3"/></svg>`;

// Systeemplafond: contour met boograndje, tegelraster, één ventilatiepaneel
// (kruis) en één lichtpaneel (arcering).
const systeemplafondPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M6 8 H58 V44 Q44 58 30 56 Q16 54 6 44 Z"/><g stroke-width="0.9"><line x1="19" y1="8" x2="19" y2="50"/><line x1="32" y1="8" x2="32" y2="56"/><line x1="45" y1="8" x2="45" y2="52"/><line x1="6" y1="22" x2="58" y2="22"/><line x1="6" y1="36" x2="58" y2="36"/><path d="M19 8 32 22 M32 8 19 22"/><path d="M45 25 55 35 M48 22 58 32 M45 31 50 36"/></g></svg>`;

export const NL_CATEGORIES = [
  {
    // ONE building category, IFC-georiënteerd: wanden, vloeren en
    // constructieprofielen samen. De wand is ÉÉN object — materiaal en
    // dikte kies je daarna in het eigenschappenvenster.
    id: 'nl-ifc-bouw',
    name: 'NL IFC Bouw',
    // Meegeleverde groep: zonder deze vlag toonde de bibliotheek-instellingen
    // "+ Add Symbol"/Export/Remove die stilletjes niets deden — de handlers
    // werken alleen op preferences.customSymbolGroups (#339).
    builtin: true,
    industry: 'aec',
    country: 'nl',
    color: 'var(--theme-text, #000000)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 5.5 8 2l6 3.5v5L8 14l-6-3.5z"/><path d="M8 8v6M2 5.5 8 8l6-2.5"/></svg>`,
    symbols: [
      { id: 'wand', name: 'Wand (IfcWall)', wall: { pattern: 'nen47-metselwerk-baksteen', dikteMm: 100 }, svg: wandMetselwerkPreview },
      { id: 'ifc-space', name: 'Ruimte (IfcSpace)', parametricId: 'ifc-space', svg: ifcSpacePreview },
      { id: 'param-vloer-kanaalplaat', name: 'Kanaalplaatvloer', parametricId: 'vloer-kanaalplaatvloer', svg: kanaalplaatPreview },
      { id: 'param-vloer-isolatieplaat', name: 'Isolatieplaatvloer', parametricId: 'vloer-isolatieplaatvloer', svg: isolatieplaatPreview },
      { id: 'param-vloer-ps-isolatie', name: 'PS-isolatievloer', parametricId: 'vloer-ps-isolatievloer', svg: psIsolatiePreview },
      { id: 'param-staal-hea', name: 'HEA', parametricId: 'staal-hea', svg: heaPreview },
      { id: 'param-staal-heb', name: 'HEB', parametricId: 'staal-heb', svg: hebPreview },
      { id: 'param-staal-ipe', name: 'IPE', parametricId: 'staal-ipe', svg: ipePreview },
      { id: 'param-staal-unp', name: 'UNP', parametricId: 'staal-unp', svg: unpPreview },
      { id: 'param-staal-koker', name: 'Koker', parametricId: 'staal-koker', svg: kokerPreview },
      { id: 'param-hout-balk', name: 'Houten balk', parametricId: 'hout-balk', svg: houtBalkPreview },
      { id: 'param-paal-type-1', name: 'Paal aanzicht type 1', parametricId: 'paal-aanzicht-type-1', svg: paalPreview },
      { id: 'param-paal-type-2', name: 'Paal aanzicht type 2', parametricId: 'paal-aanzicht-type-2', svg: paalPreview },
      { id: 'param-bout', name: 'Bout / anker (M6–M24)', parametricId: 'bout', svg: boutPreview },
      { id: 'param-wapeningskorf', name: 'Wapeningskorf (doorsnede)', parametricId: 'wapeningskorf', svg: wapeningskorfPreview },
      { id: 'param-wapeningsstaaf', name: 'Wapeningsstaaf', parametricId: 'wapeningsstaaf', svg: wapeningsstaafPreview },
      { id: 'param-netwapening', name: 'Netwapening', parametricId: 'netwapening', svg: netwapeningPreview },
      { id: 'param-sondering', name: 'Sondering', parametricId: 'sondering', svg: sonderingPreview },
      { id: 'param-paalpuntniveau', name: 'Paalpuntniveau', parametricId: 'paalpuntniveau', svg: paalpuntniveauPreview },
      { id: 'param-overspanningspijl-vloer', name: 'Overspanningspijl vloer', parametricId: 'overspanningspijl-vloer', svg: overspanningspijlPreview },
      { id: 'param-stenenrij', name: 'Stenenrij (lagen-/koppenmaat)', parametricId: 'stenenrij', svg: stenenrijPreview },
      // Stavenreeks: geen parametrisch symbool maar een eigen gereedschap —
      // je sleept de reekslijn, net als bij Maskeer hieronder.
      { id: 'stavenreeks', name: 'Stavenreeks (wapening)', tool: 'stavenreeks', svg: stavenreeksPreview },
      // Betonbalk: eigen klik-voor-klik-gereedschap (hartlijn zoals een
      // polylijn); breedte/lijnstijl daarna in het eigenschappen-paneel.
      { id: 'betonbalk', name: 'Betonbalk (IfcBeam)', tool: 'betonbalk', svg: betonbalkPreview },
      // Systeemraster: klik-voor-klik contour die automatisch gevuld wordt
      // met een platenraster (systeemplafond, stelconplaten 2000×2000);
      // plaatmaat/equalize/randconditie daarna in het eigenschappen-paneel.
      { id: 'systeemraster', name: 'Systeemraster (IfcCovering)', tool: 'systeemraster', svg: systeemrasterPreview },
      // Systeemplafond: zelfde contour-flow, celmaat 600×600, panelen
      // individueel inwisselbaar (tegel/ventilatie/licht) en randprofiel;
      // IFC: IfcCovering met PredefinedType CEILING.
      { id: 'systeemplafond', name: 'Systeemplafond (IfcCovering.CEILING)', tool: 'systeemplafond', svg: systeemplafondPreview },
      // NL tekenwerk-symbolen horen er ook gewoon bij (één bouw-categorie).
      { id: 'param-stramien', name: 'Stramien', parametricId: 'stramien', svg: stramienPreview },
      { id: 'param-peilmaat', name: 'Peilmaat (spot elevation)', parametricId: 'peilmaat', svg: peilmaatPreview },
      // Maskeer: wit afdekvlak (wipeout) — rechthoek slepen dekt de
      // onderliggende tekening + eerdere annotaties af.
      { id: 'maskeer', name: 'Maskeer (afdekvlak)', tool: 'mask', svg: maskeerPreview },
      // PARKED (below par, to be reworked later): wandarcering,
      // wapeningVerdeling and beugel — templates stay registered in
      // symbols/registry.js, only their palette entries are hidden.
    ],
  },
  {
    // Elektra — NLRS-legendasymbolen (stopcontacten, schakelaars, verlichting,
    // aansluitpunten, bel, meterkast, bewegingsdetector). Statische SVG-stempels
    // die als stempel geplaatst worden; geometrie uit de elektra-renvooi-DXF.
    id: 'nl-elektra',
    // Zie nl-ifc-bouw hierboven (#339).
    builtin: true,
    name: 'NL Elektra',
    color: 'var(--theme-text, #000000)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1 3 9h4l-1 6 6-8H8z"/></svg>`,
    symbols: ELEKTRA_SYMBOLS,
  },
];
