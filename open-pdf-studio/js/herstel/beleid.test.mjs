import test from 'node:test';
import assert from 'node:assert/strict';
import { deelIn, beoordeelMarkers, MAX_LEEFTIJD_MS, ONVOLLEDIG_NA_MS } from './beleid.js';
import { sleutelVoor } from './manifest.js';

const DAG = 24 * 60 * 60 * 1000;
const NU = 1_800_000_000_000;
const IK = { id: '100-1000', sessie: 'aaaaaaaa' };

function item({ instantie, sessie = 'bbbbbbbb', doc = 'd', leeftijd = 0, grootte = 100, onvolledig = false }) {
  const sleutel = sleutelVoor(instantie, sessie, doc);
  return {
    sleutel,
    onvolledig,
    grootte,
    gewijzigdMs: NU - leeftijd,
    manifest: onvolledig ? null : { sleutel, instantie: { id: instantie }, sessie, tijdMs: NU - leeftijd, pdf: 'momentopname-1.pdf' },
  };
}

const sleutels = (lijst) => lijst.map((i) => i.sleutel ?? i).sort();

test('eigen sessie beheert zichzelf; eerdere sessie van dit proces is wees', () => {
  const eigen = item({ instantie: IK.id, sessie: IK.sessie, doc: 'e' });
  const vorigeSessie = item({ instantie: IK.id, sessie: 'cccccccc', doc: 'v' });
  const uit = deelIn([eigen, vorigeSessie], { eigen: IK, leeft: () => { throw new Error('niet nodig'); }, nu: NU });
  assert.deepEqual(sleutels(uit.eigen), [eigen.sleutel]);
  assert.deepEqual(sleutels(uit.wees), [vorigeSessie.sleutel], 'WebView uitgevallen en herladen');
  assert.deepEqual(uit.verwijderen, []);
});

test('meerdere instanties: een levende andere instantie wordt niet aangeraakt', () => {
  const levend = item({ instantie: '200-2000', doc: 'l', leeftijd: 20 * DAG, onvolledig: false });
  const levendHalf = item({ instantie: '200-2000', doc: 'h', leeftijd: 5 * DAG, onvolledig: true });
  const dood = item({ instantie: '300-3000', doc: 'x' });
  const uit = deelIn([levend, levendHalf, dood], { eigen: IK, leeft: (id) => id === '200-2000', nu: NU });
  assert.deepEqual(sleutels(uit.anderLevend), sleutels([levend, levendHalf]), 'ook niet als ze oud of onvolledig zijn');
  assert.deepEqual(sleutels(uit.wees), [dood.sleutel]);
  assert.deepEqual(uit.verwijderen, []);
});

test('opruimen: wezen ouder dan 14 dagen, onvolledig ouder dan een dag', () => {
  const vers = item({ instantie: '300-3000', doc: 'vers', leeftijd: 13 * DAG });
  const oud = item({ instantie: '300-3000', doc: 'oud', leeftijd: MAX_LEEFTIJD_MS + 1 });
  const halfVers = item({ instantie: '300-3000', doc: 'hv', leeftijd: ONVOLLEDIG_NA_MS - 1000, onvolledig: true });
  const halfOud = item({ instantie: '300-3000', doc: 'ho', leeftijd: ONVOLLEDIG_NA_MS + 1000, onvolledig: true });
  const eigenHalf = item({ instantie: IK.id, sessie: IK.sessie, doc: 'eh', leeftijd: 2 * DAG, onvolledig: true });
  const uit = deelIn([vers, oud, halfVers, halfOud, eigenHalf], { eigen: IK, leeft: () => false, nu: NU });
  assert.deepEqual(sleutels(uit.wees), [vers.sleutel]);
  assert.deepEqual(uit.verwijderen.map((v) => [v.sleutel, v.reden]).sort(), [
    [halfOud.sleutel, 'onvolledig'],
    [oud.sleutel, 'verlopen'],
  ].sort());
  assert.deepEqual(sleutels(uit.eigen), [eigenHalf.sleutel], 'eigen opname in wording blijft');
});

test('opruimen: te veel in totaal = oudste wezen eerst weg', () => {
  const a = item({ instantie: '300-3000', doc: 'a', leeftijd: 3 * DAG, grootte: 600 });
  const b = item({ instantie: '300-3000', doc: 'b', leeftijd: 2 * DAG, grootte: 600 });
  const c = item({ instantie: '300-3000', doc: 'c', leeftijd: 1 * DAG, grootte: 600 });
  const levend = item({ instantie: '200-2000', doc: 'l', grootte: 600 });
  const uit = deelIn([a, b, c, levend], { eigen: IK, leeft: (id) => id === '200-2000', nu: NU, maxTotaal: 1500 });
  assert.deepEqual(uit.verwijderen.map((v) => [v.sleutel, v.reden]), [[a.sleutel, 'te-groot'], [b.sleutel, 'te-groot']]);
  assert.deepEqual(sleutels(uit.wees), [c.sleutel]);
  assert.deepEqual(sleutels(uit.anderLevend), [levend.sleutel], 'van een levende instantie gaat nooit iets weg');
});

test('aanbod: nieuwste eerst', () => {
  const oud = item({ instantie: '300-3000', doc: 'o', leeftijd: 2 * DAG });
  const nieuw = item({ instantie: '400-4000', doc: 'n', leeftijd: 1000 });
  const uit = deelIn([oud, nieuw], { eigen: IK, leeft: () => false, nu: NU });
  assert.deepEqual(uit.wees.map((w) => w.sleutel), [nieuw.sleutel, oud.sleutel]);
});

test('markers: eigen en levende tellen niet als onrein, alleen dode', () => {
  const markers = [
    { id: IK.id, pid: 100, gestartMs: 1000, leeft: true },
    { id: '200-2000', pid: 200, gestartMs: 2000, leeft: true },
    { id: '300-3000', pid: 300, gestartMs: 3000, leeft: false },
    { id: '400-4000', pid: 400, gestartMs: 4000, leeft: false, tweede: true },
  ];
  const uit = beoordeelMarkers(markers, { eigenId: IK.id });
  assert.equal(uit.eigen.id, IK.id);
  assert.deepEqual(uit.levend.map((m) => m.id), ['200-2000']);
  assert.deepEqual(uit.onrein.map((m) => m.id), ['300-3000', '400-4000']);
  // Ook als de eigen markering (onterecht) als dood gemeld wordt: nooit onrein.
  assert.deepEqual(beoordeelMarkers([{ id: IK.id, leeft: false }], { eigenId: IK.id }).onrein, []);
});

test('markers: twee instanties tegelijk zien elkaar als levend', () => {
  const a = { id: '500-5000', pid: 500, gestartMs: 5000 };
  const b = { id: '600-6000', pid: 600, gestartMs: 6000 };
  const leeft = (m) => ({ ...m, leeft: true });
  assert.deepEqual(beoordeelMarkers([leeft(a), leeft(b)], { eigenId: a.id }).onrein, []);
  assert.deepEqual(beoordeelMarkers([leeft(a), leeft(b)], { eigenId: b.id }).onrein, []);
  // En hun momentopnamen ook.
  const vanA = item({ instantie: a.id, sessie: 'aaaa1111', doc: 'x' });
  const vanB = item({ instantie: b.id, sessie: 'bbbb2222', doc: 'y' });
  const zichtB = deelIn([vanA, vanB], { eigen: { id: b.id, sessie: 'bbbb2222' }, leeft: () => true, nu: NU });
  assert.deepEqual(sleutels(zichtB.anderLevend), [vanA.sleutel]);
  assert.deepEqual(sleutels(zichtB.eigen), [vanB.sleutel]);
  assert.deepEqual(zichtB.wees, []);
  assert.deepEqual(zichtB.verwijderen, []);
});

// Een achtergebleven document wordt één keer vanzelf aangeboden: na "Later"
// komt het venster er bij de volgende start niet meer voor.
import { nogNietUitgesteld, werkUitgesteldBij } from './beleid.js';

test('alleen wat nog niet is uitgesteld opent het venster bij de start', () => {
  assert.deepEqual(nogNietUitgesteld(['a', 'b', 'c'], ['b']), ['a', 'c']);
  assert.deepEqual(nogNietUitgesteld(['a'], ['a']), [], 'alles al eens uitgesteld: geen venster');
  assert.deepEqual(nogNietUitgesteld(['a'], null), ['a']);
  assert.deepEqual(nogNietUitgesteld([], ['a']), []);
});

test('uitstellen onthoudt de aangeboden documenten en vergeet wat niet meer bestaat', () => {
  assert.deepEqual(werkUitgesteldBij(['oud-weg', 'a'], ['a', 'b'], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(werkUitgesteldBij(['a'], [], ['a', 'b']), ['a'], 'zonder uitstel alleen opruimen');
  assert.deepEqual(werkUitgesteldBij('rommel', ['a'], ['a']), ['a']);
});
