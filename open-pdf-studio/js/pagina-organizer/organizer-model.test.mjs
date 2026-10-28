// De rekenkant van de pagina-organizer (#764): het plan dat de modus "Pagina's
// bewerken" bijhoudt. Alles hier is puur — geen DOM, geen pdf-lib — zodat de
// regels los te controleren zijn: verplaatsen, draaien, verwijderen, invoegen,
// splitspunten en de vertaling naar het document (welke oude pagina waar komt,
// en welke reeksen de delen zijn).
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  _resetIdTeller, maakPlan, planOngewijzigd, positieVan, verplaats, doelIndexVoorGap, draai,
  verwijder, voegBlancoIn, voegBestandToe, wisselSplitsing, splitsGroepen,
  samenvatting, bouwToewijzing, nieuweNummers, bronPaginas,
} = await import('./organizer-model.js');

function plan4() {
  _resetIdTeller();
  return maakPlan(4);
}

const volgorde = (plan) => plan.items.map((i) => (i.bron === 'doc' ? i.pagina : i.bron));

test('een nieuw plan is het document zelf', () => {
  const plan = plan4();
  assert.deepEqual(volgorde(plan), [1, 2, 3, 4]);
  assert.equal(plan.splits.size, 0);
  assert.ok(planOngewijzigd(plan, 4), 'niets gedaan = ongewijzigd');
});

test('verplaatsen zet losse pagina en hele selecties op hun plek', () => {
  const plan = plan4();
  const [p1, , p3, p4] = plan.items;

  // Pagina 4 naar voren (gap 0).
  assert.deepEqual(volgorde(verplaats(plan, [p4.id], 0)), [4, 1, 2, 3]);
  // Pagina 1 naar achteren: gap 3 in de lijst zonder die pagina = helemaal achteraan.
  assert.deepEqual(volgorde(verplaats(plan, [p1.id], 3)), [2, 3, 4, 1]);
  // Twee niet-aangrenzende pagina's samen naar gap 1.
  assert.deepEqual(volgorde(verplaats(plan, [p1.id, p4.id], 1)), [2, 1, 4, 3]);
  // Een gap voorbij het eind klemt op het eind; een negatieve op het begin.
  assert.deepEqual(volgorde(verplaats(plan, [p1.id], 99)), [2, 3, 4, 1]);
  assert.deepEqual(volgorde(verplaats(plan, [p4.id], -5)), [4, 1, 2, 3]);
});

test('verplaatsen naar de eigen plek levert hetzelfde plan op', () => {
  const plan = plan4();
  const p3 = plan.items[2];
  assert.equal(verplaats(plan, [p3.id], 2), plan, 'geen nieuwe stapel, geen nieuwe stap');
  assert.equal(verplaats(plan, [], 2), plan);
});

test('een gap tussen kaarten omgerekend naar een verplaats-index', () => {
  const plan = plan4();
  const [p1, p2, p3] = plan.items;
  // Alles verplaatsen naar de gap vóór kaart 3 (gap-index 2).
  assert.equal(doelIndexVoorGap(plan, [p1.id], 2), 1, 'de gesleepte pagina telt niet mee');
  assert.equal(doelIndexVoorGap(plan, [p1.id, p2.id], 2), 0);
  assert.equal(doelIndexVoorGap(plan, [p3.id], 0), 0);
  assert.equal(doelIndexVoorGap(plan, [p3.id], 9), 3, 'voorbij het eind klemt achteraan');
  assert.deepEqual(volgorde(verplaats(plan, [p1.id], doelIndexVoorGap(plan, [p1.id], 2))), [2, 1, 3, 4]);
});

test('draaien telt op per pagina en wentelt rond', () => {
  const plan = plan4();
  const [p1, p2] = plan.items;
  const eenKeer = draai(plan, [p1.id, p2.id], 90);
  assert.deepEqual(eenKeer.items.map((i) => i.rotatie), [90, 90, 0, 0]);
  const nogEen = draai(eenKeer, [p1.id], 90);
  assert.deepEqual(nogEen.items.map((i) => i.rotatie), [180, 90, 0, 0]);
  assert.deepEqual(draai(plan, [p1.id], -90).items.map((i) => i.rotatie), [270, 0, 0, 0]);
  assert.equal(draai(plan, [p1.id], 0), plan, 'nul graden verandert niets');
  assert.deepEqual(planOngewijzigd(nogEen, 4), false);
});

test('verwijderen laat het laatste blad staan', () => {
  const plan = plan4();
  const zonder2 = verwijder(plan, [plan.items[1].id]);
  assert.equal(zonder2.ok, true);
  assert.equal(zonder2.verwijderd, 1);
  assert.deepEqual(volgorde(zonder2.plan), [1, 3, 4]);

  const alles = verwijder(plan4(), plan.items.map((i) => i.id));
  assert.equal(alles.ok, false, 'een leeg document kunnen we niet opslaan');
  assert.deepEqual(alles.plan.items.length, 4, 'het plan blijft staan');

  // De laatste pagina mag weg zolang er nog één overblijft.
  const drie = verwijder(plan, plan.items.slice(0, 3).map((i) => i.id));
  assert.equal(drie.ok, true);
  assert.deepEqual(volgorde(drie.plan), [4]);
  assert.equal(verwijder(drie.plan, [drie.plan.items[0].id]).ok, false);
});

test('invoegen van blanco pagina en van een bestand op een gap', () => {
  const plan = plan4();
  const metBlanco = voegBlancoIn(plan, 2, { breedte: 595.28, hoogte: 841.89, aantal: 2 });
  assert.deepEqual(volgorde(metBlanco), [1, 2, 'blanco', 'blanco', 3, 4]);
  assert.deepEqual(
    metBlanco.items.slice(2, 4).map((i) => [i.breedte, i.hoogte]),
    [[595.28, 841.89], [595.28, 841.89]],
  );

  const bytes = new Uint8Array([1, 2, 3]);
  const metBestand = voegBestandToe(plan, 4, { bestandId: 'b1', naam: 'bijlage.pdf', bytes, aantalPaginas: 2 });
  assert.deepEqual(volgorde(metBestand), [1, 2, 3, 4, 'bestand', 'bestand']);
  assert.equal(metBestand.bestanden.get('b1').naam, 'bijlage.pdf');
  assert.equal(metBestand.bestanden.get('b1').bytes, bytes);
  assert.deepEqual(metBestand.items.slice(4).map((i) => i.pagina), [1, 2]);
  assert.equal(plan.bestanden.size, 0, 'het oude plan blijft schoon');
});

test('splitspunten hangen aan de pagina erachter en reizen mee', () => {
  const plan = plan4();
  const [p1, p2, p3, p4] = plan.items;
  assert.equal(wisselSplitsing(plan, p1.id).aan, false, 'vóór de eerste pagina kan geen splitspunt');

  const een = wisselSplitsing(plan, p3.id);
  assert.equal(een.aan, true);
  assert.deepEqual(splitsGroepen(een.plan).map((g) => [g.van, g.tot]), [[1, 2], [3, 4]]);

  const twee = wisselSplitsing(een.plan, p2.id);
  assert.deepEqual(splitsGroepen(twee.plan).map((g) => [g.van, g.tot]), [[1, 1], [2, 2], [3, 4]]);

  // Verhuist pagina 3 naar voren, dan verhuist haar splitspunt mee. Vooraan
  // doet dat niets meer: daar begint het eerste deel al.
  const verhuisd = verplaats(twee.plan, [p3.id], 0);
  assert.deepEqual(volgorde(verhuisd), [3, 1, 2, 4]);
  assert.deepEqual(splitsGroepen(verhuisd).map((g) => g.items.map((i) => i.id)), [
    [p3.id, p1.id], [p2.id, p4.id],
  ]);

  // Verdwijnt die pagina, dan verdwijnt haar splitspunt.
  const weg = verwijder(twee.plan, [p3.id]);
  assert.equal(weg.plan.splits.size, 1);
  assert.deepEqual(splitsGroepen(weg.plan).map((g) => [g.van, g.tot]), [[1, 1], [2, 3]]);

  // Nog een keer klikken haalt het punt weer weg.
  assert.equal(wisselSplitsing(een.plan, p3.id).aan, false);
});

test('samenvatting telt wat de gebruiker deed', () => {
  const plan = plan4();
  let nu = verwijder(plan, [plan.items[0].id]).plan;          // 1 weg
  nu = voegBlancoIn(nu, 1, { breedte: 595, hoogte: 842 });    // 1 blanco erbij
  nu = draai(nu, [nu.items[0].id], 90);                       // 1 gedraaid
  nu = wisselSplitsing(nu, nu.items[1].id).plan;              // 1 splitspunt
  const s = samenvatting(nu, 4);
  assert.equal(s.aantal, 4);
  assert.equal(s.verwijderd, 1);
  assert.equal(s.ingevoegd, 1);
  assert.equal(s.gedraaid, 1);
  assert.equal(s.splitspunten, 1);
  assert.equal(s.delen, 2);
});

test('de vertaling naar het document: oude pagina naar nieuwe plek', () => {
  const plan = plan4();                                   // 1 2 3 4
  const zonder3 = verwijder(plan, [plan.items[2].id]).plan; // 1 2 4
  const gedraaid = draai(zonder3, [zonder3.items[2].id], 90);
  const metBlanco = voegBlancoIn(gedraaid, 0, { breedte: 595, hoogte: 842 });
  const gesplitst = wisselSplitsing(metBlanco, metBlanco.items[2].id).plan;

  const { volgorde: orde, pageMapping, delen, doelPagina } = bouwToewijzing(gesplitst, 4, 2);
  assert.deepEqual(orde.map((v) => v.bron), ['blanco', 'doc', 'doc', 'doc']);
  assert.deepEqual(orde.slice(1).map((v) => v.pagina), [1, 2, 4]);
  // Oude pagina 1 → 2, 2 → 3, 4 → 4; pagina 3 is weg.
  assert.deepEqual(pageMapping, { 1: 2, 2: 3, 3: null, 4: 4 });
  assert.equal(doelPagina, 3, 'de pagina die de gebruiker bekeek');
  // Het splitspunt staat vóór oude pagina 2 (de derde plek in het plan), dus
  // deel 1 is de blanco pagina met oude pagina 1 en deel 2 de rest.
  assert.deepEqual(delen.map((d) => [d.start, d.eind]), [[1, 2], [3, 4]]);
  // De draaiing van oude pagina 4 reist mee naar haar nieuwe plek.
  assert.equal(orde[3].rotatie, 90);

  // Zonder splitspunten is er één deel en blijft de bekeken pagina staan.
  const enkel = bouwToewijzing(maakPlan(3), 3, 2);
  assert.deepEqual(enkel.delen, [{ start: 1, eind: 3, titel: null }]);
  assert.equal(enkel.doelPagina, 2);
  assert.deepEqual(enkel.pageMapping, { 1: 1, 2: 2, 3: 3 });
});

test('een deel heet naar de ingevoegde PDF waar het mee begint', () => {
  _resetIdTeller();
  let plan = maakPlan(2);
  plan = voegBestandToe(plan, 2, { bestandId: 'b1', naam: 'bijlage.pdf', bytes: new Uint8Array(), aantalPaginas: 1 });
  plan = wisselSplitsing(plan, plan.items[2].id).plan;
  assert.deepEqual(bouwToewijzing(plan, 2).delen.map((d) => d.titel), [null, 'bijlage']);
});

test('helpers voor de selectiebalk: nieuwe nummers en bronpagina\'s', () => {
  _resetIdTeller();
  let plan = maakPlan(4);
  plan = voegBlancoIn(plan, 1, { breedte: 595, hoogte: 842 });
  const [p1, , , , p4] = plan.items;
  assert.deepEqual(plan.items.map((i) => i.bron === 'doc' ? i.pagina : 'blanco'), [1, 'blanco', 2, 3, 4]);
  assert.deepEqual(nieuweNummers(plan, [p4.id, p1.id]), [1, 5], 'in planorde, niet in klikorde');
  assert.deepEqual(bronPaginas(plan, [p4.id, plan.items[1].id, p1.id]), [1, 4], 'blanco heeft geen bronpagina');
  assert.equal(positieVan(plan, p4.id), 4);
  assert.equal(positieVan(plan, 'bestaat-niet'), -1);
});
