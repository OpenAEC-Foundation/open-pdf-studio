// Break points for long ribbon labels.
//
// A label is two lines at most and never breaks in the middle of a word, so a
// long compound word ("Schermafbeelding") did not fit and was shown in a
// smaller font than its neighbours. With a soft hyphen at the joint of the
// compound it wraps as "Scherm-" / "afbeelding" in the normal font size. The
// soft hyphen is only added to what is shown: the translation itself stays
// clean, so searching and tooltips are not affected.
//
// Per language a list of compounds with "|" at each joint. A word that is not
// listed is left alone and shrinks as before (autoShrinkLabel.js).

const ZACHT = '­';

const LIJSTEN = {
  nl: [
    'scherm|afbeelding', 'eigen|schappen', 'eigenschappen|paneel', 'gereedschaps|palet',
    'navigatie|paneel', 'annotatie|lijst', 'bestands|koppeling', 'bestands|koppelingen',
    'beeld|bewerking', 'hand|tekening', 'hand|tekeningen', 'hoeveel|heden', 'markerings|lagen',
    'pagina|formaat', 'pagina|weergave', 'pagina|volgorde', 'patroon|rechthoek', 'proeflees|modus',
    'schaal|gebied', 'schaal|kalibratie', 'scheidings|lijn', 'snel|toetsen', 'standaard|indeling',
    'teken|instellingen', 'tekst|document', 'vector|knipsel', 'vergelijkings|rapport',
    'wijzigingen|lijst', 'zichtbaar|heid', 'toegankelijk|heid', 'symbool|type', 'symbool|bibliotheek',
    'systeem|typen', 'water|merken', 'werk|ruimten', 'verwijs|lijn', 'lijn|breedte', 'lijn|dekking',
    'lijn|tekening', 'grijs|waarden', 'samen|voegen', 'interface|grootte', 'brand|beveiliging',
    'nood|verlichting', 'stop|contacten', 'hand|gereedschap', 'installatie|techniek',
    'elektro|techniek', 'stijl|hulp|middelen', 'hulp|middelen', 'voor|instelling', 'meet|schalen',
    'licht|sterkte', 'pixel|afstand', 'staven|reeks', 'warmte|afvoer', 'blus|systemen',
    'toets|aanslagen', 'tekening|kader', 'structuur|tags',
  ],
};

const tabellen = new Map();
function tabel(taal) {
  const kort = String(taal || '').toLowerCase().split('-')[0];
  if (!tabellen.has(kort)) {
    tabellen.set(kort, new Map((LIJSTEN[kort] || []).map((w) => [w.replaceAll('|', ''), w])));
  }
  return tabellen.get(kort);
}

/** One word with soft hyphens at its joints; the letters keep their case. */
function breekWoord(woord, t) {
  const patroon = t.get(woord.toLowerCase());
  if (!patroon) return woord;
  let uit = '';
  let i = 0;
  for (const teken of patroon) {
    if (teken === '|') uit += ZACHT;
    else uit += woord[i++];
  }
  return uit;
}

/**
 * The label with soft hyphens in the compounds known for this language.
 * Text that is not a string, and languages without a list, come back as is.
 */
export function metAfbreekpunten(tekst, taal) {
  if (typeof tekst !== 'string' || !tekst) return tekst;
  const t = tabel(taal);
  if (!t.size) return tekst;
  // Letters (with their accents) form a word; everything else stays in place.
  return tekst.replace(/\p{L}+/gu, (woord) => breekWoord(woord, t));
}
