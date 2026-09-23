// Gastheer-kant van de demo: een PDF aanreiken, de gebeurtenissen tonen, en de
// teruggegeven bytes opvangen. Verder doet deze pagina niets — dat is precies
// het punt van de web-unit.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const unit = document.getElementById('unit');
const log = document.getElementById('log');
const uitkomst = document.getElementById('uitkomst');
const download = document.getElementById('download');

function schrijf(regel) {
  log.textContent += regel + '\n';
  log.scrollTop = log.scrollHeight;
}

for (const naam of ['opds:geladen', 'opds:gewijzigd', 'opds:opgeslagen', 'opds:fout']) {
  unit.addEventListener(naam, (e) => {
    const d = { ...e.detail };
    if (d.bytes) d.bytes = d.bytes.length + ' bytes';
    schrijf(naam + '  ' + JSON.stringify(d));
    if (naam === 'opds:geladen') {
      uitkomst.textContent = `${d.paginas} pagina('s), ${Math.round(d.breedtePt)} x ${Math.round(d.hoogtePt)} pt`
        + (d.schaal ? `, schaal 1:${Math.round(d.schaal.noemer)}` : ', geen schaal');
    }
  });
}

/**
 * Een voorbeeldtekening maken zodat de demo geen bestand uit de repo nodig
 * heeft. A3 liggend, met een maatlijn van precies 200 pt als ijkmaat.
 */
async function voorbeeldtekening() {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([1191, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pagina.drawRectangle({ x: 20, y: 20, width: 1151, height: 802, borderWidth: 1, borderColor: rgb(0.2, 0.2, 0.2) });
  pagina.drawText('Voorbeeldtekening web-unit', { x: 40, y: 780, size: 18, font });
  pagina.drawText('De dikke lijn hieronder is precies 200 pt lang.', { x: 40, y: 755, size: 11, font });
  pagina.drawLine({ start: { x: 200, y: 600 }, end: { x: 400, y: 600 }, thickness: 2, color: rgb(0, 0, 0) });
  for (let i = 0; i < 8; i++) {
    pagina.drawRectangle({
      x: 200 + i * 90, y: 200, width: 60, height: 300,
      borderWidth: 0.75, borderColor: rgb(0.35, 0.35, 0.35),
    });
  }
  return new Uint8Array(await doc.save());
}

document.getElementById('voorbeeld').addEventListener('click', async () => {
  const bytes = await voorbeeldtekening();
  window.__demoBron = bytes;
  await unit.laad(bytes);
});

document.getElementById('kiezer').addEventListener('change', async (e) => {
  const bestand = e.target.files?.[0];
  if (!bestand) return;
  await unit.laad(new Uint8Array(await bestand.arrayBuffer()));
});

document.getElementById('zetSchaal').addEventListener('click', () => {
  unit.meetschaal = document.getElementById('schaal').value;
  schrijf('gastheer: schaal gezet op ' + document.getElementById('schaal').value);
});

document.getElementById('opslaan').addEventListener('click', async () => {
  const bytes = await unit.opslaan();
  window.__laatsteBytes = bytes;
  uitkomst.textContent = `teruggekregen: ${bytes.length} bytes, ${unit.annotaties().length} annotatie(s)`;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  download.href = url;
  download.download = 'web-unit.pdf';
  download.hidden = false;
});

// Haakjes voor de playwright-controle: dezelfde weg als een gebruiker, maar
// zonder muis.
window.__demo = {
  kiesGereedschap: (soort) => unit.kiesGereedschap(soort),
  annotaties: () => unit.annotaties(),
  laadVoorbeeld: async () => { const b = await voorbeeldtekening(); await unit.laad(b); return b.length; },
};
