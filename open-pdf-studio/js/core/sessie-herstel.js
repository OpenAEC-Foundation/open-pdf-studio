// Mag de vorige sessie terugkomen, en zo nee: waarom niet?
//
// Op het bureaublad bewaart de sessie PADEN; bij het starten staan die
// bestanden er nog en gaan ze gewoon weer open. In de browser bestaat zo'n pad
// niet. Een bestand komt daar binnen als bytes — via de bestandskiezer of een
// drop — en die bytes staan alleen in het geheugen van dat tabblad. Na een
// herlaadbeurt zijn ze weg. Namen bewaren zou tabbladen opleveren die nergens
// naar wijzen, en de bytes bewaren zou betekenen dat de documenten van de
// gebruiker ongevraagd in de browser blijven staan.
//
// De keuze (#456) is daarom: in de browser NIETS bewaren, en dat zeggen in
// plaats van stil niets te doen. restoreLastSession() keerde er eerder
// woordeloos terug, en de voorkeur "vorige sessie herstellen" stond aan
// zonder ooit iets te doen.

/** Vertaalsleutel van de uitleg in de lege weergave en bij de voorkeur. */
export const WEB_SESSIE_SLEUTEL = 'webSessionStartsEmpty';

/**
 * @param {object} o
 * @param {boolean} o.inTauri     bureaubladschil aanwezig?
 * @param {boolean} o.voorkeurAan staat "vorige sessie herstellen" aan?
 * @param {boolean} [o.inDev]     Vite-dev herlaadt bij elke bewerking; daar
 *   moet het testdocument sowieso terugkomen.
 * @returns {{herstellen: boolean, reden: 'bureaublad'|'dev'|'voorkeur-uit'|'geen-webopslag'}}
 */
export function sessieHerstelBeleid({ inTauri, voorkeurAan, inDev = false }) {
  // Zonder schil is er niets om te herstellen, ook niet in dev.
  if (!inTauri) return { herstellen: false, reden: 'geen-webopslag' };
  if (inDev) return { herstellen: true, reden: 'dev' };
  if (!voorkeurAan) return { herstellen: false, reden: 'voorkeur-uit' };
  return { herstellen: true, reden: 'bureaublad' };
}

/** Moet de gebruiker te horen krijgen dat een herlaadbeurt leeg begint? */
export function meldLegeStart({ inTauri }) {
  return !inTauri;
}
