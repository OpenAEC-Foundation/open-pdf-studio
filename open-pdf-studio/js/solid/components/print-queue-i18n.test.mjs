// The "Open PDF Printer" window (PrintQueueWindow.jsx) and the preferences tab
// (VirtualPrinterTab.jsx) in all 40 languages:
//  - every language has exactly the English keys of dialogs.printQueue and
//    preferences.virtualPrinter, with the same {{variables}};
//  - every key the two components ask for exists in English;
//  - the components contain no user-visible text of their own: no JSX text
//    with letters, no text in title/aria-label/placeholder/alt attributes, no
//    `t(...) || 'fallback'` and no literal text handed to a status setter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, '../../i18n/locales');
const COMPONENTS = {
  'PrintQueueWindow.jsx': { ns: 'dialogs', block: 'printQueue' },
  'preferences/VirtualPrinterTab.jsx': { ns: 'preferences', block: 'virtualPrinter' },
};

const read = (lang, ns) => JSON.parse(readFileSync(join(LOCALES, lang, `${ns}.json`), 'utf8'));
const vars = (s) => [...new Set(String(s).match(/\{\{\s*\w+\s*\}\}/g) || [])].map((v) => v.replace(/\s/g, '')).sort();
const langs = readdirSync(LOCALES).sort();

test('40 languages', () => {
  assert.equal(langs.length, 40);
});

for (const { ns, block } of Object.values(COMPONENTS)) {
  test(`${ns}.${block}: every language has the English keys and variables`, () => {
    const en = read('en', ns)[block];
    const keys = Object.keys(en).sort();
    const wrong = [];
    for (const lang of langs) {
      const d = read(lang, ns)[block] || {};
      const have = Object.keys(d).sort();
      const missing = keys.filter((k) => !have.includes(k));
      const extra = have.filter((k) => !keys.includes(k));
      if (missing.length || extra.length) wrong.push(`${lang}: missing ${missing.join(',') || '-'}; extra ${extra.join(',') || '-'}`);
      for (const k of keys) {
        if (k in d && JSON.stringify(vars(d[k])) !== JSON.stringify(vars(en[k]))) wrong.push(`${lang}.${k}: ${vars(d[k])} ≠ ${vars(en[k])}`);
        if (k in d && !String(d[k]).trim()) wrong.push(`${lang}.${k}: empty`);
      }
    }
    assert.deepEqual(wrong, []);
  });
}

function ast(file) {
  const src = readFileSync(join(HERE, file), 'utf8');
  return parse(src, { sourceType: 'module', plugins: ['jsx'] });
}

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, node));
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}

const LETTERS = /\p{L}{2,}/u;
const TEXT_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label', 'aria-description']);
const STATUS_SETTERS = /^(set(Status|BusyMsg|Busy|Message|Notice|Error)\w*|showMessage|announce)$/;
const textOf = (n) => (n.type === 'StringLiteral' ? n.value : n.type === 'TemplateLiteral' ? n.quasis.map((q) => q.value.cooked).join('') : '');

for (const [file, { block }] of Object.entries(COMPONENTS)) {
  test(`${file}: no hard-coded user-visible text`, () => {
    const found = [];
    walk(ast(file), (n, parent) => {
      if (n.type === 'JSXText' && LETTERS.test(n.value)) found.push(`JSX text "${n.value.trim()}"`);
      if (n.type === 'JSXAttribute' && TEXT_ATTRS.has(n.name.name) && n.value?.type === 'StringLiteral' && LETTERS.test(n.value.value)) {
        found.push(`${n.name.name}="${n.value.value}"`);
      }
      if (n.type === 'JSXExpressionContainer' && parent?.type === 'JSXElement' && LETTERS.test(textOf(n.expression))) {
        found.push(`JSX literal "${textOf(n.expression)}"`);
      }
      if (n.type === 'LogicalExpression' && (n.operator === '||' || n.operator === '??') && LETTERS.test(textOf(n.right))) {
        found.push(`fallback "${textOf(n.right)}"`);
      }
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && STATUS_SETTERS.test(n.callee.name)) {
        for (const a of n.arguments) if (LETTERS.test(textOf(a))) found.push(`${n.callee.name}("${textOf(a)}")`);
      }
    });
    assert.deepEqual(found, []);
  });

  test(`${file}: every ${block} key it asks for exists in English`, () => {
    const ns = COMPONENTS[file].ns;
    const en = read('en', ns)[block];
    const missing = [];
    walk(ast(file), (n) => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 't' && n.arguments[0]?.type === 'StringLiteral') {
        const key = n.arguments[0].value;
        if (key.startsWith(`${block}.`) && !(key.slice(block.length + 1) in en)) missing.push(key);
      }
    });
    assert.deepEqual(missing, []);
  });
}
