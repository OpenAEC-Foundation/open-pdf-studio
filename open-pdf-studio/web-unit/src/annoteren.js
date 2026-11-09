// De annotatielaag van de web-unit: een overlay-canvas boven de pagina waarop
// je meet, een opmerking plaatst of een vlak tekent.
//
// De annotaties leven in PAGINAPUNTEN met de oorsprong linksboven (zie
// `meten.js`), niet in beeldpunten. Zo blijven ze bij elke zoomstand hetzelfde
// en kunnen ze zonder omrekening naar `opslaan.js`. Soorten en velden zijn die
// van de bureaubladversie (zie `model.js`).

import { meetAfstand } from './meten.js';
import { lijstNaarAppModel } from './model.js';

let _volgnummer = 0;
const nieuwId = () => 'wu-' + (++_volgnummer) + '-' + Math.random().toString(36).slice(2, 8);

export const GEREEDSCHAP_PER_SOORT = Object.freeze({
  measure: 'measureDistance',
  comment: 'comment',
  shape: 'box',
});

/** De meetvelden van de app (`measureText`, `measureValue`, ...) bijwerken. */
function zetMaat(a, meetschaal) {
  const m = meetAfstand({ x: a.startX, y: a.startY }, { x: a.endX, y: a.endY }, meetschaal);
  a.measureText = m.tekst;
  a.measureValue = m.waarde;
  a.measureUnit = m.eenheid;
  a.measurePixels = m.lengtePt;
  a.schaal = meetschaal;
}

export function maakAnnotatielaag({ canvas, onWijziging, onNieuweOpmerking }) {
  const ctx = canvas.getContext('2d');
  let annotaties = [];
  let gereedschap = null;
  let schaal = 1;          // beeldpunten per paginapunt
  let meetschaal = null;
  let pagina = 1;
  let bezig = null;
  let opmerkingTekst = () => 'Comment';
  let auteur = () => 'Web';
  const nu = () => new Date().toISOString();

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
    } else if (a.type === 'box') {
      if (a.fillColor) {
        ctx.fillStyle = a.fillColor;
        ctx.globalAlpha = (voorlopig ? 0.7 : 1) * 0.3;
        ctx.fillRect(a.x * s, a.y * s, a.width * s, a.height * s);
        ctx.globalAlpha = voorlopig ? 0.7 : 1;
      }
      ctx.strokeRect(a.x * s, a.y * s, a.width * s, a.height * s);
    } else if (a.type === 'comment') {
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
      const t = nu();
      annotaties = [...annotaties, {
        id: nieuwId(), type: 'comment', page: pagina, x: p.x, y: p.y,
        text: opmerkingTekst(), color: '#ffd400', icon: 'comment', author: auteur(),
        createdAt: t, modifiedAt: t,
      }];
      meld();
      onNieuweOpmerking?.(annotaties[annotaties.length - 1]);
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    const t = nu();
    const basis = { id: nieuwId(), page: pagina, strokeColor: '#ff0000', author: auteur(), createdAt: t, modifiedAt: t };
    bezig = gereedschap === 'measure'
      ? { ...basis, type: 'measureDistance', startX: p.x, startY: p.y, endX: p.x, endY: p.y, lineWidth: 1 }
      : { ...basis, type: 'box', x: p.x, y: p.y, width: 0, height: 0, lineWidth: 2 };
    tekenAlles();
  }

  function beweeg(e) {
    if (!bezig) return;
    const p = naarPagina(e);
    if (bezig.type === 'measureDistance') {
      bezig.endX = p.x;
      bezig.endY = p.y;
      zetMaat(bezig, meetschaal);
    } else {
      bezig.width = p.x - bezig.x;
      bezig.height = p.y - bezig.y;
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
      : Math.abs(a.width) < 1 || Math.abs(a.height) < 1;
    if (leeg) { tekenAlles(); return; }
    if (a.type === 'box' && (a.width < 0 || a.height < 0)) {
      if (a.width < 0) { a.x += a.width; a.width = -a.width; }
      if (a.height < 0) { a.y += a.height; a.height = -a.height; }
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
    zet(lijst) { annotaties = lijstNaarAppModel(lijst); meld(); },
    /** Velden van één annotatie bijwerken (bijv. de tekst van een opmerking). */
    werkBij(id, velden) {
      let gevonden = false;
      annotaties = annotaties.map((a) => {
        if (a.id !== id) return a;
        gevonden = true;
        return { ...a, ...velden, modifiedAt: nu() };
      });
      if (gevonden) meld();
      return gevonden;
    },
    wis() { annotaties = []; meld(); },
    zetGereedschap(g) { gereedschap = g || null; canvas.style.pointerEvents = g ? 'auto' : 'none'; },
    get gereedschap() { return gereedschap; },
    zetSchaal(s) { schaal = s; tekenAlles(); },
    zetMeetschaal(m) {
      meetschaal = m;
      for (const a of annotaties) if (a.type === 'measureDistance') zetMaat(a, m);
      meld();
    },
    get meetschaal() { return meetschaal; },
    zetPagina(n) { pagina = n; tekenAlles(); },
    zetOpmerkingTekst(fn) { opmerkingTekst = fn; },
    zetAuteur(fn) { auteur = fn; },
    hertekenen: tekenAlles,
  };
}
