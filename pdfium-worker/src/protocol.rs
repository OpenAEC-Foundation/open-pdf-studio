use serde::{Deserialize, Serialize};

/// Page engine for a render request. Absent (older app) = PDFium.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    #[default]
    Pdfium,
    Hayro,
}

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
        #[serde(default)]
        engine: Engine,
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
        #[serde(default)]
        engine: Engine,
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
    Ready { op: String, shm_name: String, shm_size: u64 },
    RenderOk { id: u64, ok: bool, w: u32, h: u32, shm_bytes: u64 },
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
            engine: Engine::Hayro,
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
    fn engine_defaults_to_pdfium() {
        let render: Request = serde_json::from_str(
            r#"{"op":"render","id":1,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0}"#,
        ).unwrap();
        assert!(matches!(render, Request::Render { engine: Engine::Pdfium, .. }));
        let region: Request = serde_json::from_str(
            r#"{"op":"render_region","id":2,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0,
                "region_x_pt":0,"region_y_pt":0,"region_w_pt":10,"region_h_pt":10}"#,
        ).unwrap();
        assert!(matches!(region, Request::RenderRegion { engine: Engine::Pdfium, .. }));
    }

    #[test]
    fn engine_hayro_parses_in_both_render_requests() {
        let render: Request = serde_json::from_str(
            r#"{"op":"render","id":1,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0,"engine":"hayro"}"#,
        ).unwrap();
        assert!(matches!(render, Request::Render { engine: Engine::Hayro, .. }));
        let region: Request = serde_json::from_str(
            r#"{"op":"render_region","id":2,"path":"a.pdf","page_index":0,"scale":1.0,"rotation":0,
                "region_x_pt":0,"region_y_pt":0,"region_w_pt":10,"region_h_pt":10,"engine":"hayro"}"#,
        ).unwrap();
        assert!(matches!(region, Request::RenderRegion { engine: Engine::Hayro, .. }));
    }

    #[test]
    fn response_render_ok_serializes_with_ok_true() {
        let resp = Response::RenderOk { id: 42, ok: true, w: 1289, h: 596, shm_bytes: 3072512 };
        let s = serde_json::to_string(&resp).unwrap();
        assert!(s.contains("\"ok\":true"));
        assert!(s.contains("\"shm_bytes\":3072512"));
    }
}
