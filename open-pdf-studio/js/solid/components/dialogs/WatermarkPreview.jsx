import { createSignal, createEffect, onCleanup, onMount, Show, untrack } from 'solid-js';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { getActiveDocument } from '../../../core/state.js';
import { getCachedPdfBytes } from '../../../pdf/loader.js';
import { readBinaryFile } from '../../../core/platform.js';
import { pdfjsBronnen } from '../../../core/basis-url.js';
import { viewportOpties } from '../../../pdf/getoonde-pagina.js';
import { renderMarkeringenOffscreen } from '../../../pdf/exporter.js';
import { pdfjsLaagOpties } from '../../../pdf/lagen-schakelen.js';
import { removeWatermarkStreams } from '../../../pdf/saver/watermark-content.js';
import { kopVoetInWeergave } from '../../../watermark/kopvoet-weergave.js';
import { shouldRenderOnPage, renderTextWatermark, renderImageWatermark, renderHeaderFooter } from '../../../watermark/watermark-renderer.js';
import { previewPlacement, previewHit, previewDragPosition } from '../../../watermark/watermark-preview.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function WatermarkPreview(props) {
  const { t } = useTranslation('dialogs');
  const { t: common } = useTranslation('common');
  const doc = props.doc, originalPdf = doc?.pdfDoc;
  const [pageNumber, setPageNumber] = createSignal(doc?.currentPage || 1);
  const [background, setBackground] = createSignal(null);
  const [error, setError] = createSignal(false);
  const [zoom, setZoom] = createSignal(1);
  const [imageRevision, setImageRevision] = createSignal(0);
  let canvas, viewportElement, generation = 0, disposed = false, privateTask, renderTask, frame, drag;
  const images = new Map();
  const valid = () => !disposed && getActiveDocument() === doc && doc?.pdfDoc === originalPdf;
  // Only the edited OPS watermark is removed, from private bytes. Opening or
  // cancelling the preview never changes the source/cache/document history.
  const source = (async () => {
    if (!originalPdf) return null;
    if (!props.editWm || !kopVoetInWeergave(doc, props.editWm)) return originalPdf;
    // The same source as haalKopVoetUitWeergave: the cache, else the file.
    const bytes = getCachedPdfBytes(doc.filePath) || await readBinaryFile(doc.filePath);
    if (!bytes) throw new Error('No PDF bytes');
    if (!valid()) return null;
    const pdf = await PDFDocument.load(new Uint8Array(bytes));
    removeWatermarkStreams(pdf, new Set([props.editWm.id]));
    const clean = await pdf.save();
    if (!valid()) return null;
    privateTask = pdfjs.getDocument({ data: clean.slice(), ...pdfjsBronnen(), isEvalSupported: false, verbosity: 0 });
    return privateTask.promise;
  })();
  // Attach a rejection handler immediately, also if closed before mount.
  source.catch(() => { if (!disposed) setError(true); });

  function imageFor(wm) {
    if (!wm.imageData) return null;
    let img = images.get(wm.imageData);
    if (!img) {
      img = new Image(); images.set(wm.imageData, img);
      img.onload = () => { if (!disposed) setImageRevision(v => v + 1); };
      img.onerror = () => { if (!disposed) setError(true); };
      img.src = wm.imageData;
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  // Free the pixel memory of a page that is no longer shown.
  function release(bg) {
    if (!bg) return;
    for (const c of [bg.base, bg.annotations]) if (c) { c.width = 0; c.height = 0; }
  }

  function marks() {
    return [...(doc?.watermarks || []).filter(w => w.id !== props.editWm?.id && !kopVoetInWeergave(doc, w)), props.watermark];
  }

  function paint() {
    const bg = background();
    if (!canvas || !bg || !valid()) return;
    const ctx = canvas.getContext('2d');
    canvas.width = bg.base.width; canvas.height = bg.base.height;
    canvas.style.width = `${bg.cssWidth * zoom()}px`; canvas.style.height = `${bg.cssHeight * zoom()}px`;
    ctx.drawImage(bg.base, 0, 0);
    const drawLayer = layer => {
      ctx.save(); ctx.scale(bg.ratio, bg.ratio);
      for (const wm of marks()) {
        if ((wm.type === 'headerFooter' ? 'infront' : wm.layer || 'behind') !== layer || !shouldRenderOnPage(wm, pageNumber(), originalPdf.numPages)) continue;
        if (wm.type === 'headerFooter') renderHeaderFooter(ctx, wm, pageNumber(), originalPdf.numPages, bg.width, bg.height);
        if (wm.type === 'textWatermark') renderTextWatermark(ctx, wm, bg.width, bg.height);
        if (wm.type === 'imageWatermark') {
          const img = imageFor(wm); if (img) renderImageWatermark(ctx, wm, bg.width, bg.height, img);
        }
      }
      ctx.restore();
    };
    drawLayer('behind'); ctx.drawImage(bg.annotations, 0, 0); drawLayer('infront');
    canvas.dataset.page = String(pageNumber());
  }

  onMount(() => {
    createEffect(() => {
      const number = pageNumber();
      const token = ++generation;
      renderTask?.cancel(); release(untrack(background)); setBackground(null); setError(false); drag = null;
      props.onPage?.(number);
      (async () => {
        const pdf = await source;
        if (!pdf || !valid() || token !== generation) return;
        const page = await pdf.getPage(number);
        if (!valid() || token !== generation) return;
        const options = viewportOpties(page, doc.pageRotations?.[number] || 0);
        const size = page.getViewport(options);
        const fit = Math.min(350 / size.width, 430 / size.height);
        const ratio = fit * Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ ...options, scale: ratio });
        const base = document.createElement('canvas'); base.width = Math.ceil(vp.width); base.height = Math.ceil(vp.height);
        // Switched-off layers stay off, as on screen (only the document's own pdf.js config).
        const layers = pdf === originalPdf ? pdfjsLaagOpties(doc) : {};
        renderTask = page.render({ canvasContext: base.getContext('2d'), viewport: vp, annotationMode: 0, ...layers });
        await renderTask.promise;
        if (!valid() || token !== generation) { release({ base }); return; }
        const annotations = await renderMarkeringenOffscreen(number, ratio, vp, { watermerken: false });
        if (!valid() || token !== generation) { release({ base, annotations }); return; }
        props.onSize?.({breedte:size.width, hoogte:size.height});
        setBackground({ base, annotations, width:size.width, height:size.height, ratio, cssWidth:size.width*fit, cssHeight:size.height*fit });
      })().catch(e => { if (valid() && token === generation && e.name !== 'RenderingCancelledException') setError(true); });
    });
    createEffect(() => {
      // Settings repaint cached page pixels; no PDF re-render on each keystroke.
      // The memo gives a new object on every change; reading it is enough
      // (no JSON copy of a large image on every keystroke).
      props.watermark; background(); zoom(); imageRevision();
      cancelAnimationFrame(frame); frame = requestAnimationFrame(paint);
    });
  });
  createEffect(() => { if (getActiveDocument() !== doc || doc?.pdfDoc !== originalPdf) props.onInvalid?.(); });
  onCleanup(() => {
    disposed = true; generation++; cancelAnimationFrame(frame); renderTask?.cancel();
    privateTask?.destroy().catch(() => {});
    for (const img of images.values()) { img.onload = null; img.onerror = null; }
    images.clear();
    release(background());
  });

  function point(e) {
    const r = canvas.getBoundingClientRect(), bg = background();
    return { x:(e.clientX-r.left)*bg.width/r.width, y:(e.clientY-r.top)*bg.height/r.height };
  }
  function down(e) {
    if (!background() || !valid()) return;
    const p = point(e), bg = background(), wm = props.watermark;
    if (e.button === 1) {
      drag = { pan:true, x:e.clientX, y:e.clientY, left:viewportElement.scrollLeft, top:viewportElement.scrollTop };
    } else if (e.button === 0 && shouldRenderOnPage(wm,pageNumber(),originalPdf.numPages)
      && (wm.type !== 'imageWatermark' || imageFor(wm))
      && previewHit(wm,bg.width,bg.height,p.x,p.y)) {
      const origin = previewPlacement(wm,bg.width,bg.height);
      drag = { x:p.x, y:p.y, origin };
    } else return;
    canvas.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
  }
  function move(e) {
    if (!drag || !background()) return;
    if (drag.pan) { viewportElement.scrollLeft=drag.left+drag.x-e.clientX; viewportElement.scrollTop=drag.top+drag.y-e.clientY; return; }
    const p = point(e), bg = background();
    const next = previewDragPosition(drag.origin, drag, p, bg.width, bg.height);
    props.onPosition(next.x, next.y);
  }
  function up(e) { drag=null; if(canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); }
  return <section class="watermark-preview-panel">
    <div class="watermark-preview-nav">
      <button class="pref-btn" aria-label={t('print.prevPage')} disabled={pageNumber()<=1} onClick={()=>setPageNumber(n=>n-1)}>‹</button>
      <span>{t('print.pageOf',{current:pageNumber(),total:originalPdf?.numPages || 0})}</span>
      <button class="pref-btn" aria-label={t('print.nextPage')} disabled={pageNumber()>=(originalPdf?.numPages || 0)} onClick={()=>setPageNumber(n=>n+1)}>›</button>
    </div>
    <div class="watermark-preview-viewport" ref={viewportElement} onWheel={e=>{
      if(e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setZoom(z=>Math.min(4,Math.max(.5,z*(e.deltaY>0?.9:1.1)))); }
    }}>
      <Show when={error()}><span role="alert">{common('failedToLoadPdf')}</span></Show>
      <Show when={!background() && !error()}><span>{common('loading')}</span></Show>
      <canvas ref={canvas} id="watermark-preview-canvas" aria-label={t('watermark.position')} style={{display:background()?'block':'none'}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}/>
    </div>
  </section>;
}
