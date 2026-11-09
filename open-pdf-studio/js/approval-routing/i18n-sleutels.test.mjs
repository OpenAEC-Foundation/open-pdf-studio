// Goedkeuringsroutes (#651): elke vertaalsleutel die het venster, de
// providers en de service gebruiken bestaat in alle talen; Nederlands en
// Engels zijn echte vertalingen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PROVIDERS, ROLES, FIELD_KINDS, COPY_MATCHES } from './model.js';

const here = (p) => new URL(p, import.meta.url);
const bronnen = ['../solid/components/dialogs/ApprovalRoutingDialog.jsx', './providers.js', './service.js', './core.js'].map((p) => readFileSync(here(p), 'utf8'));

const vast = new Set();
for (const bron of bronnen) for (const m of bron.matchAll(/t\('approvalRouting\.([A-Za-z0-9_.-]+)'/g)) vast.add(m[1]);
const sets = {
  tabs: ['prepare', 'status', 'receive'],
  providerConfigure: PROVIDERS, providers: PROVIDERS, submitVia: PROVIDERS, submitted: PROVIDERS,
  roles: ROLES, kinds: FIELD_KINDS,
  states: ['draft', 'submitted', 'in_progress', 'completed', 'approved', 'rejected', 'signed', 'pending', 'expired', 'cancelled', 'superseded', 'invalid'],
  events: ['create', 'submit', 'dispatch', 'receipt', 'cancel', 'supersede', 'expire'],
  delivery: ['mail-draft-handoff', 'manual-file-handoff'], where: ['document', 'app'],
  match: [...COPY_MATCHES, 'none'], evidence: ['reply', 'receipt-file'],
};
const sleutels = [...vast];
for (const [groep, waarden] of Object.entries(sets)) for (const w of waarden) sleutels.push(`${groep}.${w}`);
sleutels.push('page', 'x', 'y', 'width', 'height', 'sequential', 'parallel');

const lees = (taal) => JSON.parse(readFileSync(here(`../i18n/locales/${taal}/dialogs.json`), 'utf8').replace(/^﻿/, '')).approvalRouting;
const waarde = (obj, pad) => pad.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

test('every approval-routing key exists in every language', () => {
  for (const taal of readdirSync(here('../i18n/locales/'))) {
    const ar = lees(taal);
    const ontbreekt = sleutels.filter((k) => typeof waarde(ar, k) !== 'string');
    assert.deepEqual(ontbreekt, [], `${taal} mist ${ontbreekt.join(', ')}`);
  }
});

test('Dutch is translated, not copied from English', () => {
  const en = lees('en'), nl = lees('nl');
  const gelijk = ['tabs.prepare', 'distinctionTypes', 'intro', 'mail.intro', 'mail.disclaimer', 'roles.sign', 'match.incremental', 'errors.COPY_DOES_NOT_MATCH']
    .filter((k) => waarde(en, k) === waarde(nl, k));
  assert.deepEqual(gelijk, []);
});

test('the texts make no legal-validity claim and keep the three signature kinds apart', () => {
  for (const taal of ['en', 'nl']) {
    const ar = lees(taal);
    assert.match(ar.distinctionTypes, taal === 'en' ? /no claim about legal validity/ : /claimt geen juridische geldigheid/);
    assert.match(ar.mail.disclaimer, taal === 'en' ? /not a legally binding/ : /geen juridisch bindende/);
  }
});
