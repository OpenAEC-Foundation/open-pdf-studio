// Datum en tijd voor de interface: "28-9-2026 06:47" in de taal van het
// systeem, zoals toLocaleDateString() en toLocaleTimeString() dat gaven.
//
// Die twee maken bij elke aanroep een nieuwe opmaak aan (~50 µs). De
// annotatielijst roept dit voor elke annotatie aan, bij elke hertekening: bij
// 1000 annotaties 33 tot 60 ms per keer. Twee vaste opmaken geven dezelfde
// tekst in een fractie daarvan.

const datum = new Intl.DateTimeFormat();
const tijd = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });

export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  // Een ongeldige datum: format() gooit, de oude weg gaf "Invalid Date".
  if (Number.isNaN(d.getTime())) {
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return datum.format(d) + ' ' + tijd.format(d);
}
