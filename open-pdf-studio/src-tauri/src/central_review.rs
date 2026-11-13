//! Tauri commands for the central review transport. UI/session integration follows.
use crate::central_review_transport::{JsonReply, Operation, Transport};

#[tauri::command]
pub async fn central_review_login(
    state: tauri::State<'_, Transport>,
    server: String,
    name: String,
    password: String,
) -> Result<String, String> {
    state.login(&server, name, password).await
}

#[tauri::command]
pub async fn central_review_json(
    state: tauri::State<'_, Transport>,
    session: String,
    operation: Operation,
) -> Result<JsonReply, String> {
    state.json(&session, operation).await
}

#[tauri::command]
pub async fn central_review_upload(
    state: tauri::State<'_, Transport>,
    session: String,
    document: String,
    bytes: Vec<u8>,
) -> Result<JsonReply, String> {
    state.upload(&session, &document, bytes).await
}

#[tauri::command]
pub async fn central_review_download(
    state: tauri::State<'_, Transport>,
    session: String,
    document: String,
) -> Result<tauri::ipc::Response, String> {
    state
        .download(&session, &document)
        .await
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn central_review_logout(
    state: tauri::State<'_, Transport>,
    session: String,
) -> Result<(), String> {
    state.logout(&session).await
}
