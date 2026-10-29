// Gesplitste weergave (#715): de pure logica, zonder DOM.
//
// Architectuur in het kort (zie split-view.js voor de DOM-kant):
// - Eén document, één model: annotaties, selectie, ongedaan maken en opslaan
//   blijven van het document. Twee panelen zijn alleen twee manieren om naar
//   dat ene document te kijken.
// - Er is precies één echte viewer: #pdf-container met de canvassen en lagen
//   waar alle gereedschappen, sneltoetsen, de miniaturen, bladwijzers, Ga naar
//   pagina, zoeken en de statusbalk mee werken. Dat is het ACTIEVE paneel.
//   Daardoor blijven alle getElementById('pdf-container'/'annotation-canvas')-
//   aanroepen in de app gewoon kloppen: "het huidige paneel" ís de viewer.
// - Het andere paneel is een spiegel: een canvas dat het document tekent met
//   een eigen weergavestand (pagina, zoom, verschuiving/scroll, weergave-
//   rotatie, weergavemodus). Klikken maakt het actief: dan wisselen de standen
//   en schuift de echte viewer naar die plek in de lay-out (CSS order).
// - Een stand is een momentopname van de echte viewer; hier staat hoe je
//   standen maakt, wisselt, aan een paneelmaat aanpast, synchroon houdt en na
//   paginabewerkingen bijwerkt.

export const RICHTINGEN = Object.freeze(['vertical', 'horizontal']);
export const MIN_VERHOUDING = 0.15;
export const MAX_VERHOUDING = 0.85;

export function normaliseerRotatie(graden) {
  const r = Math.round(Number(graden) || 0) % 360;
  const n = r < 0 ? r + 360 : r;
  return n - (n % 90);
}

export function klemVerhouding(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(MAX_VERHOUDING, Math.max(MIN_VERHOUDING, n));
}

/** Weergavemodus van een document, zoals setViewMode() hem kent. */
export function modusVan(doc) {
  if (!doc) return 'single';
  if (doc.viewMode === 'continuous') {
    if (doc.facingSpread) return 'facing';
    if (doc.bookSpread) return 'book';
    return 'continuous';
  }
  return 'single';
}

/**
 * Kopie van een stand. De bevroren beeldopname (een canvas) wordt gedeeld:
 * die verandert nooit meer, en geldt alleen zolang de stand er precies bij
 * past (zie beeldSleutel).
 */
export function kopieerStand(s) {
  if (!s) return null;
  return {
    ...s,
    vp: s.vp ? { ...s.vp } : null,
    layout: s.layout ? { ...s.layout, rects: s.layout.rects.map((r) => ({ ...r })) } : null,
  };
}

/**
 * De stand met een verankerde viewport: bij een andere paneelmaat (de
 * richting wisselen, #858) houdt hij zijn zoom in plaats van opnieuw passend
 * te worden. Een doorlopende stand houdt zijn schaal toch al.
 */
export function zetVerankerd(s) {
  if (!s?.vp) return s;
  return { ...s, vp: { ...s.vp, verankerd: true } };
}

/**
 * Nieuwe gesplitste weergave. Het tweede paneel begint op dezelfde pagina en
 * zoom als de huidige viewer (live). De echte viewer blijft in paneel 0
 * (links/boven) en blijft actief.
 */
export function maakSplitStaat(richting, live) {
  return {
    richting: RICHTINGEN.includes(richting) ? richting : 'vertical',
    actief: 0,
    verhouding: 0.5,
    sync: false,
    // De stand van het NIET-actieve paneel. Die van het actieve paneel is de
    // echte viewer zelf.
    stand: kopieerStand(live),
  };
}

/** De stand van paneel `index` (0/1): de echte viewer of de opgeslagen. */
export function standVanPaneel(staat, index, live) {
  if (!staat) return index === 0 ? live : null;
  return index === staat.actief ? live : staat.stand;
}

/**
 * Maak het andere paneel actief. `live` is de stand van de echte viewer op
 * dit moment (die van het paneel dat het actief-zijn verliest). Geeft de
 * nieuwe staat en de stand die de echte viewer nu moet aannemen.
 */
export function wisselActiefPaneel(staat, live) {
  return {
    staat: { ...staat, actief: staat.actief === 0 ? 1 : 0, stand: kopieerStand(live) },
    aankomst: kopieerStand(staat.stand),
  };
}

/**
 * Splitsing opheffen: het actieve paneel houdt zijn pagina en zoom, dus de
 * echte viewer blijft zoals hij is. Geeft de stand die blijft (de live).
 */
export function hefSplitsingOp(_staat, live) {
  return live;
}

export function klemPagina(pagina, aantal) {
  const n = Math.max(1, Math.floor(Number(aantal) || 1));
  const p = Math.round(Number(pagina) || 1);
  return Math.min(n, Math.max(1, p));
}

/**
 * Pagina na invoegen/verwijderen/verplaatsen. `toewijzing` is oud → nieuw
 * (null of ontbrekend = verwijderd), zoals reloadFromBytes hem krijgt. Is de
 * pagina verwijderd, dan de dichtstbijzijnde overgebleven pagina (bij gelijke
 * afstand de vorige: daar zat de lezer net). Zonder toewijzing: binnen het
 * bereik klemmen.
 */
export function paginaNaStructuur(pagina, toewijzing, aantal) {
  if (!toewijzing) return klemPagina(pagina, aantal);
  const nieuw = toewijzing[pagina];
  if (nieuw != null) return klemPagina(nieuw, aantal);
  const oudeNummers = Object.keys(toewijzing).map(Number).filter(Number.isFinite);
  const maxOud = oudeNummers.length ? Math.max(...oudeNummers, pagina) : pagina;
  for (let d = 1; d <= maxOud; d++) {
    const voor = toewijzing[pagina - d];
    if (voor != null) return klemPagina(voor, aantal);
    const na = toewijzing[pagina + d];
    if (na != null) return klemPagina(na, aantal);
  }
  return klemPagina(pagina, aantal);
}

// ── Enkelpagina-viewport: zoom en verschuiving per paneel ────────────────

/** Zoom en verschuiving die een pagina passend in een paneel van cssW×cssH leggen. */
export function passendInPaneel(schermW, schermH, cssW, cssH) {
  if (!(schermW > 0 && schermH > 0 && cssW > 0 && cssH > 0)) return null;
  const zoom = Math.min(cssW / schermW, cssH / schermH);
  return {
    zoom,
    offsetX: (cssW - schermW * zoom) / 2,
    offsetY: (cssH - schermH * zoom) / 2,
  };
}

/**
 * Pas een viewport-stand aan een (nieuwe) paneelmaat aan, met dezelfde regel
 * als de viewer bij een venstermaatwijziging: zelf gezoomd/gepand houdt zijn
 * middelpunt, een passend beeld wordt opnieuw passend.
 * @param {object} vp      stand.vp
 * @param {{cssW:number, cssH:number}} oud  paneelmaat waarvoor vp gold
 * @param {{cssW:number, cssH:number}} nieuw
 * @param {{w:number, h:number}} scherm  paginamaat op het scherm (punten)
 */
export function pasViewportAanMaat(vp, oud, nieuw, scherm) {
  if (!vp) return vp;
  const zelfde = Math.abs((oud?.cssW || 0) - nieuw.cssW) < 0.5 && Math.abs((oud?.cssH || 0) - nieuw.cssH) < 0.5;
  if (zelfde) return vp;
  if (!vp.verankerd || !(oud?.cssW > 0 && oud?.cssH > 0)) {
    const fit = passendInPaneel(scherm.w, scherm.h, nieuw.cssW, nieuw.cssH);
    return fit ? { ...vp, ...fit, verankerd: false, strikt: false } : vp;
  }
  const midX = (oud.cssW / 2 - vp.offsetX) / vp.zoom;
  const midY = (oud.cssH / 2 - vp.offsetY) / vp.zoom;
  return {
    ...vp,
    offsetX: nieuw.cssW / 2 - midX * vp.zoom,
    offsetY: nieuw.cssH / 2 - midY * vp.zoom,
  };
}

/** Zoom een viewport-stand rond een punt (CSS-px in het paneel). */
export function zoomViewportRond(vp, factor, px, py) {
  if (!vp || !(factor > 0) || factor === 1) return vp;
  const zoom = vp.zoom * factor;
  return {
    ...vp,
    zoom,
    offsetX: px - (px - vp.offsetX) * factor,
    offsetY: py - (py - vp.offsetY) * factor,
    verankerd: true,
  };
}

export function verschuifViewport(vp, dx, dy) {
  if (!vp || (!dx && !dy)) return vp;
  return { ...vp, offsetX: vp.offsetX - dx, offsetY: vp.offsetY - dy, verankerd: true };
}

// ── Synchroon scrollen en zoomen ─────────────────────────────────────────

/**
 * Wat veranderde er in de echte viewer tussen twee waarnemingen? Alleen
 * zoom en verschuiving/scroll tellen; een paginawissel niet (Sync koppelt het
 * scrollen en zoomen, niet de pagina).
 * @returns {{factor:number, dx:number, dy:number}|null}  null = niets door te geven
 */
export function syncDelta(vorige, nu) {
  if (!vorige || !nu) return null;
  if (vorige.soort !== nu.soort || (nu.soort === 'viewport' && vorige.pagina !== nu.pagina)) return null;
  const factor = vorige.zoom > 0 && nu.zoom > 0 ? nu.zoom / vorige.zoom : 1;
  if (Math.abs(factor - 1) > 1e-6) return { factor, dx: 0, dy: 0 };
  const dx = nu.soort === 'viewport' ? vorige.x - nu.x : nu.x - vorige.x;
  const dy = nu.soort === 'viewport' ? vorige.y - nu.y : nu.y - vorige.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
  // dx/dy in schermpixels, positief = de inhoud schoof naar links/boven
  // (zoals een wielbeweging omlaag/rechts).
  return { factor: 1, dx, dy };
}

/** Pas een sync-delta toe op de stand van het andere paneel. */
export function pasSyncToe(stand, delta, paneel) {
  if (!stand || !delta) return stand;
  const s = kopieerStand(stand);
  if (s.vp) {
    if (delta.factor !== 1) s.vp = zoomViewportRond(s.vp, delta.factor, paneel.cssW / 2, paneel.cssH / 2);
    else s.vp = verschuifViewport(s.vp, delta.dx, delta.dy);
    s.scale = s.vp.zoom;
    return s;
  }
  if (delta.factor !== 1) return zoomLayoutStand(s, delta.factor, paneel.cssW / 2, paneel.cssH / 2);
  s.scrollLeft = Math.max(0, (s.scrollLeft || 0) + delta.dx);
  s.scrollTop = Math.max(0, (s.scrollTop || 0) + delta.dy);
  return s;
}

// ── Doorlopende (en webversie-)weergave: pagina's onder elkaar ───────────

/**
 * Rijen uit gemeten paginavlakken (CSS-px in de scrollinhoud). Pagina's op
 * dezelfde hoogte vormen één rij (boek-/facingweergave).
 */
export function rijenVan(rects) {
  const gesorteerd = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const rijen = [];
  for (const r of gesorteerd) {
    const rij = rijen[rijen.length - 1];
    if (rij && Math.abs(rij[0].y - r.y) < 1) rij.push(r);
    else rijen.push([r]);
  }
  return rijen;
}

/**
 * Herschik een gemeten lay-out voor een nieuwe schaal en/of paneelbreedte,
 * zoals de CSS het zou doen: rijen gecentreerd in max(paneel, breedste rij),
 * tussenruimtes in pixels (die schalen niet mee). `maatVan(page)` geeft
 * optioneel de nieuwe CSS-maat {w,h} (na paginarotatie/weergaverotatie);
 * zonder schaalt de gemeten maat mee.
 */
export function herschikLayout(layout, { schaal, breedte, maatVan } = {}) {
  if (!layout || !layout.rects?.length) return layout;
  const k = schaal > 0 && layout.scale > 0 ? schaal / layout.scale : 1;
  const rijen = rijenVan(layout.rects);
  const pad = rijen[0][0].y;
  const nieuweRijen = rijen.map((rij) => {
    const items = rij.map((r) => {
      const m = maatVan ? maatVan(r.page) : null;
      return { page: r.page, w: m ? m.w : r.w * k, h: m ? m.h : r.h * k, oudX: r.x, oudW: r.w };
    });
    const binnenGaten = rij.slice(1).map((r, i) => r.x - (rij[i].x + rij[i].w));
    const rijW = items.reduce((t, it) => t + it.w, 0) + binnenGaten.reduce((t, g) => t + g, 0);
    return { items, binnenGaten, rijW, oudH: Math.max(...rij.map((r) => r.h)), oudY: rij[0].y };
  });
  const maxRijW = Math.max(...nieuweRijen.map((r) => r.rijW));
  const inhoudW = Math.max(breedte || layout.breedte || 0, maxRijW);
  const rects = [];
  let y = pad;
  nieuweRijen.forEach((rij, i) => {
    let x = (inhoudW - rij.rijW) / 2;
    rij.items.forEach((it, j) => {
      rects.push({ page: it.page, x, y, w: it.w, h: it.h });
      x += it.w + (rij.binnenGaten[j] || 0);
    });
    const rijH = Math.max(...rij.items.map((it) => it.h));
    const volgende = nieuweRijen[i + 1];
    const gat = volgende ? volgende.oudY - (rij.oudY + rij.oudH) : 0;
    y += rijH + gat;
  });
  return {
    ...layout,
    rects,
    scale: schaal > 0 ? schaal : layout.scale,
    breedte: inhoudW,
    hoogte: y + (layout.onder ?? 0),
  };
}

/**
 * Een kolomlay-out van nul af (na paginabewerkingen: de gemeten vlakken horen
 * bij andere pagina's). `pad` = ruimte boven, `gat` = tussen twee pagina's.
 */
export function bouwKolomLayout(paginas, { schaal, breedte, pad = 20, gat = 40, onder = 0 }) {
  const inhoudW = Math.max(breedte || 0, ...paginas.map((p) => p.w));
  const rects = [];
  let y = pad;
  for (const p of paginas) {
    rects.push({ page: p.page, x: (inhoudW - p.w) / 2, y, w: p.w, h: p.h });
    y += p.h + gat;
  }
  return { rects, scale: schaal, breedte: inhoudW, hoogte: (rects.length ? y - gat : y) + onder, pad, gat, onder };
}

/** Gemiddelde tussenruimte van een gemeten kolom (voor bouwKolomLayout). */
export function meetRuimtes(rects) {
  const rijen = rijenVan(rects);
  if (!rijen.length) return { pad: 20, gat: 40 };
  const gaten = [];
  for (let i = 1; i < rijen.length; i++) {
    const vorige = rijen[i - 1];
    gaten.push(rijen[i][0].y - (vorige[0].y + Math.max(...vorige.map((r) => r.h))));
  }
  const gat = gaten.length ? gaten.reduce((t, g) => t + g, 0) / gaten.length : 40;
  return { pad: rijen[0][0].y, gat };
}

/** Pagina's van een lay-out die (deels) in beeld zijn, met hun schermvlak. */
export function zichtbarePaginas(layout, scrollLeft, scrollTop, cssW, cssH, marge = 0) {
  if (!layout?.rects) return [];
  const uit = [];
  for (const r of layout.rects) {
    const x = r.x - scrollLeft;
    const y = r.y - scrollTop;
    if (x + r.w < -marge || y + r.h < -marge || x > cssW + marge || y > cssH + marge) continue;
    uit.push({ page: r.page, x, y, w: r.w, h: r.h });
  }
  return uit;
}

/** De pagina die het midden van het paneel het dichtst raakt. */
export function paginaInBeeld(layout, scrollLeft, scrollTop, cssW, cssH) {
  const zicht = zichtbarePaginas(layout, scrollLeft, scrollTop, cssW, cssH);
  if (!zicht.length) return null;
  const mid = cssH / 2;
  let beste = zicht[0];
  let besteAfstand = Infinity;
  for (const z of zicht) {
    const afstand = mid >= z.y && mid <= z.y + z.h ? 0 : Math.min(Math.abs(z.y - mid), Math.abs(z.y + z.h - mid));
    if (afstand < besteAfstand) { besteAfstand = afstand; beste = z; }
  }
  return beste.page;
}

/** Klem de scrollpositie binnen de inhoud van een lay-out. */
export function klemScroll(layout, scrollLeft, scrollTop, cssW, cssH) {
  const maxX = Math.max(0, (layout?.breedte || 0) - cssW);
  const maxY = Math.max(0, (layout?.hoogte || 0) - cssH);
  return {
    scrollLeft: Math.min(maxX, Math.max(0, scrollLeft || 0)),
    scrollTop: Math.min(maxY, Math.max(0, scrollTop || 0)),
  };
}

/**
 * Zoom een lay-outstand rond een punt in het paneel: het documentpunt onder
 * (px, py) blijft daar staan.
 */
export function zoomLayoutStand(stand, factor, px, py, opties = {}) {
  if (!stand?.layout || !(factor > 0)) return stand;
  const s = kopieerStand(stand);
  const oud = s.layout;
  const docX = (s.scrollLeft || 0) + px;
  const docY = (s.scrollTop || 0) + py;
  // Het documentpunt als (pagina, plek op die pagina) — tussenruimtes
  // schalen niet mee, dus een gewone vermenigvuldiging klopt niet.
  const raak = oud.rects.find((r) => docY >= r.y && docY <= r.y + r.h) || null;
  const nieuweSchaal = s.scale * factor;
  const nieuw = herschikLayout(oud, { schaal: nieuweSchaal, breedte: opties.breedte, maatVan: opties.maatVan ? (p) => opties.maatVan(p, nieuweSchaal) : undefined });
  s.layout = nieuw;
  s.scale = nieuweSchaal;
  if (raak) {
    const nr = nieuw.rects.find((r) => r.page === raak.page);
    const fy = (docY - raak.y) / (raak.h || 1);
    const fx = (docX - raak.x) / (raak.w || 1);
    s.scrollTop = nr.y + fy * nr.h - py;
    s.scrollLeft = nr.x + fx * nr.w - px;
  } else {
    s.scrollTop = docY * factor - py;
    s.scrollLeft = docX * factor - px;
  }
  if (opties.cssW > 0 && opties.cssH > 0) Object.assign(s, klemScroll(nieuw, s.scrollLeft, s.scrollTop, opties.cssW, opties.cssH));
  else { s.scrollLeft = Math.max(0, s.scrollLeft); s.scrollTop = Math.max(0, s.scrollTop); }
  return s;
}

/**
 * De pagina's van de facingweergave rond `page`, zoals renderer.js ze bouwt:
 * pagina 1 alleen, daarna paren (even links, oneven rechts).
 */
export function spreadPaginas(page, aantal) {
  const p = klemPagina(page, aantal);
  if (p <= 1) return [1];
  const anker = p % 2 === 0 ? p : p - 1;
  return anker + 1 <= aantal ? [anker, anker + 1] : [anker];
}

/** Scroll een lay-outstand zodat pagina `page` bovenaan staat. */
export function scrollNaarPagina(stand, page) {
  const r = stand?.layout?.rects?.find((x) => x.page === page);
  if (!r) return stand;
  // Zoals scrollIntoView({ block: "start" }) in goToPage: de pagina bovenaan.
  return { ...kopieerStand(stand), scrollTop: Math.max(0, r.y), page };
}

// ── Het vlak van een pagina dat in een paneel zichtbaar is ───────────────

/**
 * Het zichtbare deel van een pagina die met linkerbovenhoek (tx, ty) en maat
 * (sw·z × sh·z) CSS-px in een paneel van W×H ligt. Geeft null als niets.
 */
export function zichtbaarVak(tx, ty, breedtePx, hoogtePx, W, H) {
  const x0 = Math.max(0, tx);
  const y0 = Math.max(0, ty);
  const x1 = Math.min(W, tx + breedtePx);
  const y1 = Math.min(H, ty + hoogtePx);
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── Wanneer moet het tweede paneel zijn annotaties opnieuw tekenen? ──────

/**
 * De live viewer meldt elke keer dat hij zijn annotaties tekent — ook bij
 * elke frame van pannen en zoomen, waarbij aan de annotaties niets verandert.
 * `kenmerk` beschrijft wat de live viewer liet zien ({ beeld } = zoom,
 * verschuiving, scroll en pagina) en wat het document bevat ({ inhoud } =
 * aantal annotaties, selectie, ongedaan-maken-stapel).
 * Opnieuw tekenen als de inhoud veranderde, of als het beeld gelijk bleef
 * (dan was de hertekening om een andere reden: een sleep, een bewerking).
 */
export function moetSpiegelHertekenen(vorige, nu) {
  if (!vorige) return true;
  if (vorige.inhoud !== nu.inhoud) return true;
  return vorige.beeld === nu.beeld;
}

/**
 * Een sleutel die zegt of de bevroren beeldopname van een stand nog geldt:
 * dezelfde plek, zoom, rotaties, paneelmaat en bestand.
 */
export function beeldSleutel(stand, { filePath, cssW, cssH, extra = '' } = {}) {
  if (!stand) return '';
  const vp = stand.vp;
  const delen = [
    filePath || '', stand.modus || '', stand.page, normaliseerRotatie(stand.viewRotation),
    Math.round(cssW || 0), Math.round(cssH || 0), extra,
  ];
  if (vp) delen.push(vp.zoom.toFixed(5), vp.offsetX.toFixed(2), vp.offsetY.toFixed(2), vp.rotation || 0);
  else delen.push(Number(stand.scale || 0).toFixed(5), Math.round(stand.scrollLeft || 0), Math.round(stand.scrollTop || 0));
  return delen.join('|');
}
