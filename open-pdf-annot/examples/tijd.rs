//! How long the layer takes without the app around it:
//! `cargo run --release -p open-pdf-annot --example tijd`.
use open_pdf_annot::{render, Shape, View};
use std::time::Instant;

fn main() {
    for (count, scale) in [(120usize, 1.0f32), (120, 2.0), (120, 4.0), (3000, 1.0), (3000, 2.0), (3000, 4.0)] {
        let cols = ((count as f32 * 0.7).sqrt().ceil()) as usize;
        let (sx, sy) = (520.0 / cols as f32, 760.0 / (count as f32 / cols as f32).ceil());
        let mut json = String::from("[");
        for i in 0..count {
            let (x, y) = (30.0 + (i % cols) as f32 * sx, 30.0 + (i / cols) as f32 * sy);
            let (w, h) = (sx * 0.75, sy * 0.6);
            if i > 0 {
                json.push(',');
            }
            let line = r#"{"rgb":[255,0,0],"alpha":1,"width":1,"dash":[3,4]}"#;
            json.push_str(&match i % 3 {
                0 => format!(r#"{{"t":"line","x1":{x},"y1":{y},"x2":{},"y2":{},"line":{line}}}"#, x + w, y + h),
                1 => format!(r#"{{"t":"box","x":{x},"y":{y},"w":{w},"h":{h},"rot":15,"fill":{{"rgb":[255,238,136],"alpha":0.3}},"line":{line}}}"#),
                _ => format!(r#"{{"t":"circle","x":{x},"y":{y},"w":{w},"h":{h},"line":{line}}}"#),
            });
        }
        json.push(']');
        let view = View { width: (595.0 * scale) as u32, height: (842.0 * scale) as u32, scale, offset_x: 0.0, offset_y: 0.0 };
        let t0 = Instant::now();
        let shapes: Vec<Shape> = serde_json::from_str(&json).unwrap();
        let parse = t0.elapsed();
        let mut best = f64::MAX;
        for _ in 0..5 {
            let t = Instant::now();
            let (rgba, drawn) = render(&view, &shapes).unwrap();
            assert_eq!(drawn, count);
            assert!(!rgba.is_empty());
            best = best.min(t.elapsed().as_secs_f64() * 1000.0);
        }
        println!("{count} shapes at {}x{}: parse {:.1} ms, render {:.1} ms", view.width, view.height, parse.as_secs_f64() * 1000.0, best);
    }
}
