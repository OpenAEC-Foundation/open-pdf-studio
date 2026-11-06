// Printen op Windows naar een printer die een document schrijft (#699): één
// papiercode met één stand per opdracht, geen eigen maat voor een
// standaardvel en geen ResetDC halverwege. De beslissingen staan puur in
// src-tauri/src/print_plan.rs, met hun beslistabellen als tekst. De
// Rust-tests van de bibliotheek draaien niet op elke machine (en niet in CI),
// dus hier lezen we dezelfde tabellen uit de bron en gaan ze na met een
// JS-weergave van dezelfde regels, plus de bedrading in de printkern.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SRC = new URL('../../src-tauri/src/', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, SRC), 'utf8').replace(/\r\n/g, '\n');

const plan = lees('print_plan.rs');
const windows = lees('print_windows.rs');
const devmode = lees('print_devmode.rs');
const lib = lees('lib.rs');

/** Rijen van de tekst-tabel `naam` in print_plan.rs, velden getrimd. */
function tabel(naam) {
  const m = new RegExp(`const ${naam}: &str = "([^"]*)";`).exec(plan);
  assert.ok(m, `tabel ${naam} niet gevonden`);
  const rijen = m[1].split('\n').map((r) => r.trim()).filter(Boolean).map((r) => r.split('|').map((v) => v.trim()));
  assert.ok(rijen.length > 3, `tabel ${naam} is leeg`);
  return rijen;
}

const ja = (v) => {
  assert.ok(v === 'ja' || v === 'nee', `ja of nee verwacht, niet '${v}'`);
  return v === 'ja';
};
const optie = (v) => (v === '-' ? null : v);
const standen = (v) => [...v].map((c) => c === 'L');
const maat = (v) => (v === '-' ? null : v.split('x').map(Number));

// --- JS-weergave van de regels in print_plan.rs ---

function schakelaar(waarde) {
  if (waarde == null) return null;
  const v = waarde.trim().toLowerCase();
  if (['0', 'uit', 'off', 'false', 'nee', 'no'].includes(v)) return false;
  if (['1', 'aan', 'on', 'true', 'ja', 'yes', 'altijd', 'always'].includes(v)) return true;
  return null;
}

function resetTussenPaginas(document, stuurprogramma, omgeving) {
  const keuze = schakelaar(omgeving);
  if (keuze !== null) return keuze;
  const s = (stuurprogramma ?? '').trim().toLowerCase();
  const eigen = s.startsWith('microsoft print to pdf') || s.startsWith('microsoft xps document writer');
  return !document || (stuurprogramma != null && eigen);
}

function planOpdracht(liggend, resetMag, gelijk) {
  if (liggend.length === 0) return { begin: false, resetMag: false, paginas: [] };
  const wisselen = resetMag && !gelijk;
  const n = liggend.filter(Boolean).length;
  const meerderheid = n === liggend.length - n ? liggend[0] : n > liggend.length - n;
  const begin = wisselen || gelijk ? liggend[0] : meerderheid;
  let vorige = begin;
  const paginas = liggend.map((l) => {
    const doel = wisselen ? l : begin;
    const p = { vel: doel, reset: doel !== vorige };
    vorige = doel;
    return p;
  });
  return { begin, resetMag: wisselen, paginas };
}

// Staande maten in mm: A0–A5, Letter, Legal, Tabloid.
const STANDAARD = [
  [841, 1189], [594, 841], [420, 594], [297, 420], [210, 297], [148, 210],
  [215.9, 279.4], [215.9, 355.6], [279.4, 431.8],
];
function velIsStandaard(code, vel) {
  if (code != null && code >= 1 && code < 256) return true;
  if (!vel) return false;
  const [kort, lang] = [...vel].sort((a, b) => a - b);
  return STANDAARD.some(([k, l]) => Math.abs(k - kort) <= 3 && Math.abs(l - lang) <= 3);
}

function eigenMaatOndersteund(userInLijst, max, m) {
  if (max) return m[0] > 0 && m[1] > 0 && m[0] <= max[0] && m[1] <= max[1];
  return userInLijst;
}

function liggendeWeg(document, omgeving, standaard) {
  const modus = schakelaar(omgeving);
  if (modus === false) return 'stand';
  if (document !== true) return 'stand';
  if (modus === null && standaard) return 'stand';
  return 'vel';
}

// --- De tabellen ---

test('#699: één vel per opdracht waar wisselen niet mag, ResetDC alleen waar het vel echt wisselt', () => {
  for (const r of tabel('PLAN_TABEL')) {
    const p = planOpdracht(standen(r[0]), ja(r[1]), ja(r[2]));
    assert.equal(p.begin, r[3] === 'L', r.join(' | '));
    assert.deepEqual(p.paginas.map((x) => x.vel), standen(r[4]), r.join(' | '));
    assert.deepEqual(p.paginas.map((x) => x.reset), [...r[5]].map((c) => c === 'x'), r.join(' | '));
    assert.equal(p.resetMag, ja(r[1]) && !ja(r[2]), r.join(' | '));
  }
});

test('#699: geen ResetDC tussen pagina\'s bij documentschrijvers, behalve de ingebouwde van Windows', () => {
  for (const r of tabel('RESET_TABEL')) {
    assert.equal(resetTussenPaginas(ja(r[0]), optie(r[1]), optie(r[2])), ja(r[3]), r.join(' | '));
  }
});

test('#699: standaardvel op papiercode of op maat, in beide standen', () => {
  for (const r of tabel('STANDAARD_TABEL')) {
    const code = optie(r[0]) === null ? null : Number(r[0]);
    assert.equal(velIsStandaard(code, maat(r[1])), ja(r[2]), r.join(' | '));
  }
});

test('#699: eigen maat alleen als het stuurprogramma die aanbiedt', () => {
  for (const r of tabel('EIGEN_MAAT_TABEL')) {
    assert.equal(eigenMaatOndersteund(ja(r[0]), maat(r[1]), maat(r[2])), ja(r[3]), r.join(' | '));
  }
});

test('#699: liggend vel alleen bij een documentschrijver met een vel zonder standaardmaat', () => {
  for (const r of tabel('LIGGEND_TABEL')) {
    const document = r[0] === 'onbekend' ? null : ja(r[0]);
    assert.equal(liggendeWeg(document, optie(r[1]), ja(r[2])), r[3], r.join(' | '));
  }
});

test('#699: de Rust-tests lezen dezelfde tabellen', () => {
  for (const naam of ['PLAN_TABEL', 'RESET_TABEL', 'STANDAARD_TABEL', 'EIGEN_MAAT_TABEL', 'LIGGEND_TABEL']) {
    assert.match(plan, new RegExp(`rijen\\(${naam}\\)`), `${naam} wordt in Rust niet getest`);
  }
});

// --- De bedrading ---

/** Het lichaam van `fn naam` (tot de `}` op kolom 0 die erna komt). */
function functie(bron, naam) {
  const start = bron.search(new RegExp(`\\n(?:pub )?fn ${naam}\\b`));
  assert.ok(start >= 0, `fn ${naam} niet gevonden`);
  const eind = bron.indexOf('\n}\n', start);
  assert.ok(eind > start, `fn ${naam} sluit niet`);
  return bron.slice(start, eind + 2);
}

const zonderCommentaar = (bron) => bron.replace(/^\s*\/\/.*$/gm, '');

test('#699: print_plan wordt op elk platform gebouwd', () => {
  assert.match(lib, /\npub mod print_plan;/);
  assert.doesNotMatch(lib, /#\[cfg\([^)]*\)\]\s*pub mod print_plan;/);
});

test('#699: de printkern volgt het plan en zet de DC alleen om via reset_nodig', () => {
  const kern = zonderCommentaar(functie(windows, 'print_met_devmodes'));
  assert.match(kern, /plan_opdracht\(&liggend, reset_mag, devmodes\.is_some_and\(\|d\| d\.gelijk\(\)\)\)/);
  assert.match(kern, /d\.voor\(eerste_liggend\)\.ptr\(\)/);
  assert.match(kern, /let eerste_liggend = plan\.begin_liggend;/);
  assert.match(kern, /plan\.paginas\[i as usize\]\.liggend_vel/);
  // Elke ResetDCW in de kern zit in het blok na reset_nodig(...).then(.
  const at = kern.indexOf('reset_nodig(');
  assert.ok(at > 0, 'reset_nodig niet gebruikt');
  const resets = [...kern.matchAll(/ResetDCW\(/g)].map((m) => m.index);
  assert.equal(resets.length, 2, 'precies twee ResetDCW-aanroepen (volledig en noodweg)');
  const blokEind = kern.indexOf('});', at);
  for (const r of resets) assert.ok(r > at && r < blokEind, 'ResetDCW buiten reset_nodig');
  // Het beleid komt van de printer zelf, ook op de noodweg.
  assert.match(windows, /reset_tussen_paginas\(document, gegevens\.map\(\|\(s, _\)\| s\.as_str\(\)\), omgeving\.as_deref\(\)\)/);
  assert.match(kern, /None => reset_beleid\(printer,/);
});

test('#699: liggend vel en eigen maat volgen print_plan, de basis is de verse standaard', () => {
  const liggend = zonderCommentaar(functie(devmode, 'liggend_voor_opdracht'));
  assert.match(liggend, /liggende_weg\(document, modus, standaard\)/);
  assert.match(liggend, /vel_is_standaard\(staand\.papiercode\(\), keuze\.staand_vel_mm\)/);
  assert.match(zonderCommentaar(functie(devmode, 'liggend_als_eigen_maat')), /EigenMaatCapaciteit::van\(prn\.naam\(\), &lijst\)\.mag\(maat\)/);
  assert.match(zonderCommentaar(functie(devmode, 'met_papier')), /EigenMaatCapaciteit::van\(prn\.naam\(\), &lijst\)/);
  const basis = zonderCommentaar(functie(devmode, 'basis_devmode'));
  assert.match(basis, /let standaard = prn\.standaard\(\);/);
  assert.match(basis, /driverdeel_past\(&dm\.kop\(\), &vers\.kop\(\)\)/);
  assert.match(basis, /vers\.met_publiek_van\(&dm\)/);
});
