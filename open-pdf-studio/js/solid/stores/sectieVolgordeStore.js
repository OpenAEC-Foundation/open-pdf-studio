// Volgorde van de secties in het eigenschappenpaneel (#967). De gebruiker
// sleept een sectiekop (of Alt+pijl omhoog/omlaag op een kop met focus); de
// volgorde geldt voor elke soort annotatie en blijft na herstarten bewaard
// in de browseropslag. Het rekenwerk staat in sectie-volgorde.js.
import { createSignal, createMemo, createContext, createRoot } from 'solid-js';
import { leesOpslagJson, schrijfOpslagJson, verwijderOpslag } from '../../core/opslag.js';
import {
  voegVolgordeSamen, verplaatsNaast, verschuifZichtbaar, isStandaardVolgorde,
} from '../components/properties-panel/sectie-volgorde.js';

const OPSLAG_NAAM = 'propSectionOrder';

/** Sleutel van de verplaatsbare sectie waar een CollapsibleSection in staat. */
export const SectieContext = createContext(null);

const [standaard, setStandaard] = createSignal([]);
const [opgeslagen, setOpgeslagen] = createSignal((() => {
  const w = leesOpslagJson(OPSLAG_NAAM, null);
  return Array.isArray(w) ? w.filter(k => typeof k === 'string') : null;
})());

// Slepen: welke sectie, en waar hij zou landen ({ sleutel, erna }).
const [sleepSectie, setSleepSectie] = createSignal(null);
const [dropDoel, setDropDoel] = createSignal(null);
export { sleepSectie, dropDoel };

const _afgeleid = createRoot(() => ({
  volgorde: createMemo(() => voegVolgordeSamen(standaard(), opgeslagen())),
  isStandaard: createMemo(() => isStandaardVolgorde(opgeslagen(), standaard())),
}));

/** De volledige sectievolgorde (standaard aangevuld met wat de gebruiker koos). */
export const sectieVolgorde = _afgeleid.volgorde;
/** true als de gebruiker niets verplaatst heeft. */
export const sectieVolgordeIsStandaard = _afgeleid.isStandaard;

/** Het paneel meldt zijn standaardvolgorde (de sleutels in JSX-volgorde). */
export function zetStandaardSectieVolgorde(sleutels) {
  setStandaard([...sleutels]);
}

function bewaar(lijst) {
  setOpgeslagen(lijst);
  try { schrijfOpslagJson(OPSLAG_NAAM, lijst); } catch { /* quotum vol: geldt dan alleen deze sessie */ }
}

/** Sleep-einde of programmatisch: `sleutel` voor/na `doel`. */
export function verplaatsSectie(sleutel, doel, erna = false) {
  const nieuw = verplaatsNaast(sectieVolgorde(), sleutel, doel, erna);
  bewaar(nieuw);
}

/** Toetsenbord: een plek omhoog/omlaag tussen de zichtbare secties. */
export function verschuifSectie(sleutel, richting, zichtbaar) {
  bewaar(verschuifZichtbaar(sectieVolgorde(), sleutel, richting, zichtbaar));
}

/** Herstel de standaardvolgorde. */
export function herstelSectieVolgorde() {
  setOpgeslagen(null);
  verwijderOpslag(OPSLAG_NAAM);
}

export function beginSlepen(sleutel) { setSleepSectie(sleutel); setDropDoel(null); }
export function zetDropDoel(doel) { setDropDoel(doel); }
export function stopSlepen(uitvoeren) {
  const sleutel = sleepSectie();
  const doel = dropDoel();
  setSleepSectie(null);
  setDropDoel(null);
  if (uitvoeren && sleutel && doel && doel.sleutel !== sleutel) verplaatsSectie(sleutel, doel.sleutel, doel.erna);
}
