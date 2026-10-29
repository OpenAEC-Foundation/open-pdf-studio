// Key combinations for the keyboard shortcuts (#714): parsing, the one
// canonical spelling, display per platform, and the combinations a keydown
// event stands for.
//
// Canonical form: modifiers in the fixed order Ctrl, Alt, Shift, Meta, then
// the key, joined by '+':  "Ctrl+Shift+S", "F3", "Ctrl+=", "Ctrl+Plus".
// Keys: A-Z, 0-9, F1-F24, the named keys below, the punctuation keys
// , . / ; ' [ ] \ ` - =, "Plus" for '+', and the numeric keypad
// (Numpad0-9, NumpadAdd, ...). This is the form that is stored in the
// preferences and in exported files.
//
// Pure module: no DOM, no app state.

export const MODIFIERS = Object.freeze(['Ctrl', 'Alt', 'Shift', 'Meta']);

const MODIFIER_ALIASES = {
  ctrl: 'Ctrl', control: 'Ctrl', ctl: 'Ctrl', strg: 'Ctrl',
  alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift',
  meta: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta', windows: 'Meta', super: 'Meta', os: 'Meta',
};

const NAMED_KEYS = ['Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Escape', 'Tab', 'Backspace',
  'Pause', 'ContextMenu', 'PrintScreen', 'ScrollLock', 'Plus'];

const KEY_ALIASES = {
  del: 'Delete', ins: 'Insert', pgup: 'PageUp', pgdn: 'PageDown', pagedn: 'PageDown',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  esc: 'Escape', return: 'Enter', spacebar: 'Space', ' ': 'Space', apps: 'ContextMenu', menu: 'ContextMenu',
  prtsc: 'PrintScreen', '+': 'Plus', minus: '-', comma: ',', period: '.', dot: '.', slash: '/',
  semicolon: ';', quote: "'", backslash: '\\', backquote: '`', equal: '=', equals: '=',
  bracketleft: '[', bracketright: ']',
};
for (const naam of NAMED_KEYS) KEY_ALIASES[naam.toLowerCase()] = naam;

const PUNCTUATION = new Set([',', '.', '/', ';', "'", '[', ']', '\\', '`', '-', '=']);
const NUMPAD = { add: 'NumpadAdd', subtract: 'NumpadSubtract', multiply: 'NumpadMultiply', divide: 'NumpadDivide', decimal: 'NumpadDecimal' };

const MODIFIER_KEY_NAMES = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Super', 'Hyper', 'CapsLock', 'NumLock', 'Fn', 'FnLock']);

/** The canonical name of a key, or null if it is not a key we know. */
export function normalizeKeyName(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length === 1) {
    if (/^[a-z]$/i.test(raw)) return raw.toUpperCase();
    if (/^[0-9]$/.test(raw)) return raw;
    if (PUNCTUATION.has(raw)) return raw;
    if (raw === '+') return 'Plus';
    if (raw === ' ') return 'Space';
    return null;
  }
  const laag = raw.trim().toLowerCase();
  if (KEY_ALIASES[laag]) return KEY_ALIASES[laag];
  const f = laag.match(/^f([1-9]|1[0-9]|2[0-4])$/);
  if (f) return `F${f[1]}`;
  const num = laag.match(/^(?:numpad|num)\s*(\d|add|subtract|multiply|divide|decimal)$/);
  if (num) return /\d/.test(num[1]) ? `Numpad${num[1]}` : NUMPAD[num[1]];
  return null;
}

function canonicalOf(mods, key) {
  const order = MODIFIERS.filter((m) => mods.has(m));
  return [...order, key].join('+');
}

/**
 * Parse a combination as a person or a file writes it ("ctrl+shift+s",
 * "Strg+2", "Cmd+K", "Ctrl++", "PgDn") into the canonical form, or null.
 */
export function parseBinding(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (!s || s.length > 64) return null;
  let keyPart;
  let modPart;
  if (s === '+') { keyPart = '+'; modPart = ''; }
  else if (s.endsWith('++')) { keyPart = '+'; modPart = s.slice(0, -2); }
  else {
    const i = s.lastIndexOf('+');
    keyPart = s.slice(i + 1);
    modPart = i >= 0 ? s.slice(0, i) : '';
  }
  const mods = new Set();
  if (modPart) {
    for (const deel of modPart.split('+')) {
      const mod = MODIFIER_ALIASES[deel.trim().toLowerCase()];
      if (!mod || mods.has(mod)) return null;
      mods.add(mod);
    }
  }
  if (MODIFIER_ALIASES[keyPart.trim().toLowerCase()]) return null; // only modifiers
  const key = normalizeKeyName(keyPart.trim() === '' ? keyPart : keyPart.trim());
  if (!key) return null;
  return canonicalOf(mods, key);
}

/** Split a canonical combination into { mods: Set, key }. */
export function splitBinding(canonical) {
  const c = parseBinding(canonical);
  if (!c) return null;
  const delen = c === 'Plus' ? ['Plus'] : c.split('+');
  const key = delen.pop();
  return { mods: new Set(delen), key };
}

/** Is it one key without Ctrl, Alt or Meta (a letter, digit, Delete, F-key, ...)? */
export function isSingleKey(canonical) {
  const s = splitBinding(canonical);
  return !!s && !s.mods.has('Ctrl') && !s.mods.has('Alt') && !s.mods.has('Meta');
}

/** A function key, alone or with modifiers. */
export function isFunctionKey(canonical) {
  const s = splitBinding(canonical);
  return !!s && /^F\d+$/.test(s.key);
}

/** 'mac', 'win' or 'linux', from navigator.platform / userAgent (or a test value). */
export function detectPlatform(nav = globalThis.navigator) {
  const p = `${nav?.userAgentData?.platform || ''} ${nav?.platform || ''} ${nav?.userAgent || ''}`.toLowerCase();
  if (/mac|iphone|ipad/.test(p)) return 'mac';
  if (/win/.test(p)) return 'win';
  return 'linux';
}

const MOD_LABELS = {
  win: { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' },
  linux: { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' },
  mac: { Ctrl: 'Ctrl', Alt: 'Option', Shift: 'Shift', Meta: 'Cmd' },
};
const KEY_LABELS = {
  Delete: 'Del', Insert: 'Ins', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', Plus: '+',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ContextMenu: 'Menu',
  PrintScreen: 'PrtSc', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};

/** The parts to show (one <kbd> each): ['Ctrl', 'Shift', 'S']. */
export function bindingParts(canonical, platform = 'win') {
  const s = splitBinding(canonical);
  if (!s) return [];
  const mods = MOD_LABELS[platform] || MOD_LABELS.win;
  const key = KEY_LABELS[s.key] || (/^Numpad\d$/.test(s.key) ? `Num ${s.key.slice(6)}` : s.key);
  return [...MODIFIERS.filter((m) => s.mods.has(m)).map((m) => mods[m]), key];
}

/** The combination as text: "Ctrl+Shift+S", "Cmd+K" on macOS. */
export function formatBinding(canonical, platform = 'win') {
  return bindingParts(canonical, platform).join('+');
}

const CODE_KEYS = {
  Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', IntlBackslash: '\\',
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  NumpadAdd: 'NumpadAdd', NumpadSubtract: 'NumpadSubtract', NumpadMultiply: 'NumpadMultiply',
  NumpadDivide: 'NumpadDivide', NumpadDecimal: 'NumpadDecimal', Pause: 'Pause', ContextMenu: 'ContextMenu',
  PrintScreen: 'PrintScreen', ScrollLock: 'ScrollLock',
};

/** The key of the physical key (KeyboardEvent.code), independent of the layout. */
export function keyFromCode(code) {
  if (typeof code !== 'string') return null;
  let m = code.match(/^Key([A-Z])$/);
  if (m) return m[1];
  m = code.match(/^Digit([0-9])$/);
  if (m) return m[1];
  m = code.match(/^Numpad([0-9])$/);
  if (m) return `Numpad${m[1]}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] || null;
}

/** Is this keydown only a modifier (Ctrl, Shift, ... on its own)? */
export function isModifierOnly(e) {
  return !e || MODIFIER_KEY_NAMES.has(e.key);
}

function modsOf(e) {
  const mods = new Set();
  if (e.ctrlKey) mods.add('Ctrl');
  if (e.altKey) mods.add('Alt');
  if (e.shiftKey) mods.add('Shift');
  if (e.metaKey) mods.add('Meta');
  return mods;
}

const isPrintableNonLetter = (k) => k === 'Plus' || PUNCTUATION.has(k) || /^[0-9]$/.test(k);

/**
 * The combination to store when this key is pressed in the recorder: the
 * character on the key, except where the layout makes that unreliable (Shift
 * with a digit or punctuation key gives '!' or '+', Option on macOS or a
 * non-Latin layout gives another letter): then the physical key.
 */
export function bindingFromEvent(e) {
  if (isModifierOnly(e)) return null;
  const mods = modsOf(e);
  const vanToets = normalizeKeyName(e.key);
  const vanCode = keyFromCode(e.code);
  let key = vanToets;
  if (!key) key = vanCode;
  else if (vanCode && mods.has('Shift') && isPrintableNonLetter(vanToets)) key = vanCode;
  else if (vanCode && /^[A-Z]$/.test(vanCode) && !/^[A-Z]$/.test(vanToets)) key = vanCode;
  else if (vanCode && /^Numpad/.test(vanCode) && /^[0-9]$/.test(vanToets)) key = vanToets;
  if (!key) return null;
  return canonicalOf(mods, key);
}

/**
 * Every canonical combination this keydown stands for, best match first:
 * by the character, by the physical key, and with Cmd (Meta) read as Ctrl
 * (as the built-in shortcuts always did).
 */
export function eventCandidates(e) {
  if (isModifierOnly(e)) return [];
  const mods = modsOf(e);
  const keys = [normalizeKeyName(e.key), keyFromCode(e.code)].filter(Boolean);
  const uit = [];
  const voeg = (m, k) => { const c = canonicalOf(m, k); if (!uit.includes(c)) uit.push(c); };
  for (const k of keys) voeg(mods, k);
  if (mods.has('Meta') && !mods.has('Ctrl')) {
    const alsCtrl = new Set(mods);
    alsCtrl.delete('Meta');
    alsCtrl.add('Ctrl');
    for (const k of keys) voeg(alsCtrl, k);
  }
  return uit;
}

/**
 * The fields of a keydown event for a canonical combination, so the built-in
 * handling can be run for a command as if its default key had been pressed.
 */
export function eventFieldsFor(canonical) {
  const s = splitBinding(canonical);
  if (!s) return null;
  const { key } = s;
  let evKey = key;
  let code = '';
  if (/^[A-Z]$/.test(key)) { evKey = key.toLowerCase(); code = `Key${key}`; }
  else if (/^[0-9]$/.test(key)) code = `Digit${key}`;
  else if (key === 'Plus') { evKey = '+'; code = 'Equal'; }
  else if (key === 'Space') { evKey = ' '; code = 'Space'; }
  else if (/^Numpad\d$/.test(key)) { evKey = key.slice(6); code = key; }
  else if (key.startsWith('Numpad')) {
    evKey = { NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.' }[key];
    code = key;
  } else {
    const gevonden = Object.entries(CODE_KEYS).find(([, v]) => v === key);
    code = gevonden ? gevonden[0] : key;
  }
  return {
    key: evKey, code,
    ctrlKey: s.mods.has('Ctrl'), altKey: s.mods.has('Alt'), shiftKey: s.mods.has('Shift'), metaKey: s.mods.has('Meta'),
  };
}
