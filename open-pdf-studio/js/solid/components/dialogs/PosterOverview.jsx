import { createMemo, createEffect, on, onCleanup, For, Show } from 'solid-js';
import { posterGrid } from '../../../pdf/print-poster-grid.js';
import { renderPrintBeeld } from '../../../pdf/print-job.js';
import { renderDeel } from '../../../pdf/print-plaatsing.js';
import { getActiveDocument } from '../../../core/state.js';

export default function PosterOverview(props) {
  // Selecting another tile of the same page keeps the layout object, so the
  // grid, its tile elements (and their keyboard focus) and the rendered
  // overview stay as they are; only a new layout rebuilds them.
  const layout = createMemo(() => props.layout);
  const page = createMemo(() => props.page);
  const markups = createMemo(() => props.markups);
  const color = createMemo(() => props.color);
  const grid = createMemo(() => posterGrid(layout()));
  let canvas, generation = 0;
  onCleanup(() => { generation++; });

  createEffect(on([grid, page, markups, color], async () => {
    const current = ++generation, g = grid(), l = layout();
    const doc = getActiveDocument();
    if (!g || !canvas || !doc?.pdfDoc) return;
    const b = g.bounds;
    const px = Math.min(300 / b.width, 180 / b.height) * Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(b.width * px));
    canvas.height = Math.max(1, Math.round(b.height * px));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const original = l.vellen[0].plaatsing;
    const placement = l.getegeld ? {
      ...original,
      pagina: { x: 0, y: 0, breedte: g.page.width, hoogte: g.page.height },
      zichtbaar: { x: 0, y: 0, breedte: g.page.width, hoogte: g.page.height },
      bron: { x: 0, y: 0, breedte: original.paginaPt.breedtePt, hoogte: original.paginaPt.hoogtePt },
    } : original;
    const scale = placement.schaal * (25.4 / 72) * px;
    const part = renderDeel(placement, scale);
    if (!part) return;
    try {
      const image = await renderPrintBeeld(page(), scale, placement, part, { markeringen: markups(), kleur: color() });
      if (current !== generation || doc !== getActiveDocument() || doc.isClosed?.()) return;
      const r = part.opVel;
      ctx.drawImage(image, (r.x - b.x) * px, (r.y - b.y) * px, r.breedte * px, r.hoogte * px);
      canvas.dataset.page = String(page());
    } catch (error) {
      if (current === generation) console.error('Poster overview:', error);
    }
  }));

  const choose = tile => props.onSelect(tile.number - 1);
  return <Show when={grid()}>{g => <div class="poster-overview" data-page={props.page}>
    <div class="poster-overview-title">{props.title}</div>
    <div class="poster-overview-picture" style={{
      width: `${Math.min(300, 180 * g().bounds.width / g().bounds.height)}px`,
      'aspect-ratio': `${g().bounds.width} / ${g().bounds.height}`,
    }}>
      <canvas ref={canvas} />
      <svg viewBox={`${g().bounds.x} ${g().bounds.y} ${g().bounds.width} ${g().bounds.height}`} aria-label={props.title}>
        <For each={g().overlaps}>{r => <rect {...r} class="poster-overlap" />}</For>
        <For each={g().tiles}>{tile => <rect x={tile.x} y={tile.y} width={tile.width} height={tile.height}
          role="button" tabindex="0" aria-label={props.tileLabel(tile)} aria-pressed={tile.number === props.selected}
          class="poster-grid-tile" classList={{ selected: tile.number === props.selected }}
          onClick={() => choose(tile)} onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(tile); }
          }}><title>{props.tileLabel(tile)}</title></rect>}</For>
      </svg>
    </div>
    <Show when={g().overlaps.length}><div class="poster-overlap-legend">{props.overlapLabel}</div></Show>
  </div>}</Show>;
}
