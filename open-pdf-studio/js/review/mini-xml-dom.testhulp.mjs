// A very small XML DOM for node tests (#237): enough of DOMParser for the
// XFDF reader in annotations/xfdf.js — elements, attributes, text,
// querySelector(All) on tag names and `tag[attr]`, comma lists.
// No *.test.mjs: this file holds no tests.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : ENT[e] ?? m));

class El {
  constructor(tag, attrs, parent) { this.tagName = tag; this.localName = tag.split(':').pop(); this.attrs = attrs; this.parentNode = parent; this.nodes = []; }
  get children() { return this.nodes.filter((n) => n instanceof El); }
  get textContent() { return this.nodes.map((n) => (n instanceof El ? n.textContent : n)).join(''); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  *descendants() { for (const c of this.children) { yield c; yield* c.descendants(); } }
  matches(sel) {
    const m = /^([\w:-]+)(?:\[([\w:-]+)\])?$/.exec(sel.trim());
    return !!m && this.localName === m[1] && (!m[2] || this.getAttribute(m[2]) !== null);
  }
  querySelectorAll(sel) { const parts = sel.split(','); return [...this.descendants()].filter((e) => parts.some((p) => e.matches(p))); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

export function parseXml(text) {
  const root = new El('#document', {}, null);
  let cur = root;
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  let pos = 0;
  while ((m = re.exec(text))) {
    if (m.index !== pos) throw new Error('bad xml');
    pos = re.lastIndex;
    if (m[1] !== undefined) cur.nodes.push(m[1]);
    else if (m[2]) { if (cur.tagName !== m[2]) throw new Error('mismatched'); cur = cur.parentNode; }
    else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
        if (Object.hasOwn(attrs, a[1])) throw new Error('duplicate attribute ' + a[1]);
        attrs[a[1]] = decode(a[2]);
      }
      const el = new El(m[3], attrs, cur);
      cur.nodes.push(el);
      if (!m[5]) cur = el;
    } else if (m[6] !== undefined) cur.nodes.push(decode(m[6]));
  }
  if (pos !== text.length || cur !== root) throw new Error('unclosed');
  return root;
}

export class MiniDOMParser {
  parseFromString(text) {
    try { return parseXml(text); } catch {
      const doc = new El('#document', {}, null);
      doc.nodes.push(new El('parsererror', {}, doc));
      return doc;
    }
  }
}
