// Palettecategorie GD&T en bewerking (#971): vorm- en plaatstoleranties
// (ISO 1101 / ASME Y14.5), referentie-element, materiaalvoorwaarden,
// oppervlaktegesteldheid (ISO 1302) en maattekens voor gaten (verzinking,
// verzinkboring, diepte, diameter, vierkant, boldiameter).
//
// De tekens zijn statische vector-stempels; de geometrie staat één keer in
// symbols/templates/gdt.js en geeft zowel deze stempels als de kenmerk-cel van
// het parametrische kenmerkkader. Het kenmerkkader zelf is parametrisch: kenmerk,
// tolerantie, materiaalvoorwaarde en referenties zijn velden in het
// eigenschappenvenster.
//
// Geen industry/country-metadata: de tekens zijn internationaal en blijven bij
// elke sector- en landkeuze zichtbaar (uit te zetten in de bibliotheekinstellingen).
import { GDT_KENMERKEN, GDT_AANVULLEND, BEWERKING_SYMBOLEN, gdtSvg } from '../../symbols/templates/gdt.js';

const naam = (s) => (s.name.toLowerCase() === s.nameEn.toLowerCase() ? s.name : `${s.name} (${s.nameEn.toLowerCase()})`);
const stempel = (s) => ({ id: `gdt-${s.id}`, name: naam(s), svg: gdtSvg(s.geo) });

const kenmerkkaderPreview = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#000" stroke-width="2"><path d="M3 22H61V42H3Z"/><path d="M23 22V42M47 22V42"/><circle cx="13" cy="32" r="5"/><path d="M13 25V39M6 32H20"/></g><text x="35" y="36" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#000">0.1</text><text x="54" y="36" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#000">A</text></svg>`;

export const GDT_CATEGORIES = [
  {
    id: 'gdt-bewerking',
    name: 'GD&T en bewerking',
    builtin: true,
    color: 'var(--theme-text, #000000)',
    icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="4.5" width="13" height="7"/><path d="M6 4.5v7"/><circle cx="3.75" cy="8" r="1.4"/></svg>`,
    symbols: [
      { id: 'param-gdt-kenmerkkader', name: 'Kenmerkkader (feature control frame)', parametricId: 'gdt-kenmerkkader', svg: kenmerkkaderPreview },
      ...GDT_KENMERKEN.map(stempel),
      ...GDT_AANVULLEND.map(stempel),
      ...BEWERKING_SYMBOLEN.map(stempel),
    ],
  },
];
