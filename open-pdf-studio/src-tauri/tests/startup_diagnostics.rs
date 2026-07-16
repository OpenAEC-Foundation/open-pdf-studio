use app_lib::startup_diagnostics::{redact_detail, sanitize_phase};

#[test]
fn startup_phases_are_allowlisted() {
    assert_eq!(sanitize_phase("frontend-ready"), "frontend-ready");
    assert_eq!(sanitize_phase("unexpected private value"), "unknown");
}

#[test]
fn diagnostic_details_do_not_store_local_paths_or_urls() {
    let input = r#"Failed to open C:\Users\person\Documents\contract.pdf and budget.pdf from https://example.invalid/private?id=4"#;
    let redacted = redact_detail(input);

    assert!(!redacted.contains("person"));
    assert!(!redacted.contains("contract.pdf"));
    assert!(!redacted.contains("budget.pdf"));
    assert!(!redacted.contains("example.invalid"));
    assert!(redacted.contains("[path]"));
    assert!(redacted.contains("[url]"));
}
