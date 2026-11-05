// Small canvas preview of a dynamic stamp template (#629), drawn with the
// same code as the stamp on the page.
import { createEffect, onCleanup } from 'solid-js';
import { drawDynamicStamp } from '../../../annotations/rendering/dynamic-stamp-draw.js';
import { naturalStampSize } from '../../../annotations/dynamic-stamp-layout.js';
import { resolveStampValues, customFields, normalizeTemplate } from '../../../annotations/dynamic-stamp.js';
import i18next from '../../../i18n/config.js';
import { state } from '../../../core/state.js';

/** Example values: now, the author, page 1 of 1; own fields show their default or name. */
export function sampleValues(template, given = {}) {
  const own = {};
  for (const f of customFields(template)) own[f.key] = f.default || f.name;
  return resolveStampValues(template, {
    now: new Date(), locale: i18next.language || 'en',
    user: state.preferences?.authorName || state.defaultAuthor || 'User',
    page: 1, pages: 1, filename: 'document.pdf', title: 'Document',
  }, { ...own, ...given });
}

export default function StampTemplatePreview(props) {
  let canvas;
  let alive = true;
  onCleanup(() => { alive = false; });

  const draw = () => {
    if (!alive || !canvas) return;
    const t = normalizeTemplate(props.template).template;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = props.width || 160, H = props.height || 60;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!t) return;
    const values = props.values || sampleValues(t);
    const nat = naturalStampSize(t, values);
    const s = Math.min((W - 4) / nat.width, (H - 4) / nat.height, props.maxScale || 2);
    const w = nat.width * s, h = nat.height * s;
    drawDynamicStamp(ctx, {
      x: (W - w) / 2, y: (H - h) / 2, width: w, height: h, rotation: 0,
      dynamicStamp: { template: t, values },
    }, { onImageLoad: draw });
  };

  createEffect(() => {
    // Track the props that change the picture.
    JSON.stringify(props.template);
    JSON.stringify(props.values);
    draw();
  });

  return (
    <canvas
      ref={canvas}
      class="stamp-template-preview"
      style={{ width: `${props.width || 160}px`, height: `${props.height || 60}px` }}
    />
  );
}
