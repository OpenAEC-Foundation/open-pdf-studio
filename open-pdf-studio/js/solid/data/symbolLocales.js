// Centrale lokalisatie-metadata voor de symboolbibliotheek.
//
// Elke ingebouwde categorie kan optioneel een `industry` (bv. 'aec') en een
// `country` (bv. 'nl') dragen. De Symbol Library Settings biedt hierop een
// Industrie- en Land-selectie; de palette filtert mee. Uitbreiden = alleen
// een regel toevoegen aan INDUSTRIES / COUNTRIES en de metadata op de
// categorieën zetten. YAGNI: voorlopig alleen AEC + NL.

export const INDUSTRIES = [
  { id: 'aec', name: 'AEC (Bouw)' },
];

export const COUNTRIES = [
  { id: 'nl', name: 'Nederland', flag: '🇳🇱' },
];

// Standaardselectie bij een verse installatie.
export const DEFAULT_INDUSTRY = 'aec';
export const DEFAULT_COUNTRY = 'nl';

export function industryName(id) {
  return INDUSTRIES.find(i => i.id === id)?.name || id;
}

export function countryName(id) {
  return COUNTRIES.find(c => c.id === id)?.name || id;
}

// Filter-regel voor de settings/palette:
//   Een categorie hoort bij de gekozen industrie+land als haar metadata
//   matcht. Categorieën ZONDER industry/country-metadata ("Overig")
//   blijven ALTIJD zichtbaar — zo verdwijnt niets onverwacht en werken
//   custom/legacy-groepen die (nog) geen lokalisatie hebben gewoon door.
//   De metadata mag een string zijn (ingebouwd/custom) of een ARRAY
//   (gedownloade online-collecties gelden vaak voor meerdere landen en
//   sectoren tegelijk; de tags groeien mee per download).
function tagMatches(tag, selected) {
  return Array.isArray(tag) ? tag.includes(selected) : tag === selected;
}

export function matchesLocale(cat, industry, country) {
  const hasIndustry = cat.industry != null && (!Array.isArray(cat.industry) || cat.industry.length > 0);
  const hasCountry = cat.country != null && (!Array.isArray(cat.country) || cat.country.length > 0);
  // Geen enkele lokalisatie-metadata → altijd tonen ("Overig").
  if (!hasIndustry && !hasCountry) return true;
  if (hasIndustry && !tagMatches(cat.industry, industry)) return false;
  if (hasCountry && !tagMatches(cat.country, country)) return false;
  return true;
}

// Built-in categories carry a Dutch name in their data file; the palette
// header follows the app language (#882). Custom and downloaded groups keep
// the name the user or the library gave them.
export function categoryLabel(t, cat) {
  if (!cat?.builtin) return cat?.name;
  return t(`symbolPalette.categories.${cat.id}`, { defaultValue: cat.name });
}
