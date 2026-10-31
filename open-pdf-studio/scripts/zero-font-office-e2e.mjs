// node scripts/zero-font-office-e2e.mjs [isolated Vite URL]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { zeroFontFixture } from './zero-font-fixture.mjs';
import { unzip } from '../js/bcf/bcf-zip.js';
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.goto(process.argv[2] || 'http://127.0.0.1:3073', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('[data-tab="view"]').waitFor({ timeout: 90000 });
    const load = async (bytes, name) => page.evaluate(async ({ bytes, name }) => {
        const { cacheWebFile } = await import('/js/core/platform.js');
        const { createTab } = await import('/js/ui/chrome/tabs.js');
        const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
        const { getActiveDocument } = await import('/js/core/state.ts');
        cacheWebFile(name, new Uint8Array(bytes));
        const { index } = createTab(name);
        await loadPDFIfNeeded(name, index);
        window.fixture = { getActiveDocument };
    }, { bytes: [...bytes], name });
    for (const [index, opts] of [{}, { form: true }, { zero: false }].entries()) {
        await load(await zeroFontFixture(opts), `zero-${index}.pdf`);
        const text = await page.evaluate(async () => {
            const doc = window.fixture.getActiveDocument(), p = await doc.pdfDoc.getPage(1);
            const search = await (await import('/js/search/find-controller.js')).extractPageText(doc.pdfDoc, 1, doc);
            const host = document.createElement('div');
            host.style.cssText = 'position:absolute;left:0;top:0;width:400px;height:300px';
            document.body.append(host);
            const layer = await (await import('/js/text/text-layer.js')).createTextLayer(p, p.getViewport({ scale: 1 }), host, 1);
            const span = [...layer.querySelectorAll('span')].find(s => s.textContent === 'Visible text');
            if (!span)
                throw Error('Visible text missing from selectable layer');
            const range = document.createRange();
            range.selectNodeContents(span);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            const selected = (await import('/js/text/text-selection.js')).getSelectedText();
            host.remove();
            return { search: search.text, selected };
        });
        assert.match(text.search, /Visible text/);
        assert.equal(text.selected, 'Visible text');
        for (const format of ['docx', 'odt', 'xlsx']) {
            const [download, ok] = await Promise.all([page.waitForEvent('download'), page.evaluate(async (format) => (await import('/js/pdf/office-export.js')).exportOffice({ format, pages: [1] }), format)]);
            assert.equal(ok, true);
            const entries = await unzip(new Uint8Array(readFileSync(await download.path())));
            const xml = [...entries].filter(([name]) => name.endsWith('.xml')).map(([, bytes]) => new TextDecoder().decode(bytes)).join('\n');
            assert.match(xml, /Visible text/);
        }
    }
    // Browser opening passwords are not retained. Re-authenticate for strict
    // extraction, including a wrong-password retry and cancellation.
    const encrypted = new Uint8Array(readFileSync(new URL('../src-tauri/tests/fixtures/beveiligd/wachtwoord-geheim.pdf', import.meta.url)));
    const opening = load(encrypted, 'protected-878.pdf');
    await page.locator('input[type="password"]').fill('geheim');
    await page.locator('#pdf-password-ok').click();
    await opening;
    const protectedExport = page.evaluate(async () => (await import('/js/pdf/office-export.js')).exportOffice({ format: 'docx', pages: [1] }));
    await page.locator('input[type="password"]').fill('wrong');
    await page.locator('#pdf-password-ok').click();
    await page.locator('#pdf-password-ok:not([disabled])').waitFor();
    await page.locator('input[type="password"]').fill('geheim');
    const protectedDownload = page.waitForEvent('download');
    await page.locator('#pdf-password-ok').click();
    assert.equal(await protectedExport, true);
    assert.ok((await protectedDownload).suggestedFilename().endsWith('.docx'));
    let cancelledDownloads = 0;
    page.on('download', () => cancelledDownloads++);
    const cancelledExport = page.evaluate(async () => (await import('/js/pdf/office-export.js')).exportOffice({ format: 'docx', pages: [1] }));
    await page.locator('#pdf-password-cancel').click();
    assert.equal(await cancelledExport, false);
    assert.equal(cancelledDownloads, 0);
    // Malformed XObject produces a dependency warning in tolerant display, but
    // strict Office extraction must fail visibly and must never download a file.
    await load(await zeroFontFixture({ broken: true }), 'broken-878.pdf');
    let downloads = 0;
    page.on('download', () => downloads++);
    const result = await page.evaluate(async () => (await import('/js/pdf/office-export.js')).exportOffice({ format: 'docx', pages: [1] }));
    assert.equal(result, false);
    assert.equal(downloads, 0);
    await page.getByText(/XObject should be a stream/).waitFor();
    console.log('PASS: actual Office downloads DOCX/ODT/XLSX preserve visible text; search and selection work; malformed extraction reports error without download.');
}
finally {
    await browser.close();
}
