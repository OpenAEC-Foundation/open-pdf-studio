// Toetsen van een voet-inchmaat in de directe lengte-invoer (#1145).
//
// De invoer tijdens het tekenen is een toetsenbuffer, geen tekstveld: elke
// toets wordt apart aangenomen of geweigerd (type-length-input.js). Naast
// cijfers en de punt heeft `12'-6 3/8"` het voetteken, het inchteken, een
// spatie, een schuine streep en het streepje na de voet nodig. Hier staat
// alleen WELKE toets op welke plek mag; het lezen van de maat zelf doet de
// ene parser in core/voet-inch.js.

const EINDIGT_OP_CIJFER = /\d$/;

/**
 * Mag deze toets achter het veld dat nu getypt wordt?
 * @param {string} veld  de tekst van het huidige veld (na de laatste , < =)
 * @param {string} key   KeyboardEvent.key
 * @returns {boolean}
 */
export function magVoetInchTeken(veld, key) {
  const v = String(veld ?? '');
  switch (key) {
    // 12' — één keer, na een getal, en niet meer na het inchteken.
    case "'": return EINDIGT_OP_CIJFER.test(v) && !/['"]/.test(v);
    // 6" — één keer, na een getal.
    case '"': return EINDIGT_OP_CIJFER.test(v) && !v.includes('"');
    // 6 3/8 en 12' 6: een spatie na een cijfer of na de voet.
    case ' ': return /[\d']$/.test(v) && !v.includes('"');
    // 3/8 — één breukstreep, na een cijfer.
    case '/': return EINDIGT_OP_CIJFER.test(v) && !v.includes('/') && !v.includes('"');
    // 12'-6 en 12'-6-3/8: het streepje na de voet, of voor de breuk.
    case '-': return /'$/.test(v) || (EINDIGT_OP_CIJFER.test(v) && v.includes("'") && !v.includes('/') && !/'.*-.*-/.test(v));
    default: return false;
  }
}
