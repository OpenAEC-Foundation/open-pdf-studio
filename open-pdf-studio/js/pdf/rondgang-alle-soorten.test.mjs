// Rondgang van elke annotatiesoort die een markeringswerkstroom in de bouw
// maakt (#629, met #555, #618, #619 en #621).
//
// Eén bestand, met pdf-lib gebouwd: elke soort uit de PDF-specificatie die
// zo'n werkstroom oplevert, plus een boog en een gebogen aanwijzer zoals de
// app ze schrijft (PolyLine met eigen sleutels) en zoals een ander programma
// ze schrijft (Ink en PolyLine met eigen sleutels). Elke annotatie draagt
// /NM, /Subj, /T, /M, /CreationDate, /F, /CA, /C, /BS, en waar het past /IC,
// /BE (wolk), /RC, /DS, /OC, antwoorden en groepen (/IRT + /RT),
// statusantwoorden (/State + /StateModel, ook Marked), en sleutels van een
// ander programma (/XYZ_Private met geneste arrays en een stroom). /Contents
// staat vol lastige tekens: ( ) \ en haakjes die niet sluiten, €, ², °, ±,
// Ø, emoji, CJK en tekst van rechts naar links.
//
// Laden met de echte lader en opslaan met de echte saver
// (rondgang.testhulp.mjs), en dan:
//   a) zonder bewerking: elk annotatiewoordenboek komt sleutel voor sleutel
//      en waarde voor waarde terug, ook de appearance;
//   b) één annotatie verplaatst: alleen die verandert, en alleen haar
//      geometrie, /M en /AP; alle andere blijven gelijk. De soort en /IT
//      veranderen nooit.
// Elk scenario twee keer achter elkaar (opslaan -> heropenen -> opslaan).
//
// Woordenboeken vergelijken we ontleed: een verwijzing naar een andere
// annotatie wordt haar /NM, een verwijzing naar de pagina 'pagina', en elk
// ander object wordt opgevolgd. Objectnummers tellen dus niet mee.

import assert from 'node:assert/strict';
import test from 'node:test';
import { opslaan, laad } from './rondgang.testhulp.mjs';
import { bouwBron, annotaties, ontleed, ontleedAlle, N } from './rondgang-alle-soorten.testhulp.mjs';

const { applyMove } = await import('../annotations/transforms.js');

/**
 * Elke annotatie van `voor` staat ongewijzigd in `na`, behalve:
 * - `behalve`: naam -> sleutels die mogen veranderen (geen sleutel erbij of weg);
 * - `vast`: naam -> de enige sleutels die gelijk moeten blijven (de annotatie
 *   is opnieuw opgebouwd).
 * De soort (/Subtype) en de bedoeling (/IT) blijven altijd.
 */
function vergelijk(voor, na, { behalve = new Map(), vast = new Map() } = {}) {
  assert.deepEqual([...na.perNaam.keys()].sort(), [...voor.perNaam.keys()].sort(), 'dezelfde annotaties');
  assert.equal(na.aantal, voor.aantal, 'geen annotatie erbij of weg');
  const v = ontleedAlle(voor);
  const w = ontleedAlle(na);
  for (const [naam, oud] of v) {
    const nieuw = w.get(naam);
    assert.equal(nieuw.Subtype, oud.Subtype, `${naam}: de soort blijft`);
    assert.deepEqual(nieuw.IT, oud.IT, `${naam}: de bedoeling (/IT) blijft`);
    const mag = behalve.get(naam);
    const moet = vast.get(naam);
    if (moet) {
      for (const k of moet) assert.deepEqual(nieuw[k], oud[k], `${naam}: /${k} blijft`);
      continue;
    }
    if (!mag) {
      assert.deepEqual(nieuw, oud, `${naam} ongewijzigd`);
      continue;
    }
    assert.deepEqual(Object.keys(nieuw).sort(), Object.keys(oud).sort(), `${naam}: geen sleutel erbij of weg`);
    for (const k of Object.keys(oud)) {
      if (mag.has(k)) continue;
      assert.deepEqual(nieuw[k], oud[k], `${naam}: /${k} ongewijzigd`);
    }
  }
}

// Wat een verplaatsing mag veranderen: de geometrie (ook /RD: een aanwijzer
// verplaatst alleen haar tekstvak), /M en /AP, en de geometrie in de eigen
// sleutels van de app.
const GEOMETRIE = new Set(['Rect', 'L', 'Vertices', 'InkList', 'QuadPoints', 'CL', 'RD', 'M', 'AP', 'OPS_Points', 'OPS_CenterX', 'OPS_CenterY']);
// Wat een herschreven annotatie (een andere kleur) altijd houdt.
const IDENTITEIT = ['Subtype', 'IT', 'NM', 'Subj', 'T', 'CreationDate', 'IRT', 'RT', 'Popup', 'OC', 'XYZ_Private', 'XYZ_Flag'];

const BRON = await bouwBron();
const BRON_ANNOTATIES = await annotaties(BRON);

/**
 * Opslaan, en nog eens opslaan met dezelfde modellen op het opgeslagen
 * bestand (zoals de app na Ctrl+S doet): de tweede keer verandert niets.
 */
async function opslaanTweeKeer(bron, modellen) {
  const bytes = await opslaan(bron, modellen, { lagen: modellen.lagen });
  const eerste = await annotaties(bytes);
  const weer = await opslaan(bytes, modellen, { lagen: modellen.lagen });
  vergelijk(eerste, await annotaties(weer));
  return { bytes, na: eerste };
}

// ── a) zonder bewerking ────────────────────────────────────────────────────

test('zonder bewerking komt elke annotatie sleutel voor sleutel terug, twee rondgangen lang', async () => {
  let bytes = BRON;
  for (let ronde = 1; ronde <= 2; ronde++) {
    const modellen = await laad(bytes);
    ({ bytes } = await opslaanTweeKeer(bytes, modellen));
    vergelijk(BRON_ANNOTATIES, await annotaties(bytes));
  }
});

// ── b) één annotatie verplaatst ────────────────────────────────────────────

const BEWERKBAAR = [
  'nm-app-boog', 'nm-app-spline', 'nm-notitie', 'nm-tekstvak', 'nm-aanwijzer', 'nm-typemachine', 'nm-lijn',
  'nm-maatlijn', 'nm-rechthoek', 'nm-ellips', 'nm-veelhoek', 'nm-wolk', 'nm-meetvlak', 'nm-polylijn',
  'nm-meetlijn', 'nm-markeer', 'nm-onderstreep', 'nm-doorhaal', 'nm-golf', 'nm-stempel', 'nm-invoeg',
  'nm-inkt', 'nm-xyz-boog', 'nm-xyz-boogaanwijzer', 'nm-groepskind', 'nm-antwoord',
];

/** Laden, het model met /NM `naam` bewerken, opslaan (twee keer) en heropenen. */
async function bewerk(naam, wijzig) {
  const modellen = await laad(BRON);
  const model = modellen.find((m) => m.nm === naam);
  assert.ok(model, `model voor ${naam}`);
  const soort = model.type;
  wijzig(model);
  const { bytes, na } = await opslaanTweeKeer(BRON, modellen);
  // Heropenen en nog eens opslaan zonder bewerking: niets verandert meer.
  const weer = await laad(bytes);
  assert.equal(weer.find((m) => m.nm === naam)?.type, soort, `${naam}: hetzelfde soort model na heropenen`);
  const bytes2 = await opslaan(bytes, weer, { lagen: weer.lagen });
  vergelijk(na, await annotaties(bytes2));
  return na;
}

const rectVan = (a, naam) => a.perNaam.get(naam).get(N('Rect')).asArray().map((v) => v.asNumber());

for (const naam of BEWERKBAAR) {
  test(`${naam} verplaatst: alleen haar geometrie, /M en /AP veranderen, twee rondgangen lang`, async () => {
    const na = await bewerk(naam, (m) => applyMove(m, 15, -10));
    vergelijk(BRON_ANNOTATIES, na, { behalve: new Map([[naam, GEOMETRIE]]) });
    const voor = rectVan(BRON_ANNOTATIES, naam);
    const nu = rectVan(na, naam);
    assert.notDeepEqual(nu, voor, `${naam} is verplaatst`);
    // Een aanwijzer verplaatst alleen haar tekstvak; al het andere schuift
    // precies 15 naar rechts en 10 omhoog (de y-as van de PDF wijst omhoog).
    if (naam !== 'nm-aanwijzer') {
      const r2 = (v) => Math.round(v * 100) / 100;
      assert.deepEqual(nu.map(r2), voor.map((v, i) => r2(v + (i % 2 ? 10 : 15))), `${naam}: /Rect geschoven`);
    }
  });
}

// ── c) iets wat niet tekent veranderd: de auteur ───────────────────────────

for (const naam of BEWERKBAAR) {
  test(`${naam} met een andere auteur: alleen /T en /M veranderen`, async () => {
    const na = await bewerk(naam, (m) => { m.author = 'Nieuwe auteur € (2'; });
    vergelijk(BRON_ANNOTATIES, na, { behalve: new Map([[naam, new Set(['T', 'M'])]]) });
    assert.equal(na.perNaam.get(naam).get(N('T')).decodeText(), 'Nieuwe auteur € (2');
  });
}

// ── d) iets wat wel tekent veranderd: de kleur ─────────────────────────────

for (const naam of BEWERKBAAR) {
  test(`${naam} in een andere kleur: opnieuw opgebouwd, met dezelfde soort, naam, koppelingen en eigen sleutels`, async () => {
    const na = await bewerk(naam, (m) => { m.color = '#123456'; m.strokeColor = '#123456'; });
    vergelijk(BRON_ANNOTATIES, na, { vast: new Map([[naam, IDENTITEIT]]) });
  });
}

// ── e) de reviewstatus veranderd ───────────────────────────────────────────

test('een nieuwe reviewstatus vervangt alleen de statusantwoorden; de annotatie zelf krijgt alleen een nieuwe /M', async () => {
  const modellen = await laad(BRON);
  const model = modellen.find((m) => m.nm === 'nm-tekstvak');
  assert.equal(model.status, 'completed', 'de laatste status uit het bestand');
  model.status = 'rejected';
  const bytes = await opslaan(BRON, modellen, { lagen: modellen.lagen });
  const na = await annotaties(bytes);
  const v = ontleedAlle(BRON_ANNOTATIES);
  const w = ontleedAlle(na);
  for (const [naam, oud] of v) {
    if (naam === 'nm-status-1' || naam === 'nm-status-2') {
      assert.ok(!w.has(naam), `${naam} is vervangen`);
      continue;
    }
    const nieuw = w.get(naam);
    if (naam === 'nm-tekstvak') {
      assert.deepEqual({ ...nieuw, M: null }, { ...oud, M: null }, 'het tekstvak zelf blijft');
      continue;
    }
    assert.deepEqual(nieuw, oud, `${naam} ongewijzigd`);
  }
  const ref = [...na.naamVanRef].find(([, n]) => n === 'nm-tekstvak')[0];
  const status = [...na.perNaam.values()].filter((d) => d.get(N('State')) && d.get(N('IRT'))?.toString() === ref);
  assert.equal(status.length, 1);
  assert.equal(status[0].get(N('State')).decodeText(), 'Rejected');
  const weer = await laad(bytes);
  assert.equal(weer.find((m) => m.nm === 'nm-tekstvak').status, 'rejected');
});

// ── wat (nog) niet kan ─────────────────────────────────────────────────────

// Een inktannotatie met meer dan één streek: het model van de app ('draw')
// kent één pad. Ongewijzigd, verplaatst of met een andere auteur blijven alle
// streken staan (het woordenboek van het bestand blijft), maar een bewerking
// die tekent (kleur, lijndikte) bouwt de annotatie opnieuw uit het model en
// houdt alleen de eerste streek. Daarvoor moet het model meerdere paden
// kunnen tekenen, verplaatsen en raken.
test('inkt met meerdere streken houdt na een andere kleur al haar streken', { skip: 'het model (type draw) kent één pad; zie de toelichting hierboven' }, async () => {
  const na = await bewerk('nm-inkt', (m) => { m.color = '#123456'; m.strokeColor = '#123456'; });
  assert.equal(na.perNaam.get('nm-inkt').get(N('InkList')).size(), 2);
});
