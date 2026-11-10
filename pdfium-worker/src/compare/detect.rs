//! Wijzigingsdetectie op inktmaskers: poort van js/compare/mask-detect.js.
//!
//! De pagina wordt als een stroom rijen verwerkt met een ringbuffer van 2·r+1
//! rijen: de oude rij wordt naar het nieuwe raster bemonsterd (naaste buur;
//! overgeslagen bij de identiteit), beide rijen worden met de tolerantie r
//! gedilateerd (vier pixels per 32-bits woord), verwijderd = oude inkt zonder
//! nieuwe inkt binnen r, toegevoegd = omgekeerd. Gewijzigde pixels worden
//! horizontale runs, runs worden 8-samenhangende componenten via union-find,
//! en componenten worden gefilterd en samengevoegd.

use super::ink::Mask;
use super::matrix::{apply_rect, invert, is_identity, Matrix, Rect, IDENTITY};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DetectOptions {
    #[serde(default = "d_tol")]
    pub tolerance_px: f64,
    #[serde(default = "d_min_area")]
    pub min_area_px: f64,
    #[serde(default = "d_merge")]
    pub merge_px: f64,
    #[serde(default = "d_noise")]
    pub noise_px: f64,
    #[serde(default = "d_max_runs")]
    pub max_runs: f64,
}

fn d_tol() -> f64 {
    1.0
}
fn d_min_area() -> f64 {
    5.0
}
fn d_merge() -> f64 {
    8.0
}
fn d_noise() -> f64 {
    1.0
}
fn d_max_runs() -> f64 {
    2_000_000.0
}

impl Default for DetectOptions {
    fn default() -> Self {
        DetectOptions { tolerance_px: d_tol(), min_area_px: d_min_area(), merge_px: d_merge(), noise_px: d_noise(), max_runs: d_max_runs() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Added,
    Removed,
    Modified,
}

impl Kind {
    pub fn code(self) -> f64 {
        match self {
            Kind::Added => 0.0,
            Kind::Removed => 1.0,
            Kind::Modified => 2.0,
        }
    }
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn name(self) -> &'static str {
        match self {
            Kind::Added => "added",
            Kind::Removed => "removed",
            Kind::Modified => "modified",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cluster {
    pub kind: Kind,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub pixel_count: i64,
    pub old: Rect,
}

#[derive(Debug, Clone)]
pub struct Detection {
    pub clusters: Vec<Cluster>,
    pub truncated: bool,
    pub runs: usize,
    pub components: usize,
}

/// Doos met inclusieve pixelgrenzen (mergeBoxes-invoer).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BBox {
    pub x1: i64,
    pub y1: i64,
    pub x2: i64,
    pub y2: i64,
    pub count: i64,
    pub flags: u32,
}

#[inline]
fn dilate_once(from: &[u32], to: &mut [u32]) {
    let s4 = from.len();
    let mut prev = 0u32;
    let mut cur = from[0];
    for i in 0..s4 {
        let next = if i + 1 < s4 { from[i + 1] } else { 0 };
        to[i] = cur | (cur << 8) | (cur >> 8) | (prev >> 24) | (next << 24);
        prev = cur;
        cur = next;
    }
}

fn hdilate(src: &[u32], dst: &mut [u32], tmp_a: &mut [u32], tmp_b: &mut [u32], r: usize) {
    if r == 0 {
        dst.copy_from_slice(src);
        return;
    }
    for k in 0..r {
        let last = k == r - 1;
        if k == 0 {
            if last {
                dilate_once(src, dst)
            } else {
                dilate_once(src, tmp_a)
            }
        } else if k % 2 == 1 {
            if last {
                dilate_once(tmp_a, dst)
            } else {
                dilate_once(tmp_a, tmp_b)
            }
        } else if last {
            dilate_once(tmp_b, dst)
        } else {
            dilate_once(tmp_b, tmp_a)
        }
    }
}

struct UnionFind {
    parent: Vec<i32>,
}

impl UnionFind {
    fn find(&mut self, mut a: usize) -> usize {
        while self.parent[a] as usize != a {
            let pa = self.parent[a] as usize;
            self.parent[a] = self.parent[pa];
            a = self.parent[a] as usize;
        }
        a
    }
    fn union(&mut self, a: usize, b: usize) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra == rb {
            return;
        }
        if ra < rb {
            self.parent[rb] = ra as i32;
        } else {
            self.parent[ra] = rb as i32;
        }
    }
}

/// detectMaskChanges
pub fn detect_mask_changes(old: &Mask, new: &Mask, transform: Option<&Matrix>, opts: &DetectOptions) -> Detection {
    let w = new.width;
    let h = new.height;
    let s = new.stride;
    let s4 = s >> 2;
    let r = opts.tolerance_px.floor().max(0.0) as usize;
    let rr = 2 * r + 1;
    let same_grid = old.width == w && old.height == h && old.stride == s;
    let direct = same_grid && is_identity(transform);
    let inv = invert(*transform.unwrap_or(&IDENTITY));
    let o_bytes = old.bytes();
    let (o_stride, o_width, o_height) = (old.stride, old.width as i64, old.height as i64);

    // Ring met bemonsterde oude rijen (alleen als het raster niet direct past).
    let mut raw_ring: Vec<u32> = if direct { Vec::new() } else { vec![0; rr * s4] };
    let mut raw_any = vec![0u8; rr];
    let mut new_any = vec![0u8; rr];
    let mut h_old = vec![0u32; rr * s4];
    let mut h_new = vec![0u32; rr * s4];
    let mut tmp_a = vec![0u32; s4];
    let mut tmp_b = vec![0u32; s4];

    let row_any = |arr: &[u32]| -> u8 { u8::from(arr.iter().any(|&v| v != 0)) };

    let warp_row = |ring: &mut [u32], y: usize, slot: usize| -> u8 {
        let words = &mut ring[slot * s4..slot * s4 + s4];
        words.fill(0);
        // Safety: u32 -> u8, zelfde geheugen.
        let bytes = unsafe { std::slice::from_raw_parts_mut(words.as_mut_ptr() as *mut u8, s4 * 4) };
        let yc = y as f64 + 0.5;
        let mut ox = inv[0] * 0.5 + inv[2] * yc + inv[4];
        let mut oy = inv[1] * 0.5 + inv[3] * yc + inv[5];
        let (sx, sy) = (inv[0], inv[1]);
        let mut any = 0u8;
        for x in 0..w {
            if !(ox < 0.0 || oy < 0.0) {
                // JS: `ox | 0` (afkappen naar int32); NaN wordt 0.
                let xi = ox as i64;
                let yi = oy as i64;
                if xi < o_width && yi < o_height && o_bytes[yi as usize * o_stride + xi as usize] != 0 {
                    bytes[x] = 1;
                    any = 1;
                }
            }
            ox += sx;
            oy += sy;
        }
        any
    };

    let mut load_row = |y: usize,
                        raw_ring: &mut Vec<u32>,
                        raw_any: &mut Vec<u8>,
                        new_any: &mut Vec<u8>,
                        h_old: &mut Vec<u32>,
                        h_new: &mut Vec<u32>| {
        let slot = y % rr;
        let dst = slot * s4..slot * s4 + s4;
        if direct {
            let src = &old.words[y * s4..y * s4 + s4];
            raw_any[slot] = row_any(src);
            if raw_any[slot] != 0 {
                hdilate(src, &mut h_old[dst.clone()], &mut tmp_a, &mut tmp_b, r);
            } else {
                h_old[dst.clone()].fill(0);
            }
        } else {
            raw_any[slot] = warp_row(raw_ring, y, slot);
            if raw_any[slot] != 0 {
                let src = &raw_ring[dst.clone()];
                hdilate(src, &mut h_old[dst.clone()], &mut tmp_a, &mut tmp_b, r);
            } else {
                h_old[dst.clone()].fill(0);
            }
        }
        let src = &new.words[y * s4..y * s4 + s4];
        new_any[slot] = row_any(src);
        if new_any[slot] != 0 {
            hdilate(src, &mut h_new[dst], &mut tmp_a, &mut tmp_b, r);
        } else {
            h_new[dst].fill(0);
        }
    };

    let mut rx0: Vec<i32> = Vec::with_capacity(4096);
    let mut rx1: Vec<i32> = Vec::with_capacity(4096);
    let mut ry: Vec<i32> = Vec::with_capacity(4096);
    let mut rf: Vec<u32> = Vec::with_capacity(4096);
    let mut uf = UnionFind { parent: Vec::with_capacity(4096) };
    let mut truncated = false;
    let max_runs = opts.max_runs;

    for y in 0..r.min(h) {
        load_row(y, &mut raw_ring, &mut raw_any, &mut new_any, &mut h_old, &mut h_new);
    }

    let mut prev_start = 0usize;
    let mut prev_end = 0usize;
    for y in 0..h {
        if y + r < h {
            load_row(y + r, &mut raw_ring, &mut raw_any, &mut new_any, &mut h_old, &mut h_new);
        }
        let slot = y % rr;
        let cur_start = rx0.len();
        if raw_any[slot] != 0 || new_any[slot] != 0 {
            let y0 = y.saturating_sub(r);
            let y1 = (h - 1).min(y + r);
            let (raw_arr, raw_off): (&[u32], usize) = if direct { (&old.words, y * s4) } else { (&raw_ring, slot * s4) };
            let new_off = y * s4;
            let mut open = false;
            let mut x0 = 0i32;
            let mut xl = -2i32;
            let mut fl = 0u32;
            for i in 0..s4 {
                let o = raw_arr[raw_off + i];
                let n = new.words[new_off + i];
                if (o | n) == 0 {
                    continue;
                }
                let mut d_o = 0u32;
                let mut d_n = 0u32;
                for yy in y0..=y1 {
                    let si = (yy % rr) * s4 + i;
                    d_o |= h_old[si];
                    d_n |= h_new[si];
                }
                let rem = o & !d_n;
                let add = n & !d_o;
                if (rem | add) == 0 {
                    continue;
                }
                for j in 0..4u32 {
                    let sh = j << 3;
                    let lab = ((rem >> sh) & 1) | (((add >> sh) & 1) << 1);
                    if lab == 0 {
                        continue;
                    }
                    let x = ((i as u32) << 2) + j;
                    if x as usize >= w {
                        break;
                    }
                    let x = x as i32;
                    if open && x == xl + 1 {
                        xl = x;
                        fl |= lab;
                    } else {
                        if open {
                            rx0.push(x0);
                            rx1.push(xl);
                            ry.push(y as i32);
                            rf.push(fl);
                            uf.parent.push((rx0.len() - 1) as i32);
                        }
                        open = true;
                        x0 = x;
                        xl = x;
                        fl = lab;
                    }
                }
            }
            if open {
                rx0.push(x0);
                rx1.push(xl);
                ry.push(y as i32);
                rf.push(fl);
                uf.parent.push((rx0.len() - 1) as i32);
            }
        }
        let cur_end = rx0.len();
        if prev_end > prev_start && cur_end > cur_start {
            let mut p = prev_start;
            for c in cur_start..cur_end {
                let a0 = rx0[c] - 1;
                let a1 = rx1[c] + 1;
                while p < prev_end && rx1[p] < a0 {
                    p += 1;
                }
                let mut q = p;
                while q < prev_end && rx0[q] <= a1 {
                    uf.union(c, q);
                    q += 1;
                }
            }
        }
        prev_start = cur_start;
        prev_end = cur_end;
        if rx0.len() as f64 >= max_runs {
            truncated = true;
            break;
        }
    }

    let n_runs = rx0.len();
    let mut comp_of = vec![-1i64; n_runs];
    let mut comps: Vec<BBox> = Vec::new();
    for i in 0..n_runs {
        let root = uf.find(i);
        let mut ci = comp_of[root];
        if ci < 0 {
            ci = comps.len() as i64;
            comp_of[root] = ci;
            comps.push(BBox { x1: rx0[i] as i64, y1: ry[i] as i64, x2: rx1[i] as i64, y2: ry[i] as i64, count: 0, flags: 0 });
        }
        let c = &mut comps[ci as usize];
        let (a0, a1, yy) = (rx0[i] as i64, rx1[i] as i64, ry[i] as i64);
        if a0 < c.x1 {
            c.x1 = a0;
        }
        if a1 > c.x2 {
            c.x2 = a1;
        }
        if yy < c.y1 {
            c.y1 = yy;
        }
        if yy > c.y2 {
            c.y2 = yy;
        }
        c.count += a1 - a0 + 1;
        c.flags |= rf[i];
    }

    let n_comps = comps.len();
    let kept: Vec<BBox> = comps.into_iter().filter(|c| c.count as f64 >= opts.noise_px).collect();
    let merged = merge_boxes(&kept, opts.merge_px.max(0.0));
    let to_old = invert(*transform.unwrap_or(&IDENTITY));
    let mut clusters = Vec::new();
    for c in merged {
        if (c.count as f64) < opts.min_area_px {
            continue;
        }
        let kind = if c.flags & 3 == 3 {
            Kind::Modified
        } else if c.flags & 1 != 0 {
            Kind::Removed
        } else {
            Kind::Added
        };
        let rect = Rect { x: c.x1 as f64, y: c.y1 as f64, width: (c.x2 - c.x1 + 1) as f64, height: (c.y2 - c.y1 + 1) as f64 };
        clusters.push(Cluster {
            kind,
            x: c.x1,
            y: c.y1,
            width: c.x2 - c.x1 + 1,
            height: c.y2 - c.y1 + 1,
            pixel_count: c.count,
            old: apply_rect(&to_old, rect),
        });
    }
    // Stabiel, net als Array.prototype.sort.
    clusters.sort_by(|a, b| a.y.cmp(&b.y).then(a.x.cmp(&b.x)));
    Detection { clusters, truncated, runs: n_runs, components: n_comps }
}

/// mergeBoxes: voeg dozen samen waarvan de tussenruimte op beide assen
/// hoogstens `prox` pixels is, tot er niets meer binnen bereik ligt. Een
/// uniform raster houdt duizenden dozen snel.
pub fn merge_boxes(boxes: &[BBox], prox: f64) -> Vec<BBox> {
    use std::collections::HashMap;
    let mut list: Vec<BBox> = boxes.to_vec();
    let near = |a: &BBox, b: &BBox| {
        let dx = 0.max(a.x1.max(b.x1) - a.x2.min(b.x2) - 1) as f64;
        let dy = 0.max(a.y1.max(b.y1) - a.y2.min(b.y2) - 1) as f64;
        dx <= prox && dy <= prox
    };
    let mut iter = 0;
    while iter < 32 && list.len() > 1 {
        let n = list.len();
        let cell = 64f64.max(prox * 2.0 + 1.0);
        let cell_floor = |v: i64| ((v as f64 - prox) / cell).floor() as i64;
        let cell_ceil = |v: i64| ((v as f64 + prox) / cell).floor() as i64;
        let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let mut big = Vec::new();
        for (i, b) in list.iter().enumerate() {
            let (cx1, cx2) = (cell_floor(b.x1), cell_ceil(b.x2));
            let (cy1, cy2) = (cell_floor(b.y1), cell_ceil(b.y2));
            if (cx2 - cx1 + 1) * (cy2 - cy1 + 1) > 256 {
                big.push(i);
                continue;
            }
            for cy in cy1..=cy2 {
                for cx in cx1..=cx2 {
                    grid.entry((cx, cy)).or_default().push(i);
                }
            }
        }
        let mut par: Vec<usize> = (0..n).collect();
        fn find(par: &mut [usize], mut a: usize) -> usize {
            while par[a] != a {
                par[a] = par[par[a]];
                a = par[a];
            }
            a
        }
        let mut joined = 0usize;
        let mut join = |par: &mut Vec<usize>, i: usize, j: usize| {
            let ri = find(par, i);
            let rj = find(par, j);
            if ri != rj {
                par[ri.max(rj)] = ri.min(rj);
                joined += 1;
            }
        };
        for l in grid.values() {
            for a in 0..l.len() {
                for b in a + 1..l.len() {
                    if near(&list[l[a]], &list[l[b]]) {
                        join(&mut par, l[a], l[b]);
                    }
                }
            }
        }
        for &i in &big {
            for j in 0..n {
                if j != i && near(&list[i], &list[j]) {
                    join(&mut par, i, j);
                }
            }
        }
        if joined == 0 {
            break;
        }
        // Wortel = kleinste index van de groep, dus oplopend itereren geeft
        // dezelfde volgorde als de Map-invoegvolgorde in JS.
        let mut out: Vec<BBox> = Vec::new();
        let mut slot_of = vec![usize::MAX; n];
        for i in 0..n {
            let rt = find(&mut par, i);
            let b = list[i];
            if slot_of[rt] == usize::MAX {
                slot_of[rt] = out.len();
                out.push(b);
            } else {
                let m = &mut out[slot_of[rt]];
                if b.x1 < m.x1 {
                    m.x1 = b.x1;
                }
                if b.y1 < m.y1 {
                    m.y1 = b.y1;
                }
                if b.x2 > m.x2 {
                    m.x2 = b.x2;
                }
                if b.y2 > m.y2 {
                    m.y2 = b.y2;
                }
                m.count += b.count;
                m.flags |= b.flags;
            }
        }
        list = out;
        iter += 1;
    }
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mask_with(w: usize, h: usize, pts: &[(usize, usize)]) -> Mask {
        let mut m = Mask::new(w, h);
        let s = m.stride;
        for &(x, y) in pts {
            m.bytes_mut()[y * s + x] = 1;
        }
        m
    }

    #[test]
    fn finds_an_added_and_a_removed_block() {
        let mut old_pts = Vec::new();
        let mut new_pts = Vec::new();
        for y in 10..20 {
            for x in 10..20 {
                old_pts.push((x, y));
                new_pts.push((x, y));
            }
            for x in 40..46 {
                old_pts.push((x, y));
            }
            for x in 70..80 {
                new_pts.push((x, y));
            }
        }
        let old = mask_with(100, 40, &old_pts);
        let new = mask_with(100, 40, &new_pts);
        let d = detect_mask_changes(&old, &new, None, &DetectOptions { merge_px: 2.0, ..Default::default() });
        assert_eq!(d.clusters.len(), 2, "{:?}", d.clusters);
        assert_eq!(d.clusters[0].kind, Kind::Removed);
        assert_eq!((d.clusters[0].x, d.clusters[0].width, d.clusters[0].pixel_count), (40, 6, 60));
        assert_eq!(d.clusters[1].kind, Kind::Added);
        assert_eq!((d.clusters[1].x, d.clusters[1].width, d.clusters[1].pixel_count), (70, 10, 100));
    }

    #[test]
    fn merge_boxes_joins_neighbours_within_reach() {
        let b = |x1, x2, count| BBox { x1, y1: 0, x2, y2: 3, count, flags: 1 };
        let out = merge_boxes(&[b(0, 3, 4), b(6, 9, 4), b(100, 103, 4)], 2.0);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].x1, out[0].x2, out[0].count), (0, 9, 8));
    }
}
