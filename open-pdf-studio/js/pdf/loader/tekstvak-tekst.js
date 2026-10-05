// De tekst van een ingelezen tekstvak (FreeText).
//
// De regels uit de appearance (PDF.js textContent) zijn wat de schrijver liet
// zien, maar zonder witregels tussen alinea's en met een harde afbreking op
// elke zichtbare regelgrens. /Contents bewaart de tekst zoals hij getypt is
// (\r\r tussen alinea's). Die gaat voor zolang hij, op witruimte na, dezelfde
// tekens bevat als de appearance; een verouderde /Contents (tekst aangepast
// zonder dat /Contents meeging) laat de appearance leidend. /RC telt hier
// niet mee: de opmaakwitruimte van andere programma's daarin is niet
// betrouwbaar van tekst te onderscheiden.

import { toWinAnsiText } from '../saver/pdf-text.js';

const zonderWit = (s) => String(s ?? '').replace(/\s+/g, '');
const regels = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');

/**
 * @param {{appearanceTekst?: string, contents?: string}} bronnen
 * @returns {string}
 */
export function kiesTekstvakTekst({ appearanceTekst = '', contents = '' } = {}) {
  const getoond = zonderWit(appearanceTekst);
  // Zonder appearance-tekst is er niets om tegen te toetsen.
  const klopt = (s) => !getoond || zonderWit(s) === getoond || zonderWit(toWinAnsiText(s)) === getoond;
  // Voorloopspaties die de appearance op geen enkele regel toont, horen niet
  // bij wat de schrijver liet zien (bv. ' Bouwbedrijf' in /Contents).
  const zonderInspringing = appearanceTekst && !/^[ \t]/m.test(appearanceTekst)
    ? (s) => s.replace(/^[ \t]+/gm, '') : (s) => s;

  if (zonderWit(contents) && klopt(contents)) return zonderInspringing(regels(contents));
  return appearanceTekst || regels(contents);
}

/**
 * Dezelfde regel als in kiesTekstvakTekst voor de runs van gemengde opmaak:
 * toont de appearance op geen enkele regel voorloopwit, dan gaat het ook van
 * het begin van elke runregel af. Anders komen de runs ongewijzigd terug.
 */
export function runsZonderInspringing(regelRuns, appearanceTekst) {
  if (!appearanceTekst || /^[ \t]/m.test(appearanceTekst) || !Array.isArray(regelRuns)) return regelRuns;
  return regelRuns.map((regel) => {
    const uit = [];
    let begin = true;
    for (const run of regel || []) {
      const tekst = begin ? String(run.text ?? '').replace(/^[ \t]+/, '') : run.text;
      if (begin && !tekst) continue;
      begin = false;
      uit.push(tekst === run.text ? run : { ...run, text: tekst });
    }
    return uit;
  });
}
