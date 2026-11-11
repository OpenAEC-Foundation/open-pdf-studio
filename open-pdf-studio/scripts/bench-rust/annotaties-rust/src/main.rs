// Meetprototype (zie Cargo.toml): de rauwe annotatiewoordenboeken per blad
// met lopdf, als JSON. Meet laden + doorlopen + coderen; geen pariteit.
use lopdf::{Document, Object, ObjectId};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

fn name(b: &[u8]) -> String { String::from_utf8_lossy(b).into_owned() }

struct Ctx<'a> {
    doc: &'a Document,
    annot_ids: &'a HashSet<ObjectId>,
    page_nums: &'a HashMap<ObjectId, u32>,
}

fn rid(id: ObjectId) -> String { if id.1 == 0 { format!("{}R", id.0) } else { format!("{}R{}", id.0, id.1) } }

fn val(c: &Ctx, o: &Object, depth: u32, seen: &mut Vec<ObjectId>, key: &[u8]) -> Value {
    match o {
        Object::Null => Value::Null,
        Object::Boolean(b) => json!(b),
        Object::Integer(i) => json!(i),
        Object::Real(r) => json!(*r as f64),
        Object::Name(n) => json!({ "n": name(n) }),
        Object::String(s, f) => json!({ "s": hex(s), "h": matches!(f, lopdf::StringFormat::Hexadecimal) }),
        Object::Array(a) => Value::Array(a.iter().map(|x| val(c, x, depth + 1, seen, key)).collect()),
        Object::Dictionary(d) => {
            let mut m = Map::new();
            for (k, v) in d.iter() { m.insert(name(k), val(c, v, depth + 1, seen, k)); }
            Value::Object(m)
        }
        Object::Stream(s) => {
            let mut m = Map::new();
            for (k, v) in s.dict.iter() {
                if k.as_slice() == b"Resources" && depth > 3 { continue; }
                m.insert(name(k), val(c, v, depth + 1, seen, k));
            }
            json!({ "stream": m, "len": s.content.len() })
        }
        Object::Reference(id) => {
            if c.annot_ids.contains(id) { return json!({ "annot": rid(*id) }); }
            if let Some(p) = c.page_nums.get(id) { return json!({ "page": p }); }
            if key == b"P" || key == b"Parent" || depth > 12 || seen.contains(id) { return json!({ "ref": rid(*id) }); }
            match c.doc.get_object(*id) {
                Ok(t) => { seen.push(*id); let v = val(c, t, depth + 1, seen, key); seen.pop(); json!({ "ref": rid(*id), "v": v }) }
                Err(_) => json!({ "ref": rid(*id), "missing": true }),
            }
        }
    }
}

fn hex(s: &[u8]) -> String { s.iter().map(|b| format!("{:02x}", b)).collect() }

fn main() {
    let path = std::env::args().nth(1).expect("pad");
    let out = std::env::args().nth(2);
    let t0 = Instant::now();
    let bytes = std::fs::read(&path).unwrap();
    let t_read = t0.elapsed();
    let t1 = Instant::now();
    let doc = Document::load_mem(&bytes).unwrap();
    let t_load = t1.elapsed();
    let t2 = Instant::now();
    let pages = doc.get_pages();
    let page_nums: HashMap<ObjectId, u32> = pages.iter().map(|(n, id)| (*id, *n)).collect();
    let mut annot_ids = HashSet::new();
    let mut per_page = Vec::new();
    for (_n, pid) in &pages {
        let mut ids = Vec::new();
        if let Ok(Object::Dictionary(pd)) = doc.get_object(*pid) {
            let annots = match pd.get(b"Annots") {
                Ok(Object::Reference(r)) => doc.get_object(*r).ok().and_then(|o| o.as_array().ok()).cloned(),
                Ok(Object::Array(a)) => Some(a.clone()),
                _ => None,
            };
            for a in annots.unwrap_or_default() { if let Object::Reference(id) = a { ids.push(id); annot_ids.insert(id); } }
        }
        per_page.push(ids);
    }
    let c = Ctx { doc: &doc, annot_ids: &annot_ids, page_nums: &page_nums };
    let mut n = 0usize;
    let mut out_pages = Vec::new();
    for ids in &per_page {
        let mut recs = Vec::new();
        for id in ids {
            if let Ok(o) = doc.get_object(*id) {
                let mut seen = vec![*id];
                let mut v = val(&c, o, 0, &mut seen, b"");
                if let Value::Object(ref mut m) = v { m.insert("@id".into(), json!(rid(*id))); }
                recs.push(v);
                n += 1;
            }
        }
        out_pages.push(Value::Array(recs));
    }
    let t_walk = t2.elapsed();
    let t3 = Instant::now();
    let s = serde_json::to_string(&out_pages).unwrap();
    let t_json = t3.elapsed();
    if let Some(o) = out { std::fs::write(o, &s).unwrap(); }
    println!("{{\"annots\":{},\"read_ms\":{:.1},\"load_ms\":{:.1},\"walk_ms\":{:.1},\"json_ms\":{:.1},\"json_bytes\":{}}}",
        n, t_read.as_secs_f64() * 1e3, t_load.as_secs_f64() * 1e3, t_walk.as_secs_f64() * 1e3, t_json.as_secs_f64() * 1e3, s.len());
}
