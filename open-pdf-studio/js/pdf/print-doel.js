// Het doel van de printdialoog: een printer, of "Opslaan als PDF".
//
// Een afdruk naar een PDF-stuurprogramma loopt door dat stuurprogramma: de app
// levert pixels aan, en het stuurprogramma bepaalt hoe het vel in het bestand
// komt (bij sommige een liggend vel als staand medium met gedraaide inhoud).
// Het doel "Opslaan als PDF" slaat dat over: de app schrijft de print-PDF zelf
// weg (print-vector.js), met het vel in de gekozen stand en tekst en lijnen
// als vectoren. Hier staan de pure regels rond dat doel. Geen DOM, geen state.

/**
 * De waarde van het doel "Opslaan als PDF" in de printerlijst en in de bewaarde
 * printinstellingen. Geen printernaam: de dubbele punt en de kleine letters
 * maken een botsing met een echte wachtrij onwaarschijnlijk, en de dialoog
 * toont er de vertaalde tekst bij.
 */
export const DOEL_PDF = 'opds:opslaan-als-pdf';

export function isPdfDoel(naam) {
  return naam === DOEL_PDF;
}

/** Pad op vaste vorm: schuine strepen één kant op, zonder `.` en `..`, kleine letters. */
function vastePadVorm(pad) {
  const delen = [];
  for (const deel of String(pad).replace(/\\/g, '/').split('/')) {
    if (deel === '.' || (deel === '' && delen.length > 0)) continue;
    if (deel === '..' && delen.length > 1) delen.pop();
    else delen.push(deel);
  }
  return delen.join('/').toLowerCase();
}

/**
 * Wijzen twee paden hetzelfde bestand aan? Ongeacht hoofdletters (Windows en
 * macOS maken daar geen verschil in; op Linux is te streng hier veilig: het
 * gaat om niet overschrijven) en de richting van de schuine strepen.
 */
export function zelfdeBestand(a, b) {
  if (!a || !b) return false;
  return vastePadVorm(a) === vastePadVorm(b);
}

/**
 * Is `pad` een bestand dat in de app open staat? Het bestand zelf
 * (`saveTargetPath`, of `filePath` zonder werkkopie) of de werkkopie waaruit
 * het getoond wordt (`filePath`). Daar mag de print-PDF niet overheen.
 * @param {string} pad
 * @param {Array<{filePath?:string, saveTargetPath?:string}|null>} documenten
 */
export function doelIsGeopend(pad, documenten) {
  if (!pad) return false;
  return (documenten || []).some((d) => d
    && (zelfdeBestand(pad, d.filePath) || zelfdeBestand(pad, d.saveTargetPath)));
}

function schoneNaam(naam) {
  const kaal = String(naam || '')
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return kaal || 'document';
}

/**
 * Het pad dat het opslaan-venster voorstelt: naast het document, met
 * `achtervoegsel` vóór `.pdf` ("Tekening - afdruk.pdf"). Een naamloos document
 * staat in een tijdelijk bestand: dan de tabbladnaam in `map` (of alleen de
 * naam). Nooit het geopende bestand zelf: zonder achtervoegsel komt er " (2)"
 * achter.
 */
export function standaardDoelPad(doc, map, achtervoegsel = '') {
  const echt = doc && !doc.isUntitled ? (doc.saveTargetPath || doc.filePath) : null;
  const staart = achtervoegsel || (echt ? ' (2)' : '');
  if (echt) {
    const snede = Math.max(echt.lastIndexOf('/'), echt.lastIndexOf('\\'));
    const basis = echt.slice(0, snede + 1);
    return `${basis}${schoneNaam(echt.slice(snede + 1))}${staart}.pdf`;
  }
  const naam = `${schoneNaam(doc?.fileName)}${staart}.pdf`;
  if (!map) return naam;
  const sep = map.includes('\\') ? '\\' : '/';
  return /[\\/]$/.test(map) ? `${map}${naam}` : `${map}${sep}${naam}`;
}

/**
 * Schrijft deze printer naar een bestand in plaats van naar papier? Te zien
 * aan wat de printerlijst al meldt, zonder de printer aan te spreken:
 * - de poort vraagt om een bestandsnaam (`PORTPROMPT:`, `FILE:`) of is zelf
 *   een pad naar een bestand;
 * - de naam van het stuurprogramma bevat "PDF" of "XPS" als los woord.
 * De naam van de printer zelf telt niet: een wachtrij mag heten zoals ze wil.
 * De printdialoog wijst bij zo'n printer op "Opslaan als PDF".
 * @param {{DriverName?:string, PortName?:string}|null} printer
 */
export function isBestandsPrinter(printer) {
  if (!printer || typeof printer !== 'object') return false;
  const poort = typeof printer.PortName === 'string' ? printer.PortName.trim() : '';
  if (/^(portprompt|file):$/i.test(poort)) return true;
  // Een pad: stationsletter of UNC, met een bestandsnaam met extensie.
  if (/^([a-z]:[\\/]|\\\\)/i.test(poort) && /\.[a-z0-9]{2,5}$/i.test(poort)) return true;
  const driver = typeof printer.DriverName === 'string' ? printer.DriverName : '';
  return /(^|[^a-z0-9])(pdf|xps)([^a-z0-9]|$)/i.test(driver);
}
