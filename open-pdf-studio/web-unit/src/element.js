// Het custom element <open-pdf-studio>: de web-unit zoals een gastheer hem
// in zijn pagina zet. De afspraak voor gastheren staat in de README
// ("Embedding in a web page") en in docs/web-unit-451.md.
//
// Elke methode bestaat onder een Engelse naam (de gedocumenteerde API) en, voor
// gastheren van de eerste snede, onder de oorspronkelijke Nederlandse naam.

import {
  ATTRIBUTEN, GEBEURTENISSEN, EVENT_VOOR, engelsDetail, leesInstellingen, magGereedschap,
  geladenDetail, gewijzigdDetail, opgeslagenDetail, foutDetail,
} from './api.js';
import { leesSchaal, schaalUitKalibratie } from './meten.js';
import { maakViewer, voorladen } from './viewer.js';
import { maakAnnotatielaag, GEREEDSCHAP_PER_SOORT } from './annoteren.js';
import { lijstNaarAppModel, kopieVoorGastheer } from './model.js';
import { tekstenVoor } from './teksten.js';
import { documentSleutel, leesStand, bewaarStand, wisAlles, veiligeOpslag } from './opslag.js';

// Thema via CSS-variabelen op het element; `theme="dark"` zet een donkere set.
// De gastheer kan elke variabele zelf zetten, of met ::part() de werkbalk,
// knoppen en het blad opmaken.
const STIJL = `
:host {
  --opds-background:#525659; --opds-toolbar-background:linear-gradient(#ffffff,#f5f5f5);
  --opds-toolbar-border:#d4d4d4; --opds-toolbar-color:#1e1e1e;
  --opds-button-background:#f0f0f0; --opds-button-border:#adadad;
  --opds-button-active-background:#cce4f7; --opds-button-active-border:#5b9bd5;
  --opds-font:12px "Segoe UI",sans-serif;
  display:block; position:relative; background:var(--opds-background); overflow:auto; min-height:200px;
}
:host([theme="dark"]) {
  --opds-background:#1e1e1e; --opds-toolbar-background:#2d2d30; --opds-toolbar-border:#3f3f46;
  --opds-toolbar-color:#f1f1f1; --opds-button-background:#3e3e42; --opds-button-border:#555555;
  --opds-button-active-background:#094771; --opds-button-active-border:#3794ff;
}
.balk { position:sticky; top:0; z-index:2; display:flex; gap:4px; align-items:center;
        padding:4px 6px; background:var(--opds-toolbar-background); color:var(--opds-toolbar-color);
        border-bottom:1px solid var(--opds-toolbar-border); font:var(--opds-font); }
.balk[hidden] { display:none; }
.balk button { font:inherit; color:inherit; padding:2px 8px; border:1px solid var(--opds-button-border);
               background:var(--opds-button-background); }
.balk button[aria-pressed="true"] { background:var(--opds-button-active-background); border-color:var(--opds-button-active-border); }
.balk .rek { flex:1 1 auto; }
.blad { position:relative; margin:12px auto; width:max-content; }
canvas { display:block; }
canvas.laag { position:absolute; inset:0; }
textarea.opmerking { position:absolute; z-index:3; width:180px; height:56px; resize:none; margin:0;
                     font:var(--opds-font); border:1px solid var(--opds-button-active-border); background:#fffbe0; color:#1e1e1e; }
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
    this._eigenTeksten = null;
    this._docSleutel = null;
    this._auteur = 'Web';
    this._schaalAttribuut = undefined;
  }

  connectedCallback() {
    if (!this._klaar) { this._bouw(); this._klaar = true; }
    this._leesAttributen(true);
    if (this._instellingen.src && this._instellingen.src !== this._geladenSrc) {
      this.load(this._instellingen.src).catch(() => { /* opds:fout/opds:error is al verstuurd */ });
    }
  }

  attributeChangedCallback(naam) {
    if (!this._klaar) return;
    const vorigeSrc = this._instellingen.src;
    // Alleen een gewijzigde `page` of `zoom` verzet de weergave; een andere
    // `mode` of `scale` laat de gebruiker op zijn plek.
    const weergave = naam === 'page' || naam === 'zoom';
    this._leesAttributen(weergave);
    if (weergave && this._viewer?.paginas) {
      this._pagina = Math.min(this._pagina, this._viewer.paginas);
      this._tekenOpAchtergrond();
    }
    if (this._instellingen.src && this._instellingen.src !== vorigeSrc) {
      this.load(this._instellingen.src).catch(() => {});
    }
  }

  _bouw() {
    const stijl = document.createElement('style');
    stijl.textContent = STIJL;
    this._balk = document.createElement('div');
    this._balk.className = 'balk';
    this._balk.setAttribute('part', 'toolbar');
    this._balk.setAttribute('role', 'toolbar');
    const blad = document.createElement('div');
    blad.className = 'blad';
    blad.setAttribute('part', 'page');
    this._paginaCanvas = document.createElement('canvas');
    this._laagCanvas = document.createElement('canvas');
    this._laagCanvas.className = 'laag';
    blad.append(this._paginaCanvas, this._laagCanvas);
    this._blad = blad;
    this._wortel.append(stijl, this._balk, blad);

    this._viewer = maakViewer({ canvas: this._paginaCanvas, motor: this._instellingen.motor });
    this._laag = maakAnnotatielaag({
      canvas: this._laagCanvas,
      onWijziging: (lijst) => this._zend(GEBEURTENISSEN.gewijzigd, gewijzigdDetail(kopieVoorGastheer(lijst))),
      onNieuweOpmerking: (a) => this._bewerkOpmerking(a),
    });
    this._laag.zetOpmerkingTekst(() => this.opmerkingTekst || this._teksten().defaultComment);
    this._laag.zetAuteur(() => this._auteur);
    this._bouwBalk();
  }

  _teksten() { return tekstenVoor(this._instellingen.taal, this._eigenTeksten); }

  /**
   * Na het plaatsen van een opmerking direct de tekst laten typen, op de plek
   * van de notitie. Enter of klik ernaast bevestigt, Shift+Enter is een nieuwe
   * regel, Escape laat de standaardtekst staan.
   */
  _bewerkOpmerking(a) {
    this._sluitOpmerking?.();
    const veld = document.createElement('textarea');
    veld.className = 'opmerking';
    veld.setAttribute('part', 'comment-editor');
    veld.setAttribute('aria-label', this._teksten().comment);
    veld.value = a.text || '';
    const s = this._viewer.schaal || 1;
    veld.style.left = Math.round(a.x * s + 12) + 'px';
    veld.style.top = Math.round(a.y * s - 8) + 'px';
    let klaar = false;
    const sluit = (bewaren) => {
      if (klaar) return;
      klaar = true;
      this._sluitOpmerking = null;
      const tekst = veld.value.trim();
      veld.remove();
      if (bewaren && tekst && tekst !== a.text) this._laag.werkBij(a.id, { text: tekst });
    };
    this._sluitOpmerking = () => sluit(true);
    veld.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sluit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); sluit(false); }
    });
    this._blad.append(veld);
    // Pas na de muisklik focussen: de mousedown die op de pointerdown volgt,
    // zou het veld anders meteen weer laten vervagen.
    setTimeout(() => {
      if (klaar) return;
      veld.focus();
      veld.select();
      veld.addEventListener('blur', () => sluit(true));
    }, 0);
  }

  _bouwBalk() {
    this._knoppen = {};
    const maak = (naam, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.naam = naam;
      b.setAttribute('part', 'button');
      b.addEventListener('click', fn);
      this._balk.append(b);
      this._knoppen[naam] = b;
      return b;
    };
    for (const soort of ['measure', 'comment', 'shape']) maak(soort, () => this._kiesGereedschap(soort));
    const rek = document.createElement('span');
    rek.className = 'rek';
    this._balk.append(rek);
    maak('vorige', () => { this.page = this._pagina - 1; });
    this._paginaTekst = document.createElement('span');
    this._balk.append(this._paginaTekst);
    maak('volgende', () => { this.page = this._pagina + 1; });
    maak('uit', () => this.zoomTo((this._viewer.schaal || 1) / 1.25));
    maak('in', () => this.zoomTo((this._viewer.schaal || 1) * 1.25));
    maak('passend', () => this.zoomTo('fit'));
    this._zetBalkTeksten();
  }

  _zetBalkTeksten() {
    if (!this._knoppen) return;
    const t = this._teksten();
    const label = {
      measure: [t.measure], comment: [t.comment], shape: [t.shape],
      vorige: ['◀', t.previous], volgende: ['▶', t.next],
      uit: ['−', t.zoomOut], in: ['+', t.zoomIn], passend: [t.fit],
    };
    for (const [naam, [tekst, titel]] of Object.entries(label)) {
      const knop = this._knoppen[naam];
      knop.textContent = tekst;
      if (titel) { knop.title = titel; knop.setAttribute('aria-label', titel); }
    }
    this._balk.setAttribute('aria-label', t.toolbar);
  }

  _kiesGereedschap(soort) {
    const actief = this._laag.gereedschap === soort ? null : soort;
    if (actief && !magGereedschap(this._instellingen, actief)) return;
    this._laag.zetGereedschap(actief);
    for (const [naam, knop] of Object.entries(this._knoppen)) {
      if (GEREEDSCHAP_PER_SOORT[naam]) knop.setAttribute('aria-pressed', String(naam === actief));
    }
  }

  _leesAttributen(weergaveOok = false) {
    const attrs = {};
    for (const naam of ATTRIBUTEN) if (this.hasAttribute(naam)) attrs[naam] = this.getAttribute(naam);
    const vorigeSchaalTekst = this._schaalAttribuut;
    this._instellingen = leesInstellingen(attrs);
    this._schaalAttribuut = attrs.scale ?? null;
    if (weergaveOok) {
      this._pagina = this._instellingen.pagina;
      this._zoom = this._instellingen.zoom;
    }
    this._viewer?.zetMotor(this._instellingen.motor);
    if (this._laag) {
      // Alleen een ander `scale`-attribuut overschrijft een schaal die de
      // gastheer met setScale() of kalibreren zette.
      if (this._schaalAttribuut !== vorigeSchaalTekst) this._laag.zetMeetschaal(this._instellingen.schaal);
      if (this._instellingen.modus !== 'edit' && this._laag.gereedschap) this._kiesGereedschap(this._laag.gereedschap);
    }
    for (const soort of Object.keys(GEREEDSCHAP_PER_SOORT)) {
      const knop = this._knoppen?.[soort];
      if (knop) knop.hidden = !magGereedschap(this._instellingen, soort);
    }
    if (this._balk) this._balk.hidden = this._instellingen.werkbalk === 'none';
    this._zetBalkTeksten();
  }

  _zend(naam, detail) {
    this.dispatchEvent(new CustomEvent(naam, { detail }));
    const engels = EVENT_VOOR[naam];
    if (engels) this.dispatchEvent(new CustomEvent(engels, { detail: engelsDetail(naam, detail) }));
  }

  _opslag() { return this._instellingen.opslag === 'local' ? veiligeOpslag() : null; }

  _bewaar(stand) {
    const o = this._opslag();
    if (o && this._docSleutel) bewaarStand(o, this._docSleutel, stand);
  }

  async _haalOp(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  /** Achterwaarts: de eerste snede had deze naam voor laden-van-URL. */
  async _laadVanUrl(url) {
    try { return await this.load(url); } catch { return null; }
  }

  // ── publieke API (Engels) ─────────────────────────────────────────────────

  /**
   * Een document openen. `bron` is een Uint8Array, ArrayBuffer, Blob/File, of
   * een URL (tekst of URL-object; één fetch met `credentials: 'same-origin'`).
   * @returns {Promise<{pages:number, widthPt:number, heightPt:number}>}
   */
  async load(bron) {
    try {
      let bytes;
      if (typeof bron === 'string' || (typeof URL !== 'undefined' && bron instanceof URL)) {
        this._geladenSrc = String(bron);
        bytes = await this._haalOp(String(bron));
      } else if (typeof Blob !== 'undefined' && bron instanceof Blob) {
        bytes = new Uint8Array(await bron.arrayBuffer());
      } else if (bron instanceof Uint8Array) {
        bytes = bron;
      } else if (bron instanceof ArrayBuffer) {
        bytes = new Uint8Array(bron);
      } else if (ArrayBuffer.isView(bron)) {
        bytes = new Uint8Array(bron.buffer, bron.byteOffset, bron.byteLength);
      } else {
        throw new Error('load() expects bytes, a Blob or a URL');
      }
      const info = await this._viewer.laad(bytes);
      this._laag.wis();
      // Een schaal die de gastheer vóór het eerste document zette, gaat voor.
      let schaal = this._wachtendeSchaal !== undefined ? this._wachtendeSchaal : this._instellingen.schaal;
      this._wachtendeSchaal = undefined;
      this._docSleutel = null;
      const o = this._opslag();
      if (o) {
        this._docSleutel = documentSleutel(bytes);
        const stand = leesStand(o, this._docSleutel);
        if (stand?.pagina && !this.hasAttribute('page')) this._pagina = stand.pagina;
        if (stand?.schaal && !this.hasAttribute('scale')) schaal = stand.schaal;
      }
      this._laag.zetMeetschaal(schaal);
      this._pagina = Math.min(Math.max(1, this._pagina), info.paginas);
      await this._teken();
      this._zend(GEBEURTENISSEN.geladen, geladenDetail({ ...info, schaal: this._laag.meetschaal }));
      return { pages: info.paginas, widthPt: info.breedtePt, heightPt: info.hoogtePt, ...info };
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
    this._sluitOpmerking?.();
    const s = await this._viewer.teken(this._pagina, this._zoom, vak);
    this._laagCanvas.width = this._paginaCanvas.width;
    this._laagCanvas.height = this._paginaCanvas.height;
    this._laagCanvas.style.width = this._paginaCanvas.width + 'px';
    this._laagCanvas.style.height = this._paginaCanvas.height + 'px';
    this._laag.zetPagina(this._pagina);
    this._laag.zetSchaal(s);
    this._paginaTekst.textContent = ` ${this._pagina} / ${this._viewer.paginas} `;
  }

  /**
   * Tekenen zonder dat de aanroeper wacht (bladeren, attribuut gewijzigd). Een
   * fout wordt een `opds:error`, behalve als de unit intussen is weggehaald.
   */
  _tekenOpAchtergrond() {
    this._teken().catch((e) => {
      if (this.isConnected && this._viewer?.paginas) this._zend(GEBEURTENISSEN.fout, foutDetail('tekenen', e.message));
    });
  }

  /**
   * De PDF met de annotaties erin, als bytes. Het brondocument blijft
   * onaangeroerd; de gastheer bepaalt wat er met het resultaat gebeurt.
   * @returns {Promise<Uint8Array>}
   */
  async exportPdf() {
    if (!this._viewer.bytes) throw new Error('no document loaded');
    // pdf-lib is alleen bij het opslaan nodig; hij hoort niet in de eerste
    // lading van de gastheer.
    const { schrijfAnnotaties } = await import('./opslaan.js');
    const bytes = await schrijfAnnotaties(this._viewer.bytes, this._laag.annotaties, {
      schaal: this._laag.meetschaal,
    });
    this._zend(GEBEURTENISSEN.opgeslagen, opgeslagenDetail(bytes, this._laag.annotaties));
    return bytes;
  }

  /** Een losse kopie van de annotaties, in het model van de bureaubladversie. */
  getAnnotations() { return kopieVoorGastheer(this._laag.annotaties); }

  /** De annotatielaag vervangen. Oude namen (`note`, `square`) worden omgezet. */
  setAnnotations(lijst) { this._laag.zet(lijstNaarAppModel(lijst)); }

  /**
   * De meetschaal: `"1:100"`, een getal (eenheden per punt), het object dat
   * getScale() teruggeeft, of `null` om hem te wissen.
   */
  setScale(waarde, eenheid = this._instellingen.eenheid) {
    let s = null;
    if (typeof waarde === 'string' || typeof waarde === 'number') {
      s = leesSchaal(String(waarde), eenheid);
    } else if (waarde && waarde.unitsPerPoint > 0) {
      s = leesSchaal(String(waarde.unitsPerPoint), waarde.unit || eenheid);
    } else if (waarde && waarde.eenheidPerPunt > 0) {
      s = waarde;
    }
    this._zetSchaal(s);
    return this.getScale();
  }

  _zetSchaal(s) {
    if (!this._viewer?.bytes) this._wachtendeSchaal = s || null;
    this._laag?.zetMeetschaal(s || null);
    this._bewaar({ schaal: s || null });
  }

  getScale() {
    const s = this._laag ? this._laag.meetschaal : this._wachtendeSchaal;
    return s ? { unitsPerPoint: s.eenheidPerPunt, ratio: s.noemer, unit: s.eenheid } : null;
  }

  /** Kalibreren: een lengte in paginapunten is in werkelijkheid `waarde`. */
  calibrate(lengtePt, waarde, eenheid = this._instellingen.eenheid) {
    return this.setScale(schaalUitKalibratie(lengtePt, waarde, eenheid));
  }

  get page() { return this._pagina; }
  set page(n) {
    const nr = Math.min(Math.max(1, Math.trunc(n) || 1), this._viewer.paginas || 1);
    if (nr === this._pagina) return;
    this._pagina = nr;
    this._bewaar({ pagina: nr });
    this._tekenOpAchtergrond();
  }
  get pageCount() { return this._viewer?.paginas || 0; }

  async zoomTo(zoom) { this._zoom = zoom; await this._teken(); }

  setMode(modus) { this.setAttribute('mode', modus === 'view' ? 'view' : 'edit'); }

  /** Een gereedschap kiezen (`measure`, `comment`, `shape`) of `null`. */
  setTool(soort) {
    if (!soort) { if (this._laag.gereedschap) this._kiesGereedschap(this._laag.gereedschap); return; }
    if (this._laag.gereedschap !== soort) this._kiesGereedschap(soort);
  }
  get tool() { return this._laag.gereedschap; }

  /** Eigen teksten voor de werkbalk; zie teksten.js voor de sleutels. */
  get labels() { return this._teksten(); }
  set labels(eigen) { this._eigenTeksten = eigen || null; this._zetBalkTeksten(); }

  get author() { return this._auteur; }
  set author(naam) { this._auteur = String(naam || 'Web'); }

  /** PDF.js alvast ophalen, voordat er een document is (sneller eerste beeld). */
  preload() { return voorladen(this._instellingen.motor); }

  /** Wis alles wat de unit met `storage="local"` heeft bewaard. */
  clearStorage() { return wisAlles(veiligeOpslag()); }

  /** Het element weghalen en het document vrijgeven. */
  destroy() { this.remove(); this._viewer?.vrijgeven(); }

  get settings() { return this._instellingen; }

  disconnectedCallback() { this._viewer?.vrijgeven(); }

  // ── oorspronkelijke (Nederlandse) namen, voor gastheren van de eerste snede ──

  laad(bron) { return this.load(bron); }
  opslaan() { return this.exportPdf(); }
  annotaties() { return this.getAnnotations(); }
  zetAnnotaties(lijst) { this.setAnnotations(lijst); }
  get meetschaal() { return this._laag.meetschaal; }
  set meetschaal(waarde) {
    this._zetSchaal(typeof waarde === 'string' ? leesSchaal(waarde, this._instellingen.eenheid) : waarde);
  }
  kalibreer(lengtePt, echteWaarde, eenheid = this._instellingen.eenheid) {
    this.meetschaal = schaalUitKalibratie(lengtePt, echteWaarde, eenheid);
    return this._laag.meetschaal;
  }
  get pagina() { return this.page; }
  set pagina(n) { this.page = n; }
  get instellingen() { return this._instellingen; }
  get gereedschap() { return this._laag.gereedschap; }
  kiesGereedschap(soort) { this._kiesGereedschap(soort); }
  zoomNaar(zoom) { return this.zoomTo(zoom); }
}

export function registreer(naam = 'open-pdf-studio') {
  if (!customElements.get(naam)) customElements.define(naam, OpenPdfStudioElement);
  return naam;
}
