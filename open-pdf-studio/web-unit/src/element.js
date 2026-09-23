// Het custom element <open-pdf-studio>: de web-unit zoals een gastheer hem
// in zijn pagina zet. Zie het ontwerp voor de volledige afspraak.

import {
  ATTRIBUTEN, GEBEURTENISSEN, leesInstellingen, magGereedschap,
  geladenDetail, gewijzigdDetail, opgeslagenDetail, foutDetail,
} from './api.js';
import { leesSchaal, schaalUitKalibratie } from './meten.js';
import { maakViewer } from './viewer.js';
import { maakAnnotatielaag, GEREEDSCHAP_PER_SOORT } from './annoteren.js';

const STIJL = `
:host { display:block; position:relative; background:#525659; overflow:auto; min-height:200px; }
.balk { position:sticky; top:0; z-index:2; display:flex; gap:4px; align-items:center;
        padding:4px 6px; background:linear-gradient(#ffffff,#f5f5f5); border-bottom:1px solid #d4d4d4;
        font:12px "Segoe UI",sans-serif; }
.balk button { font:inherit; padding:2px 8px; border:1px solid #adadad; background:#f0f0f0; cursor:pointer; }
.balk button[aria-pressed="true"] { background:#cce4f7; border-color:#5b9bd5; }
.balk .rek { flex:1 1 auto; }
.blad { position:relative; margin:12px auto; width:max-content; }
canvas { display:block; }
canvas.laag { position:absolute; inset:0; }
`;

export class OpenPdfStudioElement extends HTMLElement {
  static get observedAttributes() { return ATTRIBUTEN; }

  constructor() {
    super();
    this._wortel = this.attachShadow({ mode: 'open' });
    this._instellingen = leesInstellingen({});
    this._viewer = null;
    this._laag = null;
    this._pagina = 1;
    this._zoom = 'fit';
    this._klaar = false;
  }

  connectedCallback() {
    if (!this._klaar) { this._bouw(); this._klaar = true; }
    this._leesAttributen();
    if (this._instellingen.src) this._laadVanUrl(this._instellingen.src);
  }

  attributeChangedCallback() {
    if (!this._klaar) return;
    const vorigeSrc = this._instellingen.src;
    this._leesAttributen();
    if (this._instellingen.src && this._instellingen.src !== vorigeSrc) {
      this._laadVanUrl(this._instellingen.src);
    }
  }

  _bouw() {
    const stijl = document.createElement('style');
    stijl.textContent = STIJL;
    this._balk = document.createElement('div');
    this._balk.className = 'balk';
    const blad = document.createElement('div');
    blad.className = 'blad';
    this._paginaCanvas = document.createElement('canvas');
    this._laagCanvas = document.createElement('canvas');
    this._laagCanvas.className = 'laag';
    blad.append(this._paginaCanvas, this._laagCanvas);
    this._wortel.append(stijl, this._balk, blad);

    this._viewer = maakViewer({ canvas: this._paginaCanvas, motor: this._instellingen.motor });
    this._laag = maakAnnotatielaag({
      canvas: this._laagCanvas,
      onWijziging: (lijst) => this._zend(GEBEURTENISSEN.gewijzigd, gewijzigdDetail(lijst)),
    });
    this._laag.zetOpmerkingTekst(() => this.opmerkingTekst || 'Opmerking');
    this._bouwBalk();
  }

  _bouwBalk() {
    this._knoppen = {};
    const maak = (naam, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.naam = naam;
      b.addEventListener('click', fn);
      this._balk.append(b);
      this._knoppen[naam] = b;
      return b;
    };
    for (const [soort, label] of [['measure', 'Meten'], ['comment', 'Opmerking'], ['shape', 'Vlak']]) {
      maak(soort, label, () => this._kiesGereedschap(soort));
    }
    const rek = document.createElement('span');
    rek.className = 'rek';
    this._balk.append(rek);
    maak('vorige', '◀', () => { this.pagina = this._pagina - 1; });
    this._paginaTekst = document.createElement('span');
    this._balk.append(this._paginaTekst);
    maak('volgende', '▶', () => { this.pagina = this._pagina + 1; });
    maak('uit', '−', () => this.zoomNaar((this._viewer.schaal || 1) / 1.25));
    maak('in', '+', () => this.zoomNaar((this._viewer.schaal || 1) * 1.25));
    maak('passend', 'Passend', () => this.zoomNaar('fit'));
  }

  _kiesGereedschap(soort) {
    const actief = this._laag.gereedschap === soort ? null : soort;
    if (actief && !magGereedschap(this._instellingen, actief)) return;
    this._laag.zetGereedschap(actief);
    for (const [naam, knop] of Object.entries(this._knoppen)) {
      if (GEREEDSCHAP_PER_SOORT[naam]) knop.setAttribute('aria-pressed', String(naam === actief));
    }
  }

  _leesAttributen() {
    const attrs = {};
    for (const naam of ATTRIBUTEN) if (this.hasAttribute(naam)) attrs[naam] = this.getAttribute(naam);
    this._instellingen = leesInstellingen(attrs);
    this._pagina = this._instellingen.pagina;
    this._zoom = this._instellingen.zoom;
    this._viewer?.zetMotor(this._instellingen.motor);
    if (this._laag) {
      this._laag.zetMeetschaal(this._instellingen.schaal);
      if (this._instellingen.modus !== 'edit') this._kiesGereedschap(null);
    }
    for (const soort of Object.keys(GEREEDSCHAP_PER_SOORT)) {
      const knop = this._knoppen?.[soort];
      if (knop) knop.hidden = !magGereedschap(this._instellingen, soort);
    }
  }

  _zend(naam, detail) {
    this.dispatchEvent(new CustomEvent(naam, { detail }));
  }

  async _laadVanUrl(url) {
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await this.laad(new Uint8Array(await r.arrayBuffer()));
    } catch (e) {
      this._zend(GEBEURTENISSEN.fout, foutDetail('laden', e.message));
    }
  }

  // ── publieke API ──────────────────────────────────────────────────────────

  async laad(bytes) {
    try {
      const info = await this._viewer.laad(bytes);
      this._laag.wis();
      this._laag.zetMeetschaal(this._instellingen.schaal);
      this._pagina = Math.min(Math.max(1, this._pagina), info.paginas);
      await this._teken();
      this._zend(GEBEURTENISSEN.geladen, geladenDetail({ ...info, schaal: this._laag.meetschaal }));
      return info;
    } catch (e) {
      this._zend(GEBEURTENISSEN.fout, foutDetail('laden', e.message));
      throw e;
    }
  }

  async _teken() {
    const vak = {
      breedte: Math.max(200, this.clientWidth - 24),
      hoogte: Math.max(200, this.clientHeight - 60),
    };
    const s = await this._viewer.teken(this._pagina, this._zoom, vak);
    this._laagCanvas.width = this._paginaCanvas.width;
    this._laagCanvas.height = this._paginaCanvas.height;
    this._laagCanvas.style.width = this._paginaCanvas.width + 'px';
    this._laagCanvas.style.height = this._paginaCanvas.height + 'px';
    this._laag.zetPagina(this._pagina);
    this._laag.zetSchaal(s);
    this._paginaTekst.textContent = ` ${this._pagina} / ${this._viewer.paginas} `;
  }

  async opslaan() {
    // pdf-lib is alleen bij het opslaan nodig; hij hoort niet in de eerste
    // lading van de gastheer.
    const { schrijfAnnotaties } = await import('./opslaan.js');
    const bytes = await schrijfAnnotaties(this._viewer.bytes, this._laag.annotaties, {
      schaal: this._laag.meetschaal,
    });
    this._zend(GEBEURTENISSEN.opgeslagen, opgeslagenDetail(bytes, this._laag.annotaties));
    return bytes;
  }

  annotaties() { return this._laag.annotaties.map((a) => ({ ...a })); }
  zetAnnotaties(lijst) { this._laag.zet(lijst); }

  get meetschaal() { return this._laag.meetschaal; }
  set meetschaal(waarde) {
    const s = typeof waarde === 'string'
      ? leesSchaal(waarde, this._instellingen.eenheid)
      : waarde;
    this._laag.zetMeetschaal(s || null);
  }

  kalibreer(lengtePt, echteWaarde, eenheid = this._instellingen.eenheid) {
    this.meetschaal = schaalUitKalibratie(lengtePt, echteWaarde, eenheid);
    return this._laag.meetschaal;
  }

  get pagina() { return this._pagina; }
  set pagina(n) {
    const nr = Math.min(Math.max(1, Math.trunc(n) || 1), this._viewer.paginas || 1);
    if (nr === this._pagina) return;
    this._pagina = nr;
    this._teken();
  }

  get instellingen() { return this._instellingen; }
  get gereedschap() { return this._laag.gereedschap; }
  kiesGereedschap(soort) { this._kiesGereedschap(soort); }

  async zoomNaar(zoom) { this._zoom = zoom; await this._teken(); }

  disconnectedCallback() { this._viewer?.vrijgeven(); }
}

export function registreer(naam = 'open-pdf-studio') {
  if (!customElements.get(naam)) customElements.define(naam, OpenPdfStudioElement);
  return naam;
}
