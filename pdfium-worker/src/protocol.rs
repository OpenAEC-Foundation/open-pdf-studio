use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Render {
        id: u64,
        path: String,
        page_index: u32,
        scale: f32,
        rotation: i32,
        /// Thin Lines view mode (#595): every stroke as a hairline. Absent
        /// (older app) = off.
        #[serde(default)]
        thin_lines: bool,
    },
    RenderRegion {
        id: u64,
        path: String,
        page_index: u32,
        scale: f32,
        rotation: i32,
        region_x_pt: f32,
        region_y_pt: f32,
        region_w_pt: f32,
        region_h_pt: f32,
        #[serde(default)]
        thin_lines: bool,
    },
    /// Pixelvergelijking van een paginapaar (#465), zie compare/mod.rs.
    Compare(crate::compare::CompareRequest),
    /// Snap-geometrie van een pagina (snap_geometry.rs). Het resultaat kan
    /// groter zijn dan de SHM-regio: de app haalt het in stukken op met
    /// oplopende `offset`; de worker bewaart het resultaat tot het laatste stuk
    /// is opgehaald.
    SnapGeometry {
        id: u64,
        path: String,
        page_index: u32,
        /// Weergavematrix van de pagina bij schaal 1 (a, b, c, d, e, f).
        viewport: [f64; 6],
        #[serde(default)]
        offset: u64,
    },
    /// Sluit open pagina-handles (parse-state, honderden MB's op zware
    /// CAD-pagina's); documenten blijven gecachet. Fire-and-forget: geen
    /// response. Gestuurd door de pool bij inactiviteit.
    Trim,
    Shutdown,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Response {
    /// `caps`: aanvragen die deze worker kent naast render/render_region. De
    /// app stuurt een nieuwe soort aanvraag alleen naar een worker die hem
    /// noemt; een oudere sidecar zonder `caps` krijgt hem nooit.
    Ready {
        op: String,
        shm_name: String,
        shm_size: u64,
        #[serde(default)]
        caps: Vec<String>,
    },
    RenderOk { id: u64, ok: bool, w: u32, h: u32, shm_bytes: u64 },
    /// Eén stuk snap-geometrie in de SHM-regio: `shm_bytes` vanaf `offset`
    /// van in totaal `total_bytes`. `ms` = extractietijd (0 voor een stuk uit
    /// het bewaarde resultaat).
    SnapOk { id: u64, ok: bool, total_bytes: u64, offset: u64, shm_bytes: u64, ms: f64 },
    RenderErr { id: u64, ok: bool, error: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_render_round_trips() {
        let req = Request::Render {
            id: 42,
            path: "C:/foo.pdf".to_string(),
            page_index: 5,
            scale: 0.25,
            rotation: 0,
            thin_lines: true,
        };
        let line = serde_json::to_string(&req).unwrap();
        let parsed: Request = serde_json::from_str(&line).unwrap();
        assert_eq!(req, parsed);
    }

    #[test]
    fn thin_lines_defaults_to_off_when_the_app_does_not_send_it() {
        let render: Request = serde_json::from_str(
            r#"{"op":"render","id":1,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0}"#,
        ).unwrap();
        assert!(matches!(render, Request::Render { thin_lines: false, .. }));
        let region: Request = serde_json::from_str(
            r#"{"op":"render_region","id":2,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0,
                "region_x_pt":0,"region_y_pt":0,"region_w_pt":10,"region_h_pt":10}"#,
        ).unwrap();
        assert!(matches!(region, Request::RenderRegion { thin_lines: false, .. }));
    }

    #[test]
    fn thin_lines_reaches_both_render_requests() {
        let render: Request = serde_json::from_str(
            r#"{"op":"render","id":1,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0,"thin_lines":true}"#,
        ).unwrap();
        assert!(matches!(render, Request::Render { thin_lines: true, .. }));
        let region: Request = serde_json::from_str(
            r#"{"op":"render_region","id":2,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0,
                "region_x_pt":0,"region_y_pt":0,"region_w_pt":10,"region_h_pt":10,"thin_lines":true}"#,
        ).unwrap();
        assert!(matches!(region, Request::RenderRegion { thin_lines: true, .. }));
    }

    #[test]
    fn compare_request_reads_what_the_app_sends() {
        // Vorm uit js/compare/rust-compare.js (buildRustRequest) + op/id van de pool.
        let line = r#"{"op":"compare","id":7,
            "old":{"path":"C:/a.pdf","page_index":0,"width_pt":1190.55,"height_pt":841.89,"expect_len":1234},
            "new":{"path":"C:/b.pdf","page_index":2,"width_pt":1190.55,"height_pt":841.89,"expect_len":null},
            "px_per_pt":1.7638888888888888,"threshold":96,
            "params":{"tolerance_px":1,"min_area_px":5,"merge_px":8,"noise_px":1},
            "auto_align":{"measure_ratio":null},"skip_detect":false}"#;
        let Request::Compare(req) = serde_json::from_str(line).unwrap() else { panic!("not a compare request") };
        assert_eq!(req.id, 7);
        assert_eq!(req.old.expect_len, Some(1234));
        assert_eq!(req.new.expect_len, None);
        assert_eq!(req.new.page_index, 2);
        assert_eq!(req.params.unwrap().merge_px, 8.0);
        assert_eq!(req.params.unwrap().max_runs, 2_000_000.0);
        assert!(req.auto_align.is_some() && req.alignment.is_none());
        // Handmatige uitlijning, zonder optionele velden.
        let manual: Request = serde_json::from_str(
            r#"{"op":"compare","id":8,"old":{"path":"a","page_index":0,"width_pt":10,"height_pt":10},
                "new":{"path":"b","page_index":0,"width_pt":10,"height_pt":10},"px_per_pt":1,"threshold":96,
                "alignment":{"dx":1.5,"dy":0,"rotation":0.25,"scale":1}}"#,
        ).unwrap();
        let Request::Compare(m) = manual else { panic!() };
        assert_eq!(m.alignment.unwrap().dx, 1.5);
        assert!(!m.skip_detect && m.params.is_none());
    }

    #[test]
    fn ready_names_the_compare_capability() {
        let ready = Response::Ready { op: "ready".into(), shm_name: "x".into(), shm_size: 1, caps: vec!["compare".into()] };
        assert!(serde_json::to_string(&ready).unwrap().contains(r#""caps":["compare"]"#));
    }

    #[test]
    fn snap_geometry_request_parses_with_default_offset() {
        let req: Request = serde_json::from_str(
            r#"{"op":"snap_geometry","id":7,"path":"a.pdf","page_index":2,"viewport":[1,0,0,-1,0,842]}"#,
        ).unwrap();
        assert_eq!(req, Request::SnapGeometry {
            id: 7, path: "a.pdf".into(), page_index: 2,
            viewport: [1.0, 0.0, 0.0, -1.0, 0.0, 842.0], offset: 0,
        });
    }

    #[test]
    fn ready_announces_snap_geometry() {
        let ready = Response::Ready {
            op: "ready".into(), shm_name: "x".into(), shm_size: 1,
            caps: vec!["snap_geometry".into()],
        };
        assert!(serde_json::to_string(&ready).unwrap().contains(r#""caps":["snap_geometry"]"#));
    }

    #[test]
    fn response_render_ok_serializes_with_ok_true() {
        let resp = Response::RenderOk { id: 42, ok: true, w: 1289, h: 596, shm_bytes: 3072512 };
        let s = serde_json::to_string(&resp).unwrap();
        assert!(s.contains("\"ok\":true"));
        assert!(s.contains("\"shm_bytes\":3072512"));
    }
}
