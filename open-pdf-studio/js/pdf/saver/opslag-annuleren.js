// Een lopende save annuleren (#766).
//
// Eén annulering per save. De saver controleert haar op veilige punten:
// tussen de fasen (inlezen, pagina's, tekstbewerkingen, OCR-laag, watermerken,
// opruimen, serialiseren) en in de lange lussen (per pagina, per partij
// annotaties, per partij objecten bij het opruimen). Op zo'n punt gooit een
// geannuleerde save OpslagGeannuleerd; er is dan nog niets naar het doel
// geschreven en het model is niet als opgeslagen gemarkeerd.
//
// Het punt zonder terugkeer is het hernoemen van het tijdelijke bestand over
// het doel (src-tauri/src/atomic_file.rs). Daarna legt de saver de annulering
// vast (`vastleggen`): de knop gaat uit en een te laat Annuleren verandert
// niets meer; de save meldt zich dan gewoon als opgeslagen, zonder
// terugdraaien.
//
// Een synchrone lus kan geen klik zien: `punt()` geeft de event-loop daarom
// af en toe ruimte (standaard na 50 ms rekenen), zodat Annuleren en Esc
// tussendoor binnenkomen. Klok en pauze zijn te vervangen in tests.

export const OPSLAG_GEANNULEERD = 'opds-save-cancelled';
/** De foutcode van het Rust-schrijfcommando bij een geannuleerde schrijfactie. */
export const SCHRIJVEN_GEANNULEERD = 'opds-write-cancelled';

export class OpslagGeannuleerd extends Error {
  constructor() {
    super('Save cancelled');
    this.name = 'AbortError';
    this.code = OPSLAG_GEANNULEERD;
  }
}

/** Een geannuleerde save, ook als de schrijfopdracht in Rust haar afbrak. */
export function isOpslagGeannuleerd(fout) {
  if (!fout) return false;
  if (fout.code === OPSLAG_GEANNULEERD) return true;
  return String(fout?.message ?? fout).includes(SCHRIJVEN_GEANNULEERD);
}

const echtePauze = () => new Promise((r) => setTimeout(r, 0));

/**
 * @param {{nu?: () => number, pauze?: () => Promise<void>, pauzeNaMs?: number}} [opties]
 */
export function maakOpslagAnnulering({ nu = () => Date.now(), pauze = echtePauze, pauzeNaMs = 50 } = {}) {
  /** 'bezig' | 'geannuleerd' | 'vastgelegd' */
  let status = 'bezig';
  let teLaat = false;
  let laatstePauze = nu();
  const luisteraars = new Set();
  let wijs = null;
  const afbreking = new Promise((_, reject) => { wijs = reject; });
  afbreking.catch(() => {});

  const meld = () => { for (const fn of [...luisteraars]) { try { fn(status); } catch (e) { console.warn('[save] cancel listener failed:', e); } } };

  const api = {
    get geannuleerd() { return status === 'geannuleerd'; },
    get vastgelegd() { return status === 'vastgelegd'; },
    /** Annuleren kan nog (de knop staat aan). */
    get kanAnnuleren() { return status === 'bezig'; },
    /** Er werd geannuleerd nadat het bestand al vervangen was. */
    get teLaat() { return teLaat; },
    /** @returns {boolean} of de annulering nog op tijd was */
    annuleer() {
      if (status === 'vastgelegd') { teLaat = true; return false; }
      if (status !== 'bezig') return false;
      status = 'geannuleerd';
      wijs(new OpslagGeannuleerd());
      meld();
      return true;
    },
    /**
     * Het punt zonder terugkeer. `naSchrijven`: het bestand is al vervangen;
     * een annulering die tijdens het schrijven kwam, was dus te laat.
     * Zonder `naSchrijven` gooit een al geannuleerde save hier.
     */
    vastleggen({ naSchrijven = false } = {}) {
      if (status === 'vastgelegd') return;
      if (status === 'geannuleerd') {
        if (!naSchrijven) throw new OpslagGeannuleerd();
        teLaat = true;
      }
      status = 'vastgelegd';
      meld();
    },
    /** Gooit OpslagGeannuleerd als er geannuleerd is. */
    controleer() {
      if (status === 'geannuleerd') throw new OpslagGeannuleerd();
    },
    /** Een veilig punt in een lange lus: controleren en af en toe de event-loop ruimte geven. */
    async punt() {
      api.controleer();
      if (nu() - laatstePauze >= pauzeNaMs) {
        await pauze();
        laatstePauze = nu();
        api.controleer();
      }
    },
    /**
     * Wacht op `belofte`, maar stop meteen bij annuleren. Het werk zelf loopt
     * dan door tot het klaar is; de uitkomst wordt genegeerd.
     */
    async wacht(belofte) {
      api.controleer();
      const p = Promise.resolve(belofte);
      p.catch(() => {});
      const uit = await Promise.race([p, afbreking]);
      api.controleer();
      return uit;
    },
    /** @returns {() => void} afmelden */
    opWijziging(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },
  };
  return api;
}

/** Voor een save die niet te annuleren is (herstelmomentopname). */
export const GEEN_ANNULERING = Object.freeze({
  geannuleerd: false,
  vastgelegd: false,
  kanAnnuleren: false,
  teLaat: false,
  annuleer: () => false,
  vastleggen() {},
  controleer() {},
  async punt() {},
  wacht: (belofte) => belofte,
  opWijziging: () => () => {},
});
