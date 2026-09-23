// De annotatielaag van de web-unit: een overlay-canvas boven de pagina waarop
// je meet, een opmerking plaatst of een vlak tekent.
//
// De annotaties leven in PAGINAPUNTEN met de oorsprong linksboven (zie
// `meten.js`), niet in beeldpunten. Zo blijven ze bij elke zoomstand hetzelfde
// en kunnen ze zonder omrekening naar `opslaan.js`.

import { meetAfstand } from './meten.js';

let _volgnummer = 0;
const nieuwId = () => 'wu-' + (++_volgnummer) + '-' + Math.random().toString(36).slice(2, 8);

export const GEREEDSCHAP_PER_SOORT = Object.freeze({
  measure: 'measureDistance',
  comment: 'note',
  shape: 'square',
});

export function maakAnnotatielaag({ canvas, onWijziging }) {
  const ctx = canvas.getContext('2d');
  let annotaties = [];
  let gereedschap = null;
  let schaal = 1;          // beeldpunten per paginapunt
  let meetschaal = null;
  let pagina = 1;
  let bezig = null;
  let opmerkingTekst = () => 'Opmerking';

  const naarPagina = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width) / schaal,
      y: (e.clientY - r.top) * (canvas.height / r.height) / schaal,
    };
  };

  function meld() {
    onWijziging?.(annotaties);
    tekenAlles();
  }

  function tekenAlles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const a of annotaties) if (a.page === pagina) tekenEen(a);
    if (bezig) tekenEen(bezig, true);
  }

  function tekenEen(a, voorlopig = false) {
    const s = schaal;
    ctx.save();
    ctx.globalAlpha = voorlopig ? 0.7 : 1;
    ctx.lineWidth = Math.max(1, (a.lineWidth ?? 2) * s);
    ctx.strokeStyle = a.strokeColor || '#ff0000';
    if (a.type === 'measureDistance') {
      ctx.beginPath();
      ctx.moveTo(a.startX * s, a.startY * s);
      ctx.lineTo(a.endX * s, a.endY * s);
      ctx.stroke();
      if (a.measureText) {
        ctx.font = `${Math.max(10, 11 * s)}px sans-serif`;
        ctx.fillStyle = a.strokeColor || '#ff0000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(a.measureText, (a.startX + a.endX) / 2 * s, (a.startY + a.endY) / 2 * s - 4);
      }
    } else if (a.type === 'square') {
      if (a.fillColor) {
        ctx.fillStyle = a.fillColor;
        ctx.globalAlpha = (voorlopig ? 0.7 : 1) * 0.3;
        ctx.fillRect(a.x * s, a.y * s, a.breedte * s, a.hoogte * s);
        ctx.globalAlpha = voorlopig ? 0.7 : 1;
      }
      ctx.strokeRect(a.x * s, a.y * s, a.breedte * s, a.hoogte * s);
    } else if (a.type === 'note') {
      const r = Math.max(7, 9 * s);
      ctx.fillStyle = a.color || '#ffd400';
      ctx.strokeStyle = '#7a6400';
      ctx.beginPath();
      ctx.arc(a.x * s, a.y * s, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function omlaag(e) {
    if (!gereedschap) return;
    const p = naarPagina(e);
    if (gereedschap === 'comment') {
      annotaties = [...annotaties, {
        id: nieuwId(), type: 'note', page: pagina, x: p.x, y: p.y,
        contents: opmerkingTekst(), color: '#ffd400', author: 'Web',
      }];
      meld();
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    bezig = gereedschap === 'measure'
      ? { id: nieuwId(), type: 'measureDistance', page: pagina, startX: p.x, startY: p.y, endX: p.x, endY: p.y, strokeColor: '#ff0000', lineWidth: 1, author: 'Web' }
      : { id: nieuwId(), type: 'square', page: pagina, x: p.x, y: p.y, breedte: 0, hoogte: 0, strokeColor: '#ff0000', lineWidth: 2, author: 'Web' };
    tekenAlles();
  }

  function beweeg(e) {
    if (!bezig) return;
    const p = naarPagina(e);
    if (bezig.type === 'measureDistance') {
      bezig.endX = p.x;
      bezig.endY = p.y;
      const m = meetAfstand({ x: bezig.startX, y: bezig.startY }, { x: p.x, y: p.y }, meetschaal);
      bezig.measureText = m.tekst;
      bezig.schaal = meetschaal;
    } else {
      bezig.breedte = p.x - bezig.x;
      bezig.hoogte = p.y - bezig.y;
    }
    tekenAlles();
  }

  function omhoog(e) {
    if (!bezig) return;
    canvas.releasePointerCapture?.(e.pointerId);
    const a = bezig;
    bezig = null;
    const leeg = a.type === 'measureDistance'
      ? Math.hypot(a.endX - a.startX, a.endY - a.startY) < 1
      : Math.abs(a.breedte) < 1 || Math.abs(a.hoogte) < 1;
    if (leeg) { tekenAlles(); return; }
    if (a.type === 'square' && (a.breedte < 0 || a.hoogte < 0)) {
      if (a.breedte < 0) { a.x += a.breedte; a.breedte = -a.breedte; }
      if (a.hoogte < 0) { a.y += a.hoogte; a.hoogte = -a.hoogte; }
    }
    annotaties = [...annotaties, a];
    meld();
  }

  canvas.addEventListener('pointerdown', omlaag);
  canvas.addEventListener('pointermove', beweeg);
  canvas.addEventListener('pointerup', omhoog);
  canvas.addEventListener('pointercancel', omhoog);

  return {
    get annotaties() { return annotaties; },
    zet(lijst) { annotaties = Array.isArray(lijst) ? [...lijst] : []; meld(); },
    wis() { annotaties = []; meld(); },
    zetGereedschap(g) { gereedschap = g || null; canvas.style.pointerEvents = g ? 'auto' : 'none'; },
    get gereedschap() { return gereedschap; },
    zetSchaal(s) { schaal = s; tekenAlles(); },
    zetMeetschaal(m) {
      meetschaal = m;
      for (const a of annotaties) {
        if (a.type !== 'measureDistance') continue;
        a.schaal = m;
        a.measureText = meetAfstand({ x: a.startX, y: a.startY }, { x: a.endX, y: a.endY }, m).tekst;
      }
      meld();
    },
    get meetschaal() { return meetschaal; },
    zetPagina(n) { pagina = n; tekenAlles(); },
    zetOpmerkingTekst(fn) { opmerkingTekst = fn; },
    hertekenen: tekenAlles,
  };
}
