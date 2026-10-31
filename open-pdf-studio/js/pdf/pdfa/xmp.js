// XMP voor PDF/A (#379): opbouwen, uitlezen en vergelijken met /Info.
//
// PDF/A eist dat het document-XMP de PDF/A-identificatie (pdfaid:part,
// pdfaid:conformance) draagt en dat elk gevuld /Info-veld dezelfde waarde
// heeft als zijn XMP-tegenhanger. Dit bestand doet geen DOM-parsing: het
// draait ook onder node. Het leest zowel de element- als de attribuutvorm
// (`<pdfaid:part>2</pdfaid:part>` en `pdfaid:part="2"`).

/** /Info-sleutel → XMP-eigenschap, zoals ISO 19005-1 6.7.3 ze koppelt. */
export const INFO_NAAR_XMP = Object.freeze({
  Title: 'dc:title',
  Author: 'dc:creator',
  Subject: 'dc:description',
  Keywords: 'pdf:Keywords',
  Creator: 'xmp:CreatorTool',
  Producer: 'pdf:Producer',
  CreationDate: 'xmp:CreateDate',
  ModDate: 'xmp:ModifyDate',
});

export const XMP_PACKET_ID = 'W5M0MpCehiHzreSzNTczkc9d';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ontsnap = (s) => String(s ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

const twee = (n) => String(n).padStart(2, '0');

/** Date → PDF-datum in UTC: D:YYYYMMDDHHmmSSZ */
export function pdfDatum(d) {
  return `D:${d.getUTCFullYear()}${twee(d.getUTCMonth() + 1)}${twee(d.getUTCDate())}`
    + `${twee(d.getUTCHours())}${twee(d.getUTCMinutes())}${twee(d.getUTCSeconds())}Z`;
}

/** Date → XMP-datum in UTC: YYYY-MM-DDThh:mm:ssZ */
export function xmpDatum(d) {
  return `${d.getUTCFullYear()}-${twee(d.getUTCMonth() + 1)}-${twee(d.getUTCDate())}`
    + `T${twee(d.getUTCHours())}:${twee(d.getUTCMinutes())}:${twee(d.getUTCSeconds())}Z`;
}

/**
 * PDF-datum ("D:2024…+01'00'") → Date, of null als hij niet te lezen is.
 * Ontbrekende delen gelden als het begin van de periode (ISO 32000 7.9.4).
 */
export function leesPdfDatum(s) {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz+\-])(\d{2})?'?(\d{2})?'?)?$/.exec(String(s || '').trim());
  if (!m) return null;
  const [, j, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, tzh = '00', tzm = '00'] = m;
  let ms = Date.UTC(+j, +mo - 1, +d, +h, +mi, +se);
  if (tz === '+' || tz === '-') ms -= (tz === '+' ? 1 : -1) * ((+tzh) * 60 + (+tzm)) * 60000;
  const datum = new Date(ms);
  return Number.isNaN(datum.getTime()) || +mo > 12 || +d > 31 ? null : datum;
}

/** XMP-datum (ISO 8601, mogelijk zonder tijd/zone) → Date of null. */
export function leesXmpDatum(s) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+\-]\d{2}:\d{2})?)?)?)?$/.exec(String(s || '').trim());
  if (!m) return null;
  const [, j, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz] = m;
  let ms = Date.UTC(+j, +mo - 1, +d, +h, +mi, +se);
  if (tz && tz !== 'Z') {
    const teken = tz[0] === '+' ? 1 : -1;
    ms -= teken * ((+tz.slice(1, 3)) * 60 + (+tz.slice(4, 6))) * 60000;
  }
  const datum = new Date(ms);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/**
 * De waarde van één XMP-eigenschap (eerste rdf:li bij Alt/Seq/Bag), of
 * undefined als hij ontbreekt.
 * @param {string} xml
 * @param {string} prop bv. 'dc:title', 'pdfaid:part'
 */
export function xmpWaarde(xml, prop) {
  if (typeof xml !== 'string') return undefined;
  const p = prop.replace(':', '\\:');
  const attr = new RegExp(`\\s${p}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(xml);
  if (attr) return ontsnap(attr[2]);
  const el = new RegExp(`<${p}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${p}>)`).exec(xml);
  if (!el) return undefined;
  const binnen = el[2] ?? '';
  if (/<rdf:(Alt|Seq|Bag)\b/.test(binnen)) {
    const lis = [...binnen.matchAll(/<rdf:li(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/rdf:li>)/g)];
    if (!lis.length) return '';
    // Bij een Alt telt x-default; anders de eerste.
    const standaard = lis.find((li) => /xml:lang\s*=\s*["']x-default["']/.test(li[1] || '')) || lis[0];
    return ontsnap(standaard[2] ?? '');
  }
  // Niet trimmen: /Info moet er precies gelijk aan zijn (ook witruimte).
  return ontsnap(binnen);
}

/** Aantal rdf:li-items van een Seq/Bag-eigenschap (dc:creator). */
export function xmpAantalItems(xml, prop) {
  const p = prop.replace(':', '\\:');
  const el = new RegExp(`<${p}(\\s[^>]*)?>([\\s\\S]*?)</${p}>`).exec(xml || '');
  if (!el) return 0;
  return [...el[2].matchAll(/<rdf:li[\s>/]/g)].length;
}

/**
 * Wat er aan de verpakking van het XMP mankeert.
 * @returns {{ kop: boolean, voet: boolean, bytesAttribuut: boolean, encodingAttribuut: boolean, rdf: boolean }}
 */
export function xmpVerpakking(xml) {
  const kop = /<\?xpacket\s+begin\s*=\s*["'][^"']*["']\s+id\s*=\s*["']W5M0MpCehiHzreSzNTczkc9d["'][^?]*\?>/.exec(xml || '');
  return {
    kop: !!kop,
    voet: /<\?xpacket\s+end\s*=\s*["'][rw]["']\s*\?>/.test(xml || ''),
    bytesAttribuut: !!kop && /\sbytes\s*=/.test(kop[0]),
    encodingAttribuut: !!kop && /\sencoding\s*=/.test(kop[0]),
    rdf: /<rdf:RDF[\s>]/.test(xml || ''),
  };
}

/**
 * Een compleet XMP-pakket met alleen voorgedefinieerde schema's (dc, xmp,
 * pdf, pdfaid), zodat er geen extensieschema nodig is.
 * @param {{ part: number, conformance: string, title?: string, author?: string, subject?: string,
 *   keywords?: string, creator?: string, producer?: string, createDate?: Date, modifyDate?: Date }} w
 */
export function bouwPdfAXmp(w) {
  const r = [];
  r.push(`<?xpacket begin="﻿" id="${XMP_PACKET_ID}"?>`);
  r.push('<x:xmpmeta xmlns:x="adobe:ns:meta/">');
  r.push('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
  r.push('<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">');
  r.push(`<pdfaid:part>${w.part}</pdfaid:part>`);
  r.push(`<pdfaid:conformance>${esc(String(w.conformance).toUpperCase())}</pdfaid:conformance>`);
  r.push('</rdf:Description>');
  r.push('<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">');
  r.push('<dc:format>application/pdf</dc:format>');
  if (w.title != null) r.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(w.title)}</rdf:li></rdf:Alt></dc:title>`);
  if (w.author != null) r.push(`<dc:creator><rdf:Seq><rdf:li>${esc(w.author)}</rdf:li></rdf:Seq></dc:creator>`);
  if (w.subject != null) r.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(w.subject)}</rdf:li></rdf:Alt></dc:description>`);
  r.push('</rdf:Description>');
  r.push('<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">');
  if (w.creator != null) r.push(`<xmp:CreatorTool>${esc(w.creator)}</xmp:CreatorTool>`);
  if (w.createDate) r.push(`<xmp:CreateDate>${xmpDatum(w.createDate)}</xmp:CreateDate>`);
  if (w.modifyDate) {
    r.push(`<xmp:ModifyDate>${xmpDatum(w.modifyDate)}</xmp:ModifyDate>`);
    r.push(`<xmp:MetadataDate>${xmpDatum(w.modifyDate)}</xmp:MetadataDate>`);
  }
  r.push('</rdf:Description>');
  r.push('<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">');
  if (w.producer != null) r.push(`<pdf:Producer>${esc(w.producer)}</pdf:Producer>`);
  if (w.keywords != null) r.push(`<pdf:Keywords>${esc(w.keywords)}</pdf:Keywords>`);
  r.push('</rdf:Description>');
  r.push('</rdf:RDF>');
  r.push('</x:xmpmeta>');
  // Wat witruimte zodat een ander programma het pakket ter plekke kan bijwerken.
  for (let i = 0; i < 20; i++) r.push(' '.repeat(99));
  r.push('<?xpacket end="w"?>');
  return r.join('\n');
}

/**
 * Vergelijkt /Info met het XMP. Datums tellen als gelijk als ze hetzelfde
 * moment aanduiden; dc:creator moet precies één item hebben dat gelijk is
 * aan /Author.
 * @param {Record<string, string>} info gedecodeerde /Info-tekst per sleutel
 * @param {string} xml
 * @returns {string[]} de /Info-sleutels die niet overeenkomen
 */
export function infoVerschillen(info, xml) {
  const anders = [];
  for (const [sleutel, prop] of Object.entries(INFO_NAAR_XMP)) {
    const waarde = info[sleutel];
    if (waarde == null || waarde === '') continue;
    const x = xmpWaarde(xml, prop);
    if (x === undefined) { anders.push(sleutel); continue; }
    if (sleutel === 'CreationDate' || sleutel === 'ModDate') {
      const a = leesPdfDatum(waarde);
      const b = leesXmpDatum(x);
      if (!a || !b || a.getTime() !== b.getTime()) anders.push(sleutel);
      continue;
    }
    if (sleutel === 'Author' && xmpAantalItems(xml, prop) > 1) { anders.push(sleutel); continue; }
    if (x !== waarde) anders.push(sleutel);
  }
  return anders;
}
