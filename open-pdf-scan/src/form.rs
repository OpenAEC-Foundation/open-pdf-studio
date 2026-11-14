//! Formuliervormen herkennen: regel voor regel uit detectFormShapes() in
//! js/pdf/form-recognition.js. Samenhangende inktgebieden (acht buren) in het
//! binaire paginabeeld; een lange dunne lijn is een schrijflijn, een lege
//! omlijning een tekstvak, aankruisvakje of keuzerondje. Op hetzelfde beeld
//! dezelfde vormen in dezelfde volgorde, met bitgelijke getallen (tests.rs).

use crate::symbol::Binary;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Text,
    Checkbox,
    Radio,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Text => "text",
            Kind::Checkbox => "checkbox",
            Kind::Radio => "radio",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shape {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub kind: Kind,
    pub confidence: f64,
    /// true = lege omlijning, false = schrijflijn.
    pub outline: bool,
}

/// overlap(): doorsnede gedeeld door het kleinste van beide oppervlakken.
pub fn overlap(a: &Shape, b: &Shape) -> f64 {
    let w = ((a.x + a.width).min(b.x + b.width) - a.x.max(b.x)).max(0.0);
    let h = ((a.y + a.height).min(b.y + b.height) - a.y.max(b.y)).max(0.0);
    w * h / 1f64.max((a.width * a.height).min(b.width * b.height))
}

/// detectFormShapes() op een binair beeld (inkt = 1).
pub fn detect_form_shapes(image: &Binary, scale: f64) -> Result<Vec<Shape>, &'static str> {
    let (width, height) = (image.width, image.height);
    if width < 1 || height < 1 || image.pixels.len() != width * height || !(scale > 0.0) {
        return Err("INVALID_RASTER");
    }
    let mask = &image.pixels;
    let mut seen = vec![0u8; mask.len()];
    let mut queue = vec![0u32; mask.len()];
    let mut out: Vec<Shape> = Vec::new();
    for start in 0..mask.len() {
        if mask[start] == 0 || seen[start] != 0 {
            continue;
        }
        let (mut head, mut tail) = (0usize, 1usize);
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (width, height, 0usize, 0usize);
        queue[0] = start as u32;
        seen[start] = 1;
        while head < tail {
            let p = queue[head] as usize;
            head += 1;
            let (x, y) = (p % width, p / width);
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            let (left, right, up, down) = (x > 0, x + 1 < width, y > 0, y + 1 < height);
            let mut visit = |ok: bool, q: usize| {
                if ok && mask[q] != 0 && seen[q] == 0 {
                    seen[q] = 1;
                    queue[tail] = q as u32;
                    tail += 1;
                }
            };
            visit(left, p.wrapping_sub(1));
            visit(right, p + 1);
            visit(up, p.wrapping_sub(width));
            visit(down, p + width);
            visit(left && up, p.wrapping_sub(width + 1));
            visit(right && up, p.wrapping_sub(width).wrapping_add(1));
            visit(left && down, p + width - 1);
            visit(right && down, p + width + 1);
        }
        let (bw, bh) = (max_x - min_x + 1, max_y - min_y + 1);
        let w = bw as f64 / scale;
        let h = bh as f64 / scale;
        if w >= 35.0 && w <= 600.0 && h <= 3.0 && h > 0.0 {
            out.push(Shape {
                x: min_x as f64 / scale,
                y: (min_y as f64 / scale - 16.0).max(0.0),
                width: w,
                height: 16.0,
                kind: Kind::Text,
                confidence: 0.55,
                outline: false,
            });
            continue;
        }
        if w < 7.0 || h < 7.0 || w > 600.0 || h > 48.0 || tail as f64 / (bw * bh) as f64 > 0.5 {
            continue;
        }
        let (mut inside, mut total, mut corners, mut corner_total) = (0u32, 0u32, 0u32, 0u32);
        let inset_x = ((bw as f64 * 0.22).floor() as usize).max(2);
        let inset_y = ((bh as f64 * 0.22).floor() as usize).max(2);
        for y in min_y..=max_y {
            // `y > maxY - insetY` in JS rekent met gewone getallen: geen
            // onderloop als de inzet groter is dan de coördinaat.
            let edge_y = y < min_y + inset_y || y as i64 > max_y as i64 - inset_y as i64;
            for x in min_x..=max_x {
                let edge_x = x < min_x + inset_x || x as i64 > max_x as i64 - inset_x as i64;
                if !edge_x && !edge_y {
                    total += 1;
                    inside += u32::from(mask[y * width + x]);
                }
                if edge_x && edge_y {
                    corner_total += 1;
                    corners += u32::from(mask[y * width + x]);
                }
            }
        }
        if total == 0 || f64::from(inside) / f64::from(total) > 0.06 {
            continue;
        }
        let square = w / h > 0.75 && w / h < 1.3 && w <= 30.0 && h <= 30.0;
        if !square && w < 35.0 {
            continue;
        }
        let kind = if !square {
            Kind::Text
        } else if f64::from(corners) / f64::from(corner_total.max(1)) < 0.15 {
            Kind::Radio
        } else {
            Kind::Checkbox
        };
        out.push(Shape {
            x: min_x as f64 / scale,
            y: min_y as f64 / scale,
            width: w,
            height: h,
            kind,
            confidence: if square { 0.7 } else { 0.65 },
            outline: true,
        });
    }
    let mut kept: Vec<Shape> = out
        .iter()
        .enumerate()
        .filter(|&(i, r)| !out[..i].iter().any(|a| overlap(a, r) > 0.6))
        .map(|(_, r)| *r)
        .collect();
    // Stabiel, zoals Array.prototype.sort: op y, dan op x.
    kept.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal).then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal)));
    kept.truncate(500);
    Ok(kept)
}
