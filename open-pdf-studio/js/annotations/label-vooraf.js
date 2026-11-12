// Het label van een meting vooraf instellen (#1055). Wat de gebruiker bij het
// actieve meetgereedschap als onderwerp of naam invult, gaat mee naar de
// volgende metingen van die soort. Het geldt voor deze sessie: een label hoort
// bij het werk van nu, niet bij de opgeslagen stijl van het gereedschap.

const LABEL_VELDEN = ['subject', 'measureName'];
const wachtend = new Map(); // soort meting → { subject?, measureName? }

const isMeting = (type) => typeof type === 'string' && type.startsWith('measure');

export function isLabelVeld(type, key) {
  return isMeting(type) && LABEL_VELDEN.includes(key);
}

export function zetLabelVooraf(type, key, value) {
  if (!isLabelVeld(type, key)) return;
  const velden = { ...(wachtend.get(type) || {}) };
  const tekst = typeof value === 'string' ? value.trim() : '';
  if (tekst) velden[key] = tekst; else delete velden[key];
  if (Object.keys(velden).length) wachtend.set(type, velden); else wachtend.delete(type);
}

export function labelVooraf(type) {
  return { ...(wachtend.get(type) || {}) };
}

// Eigenschappen voor een nieuwe annotatie, aangevuld met het vooraf ingestelde
// label. Wat het gereedschap zelf al invult blijft staan.
export function metLabelVooraf(props) {
  const velden = props && wachtend.get(props.type);
  if (!velden) return props;
  const uit = { ...props };
  for (const [key, value] of Object.entries(velden)) {
    if (!uit[key]) uit[key] = value;
  }
  return uit;
}

export function wisLabelVooraf() {
  wachtend.clear();
}
