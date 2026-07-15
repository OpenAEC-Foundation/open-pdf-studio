//! Parallelle tegel-rasterizer over de DrawCommandBuffer (route A, fase 2).
//!
//! Architectuur (MuPDF/Ghostscript-patroon over onze eigen display-list):
//!   1. PRE-PASS (eenmalig, sequentieel): loop de commandbuffer met een
//!      graphics-state-machine, groepeer opeenvolgende ops in CHUNKS van
//!      ~CHUNK_PAINTS teken-ops. Per chunk: byte-range + pagina-ruimte-bbox
//!      + volledig state-snapshot bij chunk-start (CTM, stijlen, clip-refs).
//!   2. TEGELS (parallel, rayon): elke tegel replayt alleen de chunks
//!      waarvan de bbox de tegel raakt, op een eigen tiny-skia-Pixmap.
//!      Chunks replayen in buffervolgorde → painter's order blijft correct.
//!
//! Replay-semantiek is identiek aan de Canvas2D-replayer in de app
//! (js/pdf/vector-renderer.js): pad-punten worden met de CTM van het moment
//! van toevoegen naar device-ruimte gebracht; stroke-breedte en dash-pattern
//! schalen met de CTM op het stroke-moment; basis-CTM = scale(s) · Y-flip ·
//! translate(-x0, -y0) (MediaBox-origin, zie build()). Beide assen trekken
//! hun MediaBox-origin AF; een niet-nul origin (gecentreerde CAD-bladen) zou
//! anders de hele pagina uit beeld schuiven. NB: de JS-replayer aan de
//! app-kant heeft dezelfde origin-correctie nodig (valt buiten deze crate).
//!
//! Tegel-offsets zijn GEHELE pixels, dus de geometrie per pixel is identiek
//! aan de volledige render — anti-aliasing is translatie-invariant en de
//! assemblage is pixel-gelijk aan een render in één stuk (getest).

use rayon::prelude::*;
use tiny_skia::{
    FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke,
    StrokeDash, Transform,
};

const CHUNK_PAINTS: usize = 64;

// ── buffer-lezer ────────────────────────────────────────────────────────────

struct CmdReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> CmdReader<'a> {
    #[inline(always)]
    fn u8(&mut self) -> u8 {
        let v = self.data[self.pos];
        self.pos += 1;
        v
    }
    #[inline(always)]
    fn f32(&mut self) -> f32 {
        let v = f32::from_le_bytes(self.data[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        v
    }
    #[inline(always)]
    fn u32(&mut self) -> u32 {
        let v = u32::from_le_bytes(self.data[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        v
    }
    #[inline(always)]
    fn u16(&mut self) -> u16 {
        let v = u16::from_le_bytes(self.data[self.pos..self.pos + 2].try_into().unwrap());
        self.pos += 2;
        v
    }
    #[inline(always)]
    fn done(&self) -> bool {
        self.pos >= self.data.len()
    }
}

// ── state ───────────────────────────────────────────────────────────────────

/// Referentie naar een actief clip-pad: byte-range in de buffer van de
/// BeginPath (op 17) tot de clip-op (20/21), plus de CTM waaronder het pad
/// begon en de even-odd-vlag. Replay herbouwt het pad uit deze range —
/// Transform-ops (12) binnen de range worden daarbij gewoon toegepast.
#[derive(Clone, Debug, PartialEq)]
struct ClipRef {
    start: usize,
    end: usize,
    even_odd: bool,
    ctm: Transform,
}

#[derive(Clone, Debug)]
struct GState {
    ctm: Transform,
    stroke_rgba: u32,
    stroke_width: f32,
    fill_rgba: u32,
    line_cap: u8,
    line_join: u8,
    miter_limit: f32,
    dash: Option<(Vec<f32>, f32)>,
    /// Actieve clips als pad-referenties. Clips zijn zeldzaam op CAD-bladen;
    /// replay bouwt per chunk-snapshot één tegel-masker uit deze lijst en
    /// houdt hem in-chunk incrementeel bij (ops 20/21 + save/restore).
    clips: Vec<ClipRef>,
}

impl GState {
    fn new(base: Transform) -> Self {
        GState {
            ctm: base,
            stroke_rgba: 0xFF00_0000,
            stroke_width: 1.0,
            fill_rgba: 0xFF00_0000,
            line_cap: 0,
            line_join: 0,
            miter_limit: 10.0,
            dash: None,
            clips: Vec::new(),
        }
    }
}

#[inline(always)]
fn uniform_scale(t: &Transform) -> f32 {
    // sqrt(|det|): exact bij uniforme schaal, nette benadering daarbuiten.
    (t.sx * t.sy - t.kx * t.ky).abs().sqrt()
}

/// Punt (x, y) onder transform `t` naar device-ruimte.
#[inline(always)]
fn dev_pt(t: &Transform, x: f32, y: f32) -> (f32, f32) {
    (t.sx * x + t.kx * y + t.tx, t.ky * x + t.sy * y + t.ty)
}

/// Is dit pad exact één as-uitgelijnde rechthoek? Zo ja: (x0, y0, x1, y1).
/// Herkent het M-L-L-L-[L]-Close-patroon van `re`-clips en Form-BBoxen; de
/// snelle weg om tegel-dekkende viewport-clips als no-op te behandelen.
fn axis_aligned_rect_of(path: &tiny_skia::Path) -> Option<(f32, f32, f32, f32)> {
    use tiny_skia::PathSegment;
    let mut pts: Vec<(f32, f32)> = Vec::with_capacity(5);
    let mut closed = false;
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(p) => {
                if !pts.is_empty() { return None; } // meerdere subpaden
                pts.push((p.x, p.y));
            }
            PathSegment::LineTo(p) => {
                if pts.is_empty() || pts.len() > 4 || closed { return None; }
                pts.push((p.x, p.y));
            }
            PathSegment::Close => {
                if closed { return None; }
                closed = true;
            }
            _ => return None, // curves: geen rechthoek
        }
    }
    // 4 hoekpunten, of 5 waarbij het laatste het eerste herhaalt.
    if pts.len() == 5 {
        if pts[4] != pts[0] { return None; }
        pts.truncate(4);
    }
    if pts.len() != 4 { return None; }
    // Opeenvolgende zijden moeten afwisselend horizontaal/verticaal zijn.
    for i in 0..4 {
        let (x0, y0) = pts[i];
        let (x1, y1) = pts[(i + 1) % 4];
        if x0 != x1 && y0 != y1 { return None; }
    }
    let xs: Vec<f32> = pts.iter().map(|p| p.0).collect();
    let ys: Vec<f32> = pts.iter().map(|p| p.1).collect();
    let (x0, x1) = (xs.iter().cloned().fold(f32::MAX, f32::min), xs.iter().cloned().fold(f32::MIN, f32::max));
    let (y0, y1) = (ys.iter().cloned().fold(f32::MAX, f32::min), ys.iter().cloned().fold(f32::MIN, f32::max));
    if x0 >= x1 || y0 >= y1 { return None; }
    Some((x0, y0, x1, y1))
}

#[inline(always)]
fn rgba_to_color(rgba: u32) -> tiny_skia::Color {
    // Buffer-encoding volgt interpreter::color_to_u32 en de JS-replayer
    // (_rgbaToCSS): 0xRRGGBBAA — r in de hoogste byte, alpha in de laagste.
    let r = ((rgba >> 24) & 0xFF) as u8;
    let g = ((rgba >> 16) & 0xFF) as u8;
    let b = ((rgba >> 8) & 0xFF) as u8;
    let a = (rgba & 0xFF) as u8;
    tiny_skia::Color::from_rgba8(r, g, b, a)
}

// ── chunk-index ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Chunk {
    start: usize,
    end: usize,
    /// bbox in pagina-pixels op schaal 1 (na flip/origin, vóór caller-scale);
    /// leeg gelaten (max<min) voor chunks zonder geometrie.
    bbox: (f32, f32, f32, f32),
    snap: GState,
    /// Save-stack op het snapshot-moment. Chunk-grenzen kunnen midden in een
    /// save/restore-paar vallen (glyph-runs!): zonder deze stack herstelde
    /// een Restore in de chunk naar het snapshot zelf i.p.v. de pre-save-
    /// staat, waardoor alle volgende tekst in de chunk de blijven-hangen
    /// glyph-transform erfde en buiten beeld belandde.
    snap_stack: Vec<GState>,
}

pub struct TileScene {
    data: Vec<u8>,
    pub page_w: f32,
    pub page_h: f32,
    base: Transform, // flip + MediaBox-origin (schaal 1)
    chunks: Vec<Chunk>,
    /// Aantal clip-ops (20/21) in de buffer. De replayer honoreert clips
    /// (tegel-maskers); de teller blijft de zwaarte-indicator voor de
    /// engine-gate in de app.
    pub clip_ops: u64,
    /// Totaal aan ge-embedde image-bytes (DrawImage-payloads) in de buffer.
    pub image_bytes: u64,
    /// Minimale stroke-breedte in device-pixels. Default 1.0 = PDFium-match:
    /// de PDF-spec (8.4.3.2) definieert `0 w` als "dunste renderbare lijn =
    /// 1 device-pixel" en PDFium rastert álle subpixel-lijnen zo — de
    /// vector-engine-kalibratie (0,2 px-coverage, zie renderer.rs) oogt op
    /// zware CAD-bladen 2-3x lichter dan de PDFium-weergave die gebruikers
    /// daar gewend zijn. Zet op 0.0 voor de fijne vector-look.
    pub hairline_floor_px: f32,
}

struct BboxAcc {
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
}

impl BboxAcc {
    fn new() -> Self {
        BboxAcc { min_x: f32::MAX, min_y: f32::MAX, max_x: f32::MIN, max_y: f32::MIN }
    }
    #[inline(always)]
    fn add(&mut self, t: &Transform, x: f32, y: f32) {
        let dx = t.sx * x + t.kx * y + t.tx;
        let dy = t.ky * x + t.sy * y + t.ty;
        if dx < self.min_x { self.min_x = dx }
        if dy < self.min_y { self.min_y = dy }
        if dx > self.max_x { self.max_x = dx }
        if dy > self.max_y { self.max_y = dy }
    }
    fn merge_into(&self, out: &mut (f32, f32, f32, f32), pad: f32) {
        if self.min_x > self.max_x { return; }
        out.0 = out.0.min(self.min_x - pad);
        out.1 = out.1.min(self.min_y - pad);
        out.2 = out.2.max(self.max_x + pad);
        out.3 = out.3.max(self.max_y + pad);
    }
}

impl TileScene {
    /// Bouw de scene + chunk-index uit een buffer MET 16-byte header
    /// (x0, y0, w, h — zoals extract_draw_commands hem oplevert).
    pub fn build(buffer: Vec<u8>) -> Result<TileScene, crate::RenderError> {
        if buffer.len() < 16 {
            return Err(crate::RenderError::RenderError("tile: buffer te kort".into()));
        }
        let x0 = f32::from_le_bytes(buffer[0..4].try_into().unwrap());
        let y0 = f32::from_le_bytes(buffer[4..8].try_into().unwrap());
        let w = f32::from_le_bytes(buffer[8..12].try_into().unwrap());
        let h = f32::from_le_bytes(buffer[12..16].try_into().unwrap());

        // Origin-verschuiving: schuif de MediaBox-oorsprong (x0, y0) naar (0, 0)
        // en flip de Y-as (PDF omhoog -> device omlaag). Voor een punt (x, y):
        //   device_x = x - x0
        //   device_y = (y0 + h) - y
        // Beide assen trekken hun origin AF: translate(-x0, -y0), daarna de flip.
        // Eerder stond hier translate(-x0, +y0); bij een niet-nul MediaBox-
        // origin (o.a. gecentreerde CAD-bladen met y0 = -h/2) verschoof dat de
        // hele pagina 2*|y0| in device-Y buiten het canvas, waardoor het blad
        // (vrijwel) leeg raste. De X-as gebruikte al correct -x0.
        // post_concat: eerst translate-matrix, dan flip erover heen.
        let base = Transform::from_translate(-x0, -y0).post_concat(Transform::from_row(
            1.0, 0.0, 0.0, -1.0, 0.0, h,
        ));

        let mut scene = TileScene {
            data: buffer,
            page_w: w,
            page_h: h,
            base,
            chunks: Vec::new(),
            clip_ops: 0,
            image_bytes: 0,
            hairline_floor_px: 1.0,
        };
        scene.index()?;
        Ok(scene)
    }

    /// PRE-PASS: state-machine + chunking. Paint-ops: Stroke/Fill/FillEO/
    /// TextAt/DrawImage. Pad-bbox wordt bij opbouw geaccumuleerd.
    fn index(&mut self) -> Result<(), crate::RenderError> {
        let mut r = CmdReader { data: &self.data, pos: 16 };
        let mut state = GState::new(self.base);
        let mut stack: Vec<GState> = Vec::new();

        let mut chunk_start = r.pos;
        let mut chunk_snap = state.clone();
        let mut chunk_snap_stack: Vec<GState> = Vec::new();
        let mut chunk_bbox = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        let mut paints = 0usize;
        let mut path_acc = BboxAcc::new();
        let mut last_pt = (0.0f32, 0.0f32);
        let mut chunks: Vec<Chunk> = Vec::new();
        // Start (byte-pos, CTM) van het pad dat sinds de laatste BeginPath
        // wordt opgebouwd — de clip-referentie bij ops 20/21.
        let mut path_start: Option<(usize, Transform)> = None;

        while !r.done() {
            let op_pos = r.pos;
            let op = r.u8();
            match op {
                0 | 1 => { // MoveTo / LineTo
                    let x = r.f32();
                    let y = r.f32();
                    path_acc.add(&state.ctm, x, y);
                    last_pt = (x, y);
                }
                2 => { // CubicTo — controlepunten meenemen is conservatief-correct
                    let x1 = r.f32(); let y1 = r.f32();
                    let x2 = r.f32(); let y2 = r.f32();
                    let x3 = r.f32(); let y3 = r.f32();
                    path_acc.add(&state.ctm, x1, y1);
                    path_acc.add(&state.ctm, x2, y2);
                    path_acc.add(&state.ctm, x3, y3);
                    last_pt = (x3, y3);
                }
                3 => { // Rect
                    let x = r.f32(); let y = r.f32();
                    let w = r.f32(); let h = r.f32();
                    path_acc.add(&state.ctm, x, y);
                    path_acc.add(&state.ctm, x + w, y);
                    path_acc.add(&state.ctm, x, y + h);
                    path_acc.add(&state.ctm, x + w, y + h);
                    last_pt = (x, y);
                }
                4 => {} // ClosePath
                5 => { state.stroke_rgba = r.u32(); state.stroke_width = r.f32(); }
                6 => { state.fill_rgba = r.u32(); }
                7 => { // Stroke — paint: bbox verruimen met halve lijndikte (+miter-marge)
                    let pad = 0.5 * state.stroke_width * uniform_scale(&state.ctm)
                        * state.miter_limit.max(1.0);
                    path_acc.merge_into(&mut chunk_bbox, pad.max(1.0));
                    paints += 1;
                }
                8 | 9 => { // Fill / FillEvenOdd
                    path_acc.merge_into(&mut chunk_bbox, 1.0);
                    paints += 1;
                }
                10 => stack.push(state.clone()),
                11 => { if let Some(s) = stack.pop() { state = s; } }
                12 => {
                    let a = r.f32(); let b = r.f32(); let c = r.f32();
                    let d = r.f32(); let e = r.f32(); let f = r.f32();
                    // Canvas2D ctx.transform = pre-concat op de CTM.
                    state.ctm = Transform::from_row(a, b, c, d, e, f).post_concat(state.ctm);
                }
                13 => { state.line_cap = r.u8(); }
                14 => { state.line_join = r.u8(); }
                15 => { state.miter_limit = r.f32(); }
                16 => {
                    let n = r.u8() as usize;
                    let mut pat = Vec::with_capacity(n);
                    for _ in 0..n { pat.push(r.f32()); }
                    let phase = r.f32();
                    state.dash = if pat.is_empty() { None } else { Some((pat, phase)) };
                }
                17 => { // BeginPath
                    path_acc = BboxAcc::new();
                    path_start = Some((op_pos, state.ctm));
                }
                18 => { // TextAt
                    let x = r.f32(); let y = r.f32();
                    let fs = r.f32(); let _rgba = r.u32();
                    let len = r.u8() as usize;
                    r.pos += len;
                    let mut acc = BboxAcc::new();
                    acc.add(&state.ctm, x, y - fs);
                    acc.add(&state.ctm, x + fs * 0.62 * len as f32, y + fs * 0.3);
                    acc.merge_into(&mut chunk_bbox, 1.0);
                    paints += 1;
                }
                19 => { // DrawImage in 1×1 unit-square onder de CTM
                    let _w = r.u16(); let _h = r.u16();
                    let dlen = r.u32() as usize;
                    self.image_bytes += dlen as u64;
                    r.pos += dlen;
                    let mut acc = BboxAcc::new();
                    acc.add(&state.ctm, 0.0, 0.0);
                    acc.add(&state.ctm, 1.0, 0.0);
                    acc.add(&state.ctm, 0.0, 1.0);
                    acc.add(&state.ctm, 1.0, 1.0);
                    acc.merge_into(&mut chunk_bbox, 1.0);
                    paints += 1;
                }
                20 | 21 => { // Clip / ClipEvenOdd: pad-range als clip-referentie
                    self.clip_ops += 1;
                    // De clip hoort bij het pad dat sinds de laatste BeginPath
                    // is opgebouwd: range [BeginPath, clip-op). Zonder actief
                    // pad (degenerate) wordt de range leeg → masker leeg →
                    // alles weggeclipt, conform PDF-semantiek voor een lege
                    // clip. Voor de index volstaat verder: clip beperkt
                    // alleen; bbox van volgende paints wordt er niet groter
                    // door.
                    let (ps, pctm) = path_start.unwrap_or((op_pos, state.ctm));
                    state.clips.push(ClipRef { start: ps, end: op_pos, even_odd: op == 21, ctm: pctm });
                    let _ = last_pt;
                }
                other => {
                    return Err(crate::RenderError::RenderError(format!(
                        "tile: onbekende opcode {} op {}", other, op_pos
                    )));
                }
            }

            // Chunk-grens ALLEEN vlak vóór een BeginPath: Canvas2D-paden
            // blijven na stroke/fill bestaan en mogen doorbouwen zonder
            // beginPath — een grens midden in zo'n doorlopend pad zou het
            // opgebouwde deel in de volgende chunk kwijtraken.
            if paints >= CHUNK_PAINTS && op == 17 {
                chunks.push(Chunk {
                    start: chunk_start,
                    end: op_pos,
                    bbox: chunk_bbox,
                    snap: chunk_snap.clone(),
                    snap_stack: chunk_snap_stack.clone(),
                });
                chunk_start = op_pos;
                chunk_snap = state.clone();
                chunk_snap_stack = stack.clone();
                chunk_bbox = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
                paints = 0;
            }
        }
        if chunk_start < r.pos {
            chunks.push(Chunk { start: chunk_start, end: r.pos, bbox: chunk_bbox, snap: chunk_snap, snap_stack: chunk_snap_stack });
        }
        self.chunks = chunks;
        Ok(())
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    /// Render één tegel: device-rect (px) bij `scale`. Pixel-offsets zijn
    /// gehele getallen zodat AA identiek is aan de volledige render.
    fn render_tile(&self, scale: f32, tx: u32, ty: u32, tw: u32, th: u32) -> Pixmap {
        self.render_tile_impl(scale, tx, ty, tw, th, true)
    }

    #[doc(hidden)]
    pub fn render_tile_debug(&self, scale: f32, tx: u32, ty: u32, tw: u32, th: u32, cull: bool) -> Pixmap {
        self.render_tile_impl(scale, tx, ty, tw, th, cull)
    }

    fn render_tile_impl_on_white(&self, scale: f32, tx: u32, ty: u32, tw: u32, th: u32) -> Pixmap {
        let mut pm = Pixmap::new(tw, th).expect("tile pixmap");
        pm.fill(tiny_skia::Color::WHITE);
        self.replay_onto(&mut pm, scale, tx, ty, tw, th, true);
        pm
    }

    fn render_tile_impl(&self, scale: f32, tx: u32, ty: u32, tw: u32, th: u32, cull: bool) -> Pixmap {
        let mut pixmap = Pixmap::new(tw, th).expect("tile pixmap");
        self.replay_onto(&mut pixmap, scale, tx, ty, tw, th, cull);
        pixmap
    }

    /// Replay alle relevante chunks van een tegel op een bestaande pixmap
    /// (transparant óf voorgevuld met papier-wit).
    fn replay_onto(&self, pixmap: &mut Pixmap, scale: f32, tx: u32, ty: u32, tw: u32, th: u32, cull: bool) {
        // volledige-pagina-CTM = scale · base. De tegel-verschuiving gaat NIET
        // de CTM in maar als aparte integer-translate in de paint-aanroepen:
        // paden krijgen zo exact dezelfde float-coördinaten als de volledige
        // render (integer-aftrek op f32 is exact) → bitwise-identieke AA.
        let full = self.base.post_concat(Transform::from_scale(scale, scale));
        let tile_shift = Transform::from_translate(-(tx as f32), -(ty as f32));

        // AA-marge: anti-aliasing bloedt tot ~2 device-pixels buiten de
        // geometrie; zonder deze marge cullen we randchunks waarvan de
        // AA-rand nog nét in de tegel valt (gaf 0,33% randpixel-verschil).
        const AA_MARGIN_PX: f32 = 2.0;
        let t_min_x = (tx as f32 - AA_MARGIN_PX) / scale;
        let t_min_y = (ty as f32 - AA_MARGIN_PX) / scale;
        let t_max_x = ((tx + tw) as f32 + AA_MARGIN_PX) / scale;
        let t_max_y = ((ty + th) as f32 + AA_MARGIN_PX) / scale;

        for chunk in &self.chunks {
            let (bx0, by0, bx1, by1) = chunk.bbox;
            if bx0 > bx1 { continue; } // chunk zonder paints
            if cull && (bx1 < t_min_x || bx0 > t_max_x || by1 < t_min_y || by0 > t_max_y) {
                continue;
            }
            self.replay_range(chunk, full, tile_shift, pixmap);
        }
    }

    /// Replay één chunk op een pixmap. `ctm_base` vervangt de scene-basis
    /// (bevat scale + tegel-translatie); de chunk-snapshot-CTM is relatief
    /// aan de scene-basis en wordt daarop omgehangen.
    fn replay_range(&self, chunk: &Chunk, ctm_base: Transform, tile_shift: Transform, pixmap: &mut Pixmap) {
        // snapshot-CTM = (relatief t.o.v. self.base) · self.base. Om hem onder
        // ctm_base te hangen: rel = snap.ctm · base⁻¹; ctm = rel · ctm_base.
        let inv_base = match self.base.invert() {
            Some(t) => t,
            None => return,
        };
        let rehome = |t: Transform| t.post_concat(inv_base).post_concat(ctm_base);

        let mut state = chunk.snap.clone();
        state.ctm = rehome(state.ctm);
        // Stack uit het snapshot, met elke CTM omgehangen naar de tegel-basis.
        let mut stack: Vec<GState> = chunk
            .snap_stack
            .iter()
            .map(|g| {
                let mut g2 = g.clone();
                g2.ctm = rehome(g2.ctm);
                g2
            })
            .collect();
        let base_state = if let Some(bottom) = stack.first() { bottom.clone() } else { state.clone() };

        // Actief clip-masker (tegel-lokaal). Start = snapshot-clips van de
        // chunk; in-chunk ops 20/21 versmallen hem incrementeel, save/restore
        // bewaart/herstelt hem via mask_stack (parallel aan replay-lokale
        // pushes op `stack`). None = geen beperking.
        let mut cur_mask: Option<std::rc::Rc<tiny_skia::Mask>> = self.build_clip_mask_refs(
            &chunk.snap.clips, &rehome, tile_shift, pixmap.width(), pixmap.height(),
        );
        let mut mask_stack: Vec<Option<std::rc::Rc<tiny_skia::Mask>>> = Vec::new();

        let mut r = CmdReader { data: &self.data, pos: chunk.start };
        let mut pb = PathBuilder::new();
        let mut cur = (0.0f32, 0.0f32);

        use dev_pt as dev;

        while r.pos < chunk.end {
            let op = r.u8();
            match op {
                0 => { let x = r.f32(); let y = r.f32(); let p = dev(&state.ctm, x, y); pb.move_to(p.0, p.1); cur = p; }
                1 => {
                    let x = r.f32(); let y = r.f32(); let p = dev(&state.ctm, x, y);
                    if pb.is_empty() { pb.move_to(cur.0, cur.1); }
                    pb.line_to(p.0, p.1); cur = p;
                }
                2 => {
                    let x1 = r.f32(); let y1 = r.f32();
                    let x2 = r.f32(); let y2 = r.f32();
                    let x3 = r.f32(); let y3 = r.f32();
                    let p1 = dev(&state.ctm, x1, y1);
                    let p2 = dev(&state.ctm, x2, y2);
                    let p3 = dev(&state.ctm, x3, y3);
                    if pb.is_empty() { pb.move_to(cur.0, cur.1); }
                    pb.cubic_to(p1.0, p1.1, p2.0, p2.1, p3.0, p3.1);
                    cur = p3;
                }
                3 => {
                    let x = r.f32(); let y = r.f32(); let w = r.f32(); let h = r.f32();
                    let p0 = dev(&state.ctm, x, y);
                    let p1 = dev(&state.ctm, x + w, y);
                    let p2 = dev(&state.ctm, x + w, y + h);
                    let p3 = dev(&state.ctm, x, y + h);
                    pb.move_to(p0.0, p0.1);
                    pb.line_to(p1.0, p1.1);
                    pb.line_to(p2.0, p2.1);
                    pb.line_to(p3.0, p3.1);
                    pb.close();
                    cur = p0;
                }
                4 => pb.close(),
                5 => { state.stroke_rgba = r.u32(); state.stroke_width = r.f32(); }
                6 => { state.fill_rgba = r.u32(); }
                7 => { // Stroke
                    if let Some(path) = pb.clone().finish() {
                        let mut paint = Paint::default();
                        paint.set_color(rgba_to_color(state.stroke_rgba));
                        paint.anti_alias = true;
                        let s = uniform_scale(&state.ctm);
                        let dev_w = state.stroke_width * s;
                        let floored = if dev_w < self.hairline_floor_px {
                            self.hairline_floor_px.max(0.05)
                        } else {
                            dev_w
                        };
                        let mut stroke = Stroke {
                            width: floored.max(0.05),
                            miter_limit: state.miter_limit,
                            line_cap: match state.line_cap { 1 => LineCap::Round, 2 => LineCap::Square, _ => LineCap::Butt },
                            line_join: match state.line_join { 1 => LineJoin::Round, 2 => LineJoin::Bevel, _ => LineJoin::Miter },
                            dash: None,
                        };
                        if let Some((pat, phase)) = &state.dash {
                            let scaled: Vec<f32> = pat.iter().map(|v| v * s).collect();
                            stroke.dash = StrokeDash::new(scaled, phase * s);
                        }
                        pixmap.stroke_path(&path, &paint, &stroke, tile_shift, cur_mask.as_deref());
                    }
                }
                8 | 9 => { // Fill / FillEvenOdd
                    if let Some(path) = pb.clone().finish() {
                        let mut paint = Paint::default();
                        paint.set_color(rgba_to_color(state.fill_rgba));
                        paint.anti_alias = true;
                        let rule = if op == 9 { FillRule::EvenOdd } else { FillRule::Winding };
                        pixmap.fill_path(&path, &paint, rule, tile_shift, cur_mask.as_deref());
                    }
                }
                10 => {
                    stack.push(state.clone());
                    mask_stack.push(cur_mask.clone());
                }
                11 => {
                    state = stack.pop().unwrap_or_else(|| base_state.clone());
                    // Replay-lokale saves hebben altijd een mask_stack-entry;
                    // valt de pop daarbuiten (snapshot-stack), dan is de
                    // clips-lijst van de herstelde staat leidend.
                    cur_mask = match mask_stack.pop() {
                        Some(m) => m,
                        None => self.build_clip_mask_refs(
                            &state.clips, &rehome, tile_shift, pixmap.width(), pixmap.height(),
                        ),
                    };
                }
                12 => {
                    let a = r.f32(); let b = r.f32(); let c = r.f32();
                    let d = r.f32(); let e = r.f32(); let f = r.f32();
                    state.ctm = Transform::from_row(a, b, c, d, e, f).post_concat(state.ctm);
                }
                13 => { state.line_cap = r.u8(); }
                14 => { state.line_join = r.u8(); }
                15 => { state.miter_limit = r.f32(); }
                16 => {
                    let n = r.u8() as usize;
                    let mut pat = Vec::with_capacity(n);
                    for _ in 0..n { pat.push(r.f32()); }
                    let phase = r.f32();
                    state.dash = if pat.is_empty() { None } else { Some((pat, phase)) };
                }
                17 => { pb = PathBuilder::new(); }
                18 => { // TextAt — legacy, vrijwel ongebruikt: overslaan
                    let _x = r.f32(); let _y = r.f32(); let _fs = r.f32(); let _c = r.u32();
                    let len = r.u8() as usize;
                    r.pos += len;
                }
                19 => { // DrawImage in 1×1 unit-square onder de CTM
                    let w = r.u16(); let h = r.u16();
                    let dlen = r.u32() as usize;
                    let img = &self.data[r.pos..r.pos + dlen];
                    r.pos += dlen;
                    if let Some(src) = decode_image_rgba(img, w as u32, h as u32) {
                        // unit-square → CTM; pixmap-paint met bilinear filter.
                        let t = Transform::from_scale(1.0 / w as f32, 1.0 / h as f32)
                            .post_concat(state.ctm)
                            .post_concat(tile_shift);
                        let paint = PixmapPaint {
                            quality: tiny_skia::FilterQuality::Bilinear,
                            ..Default::default()
                        };
                        pixmap.draw_pixmap(0, 0, src.as_ref(), &paint, t, cur_mask.as_deref());
                    }
                }
                20 | 21 => { // Clip / ClipEvenOdd: huidig pad versmalt het masker
                    let path = pb.clone().finish();
                    cur_mask = Self::intersect_clip(
                        cur_mask, path.as_ref(), op == 21, tile_shift,
                        pixmap.width(), pixmap.height(),
                    );
                }
                _ => return, // corrupt: stop deze chunk
            }
        }
    }

    /// Bouw het tegel-masker voor een lijst clip-referenties (chunk-snapshot
    /// of herstelde staat). None = geen beperking binnen deze tegel.
    fn build_clip_mask_refs(
        &self,
        clips: &[ClipRef],
        rehome: &impl Fn(Transform) -> Transform,
        tile_shift: Transform,
        w: u32,
        h: u32,
    ) -> Option<std::rc::Rc<tiny_skia::Mask>> {
        let mut cur: Option<std::rc::Rc<tiny_skia::Mask>> = None;
        for c in clips {
            let path = self.rebuild_clip_path(c, rehome);
            cur = Self::intersect_clip(cur, path.as_ref(), c.even_odd, tile_shift, w, h);
        }
        cur
    }

    /// Herbouw het clip-pad uit zijn byte-range: pad-ops in device-ruimte
    /// (zelfde CTM-evolutie als de hoofd-replay, incl. Transform-ops binnen
    /// de range); alle overige ops worden alleen overgeslagen.
    fn rebuild_clip_path(
        &self,
        c: &ClipRef,
        rehome: &impl Fn(Transform) -> Transform,
    ) -> Option<tiny_skia::Path> {
        if c.start >= c.end || c.end > self.data.len() {
            return None;
        }
        let mut ctm = rehome(c.ctm);
        let mut ctm_stack: Vec<Transform> = Vec::new();
        let mut r = CmdReader { data: &self.data, pos: c.start };
        let mut pb = PathBuilder::new();
        let mut cur = (0.0f32, 0.0f32);
        while r.pos < c.end {
            let op = r.u8();
            match op {
                0 => { let x = r.f32(); let y = r.f32(); let p = dev_pt(&ctm, x, y); pb.move_to(p.0, p.1); cur = p; }
                1 => {
                    let x = r.f32(); let y = r.f32(); let p = dev_pt(&ctm, x, y);
                    if pb.is_empty() { pb.move_to(cur.0, cur.1); }
                    pb.line_to(p.0, p.1); cur = p;
                }
                2 => {
                    let x1 = r.f32(); let y1 = r.f32();
                    let x2 = r.f32(); let y2 = r.f32();
                    let x3 = r.f32(); let y3 = r.f32();
                    let p1 = dev_pt(&ctm, x1, y1);
                    let p2 = dev_pt(&ctm, x2, y2);
                    let p3 = dev_pt(&ctm, x3, y3);
                    if pb.is_empty() { pb.move_to(cur.0, cur.1); }
                    pb.cubic_to(p1.0, p1.1, p2.0, p2.1, p3.0, p3.1);
                    cur = p3;
                }
                3 => {
                    let x = r.f32(); let y = r.f32(); let w = r.f32(); let h = r.f32();
                    let p0 = dev_pt(&ctm, x, y);
                    let p1 = dev_pt(&ctm, x + w, y);
                    let p2 = dev_pt(&ctm, x + w, y + h);
                    let p3 = dev_pt(&ctm, x, y + h);
                    pb.move_to(p0.0, p0.1);
                    pb.line_to(p1.0, p1.1);
                    pb.line_to(p2.0, p2.1);
                    pb.line_to(p3.0, p3.1);
                    pb.close();
                    cur = p0;
                }
                4 => pb.close(),
                5 => { r.u32(); r.f32(); }
                6 => { r.u32(); }
                7 | 8 | 9 => {}
                10 => ctm_stack.push(ctm),
                11 => { if let Some(t) = ctm_stack.pop() { ctm = t; } }
                12 => {
                    let a = r.f32(); let b = r.f32(); let cc = r.f32();
                    let d = r.f32(); let e = r.f32(); let f = r.f32();
                    ctm = Transform::from_row(a, b, cc, d, e, f).post_concat(ctm);
                }
                13 | 14 => { r.u8(); }
                15 => { r.f32(); }
                16 => {
                    let n = r.u8() as usize;
                    for _ in 0..n { r.f32(); }
                    r.f32();
                }
                17 => { pb = PathBuilder::new(); }
                18 => {
                    r.f32(); r.f32(); r.f32(); r.u32();
                    let len = r.u8() as usize;
                    r.pos += len;
                }
                19 => {
                    r.u16(); r.u16();
                    let dlen = r.u32() as usize;
                    r.pos += dlen;
                }
                20 | 21 => {}
                _ => break, // corrupt: stop
            }
        }
        pb.finish()
    }

    /// Versmal `cur` met een extra clip-pad. Semantiek:
    /// - pad None/leeg → lege clip → masker vol-nul (alles weggeclipt);
    /// - as-uitgelijnde rechthoek die de hele tegel omvat → geen extra
    ///   beperking binnen deze tegel (masker ongewijzigd) — de gangbare
    ///   viewport-clip, zo blijft het maskerpad goedkoop;
    /// - anders: masker vullen (eerste clip) of doorsnijden (volgende).
    fn intersect_clip(
        cur: Option<std::rc::Rc<tiny_skia::Mask>>,
        path: Option<&tiny_skia::Path>,
        even_odd: bool,
        tile_shift: Transform,
        w: u32,
        h: u32,
    ) -> Option<std::rc::Rc<tiny_skia::Mask>> {
        let Some(path) = path else {
            return tiny_skia::Mask::new(w, h).map(std::rc::Rc::new);
        };
        // Tegel-rect in device-coördinaten (tile_shift = translate(-tx,-ty)).
        let (tx, ty) = (-tile_shift.tx, -tile_shift.ty);
        if let Some((rx0, ry0, rx1, ry1)) = axis_aligned_rect_of(path) {
            if rx0 <= tx && ry0 <= ty && rx1 >= tx + w as f32 && ry1 >= ty + h as f32 {
                return cur;
            }
        }
        let rule = if even_odd { FillRule::EvenOdd } else { FillRule::Winding };
        match cur {
            None => {
                let mut m = tiny_skia::Mask::new(w, h)?;
                m.fill_path(path, rule, true, tile_shift);
                Some(std::rc::Rc::new(m))
            }
            Some(rc) => {
                let mut m = (*rc).clone();
                m.intersect_path(path, rule, true, tile_shift);
                Some(std::rc::Rc::new(m))
            }
        }
    }

    /// Render een pagina-REGIO (PDF-punten, weergave-ruimte zoals de viewer
    /// aanlevert) op `scale` naar UNpremultiplied RGBA — het wire-formaat dat
    /// de tegel-consumenten in de app verwachten ([w][h][rgba], zie de
    /// render_pdf_page_region-flow). Regio wordt op hele device-pixels gelegd.
    pub fn render_region_rgba(
        &self,
        scale: f32,
        x_pt: f32,
        y_pt: f32,
        w_pt: f32,
        h_pt: f32,
    ) -> (u32, u32, Vec<u8>) {
        let tx = (x_pt * scale).round().max(0.0) as u32;
        let ty = (y_pt * scale).round().max(0.0) as u32;
        let tw = (w_pt * scale).ceil().max(1.0) as u32;
        let th = (h_pt * scale).ceil().max(1.0) as u32;
        // OPAAK WIT papier, zoals de PDFium-worker-tegels: de JS-kant plakt
        // tegels met putImageData (geen compositing), dus transparante of
        // half-doorzichtige AA-randen zouden anders tegen de donkere
        // app-achtergrond mengen en de lijnkleuren vervuilen.
        let pm = self.render_tile_impl_on_white(scale, tx, ty, tw, th);
        let mut rgba = pm.take();
        // premultiplied → straight alpha voor putImageData aan de JS-kant.
        for p in rgba.chunks_exact_mut(4) {
            let a = p[3] as u32;
            if a == 0 || a == 255 {
                continue;
            }
            p[0] = ((p[0] as u32 * 255) / a).min(255) as u8;
            p[1] = ((p[1] as u32 * 255) / a).min(255) as u8;
            p[2] = ((p[2] as u32 * 255) / a).min(255) as u8;
        }
        (tw, th, rgba)
    }

    /// Volledige pagina parallel in tegels renderen en assembleren.
    pub fn render_full_parallel(&self, scale: f32, tile_px: u32) -> crate::RenderedPage {
        let out_w = (self.page_w * scale).ceil().max(1.0) as u32;
        let out_h = (self.page_h * scale).ceil().max(1.0) as u32;

        let mut tiles: Vec<(u32, u32, u32, u32)> = Vec::new();
        let mut ty = 0u32;
        while ty < out_h {
            let th = tile_px.min(out_h - ty);
            let mut tx = 0u32;
            while tx < out_w {
                let tw = tile_px.min(out_w - tx);
                tiles.push((tx, ty, tw, th));
                tx += tw;
            }
            ty += th;
        }

        let rendered: Vec<((u32, u32, u32, u32), Pixmap)> = tiles
            .par_iter()
            .map(|&(tx, ty, tw, th)| ((tx, ty, tw, th), self.render_tile(scale, tx, ty, tw, th)))
            .collect();

        let mut out = vec![0u8; out_w as usize * out_h as usize * 4];
        for ((tx, ty, tw, th), pm) in rendered {
            let src = pm.data();
            for row in 0..th as usize {
                let dst_off = ((ty as usize + row) * out_w as usize + tx as usize) * 4;
                let src_off = row * tw as usize * 4;
                out[dst_off..dst_off + tw as usize * 4]
                    .copy_from_slice(&src[src_off..src_off + tw as usize * 4]);
            }
        }
        // Zelfde conventie als renderer.rs::into_rgba: rauwe (premultiplied)
        // tiny-skia-pixels, geen demultiply — consumenten verwachten dit.
        crate::RenderedPage { width: out_w, height: out_h, rgba: out }
    }
}

/// Decodeer de embedded image-bytes (PNG/JPEG-passthrough of raw RGB/RGBA)
/// naar een premultiplied tiny-skia Pixmap.
fn decode_image_rgba(bytes: &[u8], w: u32, h: u32) -> Option<Pixmap> {
    // "RGBA"-magic-formaat van interpreter::handle_image_xobject en de
    // inline-image-emissie: "RGBA" + u16 w + u16 h + PREMULTIPLIED pixels
    // (zelfde contract als de JS-replayer _decodeImage). De payload is al
    // premultiplied — direct kopiëren, dus NIET nogmaals premultiplyen.
    if bytes.len() >= 8 && &bytes[..4] == b"RGBA" {
        let hw = u16::from_le_bytes([bytes[4], bytes[5]]) as u32;
        let hh = u16::from_le_bytes([bytes[6], bytes[7]]) as u32;
        let need = (hw as usize).checked_mul(hh as usize)?.checked_mul(4)?;
        let px = &bytes[8..];
        if hw == 0 || hh == 0 || px.len() < need {
            return None;
        }
        let mut pm = Pixmap::new(hw, hh)?;
        pm.data_mut().copy_from_slice(&px[..need]);
        return Some(pm);
    }
    let rgba: Vec<u8> = if bytes.len() == (w * h * 4) as usize {
        bytes.to_vec()
    } else if bytes.len() == (w * h * 3) as usize {
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for c in bytes.chunks_exact(3) {
            v.extend_from_slice(c);
            v.push(255);
        }
        v
    } else {
        let img = image::load_from_memory(bytes).ok()?;
        let rgba = img.to_rgba8();
        if rgba.width() != w || rgba.height() != h {
            // afmetingen uit de header zijn leidend voor de unit-square-schaal
            let mut pm = Pixmap::new(rgba.width(), rgba.height())?;
            premultiply_into(rgba.as_raw(), pm.data_mut());
            return Some(pm);
        }
        rgba.into_raw()
    };
    let mut pm = Pixmap::new(w, h)?;
    premultiply_into(&rgba, pm.data_mut());
    Some(pm)
}

fn premultiply_into(rgba: &[u8], out: &mut [u8]) {
    for (src, dst) in rgba.chunks_exact(4).zip(out.chunks_exact_mut(4)) {
        let a = src[3] as u32;
        dst[0] = ((src[0] as u32 * a) / 255) as u8;
        dst[1] = ((src[1] as u32 * a) / 255) as u8;
        dst[2] = ((src[2] as u32 * a) / 255) as u8;
        dst[3] = src[3];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::draw_commands::DrawCommandBuffer;

    fn scene_from(cmds: DrawCommandBuffer, x0: f32, y0: f32, w: f32, h: f32) -> TileScene {
        let body = cmds.into_bytes();
        let mut buf = Vec::with_capacity(16 + body.len());
        buf.extend_from_slice(&x0.to_le_bytes());
        buf.extend_from_slice(&y0.to_le_bytes());
        buf.extend_from_slice(&w.to_le_bytes());
        buf.extend_from_slice(&h.to_le_bytes());
        buf.extend(body);
        TileScene::build(buf).expect("scene")
    }

    fn test_scene() -> TileScene {
        let mut b = DrawCommandBuffer::new();
        // gevuld rood vlak linksboven (PDF-coördinaten: y omhoog)
        b.begin_path();
        b.set_fill(0xDC2626FF);
        b.rect(10.0, 140.0, 60.0, 40.0);
        b.fill();
        // blauwe diagonale lijn over het hele blad
        b.begin_path();
        b.set_stroke(0x2563EBFF, 3.0);
        b.move_to(0.0, 0.0);
        b.line_to(200.0, 200.0);
        b.stroke();
        // groene rect rechtsonder met transform
        b.save_state();
        b.transform(1.0, 0.0, 0.0, 1.0, 120.0, 10.0);
        b.begin_path();
        b.set_fill(0x16A34AFF);
        b.rect(0.0, 0.0, 50.0, 30.0);
        b.fill();
        b.restore_state();
        scene_from(b, 0.0, 0.0, 200.0, 200.0)
    }

    #[test]
    fn tiles_match_full_render_bitwise() {
        let scene = test_scene();
        let full = scene.render_full_parallel(2.0, 4096); // één tegel = referentie
        let tiled = scene.render_full_parallel(2.0, 64); // 7×7 tegels
        assert_eq!(full.width, tiled.width);
        assert_eq!(full.height, tiled.height);
        assert_eq!(full.rgba, tiled.rgba, "tegel-assemblage wijkt af van volledige render");
        // en er is echt inhoud
        assert!(full.rgba.chunks_exact(4).any(|p| p[3] != 0));
    }

    #[test]
    fn chunk_bboxes_cull() {
        let scene = test_scene();
        assert!(scene.chunk_count() >= 1);
        // Tegel buiten alle geometrie blijft leeg. Let op de Y-flip:
        // device-y = 200 - pdf-y. Diagonaal: device y = 200 - x; rode rect
        // device y 20..60 x 10..70; groene rect device y 160..190 x 120..170.
        // (100..108, 8..16) raakt niets daarvan.
        let pm = scene.render_tile(1.0, 100, 8, 8, 8);
        assert!(pm.data().iter().all(|&b| b == 0));
    }

    /// Pixel (x, y) uit een RenderedPage als [r, g, b, a].
    fn px(p: &crate::RenderedPage, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * p.width + x) * 4) as usize;
        [p.rgba[i], p.rgba[i + 1], p.rgba[i + 2], p.rgba[i + 3]]
    }

    #[test]
    fn clip_rect_beperkt_fill_en_tegels_blijven_identiek() {
        // Clip-rect pdf (10,10)-(50,50); fill van het hele blad eroverheen.
        // Y-flip: device-y = 100 - pdf-y → clipgebied device (10..50, 50..90).
        let mut b = DrawCommandBuffer::new();
        b.begin_path();
        b.rect(10.0, 10.0, 40.0, 40.0);
        b.clip();
        b.begin_path();
        b.set_fill(0xDC2626FF);
        b.rect(0.0, 0.0, 100.0, 100.0);
        b.fill();
        let scene = scene_from(b, 0.0, 0.0, 100.0, 100.0);
        assert_eq!(scene.clip_ops, 1);
        let full = scene.render_full_parallel(1.0, 4096);
        // binnen de clip gevuld, erbuiten leeg
        assert_eq!(px(&full, 30, 70)[3], 255, "binnen clip moet gevuld zijn");
        assert_eq!(px(&full, 5, 5)[3], 0, "buiten clip moet leeg zijn");
        assert_eq!(px(&full, 80, 80)[3], 0, "buiten clip moet leeg zijn");
        assert_eq!(px(&full, 30, 95)[3], 0, "onder de clip moet leeg zijn");
        // tegel-assemblage blijft bitwise gelijk aan render-in-één-stuk
        let tiled = scene.render_full_parallel(1.0, 16);
        assert_eq!(full.rgba, tiled.rgba, "clips breken de tegel-gelijkheid");
    }

    #[test]
    fn clip_werkt_over_chunk_grens_via_snapshot() {
        // Clip vóór een lange paint-reeks: de chunk-grens valt midden in de
        // reeks, dus chunk 2+ moet de clip via het snapshot meekrijgen.
        let mut b = DrawCommandBuffer::new();
        b.begin_path();
        b.rect(20.0, 0.0, 40.0, 40.0); // clip pdf x 20..60, y 0..40
        b.clip();
        b.set_fill(0x16A34AFF);
        for i in 0..(CHUNK_PAINTS as i32 + 8) {
            b.begin_path();
            b.rect(0.0, i as f32, 100.0, 0.8);
            b.fill();
        }
        let scene = scene_from(b, 0.0, 0.0, 100.0, 100.0);
        assert!(scene.chunk_count() >= 2, "test verwacht meerdere chunks");
        let full = scene.render_full_parallel(1.0, 4096);
        // balk i=10 (chunk 1): pdf y 10..10,8 → device y ~89,2..90 (AA-dekking < 1)
        assert!(px(&full, 50, 89)[3] > 100, "balk binnen clip (chunk 1) zichtbaar");
        assert_eq!(px(&full, 70, 89)[3], 0, "x buiten clip-band blijft leeg");
        // balk i=70 (chunk 2): pdf y 70 > 40 → volledig weggeclipt
        assert_eq!(px(&full, 50, 29)[3], 0, "balk boven clipgebied (chunk 2) weggeclipt");
        let tiled = scene.render_full_parallel(1.0, 16);
        assert_eq!(full.rgba, tiled.rgba, "snapshot-clips breken de tegel-gelijkheid");
    }

    #[test]
    fn restore_herstelt_clip() {
        let mut b = DrawCommandBuffer::new();
        b.save_state();
        b.begin_path();
        b.rect(10.0, 10.0, 20.0, 20.0); // clip pdf (10,10)-(30,30)
        b.clip();
        b.begin_path();
        b.set_fill(0x2563EBFF);
        b.rect(0.0, 0.0, 100.0, 100.0); // alleen clipgebied wordt blauw
        b.fill();
        b.restore_state();
        b.begin_path();
        b.set_fill(0xDC2626FF);
        b.rect(60.0, 60.0, 20.0, 20.0); // ná restore: vrij van de clip
        b.fill();
        let scene = scene_from(b, 0.0, 0.0, 100.0, 100.0);
        let full = scene.render_full_parallel(1.0, 4096);
        assert_eq!(px(&full, 20, 80)[3], 255, "geclipte fill binnen clip zichtbaar");
        assert_eq!(px(&full, 50, 50)[3], 0, "geclipte fill buiten clip leeg");
        assert_eq!(px(&full, 70, 30)[3], 255, "fill na restore niet meer geclipt");
        let tiled = scene.render_full_parallel(1.0, 16);
        assert_eq!(full.rgba, tiled.rgba);
    }

    #[test]
    fn state_snapshot_carries_over_chunks() {
        // Forceer veel chunks met een kleine CHUNK_PAINTS-onafhankelijke truc:
        // veel paints zodat er zeker >1 chunk is, en de stijl vóór chunk 2
        // gezet in chunk 1 moet doorwerken.
        let mut b = DrawCommandBuffer::new();
        b.set_fill(0xDC2626FF);
        for i in 0..(CHUNK_PAINTS as i32 + 8) {
            b.begin_path();
            b.rect(0.0, i as f32, 4.0, 0.8);
            b.fill();
        }
        let scene = scene_from(b, 0.0, 0.0, 100.0, 100.0);
        assert!(scene.chunk_count() >= 2, "test verwacht meerdere chunks");
        let full = scene.render_full_parallel(1.0, 4096);
        let tiled = scene.render_full_parallel(1.0, 16);
        assert_eq!(full.rgba, tiled.rgba);
    }
}
