// Centrale standaard-plaatsingsgroottes voor stempels (app-annotatie-
// coördinaten, scale=1). Deze waarden gelden ALLEEN bij het plaatsen van een
// NIEUW stempel; bestaande, reeds geplaatste stempels blijven ongewijzigd en
// de gebruiker kan na plaatsing vrij schalen/slepen.
//
// Aspect-verhouding per stempel blijft behouden.

// Symbool-/bibliotheek-stempels (SymbolPalette selectSymbol -> toolOverrides ->
// placeOverrideStamp), het pad dat de stempels van ALLE taalgebieden gebruiken.
//
// Een stempel uit het palet is een ANNOTATIESYMBOOL (brandveiligheid,
// elektra, GD&T, ...): op papier altijd even groot, los van de tekeningschaal,
// zoals tekst (#983). De hoogte staat daarom in papiermillimeters; de
// omrekening naar paginaeenheden rekent met de /UserUnit van de pagina
// (svg-real-size.js). Een vaste maat in paginapunten (eerst 40, later 400 =
// 141 mm papier) kwam op een A3-plattegrond 1:50 als blok van zeven meter
// binnen. Symbolen op werkelijke maat (staalprofielen, palen, meubilair) zijn
// parametrische symbolen met een realSizeMm (symbols/real-size.js), of een
// SVG die zelf een echte maat declareert; die volgen wel de tekeningschaal.
export const SYMBOL_PAPER_HEIGHT_MM = 10;

// Ingebouwde tekst-stempels (APPROVED, DRAFT, ...) via de stamp-picker.
// Was 160x50, nu 10x = 1600x500.
export const BUILTIN_STAMP_DEFAULT_WIDTH = 1600;
export const BUILTIN_STAMP_DEFAULT_HEIGHT = 500;

// Fallback-hoogte voor override-stempels zonder expliciete grootte
// (bv. extensie-stempels). Was 80, nu 10x = 800. Breedte volgt uit aspect.
export const OVERRIDE_STAMP_DEFAULT_HEIGHT = 800;

// Ingebouwde tekststempels: naam, kleur en tekst.
export const BUILT_IN_STAMPS = [
  { name: 'Approved', color: '#22c55e', text: 'APPROVED' },
  { name: 'Rejected', color: '#ef4444', text: 'REJECTED' },
  { name: 'Draft', color: '#3b82f6', text: 'DRAFT' },
  { name: 'Confidential', color: '#ef4444', text: 'CONFIDENTIAL' },
  { name: 'Final', color: '#22c55e', text: 'FINAL' },
  { name: 'For Review', color: '#f59e0b', text: 'FOR REVIEW' },
  { name: 'Not Approved', color: '#ef4444', text: 'NOT APPROVED' },
  { name: 'Void', color: '#6b7280', text: 'VOID' },
  { name: 'As Is', color: '#6b7280', text: 'AS IS' },
  { name: 'Revised', color: '#8b5cf6', text: 'REVISED' }
];
