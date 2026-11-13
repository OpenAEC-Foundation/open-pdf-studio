//! Probe for the Python-owned isolated S3 integration environment; stdin only.
use opds_review_native_tests::transport::{Operation, Transport};
use serde::Deserialize;
use serde_json::json;
use std::io::Read;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    server: String,
    owner_password: String,
    reader_password: String,
    reader_id: String,
    pdf: Vec<u8>,
}

#[tokio::main]
async fn main() {
    let mut input = String::new();
    std::io::stdin()
        .take(1024 * 1024)
        .read_to_string(&mut input)
        .unwrap();
    let config: Config = serde_json::from_str(&input).unwrap();
    let transport = Transport::default();
    let a = transport
        .login(&config.server, "Owner".into(), config.owner_password)
        .await
        .unwrap();
    let b = transport
        .login(&config.server, "Reader".into(), config.reader_password)
        .await
        .unwrap();
    let created = transport
        .json(
            &a,
            Operation::CreateDocument {
                title: "Native transport roundtrip".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(created.status, 201);
    let doc = created.body["id"].as_str().unwrap().to_string();
    assert_eq!(
        transport
            .upload(&a, &doc, config.pdf.clone())
            .await
            .unwrap()
            .status,
        200
    );
    assert_eq!(
        transport.download(&b, &doc).await.unwrap_err(),
        "PDF_UNAVAILABLE"
    );
    assert_eq!(
        transport
            .json(
                &a,
                Operation::Members {
                    document: doc.clone(),
                    user_id: config.reader_id.clone(),
                    role: Some("editor".into())
                }
            )
            .await
            .unwrap()
            .status,
        200
    );
    assert_eq!(transport.download(&b, &doc).await.unwrap(), config.pdf);
    let event = json!({"id":"native-e1","ann":"native-a","op":"create","base":null,"data":{"id":"native-a","type":"textbox","page":1,"text":"From native transport"}});
    assert_eq!(
        transport
            .json(
                &b,
                Operation::Append {
                    document: doc.clone(),
                    event: event.clone()
                }
            )
            .await
            .unwrap()
            .status,
        200
    );
    assert_eq!(
        transport
            .json(
                &b,
                Operation::Append {
                    document: doc.clone(),
                    event
                }
            )
            .await
            .unwrap()
            .status,
        200
    );
    let events = transport
        .json(
            &a,
            Operation::Events {
                document: doc.clone(),
                after: 0,
                limit: 100,
                wait: 0,
            },
        )
        .await
        .unwrap();
    assert_eq!(events.status, 200);
    assert_eq!(events.body["events"].as_array().unwrap().len(), 1);
    let conflict = json!({"id":"native-e2","ann":"native-a","op":"edit","base":"stale-event","data":{"id":"native-a","type":"textbox","page":1,"text":"Stale"}});
    let result = transport
        .json(
            &a,
            Operation::Append {
                document: doc.clone(),
                event: conflict,
            },
        )
        .await
        .unwrap();
    assert_eq!(result.status, 409);
    assert_eq!(result.body["current"], "native-e1");
    assert_eq!(
        transport
            .json(
                &a,
                Operation::Snapshot {
                    document: doc.clone()
                }
            )
            .await
            .unwrap()
            .body["cursor"],
        1
    );
    assert_eq!(
        transport
            .json(
                &a,
                Operation::Members {
                    document: doc.clone(),
                    user_id: config.reader_id,
                    role: None
                }
            )
            .await
            .unwrap()
            .status,
        200
    );
    assert_eq!(
        transport.download(&b, &doc).await.unwrap_err(),
        "PDF_UNAVAILABLE"
    );
    transport.logout(&a).await.unwrap();
    transport.logout(&b).await.unwrap();
    println!("PASS: production native transport, two logins, real S3 PDF, idempotency, conflict, replay, ACL and logout");
}
