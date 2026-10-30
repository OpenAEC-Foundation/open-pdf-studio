// NL drafting category for the tool palette — PARAMETRIC components.
// Unlike the stamp categories (static SVG), these entries reference a
// parametric template id (symbols/registry.js). Clicking one activates the
// parametricSymbol tool so the placed annotation stays editable (number,
// value, orientation, …) via the properties panel.

// Elektra-legendasymbolen (NLRS) — statische SVG-stempels, gegenereerd uit de
// lokale elektra-renvooi-DXF (zie scripts/dxf-elektra-convert.mjs).
import { ELEKTRA_SYMBOLS } from './elektraSymbols.js';

const stramienPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><circle cx="32" cy="15" r="9"/><text x="32" y="19.5" font-family="Arial, sans-serif" font-size="13" text-anchor="middle" fill="#000" stroke="none" font-weight="bold">1</text><path d="M32 24V58" stroke-width="1.25" stroke-dasharray="7 2.5 1.5 2.5"/></svg>`;

const peilmaatPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><text x="32" y="24" font-family="Arial, sans-serif" font-size="13" text-anchor="middle" fill="#000" stroke="none">P = 0</text><path d="M8 32H56"/><path d="M24 32L32 46L40 32"/></svg>`;

const wandarceringPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><line x1="4" y1="24" x2="60" y2="24"/><line x1="4" y1="40" x2="60" y2="40"/><line x1="8" y1="40" x2="17" y2="24"/><line x1="18" y1="40" x2="27" y2="24"/><line x1="28" y1="40" x2="37" y2="24"/><line x1="38" y1="40" x2="47" y2="24"/><line x1="48" y1="40" x2="57" y2="24"/></svg>`;

const wapeningVerdelingPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><line x1="6" y1="18" x2="44" y2="18"/><line x1="16" y1="18" x2="10" y2="40"/><line x1="27" y1="18" x2="21" y2="40"/><line x1="38" y1="18" x2="32" y2="40"/><circle cx="10" cy="42" r="2.6" fill="#000"/><circle cx="21" cy="42" r="2.6" fill="#000"/><circle cx="32" cy="42" r="2.6" fill="#000"/><text x="52" y="22" font-size="11" text-anchor="middle" fill="#000" stroke="none">3Ø12</text></svg>`;

const beugelPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="8" width="32" height="44"/><line x1="20" y1="12" x2="34" y2="12"/><line x1="34" y1="12" x2="34" y2="26"/><text x="51" y="36" font-size="9" text-anchor="middle" fill="#000" stroke="none">Ø8-250</text></svg>`;

// Palet-pictogrammen NL IFC Bouw — één stijl voor de hele categorie:
// viewBox 64, inhoud binnen ca. 6..58, hoofdlijn 2, detaillijn 1,25, tekst
// minstens 11 eenheden en hooguit één kort label. Zwart (#000) volgt via
// colorizeSvg het thema; vaste kleuren alleen voor materiaalvlakken.
// Pattern-/clip-id's beginnen met 'nlb-' en zijn uniek: alle pictogrammen
// staan in hetzelfde DOM.

// NL Constructie — steel cross-section previews: SOLID (zoals de echte
// doorsneden renderen), met afrondingen tussen lijf en flens.
const heaPreview = `<svg viewBox="0 0 64 64"><path d="M7 10H57V17H37.5A3 3 0 0 0 34.5 20V44A3 3 0 0 0 37.5 47H57V54H7V47H26.5A3 3 0 0 0 29.5 44V20A3 3 0 0 0 26.5 17H7Z" fill="#000" fill-rule="evenodd"/></svg>`;
const hebPreview = `<svg viewBox="0 0 64 64"><path d="M8 8H56V17H38.5A3 3 0 0 0 35.5 20V44A3 3 0 0 0 38.5 47H56V56H8V47H25.5A3 3 0 0 0 28.5 44V20A3 3 0 0 0 25.5 17H8Z" fill="#000" fill-rule="evenodd"/></svg>`;
const ipePreview = `<svg viewBox="0 0 64 64"><path d="M18 7H46V13H37.25A3 3 0 0 0 34.25 16V48A3 3 0 0 0 37.25 51H46V57H18V51H26.75A3 3 0 0 0 29.75 48V16A3 3 0 0 0 26.75 13H18Z" fill="#000" fill-rule="evenodd"/></svg>`;
const kokerPreview = `<svg viewBox="0 0 64 64"><path d="M14 8H50A6 6 0 0 1 56 14V50A6 6 0 0 1 50 56H14A6 6 0 0 1 8 50V14A6 6 0 0 1 14 8ZM18 14.5A3.5 3.5 0 0 0 14.5 18V46A3.5 3.5 0 0 0 18 49.5H46A3.5 3.5 0 0 0 49.5 46V18A3.5 3.5 0 0 0 46 14.5Z" fill="#000" fill-rule="evenodd"/></svg>`;
const hoeklijnPreview = `<svg viewBox="0 0 64 64"><path d="M9 9H16.5V43.5A4 4 0 0 0 20.5 47.5H55V55H9Z" fill="#000" fill-rule="evenodd"/></svg>`;
const unpPreview = `<svg viewBox="0 0 64 64"><path d="M19 7H45V13H29A3 3 0 0 0 26 16V48A3 3 0 0 0 29 51H45V57H19Z" fill="#000" fill-rule="evenodd"/></svg>`;

// NL Vloeren — realistische doorsnede-previews: grijs beton + diagonale
// arcering, witte kanalen, EPS-laag waar van toepassing.
const kanaalplaatPreview = `<svg viewBox="0 0 64 64"><defs><pattern id="nlb-kanaalplaat" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#a3a3a3" stroke="none"/><line x1="0" y1="0" x2="0" y2="5" stroke="#4a4a4a" stroke-width="1"/></pattern></defs><rect x="6" y="21" width="52" height="22" fill="url(#nlb-kanaalplaat)" stroke="#000" stroke-width="2"/><g fill="#fff" stroke="#333" stroke-width="1.25"><ellipse cx="14.5" cy="32" rx="4.5" ry="6.5"/><ellipse cx="26.5" cy="32" rx="4.5" ry="6.5"/><ellipse cx="38.5" cy="32" rx="4.5" ry="6.5"/><ellipse cx="50.5" cy="32" rx="4.5" ry="6.5"/></g></svg>`;
const isolatieplaatPreview = `<svg viewBox="0 0 64 64"><defs><pattern id="nlb-isolatieplaat" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#a3a3a3" stroke="none"/><line x1="0" y1="0" x2="0" y2="5" stroke="#4a4a4a" stroke-width="1"/></pattern></defs><rect x="6" y="30" width="52" height="16" fill="#dcdce4" stroke="#000" stroke-width="2"/><polyline points="6.5,44 11,32 15.5,44 20,32 24.5,44 29,32 33.5,44 38,32 42.5,44 47,32 51.5,44 56,32 57.5,36" fill="none" stroke="#8a8a96" stroke-width="1.25"/><rect x="6" y="17" width="52" height="13" fill="url(#nlb-isolatieplaat)" stroke="#000" stroke-width="2"/></svg>`;
const psIsolatiePreview = `<svg viewBox="0 0 64 64"><defs><pattern id="nlb-ps-isolatie" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#a3a3a3" stroke="none"/><line x1="0" y1="0" x2="0" y2="5" stroke="#4a4a4a" stroke-width="1"/></pattern></defs><path d="M6 27H58V46H46V36H18V46H6Z" fill="#dcdce4" stroke="#000" stroke-width="2"/><rect x="6" y="17" width="52" height="10" fill="url(#nlb-ps-isolatie)" stroke="#000" stroke-width="2"/></svg>`;

// NL Wanden — realistische wand-preview: baksteenrood met donkere lijnparen
// (de echte metselwerk-arcering in het klein).
const wandMetselwerkPreview = `<svg viewBox="0 0 64 64"><defs><pattern id="nlb-baksteen" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#CD7C61"/><path d="M0 0V10M3 0V10" stroke="#3b2418" stroke-width="1"/></pattern></defs><rect x="6" y="22" width="52" height="20" fill="url(#nlb-baksteen)" stroke="#000" stroke-width="2"/></svg>`;
const wandIsolatiePreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="24" width="52" height="16"/><path d="M8 32 q4 -7 8 0 q4 7 8 0 q4 -7 8 0 q4 7 8 0 q4 -7 8 0 q4 7 8 0" stroke-width="1.4"/></svg>`;
const wandKzsPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="24" width="52" height="16"/><line x1="12" y1="24" x2="8" y2="40" stroke-width="1.2"/><line x1="20" y1="24" x2="16" y2="40" stroke-width="1.2"/><line x1="28" y1="24" x2="24" y2="40" stroke-width="1.2"/><line x1="36" y1="24" x2="32" y2="40" stroke-width="1.2"/><line x1="44" y1="24" x2="40" y2="40" stroke-width="1.2"/><line x1="52" y1="24" x2="48" y2="40" stroke-width="1.2"/></svg>`;
const wandBetonPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="24" width="52" height="16"/><line x1="16" y1="24" x2="8" y2="40" stroke-width="1.2"/><line x1="30" y1="24" x2="22" y2="40" stroke-width="1.2"/><line x1="44" y1="24" x2="36" y2="40" stroke-width="1.2"/><circle cx="22" cy="30" r="1.2" fill="#000"/><circle cx="36" cy="35" r="1.2" fill="#000"/><circle cx="48" cy="29" r="1.2" fill="#000"/></svg>`;

// Gevelelement (#475): vliesgevel (stijlen als blokjes, dubbele glaslijn,
// één deur met draaicirkel) en kozijn (kozijnhout met glas en een draairaam,
// draaicirkel gestreept).
const vliesgevelPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><g fill="#000" stroke="none"><rect x="6" y="21" width="4" height="10"/><rect x="22" y="21" width="4" height="10"/><rect x="38" y="21" width="4" height="10"/><rect x="54" y="21" width="4" height="10"/></g><path d="M10 24.5H22M10 27.5H22M42 24.5H54M42 27.5H54" stroke-width="1.25"/><path d="M26 31V43"/><path d="M26 43A12 12 0 0 0 38 31" stroke-width="1.25"/></svg>`;
const kozijnPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><g fill="#000" stroke="none"><rect x="6" y="18" width="6" height="12"/><rect x="29.5" y="18" width="5" height="12"/><rect x="52" y="18" width="6" height="12"/></g><path d="M12 23H29.5M12 25H29.5M34.5 23H52M34.5 25H52" stroke-width="1.25"/><path d="M52 30V47.5"/><path d="M34.5 30A17.5 17.5 0 0 0 52 47.5" stroke-width="1.25" stroke-dasharray="2.5 2"/></svg>`;

const ifcSpacePreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="7" y="12" width="50" height="40" stroke-dasharray="5 3"/><text x="32" y="36.5" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#000" stroke="none">Ruimte</text></svg>`;
// Maskeer (wipeout): wit afdekvlak over een "tekening" (grijze lijntjes
// eronder maken zichtbaar dat het vlak afdekt), streep-punt-rand.
const maskeerPreview = `<svg viewBox="0 0 64 64" fill="none"><path d="M6 12H58M6 20H58M6 28H58M6 36H58M6 44H58M6 52H58" stroke="#9a9a9a" stroke-width="1.25"/><rect x="16" y="18" width="32" height="28" fill="#fff" stroke="#555" stroke-width="1.25" stroke-dasharray="6 2.5 1.5 2.5"/></svg>`;
const houtBalkPreview = `<svg viewBox="0 0 64 64"><defs><pattern id="nlb-hout" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#ead9b0"/><line x1="0" y1="0" x2="0" y2="6" stroke="#8a7448" stroke-width="1"/></pattern></defs><rect x="18" y="8" width="28" height="48" fill="url(#nlb-hout)" stroke="#000" stroke-width="2"/></svg>`;
// Stavenreeks: aanhaallijn met uitloop, drie steile poten naar gevulde punten
// (de staven) en het wapeningsteken — de vorm zoals het gereedschap tekent.
const stavenreeksPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M10 16H56"/><path d="M14 16L8 40M28 16L22 40M42 16L36 40"/><g fill="#000" stroke="none"><circle cx="8" cy="42" r="3.2"/><circle cx="22" cy="42" r="3.2"/><circle cx="36" cy="42" r="3.2"/></g><g stroke-width="1.25"><circle cx="50" cy="48" r="5"/><path d="M45 57L55 39"/></g></svg>`;
// Paal-aanzicht: schacht met gestreepte kop boven maaiveld en gebogen punt
// met half-gevulde lens — het klassieke heipaal-symbool in het klein. Type 1
// is smal (168), type 2 breed (250); het typenummer staat ernaast.
const paalType1Preview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M17 12V6H31V12" stroke-width="1.25" stroke-dasharray="3 2"/><path d="M17 12V50M31 12V50"/><path d="M17 50Q20.5 56.5 24 50" stroke-width="1.25"/><path d="M24 50Q27.5 58 31 50Q27.5 47 24 50Z" fill="#000" stroke-width="1"/><text x="45.5" y="37" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#000" stroke="none" font-weight="bold">1</text></svg>`;
const paalType2Preview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M10 12V6H34V12" stroke-width="1.25" stroke-dasharray="3 2"/><path d="M10 12V50M34 12V50"/><path d="M10 50Q16 56.5 22 50" stroke-width="1.25"/><path d="M22 50Q28 58 34 50Q28 47 22 50Z" fill="#000" stroke-width="1"/><text x="47" y="37" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#000" stroke="none" font-weight="bold">2</text></svg>`;
// Bout: zeskantkop (drie vlakken, afgeschuinde bovenkant) + ring + schacht
// met draadeinde, dunne kernlijnen en afgeschuinde punt.
// Constructieve tekengereedschappen (#312).
const wapeningsdetailPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><circle cx="14" cy="13" r="7" stroke-width="1.25"/><text x="14" y="17.2" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#000" stroke="none">1</text><path d="M10 26V46H54V26" stroke-width="3"/><path d="M10 54H54M8 56L12 52M52 56L56 52" stroke-width="1.25"/></svg>`;
const wapeningsnetPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="12" width="52" height="40"/><path d="M6 52L58 12" stroke-width="1.25"/><text x="21" y="29" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#000" stroke="none">Ø8</text></svg>`;
const staafPlattegrondPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M6 38H58" stroke-width="3"/><path d="M20 8V58M16 12L24 4M16 60L24 52" stroke-width="1.25"/><circle cx="40" cy="22" r="7" stroke-width="1.25"/><text x="40" y="26.2" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#000" stroke="none">1</text></svg>`;
const vloerVorstrandPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M58 10H6V56H24V26H58"/><path d="M58 10V15L60 17L56 20L58 22V26" stroke-width="1.25"/><path d="M10 14H58M10 22H58" stroke-width="1.25"/><rect x="10" y="14" width="10" height="38" stroke-width="1.25"/><g fill="#000" stroke="none"><circle cx="12.5" cy="16.5" r="1.8"/><circle cx="17.5" cy="16.5" r="1.8"/><circle cx="12.5" cy="49.5" r="1.8"/><circle cx="17.5" cy="49.5" r="1.8"/></g></svg>`;
const kopplaatPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M6 12H43M6 52H43"/><path d="M6 16H43M6 48H43" stroke-width="1.25"/><rect x="43" y="8" width="5" height="48"/><g stroke-width="1.25"><path d="M37 21H43V29H37ZM37 35H43V43H37Z"/><path d="M48 23H56M48 27H56M48 37H56M48 41H56"/><path d="M32 25H58M32 39H58" stroke-dasharray="5 2 1 2"/></g></svg>`;
const voetplaatPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="7" y="7" width="50" height="50"/><path d="M20 18H25V30H39V18H44V46H39V34H25V46H20Z" fill="#000" stroke="none"/><g stroke-width="1.25"><circle cx="14" cy="14" r="3.2"/><circle cx="50" cy="14" r="3.2"/><circle cx="14" cy="50" r="3.2"/><circle cx="50" cy="50" r="3.2"/></g></svg>`;
const boutPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M7.6 20H14V44H7.6L6 41.4V22.6Z"/><path d="M7.6 26H14M7.6 38H14M7.6 26Q5.2 32 7.6 38M7.6 20Q5.4 23 7.6 26M7.6 38Q5.4 41 7.6 44" stroke-width="1.25"/><rect x="14" y="18" width="4" height="28"/><path d="M18 25.5H56.6L58 27.2V36.8L56.6 38.5H18"/><path d="M40 25.5V38.5"/><path d="M40 27.2H58M40 36.8H58" stroke-width="1.25"/></svg>`;
// Anker: ankerbout met L-haak in gearceerd beton, ring en moer op het oppervlak.
const ankerPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><defs><pattern id="nlb-anker-beton" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#a3a3a3" stroke="none"/><line x1="0" y1="0" x2="0" y2="5" stroke="#4a4a4a" stroke-width="1"/></pattern></defs><rect x="6" y="28" width="52" height="30" fill="url(#nlb-anker-beton)" stroke="none"/><path d="M6 28H58"/><path d="M29 28V45A10 10 0 0 0 39 55H52V49H39A4 4 0 0 1 35 45V28" fill="#fff"/><rect x="21" y="25" width="22" height="3"/><path d="M24 17H40L41 18.5V23.5L40 25H24L23 23.5V18.5Z"/><path d="M27.5 17V25M36.5 17V25" stroke-width="1.25"/><path d="M29 17V11L30 10H34L35 11V17"/><path d="M30.3 10.5V17M33.7 10.5V17" stroke-width="1.25"/></svg>`;
// Wapeningskorf: betonomtrek met beugel (haak linksboven) en gevulde
// staafpunten boven/onder/zij — de doorsnede zoals het sjabloon hem tekent.
const wapeningskorfPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="9" y="8" width="46" height="48"/><rect x="14" y="13" width="36" height="38" stroke-width="1.25"/><path d="M14 18L21 25M18 13L25 20" stroke-width="1.25"/><g fill="#000" stroke="none"><circle cx="19" cy="18" r="2.8"/><circle cx="32" cy="18" r="2.8"/><circle cx="45" cy="18" r="2.8"/><circle cx="19" cy="32" r="2.2"/><circle cx="45" cy="32" r="2.2"/><circle cx="19" cy="46" r="3.2"/><circle cx="32" cy="46" r="3.2"/><circle cx="45" cy="46" r="3.2"/></g></svg>`;

const wapeningsstaafPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><text x="32" y="27" font-family="Arial, sans-serif" font-size="13" text-anchor="middle" fill="#000" stroke="none">3Ø8</text><path d="M6 40H58"/><path d="M13 40L18.5 32.5L24 40Z" fill="#000" stroke="none"/></svg>`;
const netwapeningPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><text x="32" y="27" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#000" stroke="none">Ø8-150</text><path d="M6 40H58"/><path d="M13 40L18.5 32.5L24 40Z" fill="#000" stroke="none"/></svg>`;
const sonderingPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M10 22H36L23 50Z" fill="#000" stroke="none"/><path d="M6 50H40"/><text x="49" y="30" font-family="Arial, sans-serif" font-size="18" text-anchor="middle" fill="#000" stroke="none" font-weight="bold">1</text></svg>`;
const paalpuntniveauPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="21" width="52" height="22"/><text x="32" y="36.5" font-family="Arial, sans-serif" font-size="13" text-anchor="middle" fill="#000" stroke="none" font-weight="bold">−14.0</text></svg>`;
const overspanningspijlPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M8 32H56"/><path d="M15 25L8 32L15 39M49 25L56 32L49 39"/></svg>`;
const stenenrijPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="21" y="6" width="22" height="52"/><path d="M21 16.4H43M21 26.8H43M21 37.2H43M21 47.6H43" stroke-width="1.25"/></svg>`;
// Betonbalk: balk met hoek in plattegrond — twee randlijnen, dunne
// streep-punt-hartlijn en een haakse eindkap links.
// Systeemraster: contourveld gevuld met een geclipt platenraster.
const systeemrasterPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M6 10H58V54H30V38H6Z"/><path d="M19 10V38M32 10V54M45 10V54M6 24H58M30 38H58" stroke-width="1.25"/></svg>`;

const betonbalkPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M6 14H50V58M6 30H34V58M6 14V30"/><path d="M6 22H42V58" stroke-width="1.25" stroke-dasharray="6 2.5 1.5 2.5"/></svg>`;

// Systeemplafond: contour met boograndje, tegelraster, één ventilatiepaneel
// (kruis) en één lichtpaneel (arcering).
const systeemplafondPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><defs><clipPath id="nlb-plafond"><path d="M6 8H58V44Q44 58 30 56Q16 54 6 44Z"/></clipPath></defs><g clip-path="url(#nlb-plafond)" stroke-width="1.25"><path d="M19 8V58M32 8V58M45 8V58M6 22H58M6 36H58"/><path d="M19 8L32 22M32 8L19 22"/><path d="M45 26L54 35M48 23L57 32M45 32L49 36"/></g><path d="M6 8H58V44Q44 58 30 56Q16 54 6 44Z"/></svg>`;

// Previews constructie- en bouwplaats-symbolen (#338).
const opleggingPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M32 13L20 38H44Z"/><path d="M12 38H52"/><path d="M18 38L13 45M26 38L21 45M34 38L29 45M42 38L37 45M50 38L45 45" stroke-width="1.25"/></svg>`;
const puntlastPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><text x="32" y="16" font-family="Arial, sans-serif" font-size="13" text-anchor="middle" fill="#000" stroke="none" font-weight="bold">F</text><path d="M32 22V46"/><path d="M32 57L26.5 45H37.5Z" fill="#000" stroke="none"/></svg>`;
const qlastPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><text x="32" y="14" font-family="Arial, sans-serif" font-size="13" text-anchor="middle" fill="#000" stroke="none" font-weight="bold">q</text><path d="M8 20H56"/><path d="M12 20V38M32 20V38M52 20V38"/><g fill="#000" stroke="none"><path d="M12 46L8.5 37H15.5Z"/><path d="M32 46L28.5 37H35.5Z"/><path d="M52 46L48.5 37H55.5Z"/></g><path d="M6 48H58"/></svg>`;
const beddingsverenPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M8 12H56"/><path d="M16 12V17L20.5 20L11.5 25L20.5 30L11.5 35L16 38V42M32 12V17L36.5 20L27.5 25L36.5 30L27.5 35L32 38V42M48 12V17L52.5 20L43.5 25L52.5 30L43.5 35L48 38V42"/><path d="M10 44H22M26 44H38M42 44H54"/><path d="M12 44L9 49M16 44L13 49M20 44L17 49M28 44L25 49M32 44L29 49M36 44L33 49M44 44L41 49M48 44L45 49M52 44L49 49" stroke-width="1.25"/></svg>`;
const windverbandPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="8" y="12" width="48" height="40"/><path d="M8 12L56 52M8 52L56 12"/></svg>`;
const scharnierVerbindingPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M6 32H25M39 32H58"/><circle cx="32" cy="32" r="7"/></svg>`;
const bouwkraanPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.6"><circle cx="32" cy="32" r="26" stroke-dasharray="5 4"/><rect x="28" y="28" width="8" height="8"/><line x1="36" y1="32" x2="58" y2="32" stroke-width="2"/><line x1="28" y1="32" x2="22" y2="32" stroke-width="2"/></svg>`;
const draaicirkelPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="1.6"><circle cx="32" cy="32" r="24" stroke-dasharray="5 4"/><path d="M52 16 47 13 49 20 Z" fill="#000"/><text x="32" y="36" font-size="10" text-anchor="middle" fill="#000" stroke="none">R</text></svg>`;
const parkeervakPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="18" y="8" width="28" height="48"/><text x="32" y="38" font-size="18" font-weight="bold" text-anchor="middle" fill="#000" stroke="none">P</text></svg>`;
const bouwkeetPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="20" width="52" height="24"/><line x1="6" y1="20" x2="58" y2="44" stroke-width="1"/><text x="32" y="56" font-size="9" text-anchor="middle" fill="#000" stroke="none">KEET</text></svg>`;
// Previews inrichting (#478): sanitair en keuken in plattegrond, de wand
// (achterkant) boven — zoals het symbool zelf ongedraaid ligt.
const wandclosetPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><line x1="8" y1="8" x2="56" y2="8" stroke-width="3"/><path d="M20 10 H44 V24 A12 28 0 0 1 20 24 Z"/><ellipse cx="32" cy="33" rx="7.5" ry="12"/></svg>`;
const staandClosetPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="18" y="4" width="28" height="13"/><circle cx="32" cy="10.5" r="2" stroke-width="1.4"/><path d="M20 17 H44 V26 A12 32 0 0 1 20 26 Z"/><ellipse cx="32" cy="38" rx="8" ry="12"/></svg>`;
const fonteinPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="8" y="18" width="48" height="30"/><ellipse cx="32" cy="36" rx="17" ry="9"/><circle cx="32" cy="23.5" r="2.2" stroke-width="1.4"/></svg>`;
const hoekfonteinPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M10 10 H52 A42 42 0 0 1 10 52 Z"/><circle cx="29" cy="29" r="11"/><circle cx="17" cy="17" r="2.2" stroke-width="1.4"/></svg>`;
const aanrechtPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="4" y="21" width="56" height="22"/><rect x="10" y="24" width="14" height="16" stroke-width="1.4"/><rect x="13" y="28" width="8" height="10" stroke-width="1.2"/><g stroke-width="1.2"><circle cx="38" cy="27" r="3"/><circle cx="49" cy="27" r="3.6"/><circle cx="38" cy="37" r="3.6"/><circle cx="49" cy="37" r="3"/></g></svg>`;
const aanrechtHoekPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><path d="M4 6 H58 V58 H42 V22 H4 Z"/><rect x="10" y="9" width="14" height="10" stroke-width="1.4"/><g stroke-width="1.2"><circle cx="46" cy="36" r="2.6"/><circle cx="54" cy="36" r="2.6"/><circle cx="46" cy="46" r="2.6"/><circle cx="54" cy="46" r="2.6"/></g></svg>`;
const kookeilandPreview = `<svg viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="2"><rect x="6" y="16" width="52" height="30"/><line x1="6" y1="22" x2="58" y2="22" stroke-width="1.2" stroke-dasharray="3 2"/><rect x="19" y="26" width="26" height="19" stroke-width="1.2"/><g stroke-width="1.2"><circle cx="25" cy="31" r="4"/><circle cx="39" cy="31" r="4"/><circle cx="25" cy="40" r="4"/><circle cx="39" cy="40" r="4"/></g></svg>`;

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
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 5.5 8 2l6 3.5v5L8 14l-6-3.5z"/><path d="M2 5.5 8 9l6-3.5M8 9v5"/></svg>`,
    symbols: [
      { id: 'wand', name: 'Wand (IfcWall)', wall: { pattern: 'nen47-metselwerk-baksteen', dikteMm: 100 }, svg: wandMetselwerkPreview },
      { id: 'param-vliesgevel', name: 'Vliesgevel (IfcCurtainWall)', parametricId: 'vliesgevel', svg: vliesgevelPreview },
      { id: 'param-kozijn', name: 'Kozijn (IfcWindow)', parametricId: 'kozijn', svg: kozijnPreview },
      { id: 'ifc-space', name: 'Ruimte (IfcSpace)', parametricId: 'ifc-space', svg: ifcSpacePreview },
      { id: 'param-vloer-kanaalplaat', name: 'Kanaalplaatvloer', parametricId: 'vloer-kanaalplaatvloer', svg: kanaalplaatPreview },
      { id: 'param-vloer-isolatieplaat', name: 'Isolatieplaatvloer', parametricId: 'vloer-isolatieplaatvloer', svg: isolatieplaatPreview },
      { id: 'param-vloer-ps-isolatie', name: 'PS-isolatievloer', parametricId: 'vloer-ps-isolatievloer', svg: psIsolatiePreview },
      { id: 'param-staal-hea', name: 'HEA', parametricId: 'staal-hea', svg: heaPreview },
      { id: 'param-staal-heb', name: 'HEB', parametricId: 'staal-heb', svg: hebPreview },
      { id: 'param-staal-ipe', name: 'IPE', parametricId: 'staal-ipe', svg: ipePreview },
      { id: 'param-staal-unp', name: 'UNP', parametricId: 'staal-unp', svg: unpPreview },
      { id: 'param-staal-koker', name: 'Koker', parametricId: 'staal-koker', svg: kokerPreview },
      { id: 'param-staal-hoeklijn', name: 'Hoeklijn', parametricId: 'staal-hoeklijn', svg: hoeklijnPreview },
      { id: 'param-hout-balk', name: 'Houten balk', parametricId: 'hout-balk', svg: houtBalkPreview },
      { id: 'param-paal-type-1', name: 'Paal aanzicht type 1', parametricId: 'paal-aanzicht-type-1', svg: paalType1Preview },
      { id: 'param-paal-type-2', name: 'Paal aanzicht type 2', parametricId: 'paal-aanzicht-type-2', svg: paalType2Preview },
      { id: 'param-bout', name: 'Bout (M6–M24)', parametricId: 'bout', svg: boutPreview },
      { id: 'param-anker', name: 'Anker in beton (ingestort, chemisch, keil, kopbout)', parametricId: 'anker', svg: ankerPreview },
      { id: 'param-wapeningskorf', name: 'Wapeningskorf (doorsnede)', parametricId: 'wapeningskorf', svg: wapeningskorfPreview },
      { id: 'param-wapeningsstaaf', name: 'Wapeningsstaaf', parametricId: 'wapeningsstaaf', svg: wapeningsstaafPreview },
      { id: 'param-netwapening', name: 'Netwapening', parametricId: 'netwapening', svg: netwapeningPreview },
      // Constructieve tekengereedschappen (#312): wapening en staalverbindingen.
      { id: 'param-wapeningsdetail', name: 'Wapeningsdetail (buigvorm)', parametricId: 'wapeningsdetail', svg: wapeningsdetailPreview },
      { id: 'param-staaf-plattegrond', name: 'Staaf in plattegrond', parametricId: 'staaf-plattegrond', svg: staafPlattegrondPreview },
      { id: 'param-wapeningsnet', name: 'Wapeningsnet (plattegrond)', parametricId: 'wapeningsnet', svg: wapeningsnetPreview },
      { id: 'param-vloer-vorstrand', name: 'Vloer met vorstrand (wapening)', parametricId: 'vloer-vorstrand', svg: vloerVorstrandPreview },
      { id: 'param-kopplaat', name: 'Kopplaat bij ligger', parametricId: 'kopplaat', svg: kopplaatPreview },
      { id: 'param-voetplaat', name: 'Voetplaat bij staalprofiel', parametricId: 'voetplaat', svg: voetplaatPreview },
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
      // Constructie-symbolen (#338): opleggingen, lasten, veren, verband.
      { id: 'param-oplegging', name: 'Oplegging (steunpunt)', parametricId: 'oplegging', svg: opleggingPreview },
      { id: 'param-puntlast', name: 'Puntlast', parametricId: 'puntlast', svg: puntlastPreview },
      { id: 'param-q-last', name: 'q-last (verdeelde belasting)', parametricId: 'q-last', svg: qlastPreview },
      { id: 'param-beddingsveren', name: 'Beddingsveren', parametricId: 'beddingsveren', svg: beddingsverenPreview },
      { id: 'param-windverband', name: 'Windverband', parametricId: 'windverband', svg: windverbandPreview },
      { id: 'param-scharnier-verbinding', name: 'Scharnierverbinding', parametricId: 'scharnier-verbinding', svg: scharnierVerbindingPreview },
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
  {
    // Bouwplaats-inrichting (#338): kraan met zwenkstraal, draaicirkel,
    // parkeervak en bouwkeet — parametrisch, op ware maat via de
    // tekeningschaal (realSizeMm).
    id: 'nl-bouwplaats',
    builtin: true,
    name: 'NL Bouwplaats',
    industry: 'aec',
    country: 'nl',
    color: 'var(--theme-text, #000000)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="9" r="6" stroke-dasharray="2.5 2"/><line x1="8" y1="9" x2="14" y2="9"/><rect x="6.7" y="7.7" width="2.6" height="2.6"/></svg>`,
    symbols: [
      { id: 'param-bouwkraan', name: 'Bouwkraan (zwenkstraal)', parametricId: 'bouwkraan', svg: bouwkraanPreview },
      { id: 'param-draaicirkel', name: 'Draaicirkel vrachtwagen', parametricId: 'draaicirkel', svg: draaicirkelPreview },
      { id: 'param-parkeervak', name: 'Parkeervak', parametricId: 'parkeervak', svg: parkeervakPreview },
      { id: 'param-bouwkeet', name: 'Bouwkeet', parametricId: 'bouwkeet', svg: bouwkeetPreview },
    ],
  },
  {
    // Sanitair (#478): closets en fonteinen op werkelijke maat, de wandzijde
    // boven; draaien met de draaigreep, maten in het eigenschappenpaneel.
    id: 'nl-sanitair',
    builtin: true,
    name: 'NL Sanitair',
    industry: 'aec',
    country: 'nl',
    color: 'var(--theme-text, #000000)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2h8v4a4 7 0 0 1-8 0z"/></svg>`,
    symbols: [
      { id: 'param-wandcloset', name: 'Wandcloset', parametricId: 'wandcloset', svg: wandclosetPreview },
      { id: 'param-staand-closet', name: 'Staand closet', parametricId: 'staand-closet', svg: staandClosetPreview },
      { id: 'param-fontein', name: 'Fontein', parametricId: 'fontein', svg: fonteinPreview },
      { id: 'param-hoekfontein', name: 'Hoekfontein', parametricId: 'hoekfontein', svg: hoekfonteinPreview },
    ],
  },
  {
    // Keuken (#478): een keukenblok is één symbool — het blad met de
    // onderdelen erin (spoelbak, kookplaat, vaatwasser, koelkast, hoge kast).
    id: 'nl-keuken',
    builtin: true,
    name: 'NL Keuken',
    industry: 'aec',
    country: 'nl',
    color: 'var(--theme-text, #000000)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="4.5" width="13" height="7"/><circle cx="5" cy="8" r="1.6"/><circle cx="11" cy="8" r="1.6"/></svg>`,
    symbols: [
      { id: 'param-aanrecht', name: 'Aanrecht (strekkende meter)', parametricId: 'aanrecht', svg: aanrechtPreview },
      { id: 'param-aanrecht-hoek', name: 'Aanrecht hoekopstelling (L)', parametricId: 'aanrecht-hoek', svg: aanrechtHoekPreview },
      { id: 'param-kookeiland', name: 'Kookeiland', parametricId: 'kookeiland', svg: kookeilandPreview },
    ],
  },
];
