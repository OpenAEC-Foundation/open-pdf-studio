// Het vooraf ingevulde onderwerp geldt in deze sessie voor nieuwe annotaties
// van hetzelfde tekengereedschap. Bij metingen geldt dat ook voor de meetnaam.

import { onderwerpVeld } from './onderwerp.js';
const wachtend = new Map();

const isMeting = (type) => typeof type === 'string' && type.startsWith('measure');

export function isLabelVeld(type, key) {
  if (key === 'subject') return isMeting(type) || onderwerpVeld(type) === 'pdfSubject' || type === 'textbox' || type === 'callout';
  return key === 'measureName' && isMeting(type);
}

export function zetLabelVooraf(type, key, value) {
  if (!isLabelVeld(type, key)) return;
  const velden = { ...(wachtend.get(type) || {}) };
  const tekst = typeof value === 'string' ? value.trim() : '';
  const veld = key === 'subject' ? onderwerpVeld(type) : key;
  if (tekst) velden[veld] = tekst; else delete velden[veld];
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
