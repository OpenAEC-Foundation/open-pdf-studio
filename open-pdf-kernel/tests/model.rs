use std::collections::HashSet;

use open_pdf_kernel::model::{annotations_from_json, annotations_to_json, Kind};
use serde_json::Value;

const FIXTURE: &str = include_str!("fixtures/annotations-all-types.json");

fn roundtrip() -> (Value, Value) {
    let parsed = annotations_from_json(FIXTURE).expect("fixture parses");
    let written = annotations_to_json(&parsed).expect("serializes");
    let before: Value = serde_json::from_str(FIXTURE).unwrap();
    let after: Value = serde_json::from_str(&written).unwrap();
    (before, after)
}

fn find<'a>(list: &'a Value, id: &str) -> &'a Value {
    list.as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == id)
        .unwrap_or_else(|| panic!("annotation {id} missing"))
}

#[test]
fn model_roundtrip_is_lossless() {
    assert_exact_roundtrip(FIXTURE);
}

#[test]
fn kind_maps_all_known_types() {
    let parsed = annotations_from_json(FIXTURE).unwrap();
    let known: Vec<_> = parsed
        .iter()
        .filter(|a| a.type_name() != Some("pluginShape"))
        .collect();
    assert!(known.iter().all(|a| a.kind() != Kind::Unknown));
    let distinct: HashSet<Kind> = known.iter().map(|a| a.kind()).collect();
    assert_eq!(distinct.len(), 40);
}

#[test]
fn unknown_type_survives() {
    let parsed = annotations_from_json(FIXTURE).unwrap();
    let plugin = parsed.iter().find(|a| a.id() == Some("a42")).unwrap();
    assert_eq!(plugin.kind(), Kind::Unknown);
    let (_, after) = roundtrip();
    assert_eq!(find(&after, "a42")["type"], "pluginShape");
}

#[test]
fn null_valued_untyped_field_survives() {
    let (_, after) = roundtrip();
    let caret_strike = find(&after, "a03");
    assert_eq!(caret_strike.get("groupId"), Some(&Value::Null));
}

#[test]
fn extra_preserves_nested_unknown_field() {
    let (_, after) = roundtrip();
    let schedule = find(&after, "a34");
    let expected: Value = serde_json::from_str(r#"{"a":[1,2.5,"x"]}"#).unwrap();
    assert_eq!(schedule["pluginData"], expected);
}

/// Parse and write back; the written JSON must equal the input exactly.
fn assert_exact_roundtrip(input: &str) -> String {
    let written =
        annotations_to_json(&annotations_from_json(input).expect("parses")).expect("serializes");
    let before: Value = serde_json::from_str(input).unwrap();
    let after: Value = serde_json::from_str(&written).unwrap();
    assert_eq!(before, after, "round trip changed:\n{written}");
    written
}

#[test]
fn point_extra_fields_survive() {
    assert_exact_roundtrip(
        r#"[{"id":"p","type":"polygon","page":1,
            "points":[{"x":3,"y":4,"arc":true,"bulge":0.3},{"x":9,"y":4}],
            "holes":[[{"x":1,"y":1,"arc":true,"bulge":-0.5}]]}]"#,
    );
}

#[test]
fn null_fill_and_stroke_colors_survive() {
    assert_exact_roundtrip(
        r#"[{"id":"c","type":"box","page":1,"fillColor":null,"strokeColor":null}]"#,
    );
}

#[test]
fn floats_roundtrip_exactly() {
    let written = assert_exact_roundtrip(
        r#"[{"id":"f","type":"line","page":1,"startX":1223.1689636240405,"startY":0.30000000000000004,"endX":1e-7,"endY":5}]"#,
    );
    assert!(written.contains("1223.1689636240405"), "{written}");
    assert!(written.contains("0.30000000000000004"), "{written}");
}

#[test]
fn mistyped_fields_keep_the_page() {
    assert_exact_roundtrip(
        r#"[{"id":"m","type":"box","page":"1","lineWidth":"2","text":5,"opacity":null,
             "points":[{"x":null,"y":2}]},
            {"id":"n","type":"box"},
            {"id":"o","type":"box","page":1.5}]"#,
    );
}

#[test]
fn accessors_return_none_for_mistyped_values() {
    let list = annotations_from_json(
        r#"[{"id":"m","type":"polygon","page":"1","lineWidth":"2","opacity":null,"fontSize":12.5,
             "points":[{"x":3,"y":4,"arc":true,"bulge":0.3},{"x":9,"y":4,"bulge":0.7}],
             "holes":[[{"x":1,"y":1}],[{"x":null,"y":1}]]}]"#,
    )
    .unwrap();
    let a = &list[0];
    assert_eq!(a.page(), None);
    assert_eq!(a.f64("lineWidth"), None);
    assert_eq!(a.f64("opacity"), None);
    assert_eq!(a.f64("fontSize"), Some(12.5));
    let pts = a.points("points").unwrap();
    assert_eq!(pts[0].bulge, Some(0.3));
    assert_eq!(pts[1].bulge, None, "bulge without arc:true is not an arc");
    assert_eq!(
        a.rings("holes"),
        None,
        "one invalid ring invalidates the list"
    );
}
