// Library of stamp templates (#629): built-in, personal and shared.
//
// - personal: the user's own templates, in the app data (via the backend);
// - shared:   one template-set file in a folder the user points to (e.g. a
//             network share). Every template there has an owner; only the
//             owner can change or remove it, everyone else sees it read-only
//             and can copy it to their personal templates;
// - built-in: BUILTIN_DYNAMIC_TEMPLATES, always read-only.
//
// Both stores use the template-set file format (dynamic-stamp.js), so the
// same validation guards import, the shared file and the app data.
//
// Pure: all I/O goes through the backend (stamp-template-backend.js in the
// app, an in-memory one in the tests).
//
// backend: {
//   loadPersonal(): Promise<string|null>, savePersonal(text): Promise<void>,
//   readShared(folder): Promise<string|null>   (null: no file yet),
//   writeShared(folder, text): Promise<void>,
//   getSharedFolder(): string, setSharedFolder(path): Promise<void>|void,
//   user(): string,
// }

import {
  BUILTIN_DYNAMIC_TEMPLATES, exportTemplateSet, parseTemplateSet, normalizeTemplate, newTemplateId,
} from './dynamic-stamp.js';

export const SHARED_FILE_NAME = 'open-pdf-studio-stamps.opstamps';

/** Folder + file name, with the separator the folder already uses. */
export function joinPath(folder, name) {
  const f = String(folder || '');
  const sep = f.includes('\\') && !f.includes('/') ? '\\' : '/';
  return f.replace(/[\\/]+$/, '') + sep + name;
}

export class StampTemplateError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export function createStampTemplateStore(backend) {
  let personal = [];
  let shared = [];
  let sharedError = null;
  const listeners = new Set();
  const notify = () => { for (const l of listeners) { try { l(); } catch (_) { /* listener errors are not ours */ } } };

  const user = () => String(backend.user?.() || '');
  const tag = (t, scope) => ({
    ...t, scope, readOnly: scope === 'builtin' || (scope === 'shared' && (t.owner || '') !== user()),
  });

  async function persistPersonal() {
    await backend.savePersonal(exportTemplateSet(personal));
  }

  async function readSharedFile(folder) {
    const text = await backend.readShared(folder);
    if (text === null || text === undefined || text === '') return [];
    const set = parseTemplateSet(text);
    if (!set.ok) throw new StampTemplateError('sharedInvalid', set.errors.join('; '));
    return set.templates;
  }

  async function loadShared() {
    const folder = backend.getSharedFolder?.() || '';
    shared = [];
    sharedError = null;
    if (!folder) return;
    try {
      shared = await readSharedFile(folder);
    } catch (e) {
      sharedError = e?.code || 'sharedUnavailable';
    }
  }

  const uniqueId = (id, taken) => (taken.has(id) ? newTemplateId() : id);
  const allIds = () => new Set([...BUILTIN_DYNAMIC_TEMPLATES, ...personal, ...shared].map((t) => t.id));

  return {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async load() {
      personal = [];
      try {
        const text = await backend.loadPersonal();
        if (text) {
          const set = parseTemplateSet(text);
          if (set.ok) personal = set.templates;
        }
      } catch (_) { personal = []; }
      await loadShared();
      notify();
    },

    async reloadShared() { await loadShared(); notify(); },

    sharedError: () => sharedError,
    sharedFolder: () => backend.getSharedFolder?.() || '',

    async setSharedFolder(path) {
      await backend.setSharedFolder(String(path || ''));
      await loadShared();
      notify();
    },

    /** All templates, tagged with scope and readOnly. */
    list() {
      return [
        ...BUILTIN_DYNAMIC_TEMPLATES.map((t) => tag(t, 'builtin')),
        ...personal.map((t) => tag(t, 'personal')),
        ...shared.map((t) => tag(t, 'shared')),
      ];
    },

    get(id) { return this.list().find((t) => t.id === id) || null; },

    /** Add or replace a personal template. */
    async savePersonal(raw) {
      const { template, errors } = normalizeTemplate(raw);
      if (!template) throw new StampTemplateError('invalidTemplate', errors.join(', '));
      delete template.owner;
      const i = personal.findIndex((t) => t.id === template.id);
      if (i >= 0) personal[i] = template;
      else {
        template.id = uniqueId(template.id, allIds());
        personal.push(template);
      }
      await persistPersonal();
      notify();
      return tag(template, 'personal');
    },

    async deletePersonal(id) {
      const before = personal.length;
      personal = personal.filter((t) => t.id !== id);
      if (personal.length === before) return false;
      await persistPersonal();
      notify();
      return true;
    },

    /** Import a template-set file into the personal templates. */
    async importSet(text) {
      const set = parseTemplateSet(text);
      if (!set.ok) return { added: [], errors: set.errors };
      const taken = allIds();
      const added = set.templates.map((t) => {
        const copy = { ...t, id: uniqueId(t.id, taken) };
        delete copy.owner;
        taken.add(copy.id);
        return copy;
      });
      personal.push(...added);
      await persistPersonal();
      notify();
      return { added: added.map((t) => tag(t, 'personal')), errors: set.errors };
    },

    /** Template-set file of the given templates (any scope). */
    exportSet(ids) {
      const want = new Set(ids);
      return exportTemplateSet(this.list().filter((t) => want.has(t.id)));
    },

    /**
     * Put a template in the shared file (new, or an update of one's own).
     * Re-reads the file first so concurrent changes by others are kept.
     */
    async saveShared(raw) {
      const folder = backend.getSharedFolder?.() || '';
      if (!folder) throw new StampTemplateError('noSharedFolder');
      const { template, errors } = normalizeTemplate(raw);
      if (!template) throw new StampTemplateError('invalidTemplate', errors.join(', '));
      const me = user();
      const current = await readSharedFile(folder);
      const i = current.findIndex((t) => t.id === template.id);
      if (i >= 0 && (current[i].owner || '') !== me) throw new StampTemplateError('notOwner', current[i].owner || '');
      template.owner = me;
      if (i >= 0) current[i] = template;
      else current.push(template);
      await backend.writeShared(folder, exportTemplateSet(current));
      shared = current;
      sharedError = null;
      notify();
      return tag(template, 'shared');
    },

    async removeShared(id) {
      const folder = backend.getSharedFolder?.() || '';
      if (!folder) throw new StampTemplateError('noSharedFolder');
      const current = await readSharedFile(folder);
      const t = current.find((x) => x.id === id);
      if (!t) return false;
      if ((t.owner || '') !== user()) throw new StampTemplateError('notOwner', t.owner || '');
      const rest = current.filter((x) => x.id !== id);
      await backend.writeShared(folder, exportTemplateSet(rest));
      shared = rest;
      notify();
      return true;
    },

    /** Copy any template (built-in, shared) to the personal templates. */
    async copyToPersonal(id, name) {
      const t = this.get(id);
      if (!t) return null;
      const { scope, readOnly, owner, ...rest } = t;
      return this.savePersonal({ ...rest, id: newTemplateId(), name: name || t.name });
    },
  };
}
