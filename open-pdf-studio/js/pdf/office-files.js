import { zipStore } from '../bcf/bcf-zip.js';
import { spreadsheetCurrency, spreadsheetNumber } from './office-layout.js';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export function xml(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const part = (name, data) => ({ name, data });
const decimalPlaces = Array.from({ length: 15 }, (_, i) => i + 1);
const CURRENCY_STYLE = 2 + decimalPlaces.length;
function hasHeaderRow(rows, decimal = '.') {
  return rows.length > 1 && !/:\s*$/.test(String(rows[0][0] ?? ''))
    && !rows[0].slice(1).some(value => spreadsheetNumber(value, decimal) !== null
      || spreadsheetCurrency(value, decimal) !== null);
}

export function buildXlsx(pages, { title = 'Document', decimal = '.', pageLabel = 'Page', tableLabel = 'Table', textLabel = 'Text' } = {}) {
  const sheets = [];
  const textRows = [[pageLabel, textLabel]];
  for (const page of pages) {
    let table = 0;
    for (const block of page.blocks) {
      if (block.type === 'table') sheets.push({ name: `${pageLabel} ${page.number} - ${tableLabel} ${++table}`, rows: block.rows });
      else textRows.push([page.number, block.text]);
    }
    if (!page.blocks.length) textRows.push([page.number, page.emptyMessage || '']);
  }
  if (textRows.length > 1 || !sheets.length) sheets.push({ name: textLabel, rows: textRows });
  const usedNames = new Set();
  for (const sheet of sheets) {
    const base = sheet.name.replace(/[\\/?:*\[\]]/g, ' ').replace(/^'+|'+$/g, '').slice(0, 31) || 'Sheet';
    let name = base, suffix = 1;
    while (usedNames.has(name.toLowerCase())) name = `${base.slice(0, 26)} (${++suffix})`;
    sheet.name = name; usedNames.add(name.toLowerCase());
  }
  const entries = [
    part('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    part('_rels/.rels', `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    part('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>Open PDF Studio</dc:creator></cp:coreProperties>`),
    part('xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    part('xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PACKAGE_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`),
    part('xl/styles.xml', `${XML}<styleSheet xmlns="${MAIN}"><numFmts count="16">${decimalPlaces.map(n => `<numFmt numFmtId="${163 + n}" formatCode="0.${'0'.repeat(n)}"/>`).join('')}<numFmt numFmtId="179" formatCode="&quot;€&quot; #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF244766"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${CURRENCY_STYLE + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>${decimalPlaces.map(n => `<xf numFmtId="${163 + n}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}<xf numFmtId="179" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  ];
  sheets.forEach((sheet, i) => {
    const width = sheet.rows.reduce((max, row) => Math.max(max, row.length), 1);
    if (width > 16384 || sheet.rows.length > 1048576) throw new Error('Excel worksheet limits exceeded');
    const hasHeader = hasHeaderRow(sheet.rows, decimal);
    const cols = Array.from({ length: width }, (_, c) => {
      const length = sheet.rows.reduce((max, row) => Math.max(max, String(row[c] ?? '').length), 8);
      return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, length + 3)}" customWidth="1"/>`;
    }).join('');
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${columnName(c)}${r + 1}`;
      const currency = !hasHeader || r > 0 ? spreadsheetCurrency(value, decimal) : null;
      const number = !hasHeader || r > 0 ? (currency ?? spreadsheetNumber(value, decimal)) : null;
      if (number !== null) {
        const places = String(value).trim().split(decimal)[1]?.length || 0;
        return `<c r="${ref}" s="${currency !== null ? CURRENCY_STYLE : places ? places + 1 : 0}"><v>${number}</v></c>`;
      }
      const text = String(value ?? '');
      if (text.length > 32767) throw new Error('Excel cell text exceeds 32767 characters');
      return `<c r="${ref}" s="${r === 0 && hasHeader ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const range = `A1:${columnName(width - 1)}${Math.max(1, sheet.rows.length)}`;
    entries.push(part(`xl/worksheets/sheet${i + 1}.xml`, `${XML}<worksheet xmlns="${MAIN}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0">${hasHeader ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData>${hasHeader ? `<autoFilter ref="${range}"/>` : ''}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`));
  });
  return zipStore(entries);
}

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
const odtText = value => xml(value).replace(/ {2,}/g, s => `<text:s text:c="${s.length}"/>`).replace(/\t/g, '<text:tab/>').replace(/\r?\n/g, '<text:line-break/>');
export function buildOdt(pages, { title = 'Document', pageLabel = 'Page' } = {}) {
  const mime = 'application/vnd.oasis.opendocument.text';
  const entries = [part('mimetype', mime)];
  let tableId = 0;
  let columnStyles = '';
  const body = pages.map((page, index) => {
    let text = `<text:h text:style-name="${index ? 'PageHeading' : 'Heading'}" text:outline-level="1">${odtText(pageLabel)} ${page.number}</text:h>`;
    for (const block of page.blocks) {
      if (block.type === 'paragraph') text += `<text:p text:style-name="Body">${odtText(block.text)}</text:p>`;
      else {
        const columns = block.rows.reduce((max, row) => Math.max(max, row.length), 1);
        const id = ++tableId;
        const weights = Array.from({ length: columns }, (_, i) => Math.sqrt(2 + Math.min(80,
          block.rows.reduce((max, row) => Math.max(max, String(row[i] ?? '').length), 0))));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        const columnXml = weights.map((weight, i) => {
          const style = `Table${id}Column${i + 1}`;
          columnStyles += `<style:style style:name="${style}" style:family="table-column"><style:table-column-properties style:column-width="${(17 * weight / totalWeight).toFixed(3)}cm"/></style:style>`;
          return `<table:table-column table:style-name="${style}"/>`;
        }).join('');
        const rowXml = (row, header = false) => `<table:table-row>${Array.from({ length: columns }, (_, i) => `<table:table-cell table:style-name="Cell" office:value-type="string"><text:p text:style-name="${header ? 'TableHeading' : 'Body'}">${odtText(row[i] ?? '')}</text:p></table:table-cell>`).join('')}</table:table-row>`;
        const header = hasHeaderRow(block.rows, ',') && hasHeaderRow(block.rows, '.');
        text += `<table:table table:name="Table${id}" table:style-name="Table">${columnXml}${header ? `<table:table-header-rows>${rowXml(block.rows[0], true)}</table:table-header-rows>${block.rows.slice(1).map(r => rowXml(r)).join('')}` : block.rows.map(r => rowXml(r)).join('')}</table:table><text:p/>`;
      }
    }
    if (page.image) {
      const name = `Pictures/page-${page.number}.png`;
      entries.push(part(name, page.image));
      const scale = Math.min(16 / page.width, 23 / page.height);
      text += `<text:p><draw:frame draw:name="Page${page.number}" text:anchor-type="as-char" svg:width="${(page.width * scale).toFixed(3)}cm" svg:height="${(page.height * scale).toFixed(3)}cm"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`;
    }
    if (!page.blocks.length && page.emptyMessage) text += `<text:p text:style-name="Body">${odtText(page.emptyMessage)}</text:p>`;
    return text;
  }).join('');
  entries.push(part('content.xml', `${XML}<office:document-content ${NS} office:version="1.3"><office:automatic-styles><style:style style:name="Table" style:family="table"><style:table-properties table:align="margins" style:width="17cm"/></style:style><style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.12cm" fo:border="0.5pt solid #bac6ce"/></style:style>${columnStyles}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`));
  entries.push(part('styles.xml', `${XML}<office:document-styles ${NS} office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="120%"/><style:text-properties fo:font-family="Liberation Sans" fo:font-size="11pt"/></style:default-style><style:style style:name="Body" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.12cm"/></style:style><style:style style:name="Heading" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.3cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#244766"/></style:style><style:style style:name="PageHeading" style:family="paragraph" style:parent-style-name="Heading"><style:paragraph-properties fo:break-before="page"/></style:style><style:style style:name="TableHeading" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style></office:styles><office:automatic-styles><style:page-layout style:name="A4"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="A4"/></office:master-styles></office:document-styles>`));
  entries.push(part('meta.xml', `${XML}<office:document-meta ${NS} xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:title>${xml(title)}</dc:title><dc:creator>Open PDF Studio</dc:creator></office:meta></office:document-meta>`));
  entries.push(part('META-INF/manifest.xml', `${XML}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}" manifest:version="1.3"/>${entries.filter(e => e.name !== 'mimetype').map(e => `<manifest:file-entry manifest:full-path="${e.name}" manifest:media-type="${e.name.endsWith('.png') ? 'image/png' : 'text/xml'}"/>`).join('')}</manifest:manifest>`));
  return zipStore(entries);
}
