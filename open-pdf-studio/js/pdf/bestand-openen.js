// Een PDF openen vanaf een gesynchroniseerde SharePoint-/OneDrive-map of een
// netwerkpad (#1005). Rust leest het document zelf (read_document_file: delen
// voor lezen, schrijven en verwijderen, buiten de fs-scope om, en een
// plaatshouder die alleen online staat wordt daarbij opgehaald) en vergrendelt
// het pas daarna (lock_document_file). Lukt vergrendelen niet, dan opent het
// document alleen-lezen en gaat Opslaan naar Opslaan als, in plaats van dat
// het niet opent. Een fout zegt welk pad, welke stap en wat er misging, in
// plaats van alleen "toegang geweigerd" (src-tauri/src/bestand_openen.rs).
//
// Puur op de afhankelijkheden na die de aanroeper meegeeft, zodat de tests
// het los draaien.

const STAPPEN = ['scope', 'vergrendelen', 'lezen'];
const SOORTEN = ['niet-gevonden', 'geweigerd', 'in-gebruik', 'alleen-online', 'netwerk', 'pad-te-lang', 'anders'];
const REDENEN = ['kenmerk', 'in-gebruik', 'geweigerd', 'mislukt'];

// Windows-foutcodes van de cloudbestanden-API (bestanden op aanvraag), gelijk
// aan is_cloudfout in bestand_openen.rs.
function isCloudfout(code) {
  return code === 358 || (code >= 362 && code <= 366) || code === 374 || code === 375
    || (code >= 377 && code <= 383) || (code >= 386 && code <= 398)
    || code === 404 || code === 426 || code === 475;
}

const NETWERKCODES = new Set([51, 53, 59, 64, 67, 121, 1203, 1222, 1231, 1232, 2250]);

/** Soort van een Windows-foutcode (zelfde indeling als soort_van_fout in Rust). */
export function soortVanOsCode(code, plaatshouder = false) {
  if (code === 2 || code === 3) return 'niet-gevonden';
  if (code === 206) return 'pad-te-lang';
  if (code === 5) return plaatshouder ? 'alleen-online' : 'geweigerd';
  if (code === 32 || code === 33) return 'in-gebruik';
  if (isCloudfout(code)) return 'alleen-online';
  if (NETWERKCODES.has(code)) return 'netwerk';
  return 'anders';
}

/**
 * Een fout van read_document_file/lock_document_file (al een object met
 * stap en soort), of een tekst van de fs-plugin (terugval, mobiel), als
 * `{ stap, soort, pad, code, melding }`.
 */
export function normaliseerOpenFout(fout, pad = '') {
  if (fout && typeof fout === 'object' && fout.openFout) return fout.openFout;
  if (fout && typeof fout === 'object' && STAPPEN.includes(fout.stap) && SOORTEN.includes(fout.soort)) {
    return {
      stap: fout.stap,
      soort: fout.soort,
      pad: fout.pad || pad,
      code: typeof fout.code === 'number' ? fout.code : null,
      melding: String(fout.melding || ''),
      padInfo: fout.padInfo || null,
    };
  }
  const melding = String((fout && typeof fout === 'object' ? fout.message : fout) ?? '').trim();
  // De fs-plugin weigert een pad buiten zijn scope zo; dat is geen
  // Windows-weigering maar een controle van de app.
  if (/forbidden path/i.test(melding)) {
    return { stap: 'scope', soort: 'geweigerd', pad, code: null, melding, padInfo: null };
  }
  const m = /os error (\d+)/i.exec(melding);
  const code = m ? Number(m[1]) : null;
  let soort = code !== null ? soortVanOsCode(code) : 'anders';
  if (code === null) {
    if (/not found|cannot find|no such file/i.test(melding)) soort = 'niet-gevonden';
    else if (/access is denied|permission denied|access denied/i.test(melding)) soort = 'geweigerd';
    else if (/used by another process|sharing violation/i.test(melding)) soort = 'in-gebruik';
  }
  return { stap: 'lezen', soort, pad, code, melding, padInfo: null };
}

/**
 * De melding voor de gebruiker: welk bestand, bij welke stap, wat er misging
 * en wat te doen, met de tekst van Windows als detail.
 */
export function openFoutMelding(fout, t, pad = '') {
  const f = normaliseerOpenFout(fout, pad);
  const reden = f.stap === 'scope'
    ? t('openFile.reason.scope')
    : t(`openFile.reason.${SOORTEN.includes(f.soort) ? f.soort : 'anders'}`);
  const delen = [t('openFile.failed', { path: f.pad || pad, step: t(`openFile.step.${f.stap}`) }), reden];
  // Een WebDAV-pad: het synchroniseren van de bibliotheek werkt beter.
  if (f.padInfo?.soort === 'webdav' && f.soort !== 'niet-gevonden') delen.push(t('openFile.hintWebdav'));
  if (f.padInfo?.lang && f.soort !== 'pad-te-lang') delen.push(t('openFile.hintLongPath'));
  if (f.melding) delen.push(t('openFile.detail', { detail: f.melding }));
  return delen.join('\n\n');
}

/** De melding dat een document alleen-lezen geopend is. */
export function alleenLezenMelding(reden, naam, t) {
  const r = REDENEN.includes(reden) ? reden : 'mislukt';
  return `${t(`openFile.readOnly.${r}`, { name: naam })}\n\n${t('openFile.readOnly.saveAs')}`;
}

/** Een fout die de melding al bevat; `openFout` houdt de gegevens vast. */
export class OpenBestandFout extends Error {
  constructor(openFout, melding) {
    super(melding);
    this.name = 'OpenBestandFout';
    this.openFout = openFout;
  }
}

function isOnbekendCommando(fout, cmd) {
  const tekst = String((fout && typeof fout === 'object' ? fout.message : fout) ?? '');
  return tekst.includes(cmd) && /not found|unknown command|not allowed/i.test(tekst);
}

/**
 * Lees het document. `invoke` is het Tauri-commando; `leesTerugval` de oude
 * route (fs-plugin), voor een backend zonder read_document_file.
 * @returns {Promise<Uint8Array>}
 * @throws {OpenBestandFout}
 */
export async function leesDocument(pad, { invoke, leesTerugval, t }) {
  let data;
  try {
    try {
      data = await invoke('read_document_file', { path: pad });
    } catch (e) {
      if (!leesTerugval || !isOnbekendCommando(e, 'read_document_file')) throw e;
      data = await leesTerugval(pad);
    }
  } catch (e) {
    const f = normaliseerOpenFout(e, pad);
    throw new OpenBestandFout(f, openFoutMelding(f, t, pad));
  }
  if (!data) throw new OpenBestandFout(
    { stap: 'lezen', soort: 'anders', pad, code: null, melding: '', padInfo: null },
    openFoutMelding({ stap: 'lezen', soort: 'anders', pad, melding: '' }, t, pad),
  );
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Vergrendel het gelezen document en hoor of het alleen-lezen opent.
 * Nooit een fout: lukt het niet, dan alleen-lezen met een reden.
 * `vergrendelTerugval` is de oude lock_file-route.
 * @returns {Promise<{ alleenLezen: boolean, reden: string|null, fout: object|null }>}
 */
export async function vergrendelDocument(pad, { invoke, vergrendelTerugval }) {
  try {
    const r = await invoke('lock_document_file', { path: pad });
    return {
      alleenLezen: r?.alleenLezen === true,
      reden: r?.alleenLezen ? (REDENEN.includes(r.reden) ? r.reden : 'mislukt') : null,
      fout: r?.fout ? normaliseerOpenFout(r.fout, pad) : null,
    };
  } catch (e) {
    if (vergrendelTerugval && isOnbekendCommando(e, 'lock_document_file')) {
      // Oude backend: vergrendelen zoals vroeger, altijd bewerkbaar.
      try { await vergrendelTerugval(pad); } catch { /* best effort */ }
      return { alleenLezen: false, reden: null, fout: null };
    }
    return { alleenLezen: true, reden: 'mislukt', fout: normaliseerOpenFout(e, pad) };
  }
}

/** Gaat Opslaan bij dit document naar Opslaan als (alleen-lezen geopend)? */
export function opslaanNaarOpslaanAls(doc) {
  return !!doc && !!doc.bestandAlleenLezen;
}
