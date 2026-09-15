// ── Vul-alfa van het eerste vlak in een appearance-stream (pure helper) ──
//
// Een appearance kan meerdere graphics-states met een verschillende /ca
// activeren. Een meetvlak zet bijvoorbeeld het vlak op 30% en het maatlabel in
// een eigen graphics-state op 100%. Eén getal voor "de" vul-alfa van zo'n
// annotatie is dan de alfa die geldt bij de eerste vul-operator: dat is het
// lichaam van de vorm. Labels en platen worden daarna, eroverheen, getekend.
//
// Puur (geen pdf-lib, geen DOM) zodat het unit-testbaar is.

import { tokenizeContentStream } from '../../text/content-stream-text.js';

// Pad-operatoren die vullen: f, F en f* vullen; B, B*, b en b* vullen en lijnen.
const VUL_OPERATOREN = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);

/**
 * @param {string} content  gedecodeerde content-stream van de appearance
 * @param {Map<string, number>} vulAlfaPerNaam  ExtGState-naam → /ca, alleen voor
 *   graphics-states die /ca ook echt zetten
 * @returns {number|null} de /ca die bij de eerste vul-operator geldt; null als er
 *   geen vul-operator is of als het eerste vlak op de standaard-alfa staat
 */
export function fillAlphaAtFirstFill(content, vulAlfaPerNaam) {
  if (!content || !vulAlfaPerNaam) return null;
  let tokens;
  try {
    tokens = tokenizeContentStream(content);
  } catch (_) {
    return null;
  }
  const stapel = [];
  let ca = null; // null = standaard-graphics-state, nog geen /ca gezet
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t !== 'op') continue;
    if (tk.v === 'q') {
      stapel.push(ca);
    } else if (tk.v === 'Q') {
      if (stapel.length > 0) ca = stapel.pop();
    } else if (tk.v === 'gs') {
      const naam = tokens[i - 1];
      if (naam && naam.t === 'name' && vulAlfaPerNaam.has(naam.v)) ca = vulAlfaPerNaam.get(naam.v);
    } else if (VUL_OPERATOREN.has(tk.v)) {
      return ca;
    }
  }
  return null;
}
