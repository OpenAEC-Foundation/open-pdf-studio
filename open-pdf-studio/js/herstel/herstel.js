// Herstel van niet-opgeslagen werk na een crash: de bewaking in de frontend.
//
// Lagen (zie ook src-tauri/src/herstel.rs en crashlog.rs):
//
// 1. Momentopnamen tijdens het werk. Elke TIK_MS kijkt de bewaking naar de
//    open documenten (planning.js). Een document met niet-opgeslagen
//    wijzigingen krijgt ~30 s na de laatste wijziging (en bij doorwerken
//    uiterlijk elke 2 minuten) een momentopname: de bytes die opslaan zou
//    schrijven (saver.js, bouwMomentopname), weggeschreven in de herstelmap
//    (opslag.js), NOOIT over het origineel. Na opslaan, en na sluiten met
//    "niet opslaan", gaat de momentopname weg.
// 2. Noodmomentopname. Een onafgevangen fout in de frontend (foutvanger.js) of
//    een Rust-paniek (event `herstel-nood`) maakt meteen een momentopname van
//    alle gewijzigde documenten en schrijft een regel in het crashlog.
// 3. Bij de start (alleen de hoofdinstantie) kijkt de bewaking naar wat er van
//    instanties die niet meer draaien is blijven staan (beleid.js) en biedt
//    dat aan in "Niet-opgeslagen werk herstellen" (RecoveryDialog.jsx).
//    Headless (OPDS_HEADLESS=1) komt er geen venster: het aanbod gaat naar het
//    logboek.
// 4. Valt het renderproces weg, dan herlaadt Rust het hoofdvenster (hooguit
//    2 keer per 5 minuten, crashlog.rs). Vlak daarvoor valt er niets meer te
//    bewaren; de nieuwe sessie biedt de laatste momentopnamen van de vorige
//    sessie aan via laag 3 (herladen.js).
//
// Niet bewaard:
//  * documenten die met een wachtwoord geopend zijn. Ze zijn in de app
//    alleen-lezen en de enige inhoud die er te bewaren valt is ontsleuteld;
//    die komt niet buiten de tijdelijke werkkopie op schijf.
//  * documenten waarvan de PDF groter is dan MAX_BRON_BYTES (64 MiB): een
//    momentopname kost dan te veel tijd en geheugen. Dat staat één keer per
//    document in het logboek.

import { createSignal } from 'solid-js';
import { state } from '../core/state.js';
import { isHeadless } from '../core/headless.js';
import { heeftBeveiligdeInhoud } from '../pdf/wachtwoord-pdf.js';
import { TIK_MS, STILTE_MS, MAX_WACHT_MS, vingerafdruk, nieuwPlan, werkBij, isAanDeBeurt, naOpname, vastgelegdPlan } from './planning.js';
import { sleutelVoor, sessieVoorvoegsel, maakManifest, origineelPadVan, origineelGewijzigd } from './manifest.js';
import { schrijfMomentopname, schrijfManifest, leesAlle, leesMarkers } from './opslag.js';
import { deelIn, beoordeelMarkers, instantieUitSleutel, procesUitId } from './beleid.js';
import { maakFoutvanger } from './foutvanger.js';
import { zetOntvanger, wijzigTeller } from './haken.js';
import { naHerladen } from './herladen.js';

/** Grootste PDF (bytes) waarvan nog een momentopname gemaakt wordt. */
export const MAX_BRON_BYTES = 64 * 1024 * 1024;

const [aanbod, setAanbod] = createSignal([]);
/** De momentopnamen die het herstelvenster aanbiedt (reactief). */
export { aanbod };

let info = null;
let sessie = null;
let gestart = false;
const plannen = new Map();
let keten = Promise.resolve();
let tikBezig = false;
let tikTimer = null;

function tauriInvoke(cmd, args, opties) {
  return window.__TAURI__.core.invoke(cmd, args, opties);
}

const adapter = {
  schrijf(rel, bytes) {
    const mobiel = window.__TAURI__?.os?.type?.() === 'android';
    return tauriInvoke('herstel_schrijf', mobiel ? { data: Array.from(bytes) } : bytes, {
      headers: { 'x-opds-pad': encodeURIComponent(rel) },
    });
  },
  leesTekst: (rel) => tauriInvoke('herstel_lees_tekst', { rel }),
  lijst: (rel) => tauriInvoke('herstel_lijst', { rel }),
  verwijder: (rel) => tauriInvoke('herstel_verwijder', { rel }),
};

/** Eén handeling tegelijk: momentopnamen, opruimen en herstellen. */
function inRij(fn) {
  const p = keten.then(() => fn());
  keten = p.catch(() => {});
  return p;
}

function log(bericht) {
  console.info(`[herstel] ${bericht}`);
}

async function crashlog(soort, bericht) {
  try { await tauriInvoke('herstel_crashlog', { soort, bericht }); } catch { /* best effort */ }
}

async function logboek(bericht) {
  try { await tauriInvoke('herstel_log', { bericht }); } catch { console.warn(`[herstel] ${bericht}`); }
}

function eigenSleutel(docId) {
  return sleutelVoor(info.instantie.id, sessie, docId);
}

/** Waarom van dit document (nu) geen momentopname komt, of null. */
function nietGeschikt(doc) {
  if (!doc?.pdfDoc) return 'not loaded';
  if (doc._isLoading) return 'loading';
  // Ontsleutelde inhoud van een beveiligd bestand komt niet in het herstel.
  if (heeftBeveiligdeInhoud(doc)) return 'password-protected';
  return null;
}

async function registratie(doc) {
  let r = plannen.get(doc.id);
  if (r) return r;
  r = { plan: nieuwPlan(), sleutel: eigenSleutel(doc.id), bron: null, heeftOpname: false, teGrootGemeld: false };
  plannen.set(doc.id, r);
  // Stand van het origineel bij het openen (grootte + wijzigingstijd).
  const pad = origineelPadVan(doc);
  if (pad) {
    try { r.bron = await tauriInvoke('herstel_bron_info', { pad }); } catch { r.bron = null; }
  }
  return r;
}

async function basisGrootte(doc) {
  try {
    const { getCachedPdfBytes } = await import('../pdf/loader.js');
    const bytes = getCachedPdfBytes(doc.filePath) || getCachedPdfBytes(`__memory__${doc.id}`);
    if (bytes?.length) return bytes.length;
  } catch { /* geen cache */ }
  try {
    const b = await tauriInvoke('herstel_bron_info', { pad: doc.filePath });
    return b?.grootte || 0;
  } catch { return 0; }
}

async function maakOpname(doc, r, reden) {
  const grootte = await basisGrootte(doc);
  if (grootte > MAX_BRON_BYTES) {
    if (!r.teGrootGemeld) {
      r.teGrootGemeld = true;
      await logboek(`no recovery snapshot for "${doc.fileName}": ${Math.round(grootte / 1048576)} MiB is above the limit of ${MAX_BRON_BYTES / 1048576} MiB`);
    }
    return false;
  }
  const fp = vingerafdruk(doc, wijzigTeller(doc.id));
  const t0 = performance.now();
  let bytes;
  try {
    const { bouwMomentopname } = await import('../pdf/saver.js');
    bytes = await bouwMomentopname(doc);
  } catch (e) {
    console.warn(`[herstel] snapshot of "${doc.fileName}" failed (${reden}): ${e?.message || e}`);
    r.plan = { ...r.plan, laatsteOpname: Date.now(), tussenpoos: 60_000 };
    return false;
  }
  if (!state.documents.includes(doc) || !doc.modified) return false;
  const manifest = maakManifest({
    sleutel: r.sleutel,
    instantie: info.instantie,
    sessie,
    doc,
    origineelPad: origineelPadVan(doc),
    origineel: r.bron,
    appVersie: info.versie,
    nu: Date.now(),
    reden,
  });
  try {
    await schrijfMomentopname(adapter, { sleutel: r.sleutel, bytes, manifest });
  } catch (e) {
    console.warn(`[herstel] writing the snapshot of "${doc.fileName}" failed: ${e?.message || e}`);
    r.plan = { ...r.plan, laatsteOpname: Date.now(), tussenpoos: 60_000 };
    return false;
  }
  const duur = Math.round(performance.now() - t0);
  r.heeftOpname = true;
  r.plan = naOpname(r.plan, fp, Date.now(), duur);
  log(`snapshot "${doc.fileName}" (${reden}): ${bytes.length} bytes in ${duur} ms -> ${r.sleutel}`);
  return true;
}

async function verwijderEigen(docId, waarom) {
  const r = plannen.get(docId);
  plannen.delete(docId);
  const sleutel = r?.sleutel || eigenSleutel(docId);
  try {
    if (await adapter.verwijder(sleutel)) log(`snapshot ${sleutel} removed (${waarom})`);
  } catch (e) {
    console.warn(`[herstel] removing ${sleutel} failed: ${e?.message || e}`);
  }
}

/** Eén ronde van de bewaking. */
export function tik() {
  if (!gestart || tikBezig) return Promise.resolve();
  tikBezig = true;
  return inRij(async () => {
    const nu = Date.now();
    const docs = state.documents.slice();
    const ids = new Set(docs.map((d) => d.id));
    for (const id of [...plannen.keys()]) {
      if (!ids.has(id)) await verwijderEigen(id, 'document closed');
    }
    for (const doc of docs) {
      if (nietGeschikt(doc)) continue;
      const r = await registratie(doc);
      r.plan = werkBij(r.plan, { fp: vingerafdruk(doc, wijzigTeller(doc.id)), gewijzigd: !!doc.modified }, nu);
      if (!doc.modified) {
        if (r.heeftOpname) {
          await verwijderEigen(doc.id, 'no unsaved changes');
          plannen.set(doc.id, { ...r, plan: r.plan, heeftOpname: false });
        }
        continue;
      }
      if (isAanDeBeurt(r.plan, Date.now(), { stilte: STILTE_MS, maxWacht: MAX_WACHT_MS })) {
        await maakOpname(doc, r, 'scheduled');
      }
    }
  }).finally(() => { tikBezig = false; });
}

/** Meteen een momentopname van alle gewijzigde documenten (na een fout). */
export function noodopslag(reden) {
  if (!gestart) return Promise.resolve(0);
  return inRij(async () => {
    const t0 = performance.now();
    let aantal = 0;
    let gewijzigd = 0;
    for (const doc of state.documents.slice()) {
      if (!doc.modified || nietGeschikt(doc)) continue;
      gewijzigd++;
      const r = await registratie(doc);
      if (await maakOpname(doc, r, `emergency:${reden}`)) aantal++;
    }
    const tekst = `emergency snapshot after ${reden}: ${aantal} of ${gewijzigd} modified document(s) in ${Math.round(performance.now() - t0)} ms`;
    log(tekst);
    if (gewijzigd > 0) await crashlog('emergency-snapshot', tekst);
    return aantal;
  });
}

const ontvanger = {
  opgeslagen(doc) {
    if (!gestart || !doc?.id) return;
    if (doc.hersteld) doc.hersteld = false;
    inRij(() => verwijderEigen(doc.id, 'saved'));
  },
  gesloten(doc) {
    if (!gestart || !doc?.id) return;
    inRij(() => verwijderEigen(doc.id, 'closed'));
  },
  async schoonAfsluiten() {
    if (!gestart) return;
    gestart = false;
    clearInterval(tikTimer);
    await inRij(async () => {
      const voorvoegsel = sessieVoorvoegsel(info.instantie.id, sessie);
      const items = await adapter.lijst('').catch(() => []);
      for (const i of items) {
        if (i.map && i.naam.startsWith(voorvoegsel)) await adapter.verwijder(i.naam).catch(() => {});
      }
      plannen.clear();
    });
    try { await tauriInvoke('herstel_schoon_afsluiten'); } catch { /* best effort */ }
  },
};

// ─── Aanbod bij de start ───────────────────────────────────────────────────

async function naarAanbod(item) {
  const m = item.manifest;
  let gewijzigd = null;
  if (m.origineelPad) {
    try { gewijzigd = origineelGewijzigd(m, await tauriInvoke('herstel_bron_info', { pad: m.origineelPad })); } catch { gewijzigd = null; }
  }
  return {
    sleutel: item.sleutel,
    titel: m.titel,
    origineelPad: m.origineelPad,
    tijdMs: m.tijdMs,
    paginas: m.paginas,
    pdf: m.pdf,
    origineelGewijzigd: gewijzigd === true,
    manifest: m,
  };
}

function aanbodRegel(a) {
  return `"${a.titel || '(untitled)'}" (${a.origineelPad || 'never saved'}), saved ${new Date(a.tijdMs).toISOString()}, ${a.paginas} page(s)${a.origineelGewijzigd ? ', original changed since' : ''}, key ${a.sleutel}`;
}

/** Wat is er van eerdere instanties blijven staan? Opruimen en aanbieden. */
export function beoordeelBijStart() {
  return inRij(async () => {
    const eigenId = info.instantie.id;
    // Markeringen van instanties die niet meer draaien: niet netjes afgesloten.
    const markers = await leesMarkers(adapter);
    const levend = markers.length
      ? await tauriInvoke('herstel_processen', { lijst: markers.map((m) => ({ pid: m.pid, gestartMs: m.gestartMs })) })
      : [];
    const { onrein } = beoordeelMarkers(markers.map((m, i) => ({ ...m, leeft: !!levend[i] })), { eigenId });
    for (const m of onrein) {
      const tekst = `previous instance ${m.id} (pid ${m.pid}, version ${m.versie}${m.tweede ? ', torn-off tab' : ''}) did not shut down cleanly`;
      log(tekst);
      await crashlog('unclean-exit', tekst);
      await adapter.verwijder(`markers/${m.bestand}`).catch(() => {});
    }

    const items = await leesAlle(adapter);
    const andere = [...new Set(items
      .map((i) => i.manifest?.instantie?.id || instantieUitSleutel(i.sleutel))
      .filter((id) => id && id !== eigenId))]
      .map(procesUitId)
      .filter(Boolean);
    const leeftLijst = andere.length
      ? await tauriInvoke('herstel_processen', { lijst: andere.map((p) => ({ pid: p.pid, gestartMs: p.gestartMs })) })
      : [];
    const leeft = new Map(andere.map((p, i) => [p.id, !!leeftLijst[i]]));
    const indeling = deelIn(items, { eigen: { id: eigenId, sessie }, leeft: (id) => leeft.get(id) ?? false, nu: Date.now() });
    for (const v of indeling.verwijderen) {
      await adapter.verwijder(v.sleutel).catch(() => {});
      log(`removed ${v.sleutel} (${v.reden})`);
    }
    const lijst = [];
    for (const w of indeling.wees) {
      let geclaimd = false;
      try { geclaimd = await tauriInvoke('herstel_claim', { rel: w.sleutel }); } catch { geclaimd = false; }
      if (geclaimd) lijst.push(await naarAanbod(w));
    }
    setAanbod(lijst);
    return lijst;
  }).then(async (lijst) => {
    if (!lijst.length) return lijst;
    const regels = lijst.map((a) => `  - ${aanbodRegel(a)}`).join('\n');
    if (info.headless || isHeadless()) {
      await logboek(`recovery offer (headless, no dialog): ${lijst.length} document(s)\n${regels}`);
    } else {
      log(`recovery offer: ${lijst.length} document(s)\n${regels}`);
      const { openDialog } = await import('../solid/stores/dialogStore.js');
      openDialog('recovery');
    }
    return lijst;
  });
}

function haalUitAanbod(sleutel) {
  const rest = aanbod().filter((a) => a.sleutel !== sleutel);
  setAanbod(rest);
  if (!rest.length) import('../solid/stores/dialogStore.js').then((m) => m.closeDialog('recovery')).catch(() => {});
}

function vindAanbod(sleutel) {
  const a = aanbod().find((x) => x.sleutel === sleutel);
  if (!a) throw new Error(`no recovery offer with key ${sleutel}`);
  return a;
}

/**
 * Openen: de momentopname wordt een nieuw, niet-opgeslagen document met het
 * origineel als opslagdoel (Ctrl+S schrijft daarheen; een nooit opgeslagen
 * document vraagt waar). Het tabblad toont dat het hersteld is. De
 * momentopname gaat over naar deze sessie, zodat er geen moment zonder
 * momentopname is tot de gebruiker opslaat of sluit.
 */
export function openHersteld(sleutel) {
  return inRij(async () => {
    const a = vindAanbod(sleutel);
    const werkpad = await tauriInvoke('herstel_werkkopie', { rel: `${sleutel}/${a.pdf}` });
    const [{ createTab, markDocumentModified, updateWindowTitle }, { loadPDF }, { onthoudWerkbestand }] = await Promise.all([
      import('../ui/chrome/tabs.js'),
      import('../pdf/loader.js'),
      import('../pdf/document-release.js'),
    ]);
    const { index } = createTab(werkpad);
    await loadPDF(werkpad, index);
    const doc = state.documents.find((d) => d.filePath === werkpad);
    if (!doc?.pdfDoc) throw new Error('the recovered copy could not be opened');
    doc.saveTargetPath = a.origineelPad || null;
    doc._renderTemp = true;
    doc.isUntitled = !a.origineelPad;
    doc.fileName = a.titel || doc.fileName;
    doc.hersteld = true;
    onthoudWerkbestand(doc, werkpad);
    markDocumentModified(doc);
    updateWindowTitle();
    // Overnemen in deze sessie.
    const nieuw = eigenSleutel(doc.id);
    await tauriInvoke('herstel_hernoem', { van: sleutel, naar: nieuw });
    await adapter.verwijder(`${nieuw}/claim`).catch(() => {});
    await schrijfManifest(adapter, nieuw, {
      ...a.manifest,
      docId: String(doc.id),
      instantie: { ...info.instantie },
      sessie,
      hersteldUit: sleutel,
    });
    plannen.set(doc.id, {
      plan: vastgelegdPlan(vingerafdruk(doc, wijzigTeller(doc.id)), Date.now()),
      sleutel: nieuw,
      bron: a.manifest.origineel || null,
      heeftOpname: true,
      teGrootGemeld: false,
    });
    log(`recovered "${a.titel}" opened from ${sleutel} (save target ${a.origineelPad || 'none'})`);
    haalUitAanbod(sleutel);
    return { docId: doc.id, filePath: werkpad, saveTargetPath: doc.saveTargetPath, sleutel: nieuw };
  });
}

/** Opslaan als…: de momentopname naar een gekozen bestand; daarna weg. */
export async function bewaarHersteldAls(sleutel, doelpad = null) {
  const a = vindAanbod(sleutel);
  let doel = doelpad;
  if (!doel) {
    const { saveFileDialog } = await import('../core/platform.js');
    doel = await saveFileDialog(a.origineelPad || `${(a.titel || 'document').replace(/\.pdf$/i, '')}.pdf`);
  }
  if (!doel) return false;
  return inRij(async () => {
    await tauriInvoke('herstel_kopieer', { rel: `${sleutel}/${a.pdf}`, doel });
    await adapter.verwijder(sleutel);
    log(`recovered "${a.titel}" saved as ${doel}`);
    haalUitAanbod(sleutel);
    return true;
  });
}

export function verwijderHersteld(sleutel) {
  return inRij(async () => {
    await adapter.verwijder(sleutel);
    log(`recovery snapshot ${sleutel} deleted by the user`);
    haalUitAanbod(sleutel);
    return true;
  });
}

export async function verwijderAllesHersteld() {
  for (const a of aanbod().slice()) await verwijderHersteld(a.sleutel);
  return true;
}

/** Later: alles blijft staan (tot het is afgehandeld of 14 dagen oud is). */
export async function herstelLater() {
  const { closeDialog } = await import('../solid/stores/dialogStore.js');
  closeDialog('recovery');
  log(`recovery postponed: ${aanbod().length} document(s) stay`);
}

// ─── Start ─────────────────────────────────────────────────────────────────

function nieuweSessie() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Start de bewaking. `hoofd`: alleen de hoofdinstantie biedt herstel aan.
 * @param {{hoofd:boolean}} o
 */
export async function startHerstel({ hoofd = true } = {}) {
  if (gestart || !window.__TAURI__?.core?.invoke) return false;
  try {
    info = await tauriInvoke('herstel_info');
  } catch (e) {
    console.warn('[herstel] not available:', e);
    return false;
  }
  sessie = nieuweSessie();
  gestart = true;
  zetOntvanger(ontvanger);

  // Na een automatische herlaadbeurt (renderer-crash, crashlog.rs): logregel,
  // en een melding als er niet meer automatisch herladen wordt.
  const naCrash = naHerladen(info.webview, { headless: !!(info.headless || isHeadless()) });
  if (naCrash.log) logboek(naCrash.log);
  if (naCrash.toonMelding) {
    Promise.all([import('../solid/stores/dialogStore.js'), import('../i18n/config.js')])
      .then(([{ showMessage }, { default: i18next }]) => showMessage(i18next.t('dialogs:recovery.reloadStopped')))
      .catch(() => {});
  }

  const vanger = maakFoutvanger({
    noodopslag: (soort) => noodopslag(soort),
    schrijfLog: (soort, tekst) => crashlog(soort, tekst),
  });
  vanger.installeer(window);

  try {
    await window.__TAURI__.event.listen('herstel-nood', async (e) => {
      try { await noodopslag(e?.payload?.reden || 'rust-panic'); } finally {
        try { await tauriInvoke('herstel_nood_klaar'); } catch { /* Rust wacht niet meer */ }
      }
    });
  } catch (e) {
    console.warn('[herstel] emergency listener not installed:', e);
  }

  tikTimer = setInterval(() => { tik(); }, TIK_MS);

  // Voor tests (MCP/CDP) en diagnose: dezelfde handelingen als het venster.
  window.__OPDS_HERSTEL__ = {
    status: () => ({
      instantie: info.instantie,
      sessie,
      map: info.map,
      documenten: [...plannen.entries()].map(([id, r]) => ({ id, sleutel: r.sleutel, heeftOpname: r.heeftOpname, plan: { ...r.plan } })),
      foutvanger: { ...vanger.telling },
    }),
    aanbod: () => aanbod().map(({ manifest, ...rest }) => ({ ...rest })),
    tik,
    nood: (reden = 'test') => noodopslag(reden),
    beoordeel: () => beoordeelBijStart(),
    openen: openHersteld,
    opslaanAls: bewaarHersteldAls,
    verwijderen: verwijderHersteld,
    allesVerwijderen: verwijderAllesHersteld,
    later: herstelLater,
    // Het venster ook headless tonen (alleen voor een opname via CDP; het
    // aanbod bij de start opent het headless nooit).
    toonVenster: async () => (await import('../solid/stores/dialogStore.js')).openDialog('recovery'),
  };

  log(`watching unsaved work: instance ${info.instantie.id}, session ${sessie}, ${info.map}`);
  if (hoofd) {
    beoordeelBijStart().catch((e) => console.warn('[herstel] start review failed:', e));
  }
  return true;
}
