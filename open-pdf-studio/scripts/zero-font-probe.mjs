import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { zeroFontFixture } from './zero-font-fixture.mjs';
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
import { workerVoorOudeWebview } from './oude-webview.mjs';
import { textItemsToBoxes, recoverLayout } from '../js/pdf/office-layout.js';
import { buildDocx } from '../js/pdf/office-files.js';
import { unzip } from '../js/bcf/bcf-zip.js';
const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'opds-zero-font-'));
try {
    let source = readFileSync(process.argv[3] || require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
    if (!['original', 'shipped'].includes(process.argv[2]))
        source = patchPdfjsWorker(source);
    if (process.argv[2] === 'transformed')
        source = await workerVoorOudeWebview(source);
    const file = join(root, 'worker.mjs');
    writeFileSync(file, source);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(file).href;
    for (const opts of [{}, { form: true }, { zero: false }, { form: true, zero: false }]) {
        const task = pdfjs.getDocument({ data: await zeroFontFixture(opts), stopAtErrors: true, useSystemFonts: true });
        try {
            const doc = await task.promise, page = await doc.getPage(1), content = await page.getTextContent();
            assert.match(content.items.map(i => i.str).join(''), /Visible text/);
            const viewport = page.getViewport({ scale: 1 });
            const bytes = buildDocx([{ number: 1, width: 400, height: 300, blocks: recoverLayout(textItemsToBoxes(content.items, viewport)) }]);
            const zip = await unzip(bytes);
            assert.match(new TextDecoder().decode(zip.get('word/document.xml')), /Visible text/);
        }
        finally {
            await task.destroy();
        }
    }
    const task = pdfjs.getDocument({ data: await zeroFontFixture({ broken: true }), stopAtErrors: true });
    try {
        const doc = await task.promise;
        await assert.rejects(async () => (await doc.getPage(1)).getTextContent(), /XObject|Invalid/);
    }
    finally {
        await task.destroy();
    }
    console.log('PASS: zero font, Form, controls, DOCX content, strict extraction error');
}
finally {
    rmSync(root, { recursive: true, force: true });
}
