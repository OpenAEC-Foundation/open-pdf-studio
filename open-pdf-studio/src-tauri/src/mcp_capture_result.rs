//! MCP capture results: preserve the JSON payload for existing clients and
//! expose inline images to clients that consume MCP image content.
use serde_json::{json, Value};

pub(super) fn format_result(event: &str, response: Value) -> Value {
    let capture = matches!(event, "mcp:screenshot-view" | "mcp:capture-region");
    let failed = capture && (response["ok"] == false || response["error"].is_string());
    // Keep content[0] byte-compatible with clients that decode the legacy JSON.
    let mut content = vec![json!({ "type": "text", "text": response.to_string() })];
    if !failed {
        let image = match event {
            "mcp:screenshot-view" => response["png_base64"]
                .as_str()
                .map(|data| (data, "image/png")),
            "mcp:capture-region" => response["image_base64"]
                .as_str()
                .zip(response["mime"].as_str()),
            _ => None,
        };
        if let Some((data, mime)) = image {
            if !data.is_empty() && matches!(mime, "image/png" | "image/jpeg") {
                content.push(json!({ "type": "image", "data": data, "mimeType": mime }));
            }
        }
    }
    json!({ "content": content, "isError": failed })
}

pub(super) fn needs_scope_help(event: &str, arguments: &Value, response: &Value) -> bool {
    event == "mcp:capture-region"
        && arguments["path"]
            .as_str()
            .is_some_and(|path| !path.is_empty())
        && response["error"]
            .as_str()
            .is_some_and(|error| error.to_ascii_lowercase().contains("forbidden path"))
}

pub(super) fn add_scope_help(
    response: &mut Value,
    mut allowed: Vec<String>,
    mut forbidden: Vec<String>,
) {
    allowed.sort();
    forbidden.sort();
    let original = response["error"].as_str().unwrap_or("capture failed");
    response["error"] = json!(format!(
        "{original}. Current filesystem scope allows these path patterns: {allowed:?}; denies: {forbidden:?}. Window permissions and OS permissions also apply; denied paths take precedence. Use an already granted export location, select the destination through Home > Screenshot > Save, or omit path to receive an inline image. TEMP, Pictures and Documents are not automatically granted."
    ));
    response["allowedPathPatterns"] = json!(allowed);
    response["forbiddenPathPatterns"] = json!(forbidden);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_view_includes_image_and_unchanged_legacy_payload() {
        let response = json!({"ok": true, "png_base64": "iVBORw0KGgo=", "width": 2, "height": 1, "scope": "document", "bounds": {"x": 0, "y": 0, "width": 2, "height": 1}});
        let result = format_result("mcp:screenshot-view", response.clone());
        assert_eq!(
            serde_json::from_str::<Value>(result["content"][0]["text"].as_str().unwrap()).unwrap(),
            response
        );
        assert_eq!(
            result["content"][1],
            json!({"type": "image", "data": "iVBORw0KGgo=", "mimeType": "image/png"})
        );
        assert_eq!(result["isError"], false);
    }

    #[test]
    fn regions_use_the_actual_png_or_jpeg_mime() {
        for mime in ["image/png", "image/jpeg"] {
            let result = format_result(
                "mcp:capture-region",
                json!({"ok": true, "mime": mime, "image_base64": "aW1hZ2U=", "dpi": 150}),
            );
            assert_eq!(
                result["content"][1],
                json!({"type": "image", "data": "aW1hZ2U=", "mimeType": mime})
            );
        }
    }

    #[test]
    fn file_exports_and_unrelated_tools_remain_text_only() {
        for (event, response) in [
            (
                "mcp:capture-region",
                json!({"ok": true, "path": "/export/plan.png", "bytes": 80, "mime": "image/png"}),
            ),
            (
                "mcp:get-state",
                json!({"ok": true, "png_base64": "aW1hZ2U="}),
            ),
            (
                "mcp:capture-region",
                json!({"ok": true, "image_base64": "", "mime": "image/png"}),
            ),
            (
                "mcp:capture-region",
                json!({"ok": true, "image_base64": "aW1hZ2U=", "mime": "text/plain"}),
            ),
        ] {
            let result = format_result(event, response.clone());
            assert_eq!(result["content"].as_array().unwrap().len(), 1);
            assert_eq!(
                serde_json::from_str::<Value>(result["content"][0]["text"].as_str().unwrap())
                    .unwrap(),
                response
            );
        }
    }

    #[test]
    fn capture_errors_do_not_become_images() {
        for event in ["mcp:screenshot-view", "mcp:capture-region"] {
            let result = format_result(
                event,
                json!({"ok": false, "error": "capture failed", "png_base64": "aW1hZ2U=", "image_base64": "aW1hZ2U=", "mime": "image/png"}),
            );
            assert_eq!(result["isError"], true);
            assert_eq!(result["content"].as_array().unwrap().len(), 1);
        }
        assert_eq!(
            format_result("mcp:get-state", json!({"ok": false}))["isError"],
            false
        );
    }
    #[test]
    fn scope_diagnostics_name_existing_grants_without_granting_access() {
        let args = json!({"path": "/blocked/shot.png"});
        let mut response =
            json!({"ok": false, "error": "capture failed: forbidden path: /blocked/shot.png"});
        assert!(needs_scope_help("mcp:capture-region", &args, &response));
        assert!(!needs_scope_help("mcp:screenshot-view", &args, &response));
        assert!(!needs_scope_help(
            "mcp:capture-region",
            &json!({}),
            &response
        ));
        assert!(!needs_scope_help(
            "mcp:capture-region",
            &args,
            &json!({"ok": false, "error": "disk full"})
        ));
        add_scope_help(
            &mut response,
            vec!["/exports/b/*".into(), "/exports/a/*".into()],
            vec!["/exports/a/private/*".into()],
        );
        assert_eq!(
            response["allowedPathPatterns"],
            json!(["/exports/a/*", "/exports/b/*"])
        );
        assert!(response["error"]
            .as_str()
            .unwrap()
            .contains("/exports/a/private/*"));
        assert!(response["error"].as_str().unwrap().contains("omit path"));
        assert_eq!(response["ok"], false);
        let result = format_result("mcp:capture-region", response);
        assert_eq!(result["isError"], true);
        let mut empty = json!({"ok": false, "error": "forbidden path"});
        add_scope_help(&mut empty, vec![], vec![]);
        assert_eq!(empty["allowedPathPatterns"], json!([]));
        assert!(empty["error"].as_str().unwrap().contains("patterns: []"));
    }
}
