// Stamp-template library (#629): personal templates in the app data, shared
// templates in a folder (owner-only changes, read-only for others), import
// with validation, export. In-memory backend: no file system.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStampTemplateStore, joinPath, SHARED_FILE_NAME } from './stamp-template-store.js';
import { BUILTIN_DYNAMIC_TEMPLATES, TEMPLATE_SET_FORMAT, parseTemplateSet } from './dynamic-stamp.js';

function memoryBackend({ user = 'anna', folder = '' } = {}) {
  const files = new Map();
  const b = {
    personal: null,
    files,
    folder,
    me: user,
    writes: 0,
    async loadPersonal() { return b.personal; },
    async savePersonal(text) { b.personal = text; },
    async readShared(f) { if (f === '/offline') throw new Error('EACCES'); return files.get(joinPath(f, SHARED_FILE_NAME)) ?? null; },
    async writeShared(f, text) { b.writes++; files.set(joinPath(f, SHARED_FILE_NAME), text); },
    getSharedFolder() { return b.folder; },
    setSharedFolder(p) { b.folder = p; },
    user() { return b.me; },
  };
  return b;
}

const sample = (name, extra = {}) => ({ name, lines: [{ text: `${name} {date}` }], ...extra });

test('joinPath keeps the separator style of the folder', () => {
  assert.equal(joinPath('\\\\server\\stamps\\', 'x.opstamps'), '\\\\server\\stamps\\x.opstamps');
  assert.equal(joinPath('/mnt/share/', 'x.opstamps'), '/mnt/share/x.opstamps');
  assert.equal(joinPath('C:/Data', 'x'), 'C:/Data/x');
});

test('built-in templates are always listed and read-only', async () => {
  const store = createStampTemplateStore(memoryBackend());
  await store.load();
  const builtin = store.list().filter((t) => t.scope === 'builtin');
  assert.equal(builtin.length, BUILTIN_DYNAMIC_TEMPLATES.length);
  assert.ok(builtin.every((t) => t.readOnly));
});

test('personal templates persist in the app data and survive a reload', async () => {
  const backend = memoryBackend();
  const store = createStampTemplateStore(backend);
  await store.load();
  let changes = 0;
  store.onChange(() => changes++);
  const saved = await store.savePersonal(sample('Mine'));
  assert.equal(saved.scope, 'personal');
  assert.equal(saved.readOnly, false);
  assert.equal(parseTemplateSet(backend.personal).templates[0].name, 'Mine', 'stored as a template-set file');
  await store.savePersonal({ ...saved, name: 'Mine 2' });
  assert.deepEqual(store.list().filter((t) => t.scope === 'personal').map((t) => t.name), ['Mine 2'], 'same id: replaced');
  assert.ok(changes >= 2);

  const again = createStampTemplateStore(backend);
  await again.load();
  assert.deepEqual(again.list().filter((t) => t.scope === 'personal').map((t) => t.name), ['Mine 2']);
  assert.equal(await again.deletePersonal(saved.id), true);
  assert.equal(await again.deletePersonal(saved.id), false);
  assert.equal(parseTemplateSet(backend.personal).ok, false, 'empty set stored');
});

test('a personal template cannot take the id of a built-in one', async () => {
  const store = createStampTemplateStore(memoryBackend());
  await store.load();
  const t = await store.savePersonal({ ...BUILTIN_DYNAMIC_TEMPLATES[0], name: 'Copy' });
  assert.notEqual(t.id, BUILTIN_DYNAMIC_TEMPLATES[0].id);
  const copy = await store.copyToPersonal(BUILTIN_DYNAMIC_TEMPLATES[1].id);
  assert.equal(copy.scope, 'personal');
  assert.equal(copy.name, BUILTIN_DYNAMIC_TEMPLATES[1].name);
});

test('invalid templates are refused when saving', async () => {
  const store = createStampTemplateStore(memoryBackend());
  await store.load();
  await assert.rejects(store.savePersonal({ name: '', lines: [] }), (e) => e.code === 'invalidTemplate');
});

test('shared: the owner can publish and change, others see it read-only', async () => {
  const anna = memoryBackend({ user: 'anna', folder: '\\\\nas\\stamps' });
  const store = createStampTemplateStore(anna);
  await store.load();
  const shared = await store.saveShared(sample('Office'));
  assert.equal(shared.scope, 'shared');
  assert.equal(shared.owner, 'anna');
  assert.equal(shared.readOnly, false, 'own template');

  // Bob opens the same folder.
  const bob = memoryBackend({ user: 'bob', folder: '\\\\nas\\stamps' });
  bob.files.set(...anna.files.entries().next().value);
  const bobStore = createStampTemplateStore(bob);
  await bobStore.load();
  const seen = bobStore.list().find((t) => t.scope === 'shared');
  assert.equal(seen.name, 'Office');
  assert.equal(seen.readOnly, true, 'read-only for others');
  await assert.rejects(bobStore.saveShared({ ...seen, name: 'Hijack' }), (e) => e.code === 'notOwner');
  await assert.rejects(bobStore.removeShared(seen.id), (e) => e.code === 'notOwner');
  const mine = await bobStore.copyToPersonal(seen.id);
  assert.equal(mine.scope, 'personal');
  assert.equal(mine.owner, undefined);

  // Bob adds his own; Anna's is kept (the file is re-read before writing).
  await bobStore.saveShared(sample('Bob'));
  const both = parseTemplateSet(bob.files.get(joinPath('\\\\nas\\stamps', SHARED_FILE_NAME)));
  assert.deepEqual(both.templates.map((t) => [t.name, t.owner]), [['Office', 'anna'], ['Bob', 'bob']]);

  await store.saveShared({ ...shared, name: 'Office v2' });
  assert.equal(store.list().find((t) => t.id === shared.id).name, 'Office v2');
  assert.equal(await store.removeShared(shared.id), true);
});

test('shared folder: none, unreadable or invalid file → no shared templates, an error code', async () => {
  const backend = memoryBackend({ folder: '' });
  const store = createStampTemplateStore(backend);
  await store.load();
  assert.equal(store.sharedError(), null);
  await assert.rejects(store.saveShared(sample('X')), (e) => e.code === 'noSharedFolder');

  await store.setSharedFolder('/offline');
  assert.equal(store.sharedFolder(), '/offline');
  assert.equal(store.sharedError(), 'sharedUnavailable');
  assert.equal(store.list().filter((t) => t.scope === 'shared').length, 0);

  backend.files.set(joinPath('/srv', SHARED_FILE_NAME), '{"format":"something else"}');
  await store.setSharedFolder('/srv');
  assert.equal(store.sharedError(), 'sharedInvalid');
  await assert.rejects(store.saveShared(sample('X')), (e) => e.code === 'sharedInvalid', 'never overwrites a file it cannot read');
  assert.equal(backend.writes, 0);
});

test('import: valid templates are added with fresh ids, invalid files are refused', async () => {
  const backend = memoryBackend();
  const store = createStampTemplateStore(backend);
  await store.load();
  const existing = await store.savePersonal(sample('Existing'));
  const file = JSON.stringify({
    format: TEMPLATE_SET_FORMAT, version: 1, owner: 'someone',
    templates: [
      { id: existing.id, name: 'Clash', lines: [{ text: 'A' }], owner: 'someone' },
      { name: 'Broken', lines: 'nope' },
      { name: 'Fine', lines: [{ text: '{Approved by}' }], image: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 10, height: 5 } },
    ],
  });
  const res = await store.importSet(file);
  assert.deepEqual(res.added.map((t) => t.name), ['Clash', 'Fine']);
  assert.notEqual(res.added[0].id, existing.id, 'no clash with an existing id');
  assert.ok(res.added.every((t) => t.owner === undefined && t.scope === 'personal'));
  assert.equal(res.errors.length, 1);
  assert.equal(store.list().filter((t) => t.scope === 'personal').length, 3);

  for (const bad of ['not json', '{"format":"x","version":1,"templates":[]}', JSON.stringify({ format: TEMPLATE_SET_FORMAT, version: 1, templates: [{ name: 'x' }] })]) {
    const r = await store.importSet(bad);
    assert.equal(r.added.length, 0, bad);
    assert.ok(r.errors.length > 0);
  }
  assert.equal(store.list().filter((t) => t.scope === 'personal').length, 3, 'nothing added by bad files');
});

test('export: a template-set file that imports again', async () => {
  const store = createStampTemplateStore(memoryBackend());
  await store.load();
  const a = await store.savePersonal(sample('A', { color: '#112233', dateFormat: 'long' }));
  const text = store.exportSet([a.id, BUILTIN_DYNAMIC_TEMPLATES[0].id, 'unknown']);
  const set = parseTemplateSet(text);
  assert.deepEqual(set.templates.map((t) => t.name).sort(), ['A', BUILTIN_DYNAMIC_TEMPLATES[0].name].sort());
  const other = createStampTemplateStore(memoryBackend());
  await other.load();
  const res = await other.importSet(text);
  const back = res.added.find((t) => t.name === 'A');
  assert.equal(back.color, '#112233');
  assert.equal(back.dateFormat, 'long');
});
