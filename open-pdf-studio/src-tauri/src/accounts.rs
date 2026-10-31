// OpenAEC Accounts-integratie: "Sign in with OpenAEC" (OIDC Authorization
// Code + PKCE, RFC 8252) en de Accounts API (apps-catalogus + cloud-opslag).
// Contract: openaec-accounts/docs/integrations/open-pdf-studio.md
//
// Flow: systeembrowser → Zitadel-login → redirect naar loopback
// http://localhost:53682/callback → token-exchange → tokens in de
// OS-keyring (Windows Credential Manager). Tokens komen nooit in de webview.
//
// Dit staat LOS van de bestaande Impertio-login (auth.rs) die de
// AI-functies ontgrendelt — OpenAEC Accounts is het platform-account
// (portal, cloud-opslag, credits, brand).

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;

const KEYRING_SERVICE: &str = "open-pdf-studio-openaec";
const LOGIN_TIMEOUT_SECS: u64 = 300;

// ── Config ──────────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsConfig {
    pub issuer: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub scopes: String,
    pub accounts_api_url: String,
}

impl Default for AccountsConfig {
    fn default() -> Self {
        // Dev-waarden uit het integratiecontract (open-pdf-studio.md);
        // productie krijgt later een eigen issuer/API-domein (override via
        // OPENAEC_ACCOUNTS_CONFIG).
        Self {
            issuer: "http://kubernetes.docker.internal:8088".into(),
            client_id: "376959313148641285".into(),
            redirect_uri: "http://localhost:53682/callback".into(),
            scopes: "openid profile email offline_access".into(),
            accounts_api_url: "http://localhost:4000".into(),
        }
    }
}

fn load_config() -> AccountsConfig {
    if let Ok(path) = std::env::var("OPENAEC_ACCOUNTS_CONFIG") {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<AccountsConfig>(&text) {
                return cfg;
            }
            log::warn!("[Accounts] Config op {} onleesbaar — dev-defaults gebruikt", path);
        }
    }
    AccountsConfig::default()
}

// ── Token-opslag (keyring) ──────────────────────────────────────────────
// Windows Credential Manager begrenst een blob tot ~2,5 KB; JWT's zijn al
// gauw 1-2 KB per stuk, dus elk token krijgt zijn eigen entry.

// Zonder keyring (OpenAEC Linux, een container zonder Secret Service, of een
// platform waarvoor de keyring-crate alleen zijn tijdelijke mock-opslag
// heeft) mag inloggen niet mislukken (#863): elk token staat daarom óók in het
// geheugen van dit proces. Lukt de keyring, dan overleeft het een herstart;
// anders geldt het alleen voor deze sessie.
static GEHEUGEN: std::sync::Mutex<std::collections::BTreeMap<String, String>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

fn geheugen() -> std::sync::MutexGuard<'static, std::collections::BTreeMap<String, String>> {
    GEHEUGEN.lock().unwrap_or_else(|e| e.into_inner())
}

/// Pure regel: de keyring wint, het geheugen vangt op.
fn kies_token(uit_keyring: Option<String>, uit_geheugen: Option<String>) -> Option<String> {
    uit_keyring.or(uit_geheugen)
}

fn keyring_set(user: &str, value: &str) -> Result<(), String> {
    geheugen().insert(user.to_string(), value.to_string());
    if let Err(e) = keyring::Entry::new(KEYRING_SERVICE, user).and_then(|e| e.set_password(value)) {
        log::warn!("[Accounts] no keyring ({user}: {e}); token kept in memory for this session");
    }
    Ok(())
}

fn keyring_get(user: &str) -> Option<String> {
    let uit_keyring = keyring::Entry::new(KEYRING_SERVICE, user)
        .ok()
        .and_then(|e| e.get_password().ok());
    kies_token(uit_keyring, geheugen().get(user).cloned())
}

fn keyring_delete(user: &str) {
    geheugen().remove(user);
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, user) {
        let _ = e.delete_credential();
    }
}

fn store_tokens(access: &str, refresh: Option<&str>, id_token: Option<&str>) -> Result<(), String> {
    keyring_set("access_token", access)?;
    if let Some(r) = refresh {
        keyring_set("refresh_token", r)?;
    }
    if let Some(i) = id_token {
        // Best-effort: een vol id_token kan groter zijn dan de ~2,5 KB-limiet
        // van de Windows Credential Manager. Dat mag de login NIET laten falen
        // — het profiel komt uit het in-memory id_token (decode) en bij
        // herstart uit het userinfo-endpoint. Dus alleen loggen bij een fout.
        if let Err(e) = keyring_set("id_token", i) {
            log::warn!("[Accounts] id_token niet opgeslagen (te groot voor keyring?): {e}");
        }
    }
    Ok(())
}

// ── OIDC types ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct Discovery {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    userinfo_endpoint: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct UserInfo {
    pub sub: String,
    pub name: String,
    pub email: String,
}

fn b64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

/// Decodeer de payload van een JWT (zonder handtekeningverificatie — het
/// token komt rechtstreeks van het token-endpoint en dient hier alleen om
/// naam/e-mail te tonen).
fn decode_id_token(id_token: &str) -> Option<UserInfo> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Some(UserInfo {
        sub: claims.get("sub")?.as_str()?.to_string(),
        name: claims
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        email: claims
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

async fn fetch_discovery(client: &reqwest::Client, issuer: &str) -> Result<Discovery, String> {
    client
        .get(format!("{issuer}/.well-known/openid-configuration"))
        .send()
        .await
        .map_err(|e| format!("OIDC-discovery onbereikbaar ({issuer}): {e}"))?
        .json::<Discovery>()
        .await
        .map_err(|e| format!("OIDC-discovery onleesbaar: {e}"))
}

/// Profiel ophalen via het userinfo-endpoint — fallback wanneer de token-
/// respons geen id_token bevat (de Zitadel-client van deze app levert er geen,
/// in tegenstelling tot bv. Open Calc Studio).
async fn fetch_userinfo(
    client: &reqwest::Client,
    userinfo_endpoint: &str,
    access_token: &str,
) -> Result<UserInfo, String> {
    let resp = client
        .get(userinfo_endpoint)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("userinfo onbereikbaar: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("userinfo lezen: {e}"))?;
    eprintln!("[Accounts] userinfo status={} bodylen={}", status, text.len());
    if !status.is_success() {
        return Err(format!("userinfo {status}: {text}"));
    }
    let claims: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("userinfo geen JSON ({e}) — body: {}", &text[..text.len().min(120)]))?;
    let sub = claims
        .get("sub")
        .and_then(|v| v.as_str())
        .ok_or("userinfo zonder sub")?
        .to_string();
    let field = |k: &str| claims.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(UserInfo { sub, name: field("name"), email: field("email") })
}

// ── Loopback-callback ──────────────────────────────────────────────────

/// Wacht op de OAuth-redirect en geef (code, state) terug.
///
/// Niet-blokkerend met een harde deadline: zo blijft deze thread NOOIT
/// eeuwig hangen op `accept()` (anders blijft de callback-poort bezet en
/// de login-knop "bezig" hangen als de gebruiker de browser-login niet
/// afmaakt). Bij het verstrijken van de deadline keert de functie terug en
/// wordt de listener gedropt → poort vrij, knop reset.
fn wait_for_callback(listener: TcpListener) -> Result<(String, String), String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("loopback non-blocking: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(LOGIN_TIMEOUT_SECS);
    loop {
        if std::time::Instant::now() >= deadline {
            return Err("inloggen verlopen (geen callback ontvangen)".into());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(pair) => pair,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(format!("loopback accept: {e}")),
        };
        // Geaccepteerde socket kan non-blocking erven (Windows) → terug naar
        // blocking + leestimeout, zodat een half-open verbinding niet hangt.
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let first_line = request.lines().next().unwrap_or("");
        // Verwacht: GET /callback?code=...&state=... HTTP/1.1
        let path = first_line.split_whitespace().nth(1).unwrap_or("");
        if !path.starts_with("/callback") {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let query = path.splitn(2, '?').nth(1).unwrap_or("");
        let mut code = None;
        let mut state = None;
        let mut error = None;
        for pair in query.split('&') {
            let mut kv = pair.splitn(2, '=');
            match (kv.next(), kv.next()) {
                (Some("code"), Some(v)) => code = Some(v.to_string()),
                (Some("state"), Some(v)) => state = Some(v.to_string()),
                (Some("error"), Some(v)) => error = Some(v.to_string()),
                _ => {}
            }
        }
        let body = if code.is_some() {
            "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:80px\">\
             <h2>Ingelogd bij OpenAEC</h2><p>Je kunt dit venster sluiten en teruggaan naar Open PDF Studio.</p></body></html>"
        } else {
            "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:80px\">\
             <h2>Inloggen geannuleerd</h2><p>Je kunt dit venster sluiten.</p></body></html>"
        };
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .as_bytes(),
        );
        if let Some(err) = error {
            return Err(format!("inloggen geweigerd: {err}"));
        }
        match (code, state) {
            (Some(c), Some(s)) => return Ok((c, s)),
            _ => return Err("callback zonder code/state".into()),
        }
    }
}

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn accounts_sign_in(app: tauri::AppHandle) -> Result<UserInfo, String> {
    use tauri_plugin_shell::ShellExt;

    // Aanmelden opent de browser van de gebruiker; niet vanuit een headless testinstantie.
    crate::headless::weiger("accounts_sign_in (browser)")?;

    let cfg = load_config();
    let client = reqwest::Client::new();
    let disco = fetch_discovery(&client, &cfg.issuer).await?;

    // PKCE-verifier + challenge (S256) en state
    let mut raw = [0u8; 48];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    let verifier = b64url(&raw);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let mut raw_state = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut raw_state);
    let state = b64url(&raw_state);

    // Loopback-listener vóór het openen van de browser (fail-fast bij bezet)
    let port = cfg
        .redirect_uri
        .rsplit(':')
        .next()
        .and_then(|s| s.split('/').next())
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(53682);
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("poort {port} niet beschikbaar voor login-callback: {e}"))?;

    let mut auth_url = reqwest::Url::parse(&disco.authorization_endpoint)
        .map_err(|e| format!("authorization_endpoint ongeldig: {e}"))?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &cfg.client_id)
        .append_pair("redirect_uri", &cfg.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &cfg.scopes)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");

    app.shell()
        .open(auth_url.as_str(), None)
        .map_err(|e| format!("kan systeembrowser niet openen: {e}"))?;
    log::info!("[Accounts] Browser geopend voor login; wacht op callback op poort {port}");

    // wait_for_callback bewaakt zelf de deadline (niet-blokkerend), dus géén
    // extra tokio::time::timeout: die zou de blocking-thread laten doorlopen
    // en de poort bezet houden. Nu keert de thread altijd terug → poort vrij.
    let (code, returned_state) = tokio::task::spawn_blocking(move || wait_for_callback(listener))
        .await
        .map_err(|e| format!("callback-taak mislukt: {e}"))??;

    if returned_state != state {
        return Err("state-mismatch in OAuth-callback (mogelijke spoof) — login afgebroken".into());
    }

    let token_resp = client
        .post(&disco.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", cfg.redirect_uri.as_str()),
            ("client_id", cfg.client_id.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("token-exchange mislukt: {e}"))?;
    let token_status = token_resp.status();
    let token_text = token_resp
        .text()
        .await
        .map_err(|e| format!("token-respons lezen: {e}"))?;
    eprintln!("[Accounts] token-exchange status={} bodylen={}", token_status, token_text.len());
    if !token_status.is_success() {
        return Err(format!("token-exchange {token_status}: {token_text}"));
    }
    let token: TokenResponse = serde_json::from_str(&token_text)
        .map_err(|e| format!("token-respons onleesbaar: {e}"))?;
    eprintln!("[Accounts] id_token_present={}", token.id_token.is_some());

    store_tokens(
        &token.access_token,
        token.refresh_token.as_deref(),
        token.id_token.as_deref(),
    )?;

    // Profiel uit het id_token (goedkoop); valt terug op het userinfo-endpoint
    // wanneer er geen id_token is (deze Zitadel-client levert er geen).
    let user = match token.id_token.as_deref().and_then(decode_id_token) {
        Some(u) => u,
        None => {
            let endpoint = disco
                .userinfo_endpoint
                .as_deref()
                .ok_or("geen id_token én geen userinfo_endpoint in discovery")?;
            fetch_userinfo(&client, endpoint, &token.access_token).await?
        }
    };
    log::info!("[Accounts] Ingelogd als {} <{}>", user.name, user.email);
    Ok(user)
}

#[tauri::command]
pub async fn accounts_get_user() -> Option<UserInfo> {
    // Voorkeur: het opgeslagen id_token (goedkoop). Zonder id_token (deze
    // client levert er geen) → userinfo met het opgeslagen access_token, zodat
    // de sessie ook na herstart hersteld wordt.
    if let Some(u) = keyring_get("id_token").as_deref().and_then(decode_id_token) {
        return Some(u);
    }
    let access = keyring_get("access_token")?;
    let client = reqwest::Client::new();
    let cfg = load_config();
    let disco = fetch_discovery(&client, &cfg.issuer).await.ok()?;
    let endpoint = disco.userinfo_endpoint.as_deref()?;
    fetch_userinfo(&client, endpoint, &access).await.ok()
}

#[tauri::command]
pub fn accounts_sign_out() {
    for entry in ["access_token", "refresh_token", "id_token"] {
        keyring_delete(entry);
    }
    log::info!("[Accounts] Uitgelogd (tokens gewist)");
}

// ── Geauthenticeerde API-calls met refresh-retry ───────────────────────

async fn refresh_tokens(client: &reqwest::Client, cfg: &AccountsConfig) -> Result<String, String> {
    let refresh = keyring_get("refresh_token").ok_or("geen refresh_token — log opnieuw in")?;
    let disco = fetch_discovery(client, &cfg.issuer).await?;
    let token: TokenResponse = client
        .post(&disco.token_endpoint)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", cfg.client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("token-refresh mislukt: {e}"))?
        .json()
        .await
        .map_err(|e| format!("refresh-respons onleesbaar: {e}"))?;
    store_tokens(
        &token.access_token,
        token.refresh_token.as_deref(),
        token.id_token.as_deref(),
    )?;
    Ok(token.access_token)
}

enum ApiBody {
    None,
    Json(serde_json::Value),
    File { name: String, bytes: Vec<u8> },
}

async fn api_request(
    method: &str,
    path: &str,
    body: ApiBody,
) -> Result<(u16, String), String> {
    let cfg = load_config();
    let client = reqwest::Client::new();
    let mut access = keyring_get("access_token").ok_or("niet ingelogd")?;

    for attempt in 0..2 {
        let url = format!("{}{}", cfg.accounts_api_url, path);
        let mut req = match method {
            "GET" => client.get(&url),
            "POST" => client.post(&url),
            "DELETE" => client.delete(&url),
            other => return Err(format!("onbekende methode {other}")),
        };
        req = req.bearer_auth(&access);
        req = match &body {
            ApiBody::None => req,
            ApiBody::Json(v) => req.json(v),
            ApiBody::File { name, bytes } => {
                let part = reqwest::multipart::Part::bytes(bytes.clone())
                    .file_name(name.clone())
                    .mime_str("application/pdf")
                    .map_err(|e| format!("mime: {e}"))?;
                // Pad (incl. mappen) gaat als apart `path`-veld mee: multer
                // aan de serverkant stript slashes uit de bestandsnaam, dus
                // alleen via dit veld komt een submap-pad heelhuids aan.
                let form = reqwest::multipart::Form::new()
                    .text("path", name.clone())
                    .part("file", part);
                req.multipart(form)
            }
        };
        let resp = req
            .send()
            .await
            .map_err(|e| format!("Accounts API onbereikbaar ({url}): {e}"))?;
        let status = resp.status().as_u16();
        if status == 401 && attempt == 0 {
            log::info!("[Accounts] 401 — token verversen en opnieuw proberen");
            access = refresh_tokens(&client, &cfg).await?;
            continue;
        }
        let text = resp.text().await.unwrap_or_default();
        return Ok((status, text));
    }
    unreachable!()
}

fn parse_api_result(status: u16, text: String) -> Result<serde_json::Value, String> {
    if status == 413 {
        return Err("cloud-opslag vol (quota bereikt) — beheer je opslag in de OpenAEC-portal".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Accounts API gaf {status}: {text}"));
    }
    if text.is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&text).or(Ok(serde_json::Value::String(text)))
}

/// Generieke geauthenticeerde call — `GET /me/apps`, `POST /me/apps` enz.
#[tauri::command]
pub async fn accounts_fetch(
    path: String,
    method: Option<String>,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let method = method.unwrap_or_else(|| "GET".into());
    let body = body.map(ApiBody::Json).unwrap_or(ApiBody::None);
    let (status, text) = api_request(&method, &path, body).await?;
    parse_api_result(status, text)
}

/// Upload van een bestand (bv. een PDF) naar de OpenAEC cloud-opslag.
#[tauri::command]
pub async fn accounts_upload_file(file_name: String, content: Vec<u8>) -> Result<serde_json::Value, String> {
    let (status, text) = api_request(
        "POST",
        "/me/files",
        ApiBody::File { name: file_name, bytes: content },
    )
    .await?;
    parse_api_result(status, text)
}

/// Download van een cloudbestand; geeft de bytes base64-gecodeerd terug
/// (PDF's zijn binair — tekst-doorgave zou ze beschadigen).
#[tauri::command]
pub async fn accounts_download_file(id: String) -> Result<String, String> {
    let cfg = load_config();
    let client = reqwest::Client::new();
    let mut access = keyring_get("access_token").ok_or("niet ingelogd")?;
    for attempt in 0..2 {
        let url = format!("{}/me/files/{}", cfg.accounts_api_url, id);
        let resp = client
            .get(&url)
            .bearer_auth(&access)
            .send()
            .await
            .map_err(|e| format!("Accounts API onbereikbaar ({url}): {e}"))?;
        let status = resp.status().as_u16();
        if status == 401 && attempt == 0 {
            access = refresh_tokens(&client, &cfg).await?;
            continue;
        }
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("download mislukt ({status}): {text}"));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("download lezen mislukt: {e}"))?;
        return Ok(base64::engine::general_purpose::STANDARD.encode(&bytes));
    }
    unreachable!()
}

/// Logo van de actieve organisatie/entiteit als data-URL (base64), of `None`
/// bij 404 (geen logo ingesteld). De webview kan de string direct als
/// `<img src>` zetten; het access-token blijft aan de Rust-kant (de webview
/// kan het geauthenticeerde logo-endpoint zelf niet bereiken). Sluit het
/// binaire gat in de generieke `accounts_fetch` (die tekst teruggeeft).
#[tauri::command]
pub async fn accounts_brand_logo() -> Result<Option<String>, String> {
    let cfg = load_config();
    let client = reqwest::Client::new();
    let mut access = keyring_get("access_token").ok_or("niet ingelogd")?;
    for attempt in 0..2 {
        let url = format!("{}/me/brand/logo", cfg.accounts_api_url);
        let resp = client
            .get(&url)
            .bearer_auth(&access)
            .send()
            .await
            .map_err(|e| format!("Accounts API onbereikbaar ({url}): {e}"))?;
        let status = resp.status().as_u16();
        if status == 401 && attempt == 0 {
            access = refresh_tokens(&client, &cfg).await?;
            continue;
        }
        if status == 404 {
            return Ok(None); // geen logo ingesteld
        }
        if !(200..300).contains(&status) {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("logo ophalen mislukt ({status}): {text}"));
        }
        let mime = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/png")
            .to_string();
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("logo lezen mislukt: {e}"))?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(Some(format!("data:{mime};base64,{b64}")));
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyring_wint_geheugen_vangt_op() {
        assert_eq!(kies_token(Some("k".into()), Some("g".into())).as_deref(), Some("k"));
        assert_eq!(kies_token(None, Some("g".into())).as_deref(), Some("g"));
        assert_eq!(kies_token(None, None), None);
    }

    // Op Linux heeft de keyring-crate hier geen echte opslag (alleen de
    // Windows-backend staat aan): precies de situatie zonder keyring.
    #[cfg(target_os = "linux")]
    #[test]
    fn zonder_keyring_blijft_het_token_voor_deze_sessie() {
        let user = format!("test-token-{}", std::process::id());
        assert_eq!(keyring_get(&user), None);
        keyring_set(&user, "waarde").expect("opslaan mislukt nooit");
        assert_eq!(keyring_get(&user).as_deref(), Some("waarde"));
        keyring_delete(&user);
        assert_eq!(keyring_get(&user), None);
    }
}
