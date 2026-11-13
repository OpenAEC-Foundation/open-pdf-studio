//! Central review HTTP transport (#1067). Tokens stay in native process memory.
//! A session fixes one origin; callers select typed operations, never arbitrary URLs.
use reqwest::{redirect::Policy, Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const MAX_JSON: usize = 8 * 1024 * 1024;
const MAX_WRITE: usize = 1024 * 1024;
const MAX_PDF: usize = 32 * 1024 * 1024;

struct Session {
    origin: Url,
    client: Client,
    token: String,
    active: AtomicBool,
    _slot: OwnedSemaphorePermit,
}

pub struct Transport {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    sequence: AtomicU64,
    slots: Arc<Semaphore>,
    requests: Semaphore,
}

impl Default for Transport {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(1),
            slots: Arc::new(Semaphore::new(8)),
            requests: Semaphore::new(8),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Documents {
        after: Option<String>,
        limit: u16,
    },
    MemberByName {
        document: String,
        name: String,
        role: Option<String>,
    },
    CreateDocument {
        title: String,
    },
    Snapshot {
        document: String,
    },
    Events {
        document: String,
        after: u64,
        limit: u16,
        wait: u8,
    },
    Append {
        document: String,
        event: Value,
    },
    Members {
        document: String,
        #[serde(rename = "userId")]
        user_id: String,
        role: Option<String>,
    },
}

#[derive(Serialize, Debug)]
pub struct JsonReply {
    pub status: u16,
    pub body: Value,
}

fn origin(value: &str) -> Result<Url, String> {
    if value.len() > 2048 {
        return Err("INVALID_SERVER".into());
    }
    let url = Url::parse(value).map_err(|_| "INVALID_SERVER")?;
    // Only literal loopback addresses may use plaintext, not a DNS name that
    // could resolve elsewhere. HTTPS retains normal certificate validation.
    let local = url
        .host_str()
        .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    if !matches!(url.scheme(), "https" | "http")
        || (url.scheme() == "http" && !local)
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port() == Some(0)
    {
        return Err("INVALID_SERVER".into());
    }
    Ok(url)
}

fn id(value: &str) -> Result<&str, String> {
    if value.len() == 32
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        Ok(value)
    } else {
        Err("INVALID_DOCUMENT".into())
    }
}

fn route(op: Operation) -> Result<(Method, String, Option<Value>), String> {
    Ok(match op {
        Operation::Documents { after, limit } => {
            if !(1..=100).contains(&limit) {
                return Err("INVALID_CURSOR".into());
            }
            let cursor = match after {
                Some(value) => format!("&after={}", id(&value)?),
                None => String::new(),
            };
            (
                Method::GET,
                format!("v1/documents?limit={limit}{cursor}"),
                None,
            )
        }
        Operation::MemberByName {
            document,
            name,
            role,
        } => {
            if name.is_empty() || name.len() > 512 {
                return Err("INVALID_NAME".into());
            }
            if role
                .as_deref()
                .is_some_and(|r| r != "reader" && r != "editor")
            {
                return Err("INVALID_ROLE".into());
            }
            (
                Method::POST,
                format!("v1/documents/{}/members-by-name", id(&document)?),
                Some(json!({"name": name, "role": role})),
            )
        }
        Operation::CreateDocument { title } => (
            Method::POST,
            "v1/documents".into(),
            Some(json!({"title": title})),
        ),
        Operation::Snapshot { document } => (
            Method::GET,
            format!("v1/documents/{}", id(&document)?),
            None,
        ),
        Operation::Events {
            document,
            after,
            limit,
            wait,
        } => {
            if !(1..=100).contains(&limit) || wait > 25 || after > 9_007_199_254_740_991 {
                return Err("INVALID_CURSOR".into());
            }
            (
                Method::GET,
                format!(
                    "v1/documents/{}/events?after={after}&limit={limit}&wait={wait}",
                    id(&document)?
                ),
                None,
            )
        }
        Operation::Append { document, event } => (
            Method::POST,
            format!("v1/documents/{}/events", id(&document)?),
            Some(event),
        ),
        Operation::Members {
            document,
            user_id,
            role,
        } => {
            id(&user_id)?;
            if role
                .as_deref()
                .is_some_and(|r| r != "reader" && r != "editor")
            {
                return Err("INVALID_ROLE".into());
            }
            (
                Method::POST,
                format!("v1/documents/{}/members", id(&document)?),
                Some(json!({"userId": user_id, "role": role})),
            )
        }
    })
}

fn json_bytes(value: Value) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(&value).map_err(|_| "INVALID_JSON")?;
    if bytes.len() > MAX_WRITE {
        return Err("REQUEST_TOO_LARGE".into());
    }
    Ok(bytes)
}

async fn receive(
    mut response: reqwest::Response,
    max: usize,
    mime: &str,
) -> Result<(u16, Vec<u8>), String> {
    if response.status().is_redirection() {
        return Err("REDIRECT_REFUSED".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > max as u64)
    {
        return Err("RESPONSE_TOO_LARGE".into());
    }
    if response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.split(';').next())
        .map(str::trim)
        != Some(mime)
    {
        return Err("INVALID_RESPONSE".into());
    }
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "NETWORK_ERROR")? {
        if chunk.len() > max.saturating_sub(bytes.len()) {
            return Err("RESPONSE_TOO_LARGE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((status, bytes))
}

impl Transport {
    fn session(&self, handle: &str) -> Result<Arc<Session>, String> {
        self.sessions
            .lock()
            .map_err(|_| "SESSION_ERROR")?
            .get(handle)
            .cloned()
            .ok_or("SESSION_CLOSED".into())
    }

    pub async fn login(
        &self,
        server: &str,
        name: String,
        password: String,
    ) -> Result<String, String> {
        let base = origin(server)?;
        if name.len() > 512 || password.len() > 4096 {
            return Err("INVALID_LOGIN".into());
        }
        let slot = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| "SESSION_LIMIT")?;
        let _request = self.requests.try_acquire().map_err(|_| "BUSY")?;
        let client = Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(35))
            .build()
            .map_err(|_| "NETWORK_ERROR")?;
        let response = client
            .post(base.join("v1/login").map_err(|_| "INVALID_SERVER")?)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(json_bytes(json!({"name": name, "password": password}))?)
            .send()
            .await
            .map_err(|_| "NETWORK_ERROR")?;
        let (status, bytes) = receive(response, 4096, "application/json").await?;
        if status != 200 {
            return Err(match status {
                401 => "AUTHENTICATION_FAILED",
                429 => "RATE_LIMITED",
                _ => "SERVER_ERROR",
            }
            .into());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "INVALID_RESPONSE")?;
        let token = value
            .get("token")
            .and_then(Value::as_str)
            .filter(|v| {
                v.len() == 43
                    && v.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            })
            .ok_or("INVALID_RESPONSE")?
            .to_string();
        let handle = format!("central-{}", self.sequence.fetch_add(1, Ordering::Relaxed));
        self.sessions.lock().map_err(|_| "SESSION_ERROR")?.insert(
            handle.clone(),
            Arc::new(Session {
                origin: base,
                client,
                token,
                active: AtomicBool::new(true),
                _slot: slot,
            }),
        );
        Ok(handle)
    }

    async fn send(
        &self,
        session: &Session,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
        mime: &str,
    ) -> Result<reqwest::Response, String> {
        if !session.active.load(Ordering::Acquire) {
            return Err("SESSION_CLOSED".into());
        }
        let mut request = session
            .client
            .request(
                method,
                session.origin.join(path).map_err(|_| "INVALID_REQUEST")?,
            )
            .bearer_auth(&session.token);
        if let Some(body) = body {
            request = request
                .header(reqwest::header::CONTENT_TYPE, mime)
                .body(body);
        }
        request.send().await.map_err(|_| "NETWORK_ERROR".into())
    }

    pub async fn json(&self, handle: &str, op: Operation) -> Result<JsonReply, String> {
        let session = self.session(handle)?;
        let (method, path, body) = route(op)?;
        let bytes = body.map(json_bytes).transpose()?;
        let _request = self.requests.try_acquire().map_err(|_| "BUSY")?;
        let result = async {
            let response = self
                .send(&session, method, &path, bytes, "application/json")
                .await?;
            let (status, bytes) = receive(response, MAX_JSON, "application/json").await?;
            let body = serde_json::from_slice(&bytes).map_err(|_| "INVALID_RESPONSE")?;
            Ok(JsonReply { status, body })
        }
        .await;
        if !session.active.load(Ordering::Acquire) {
            return Err("SESSION_CLOSED".into());
        }
        result
    }

    pub async fn upload(
        &self,
        handle: &str,
        document: &str,
        bytes: Vec<u8>,
    ) -> Result<JsonReply, String> {
        if bytes.len() > MAX_PDF || !bytes.starts_with(b"%PDF-") {
            return Err("INVALID_PDF".into());
        }
        let session = self.session(handle)?;
        let path = format!("v1/documents/{}/pdf", id(document)?);
        let _request = self.requests.try_acquire().map_err(|_| "BUSY")?;
        let result = async {
            let response = self
                .send(&session, Method::PUT, &path, Some(bytes), "application/pdf")
                .await?;
            let (status, bytes) = receive(response, 4096, "application/json").await?;
            Ok(JsonReply {
                status,
                body: serde_json::from_slice(&bytes).map_err(|_| "INVALID_RESPONSE")?,
            })
        }
        .await;
        if !session.active.load(Ordering::Acquire) {
            return Err("SESSION_CLOSED".into());
        }
        result
    }

    pub async fn download(&self, handle: &str, document: &str) -> Result<Vec<u8>, String> {
        let session = self.session(handle)?;
        let path = format!("v1/documents/{}/pdf", id(document)?);
        let _request = self.requests.try_acquire().map_err(|_| "BUSY")?;
        let result = async {
            let response = self
                .send(&session, Method::GET, &path, None, "application/pdf")
                .await?;
            if response.status().as_u16() != 200 {
                return Err("PDF_UNAVAILABLE".into());
            }
            let (_, bytes) = receive(response, MAX_PDF, "application/pdf").await?;
            if !bytes.starts_with(b"%PDF-") {
                return Err("INVALID_PDF".into());
            }
            Ok(bytes)
        }
        .await;
        if !session.active.load(Ordering::Acquire) {
            return Err("SESSION_CLOSED".into());
        }
        result
    }

    pub async fn logout(&self, handle: &str) -> Result<(), String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "SESSION_ERROR")?
            .remove(handle);
        let Some(session) = session else {
            return Ok(());
        };
        // Locally invalidate before network I/O, including in-flight replies.
        session.active.store(false, Ordering::Release);
        let _request = self
            .requests
            .try_acquire()
            .map_err(|_| "LOGOUT_UNCONFIRMED")?;
        let response = session
            .client
            .post(
                session
                    .origin
                    .join("v1/logout")
                    .map_err(|_| "INVALID_SERVER")?,
            )
            .bearer_auth(&session.token)
            .json(&json!({}))
            .send()
            .await
            .map_err(|_| "LOGOUT_UNCONFIRMED")?;
        if response.status().as_u16() != 200 {
            return Err("LOGOUT_UNCONFIRMED".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        thread,
    };
    const TOKEN: &str = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    const DOC: &str = "0123456789abcdef0123456789abcdef";

    fn read(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut buffer = [0; 1024];
            let n = stream.read(&mut buffer).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&buffer[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length: "))
                    .map(|v| v.parse::<usize>().unwrap())
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        String::from_utf8(bytes).unwrap()
    }
    fn accept(listener: &TcpListener) -> TcpStream {
        let start = std::time::Instant::now();
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    // macOS inherits O_NONBLOCK from the listening socket;
                    // Linux does not. The scripted peer uses blocking I/O.
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_write_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    return stream;
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        && start.elapsed() < Duration::from_secs(3) =>
                {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(e) => panic!("test server accept: {e}"),
            }
        }
    }
    fn reply(status: u16, body: &str) -> String {
        format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }
    fn login_reply() -> String {
        reply(200, &format!("{{\"token\":\"{TOKEN}\"}}"))
    }
    fn scripted(replies: Vec<String>) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            replies
                .into_iter()
                .map(|response| {
                    let mut stream = accept(&listener);
                    let request = read(&mut stream);
                    stream.write_all(response.as_bytes()).unwrap();
                    request
                })
                .collect()
        });
        (url, handle)
    }
    async fn login(transport: &Transport, url: &str) -> String {
        transport
            .login(url, "Alice".into(), "test password".into())
            .await
            .unwrap()
    }

    #[test]
    fn command_futures_can_run_on_tauri_executor() {
        fn assert_send<T: Send>(_: T) {}
        let transport = Transport::default();
        assert_send(transport.login("https://example.test", "name".into(), "password".into()));
        assert_send(transport.json(
            "session",
            Operation::Snapshot {
                document: DOC.into(),
            },
        ));
        assert_send(transport.upload("session", DOC, vec![]));
        assert_send(transport.download("session", DOC));
        assert_send(transport.logout("session"));
    }

    #[test]
    fn origin_requires_https_or_literal_loopback_and_no_credentials_or_path() {
        for bad in [
            "http://example.com",
            "http://localhost",
            "http://127.0.0.1.evil.test",
            "file:///tmp/a",
            "https://a.test/x",
            "https://user:secret@a.test",
            "https://a.test/?token=x",
            "https://a.test/#x",
            "http://127.0.0.1:0",
            "not a URL",
        ] {
            assert!(origin(bad).is_err(), "{bad}");
        }
        for good in [
            "https://a.test",
            "https://a.test:8443/",
            "http://127.0.0.1:1234",
            "http://[::1]:1234",
        ] {
            assert!(origin(good).is_ok(), "{good}");
        }
    }

    #[test]
    fn discovery_routes_keep_cursors_typed_and_names_in_json() {
        let (method, path, body) = route(Operation::Documents {
            after: Some(DOC.into()),
            limit: 1,
        })
        .unwrap();
        assert_eq!(method, Method::GET);
        assert_eq!(path, format!("v1/documents?limit=1&after={DOC}"));
        assert!(body.is_none());
        for after in ["", "../secret", "a&token=secret"] {
            assert!(route(Operation::Documents {
                after: Some(after.into()),
                limit: 1
            })
            .is_err());
        }
        for limit in [0, 101] {
            assert!(route(Operation::Documents { after: None, limit }).is_err());
        }
        let (method, path, body) = route(Operation::MemberByName {
            document: DOC.into(),
            name: "Élodie?x=1".into(),
            role: Some("reader".into()),
        })
        .unwrap();
        assert_eq!(method, Method::POST);
        assert_eq!(path, format!("v1/documents/{DOC}/members-by-name"));
        assert_eq!(body.unwrap()["name"], "Élodie?x=1");
        assert!(serde_json::from_value::<Operation>(
            json!({"action":"documents","after":0,"limit":1})
        )
        .is_err());
    }

    #[test]
    fn typed_routes_reject_escape_paths_and_invalid_poll_limits() {
        for bad in [
            "../secret",
            "https://evil.test",
            "a?token=secret",
            "A123456789abcdef0123456789abcdef",
        ] {
            assert!(route(Operation::Snapshot {
                document: bad.into()
            })
            .is_err());
        }
        for (after, limit, wait) in [(0, 0, 0), (0, 101, 0), (0, 1, 26), (u64::MAX, 1, 0)] {
            assert!(route(Operation::Events {
                document: DOC.into(),
                after,
                limit,
                wait
            })
            .is_err());
        }
        assert!(serde_json::from_value::<Operation>(
            json!({"action":"snapshot","document":DOC,"url":"https://evil.test"})
        )
        .is_err());
        assert!(route(Operation::Events {
            document: DOC.into(),
            after: 1,
            limit: 1,
            wait: 25
        })
        .is_ok());
    }

    #[tokio::test]
    async fn token_is_native_and_conflict_response_reaches_client() {
        let (url, server) = scripted(vec![
            login_reply(),
            reply(409, "{\"current\":\"e1\"}"),
            reply(200, "{}"),
        ]);
        let transport = Transport::default();
        let handle = login(&transport, &url).await;
        assert!(!handle.contains(TOKEN));
        let result = transport
            .json(
                &handle,
                Operation::Append {
                    document: DOC.into(),
                    event: json!({"id":"e2"}),
                },
            )
            .await
            .unwrap();
        assert_eq!(result.status, 409);
        assert_eq!(result.body["current"], "e1");
        transport.logout(&handle).await.unwrap();
        assert_eq!(
            transport
                .json(
                    &handle,
                    Operation::Snapshot {
                        document: DOC.into()
                    }
                )
                .await
                .unwrap_err(),
            "SESSION_CLOSED"
        );
        let requests = server.join().unwrap();
        assert!(requests[1].starts_with(&format!("POST /v1/documents/{DOC}/events ")));
        assert!(requests[1].contains(&format!("Bearer {TOKEN}")));
        assert!(!requests[1].contains("test password"));
    }

    #[tokio::test]
    async fn redirects_and_oversized_login_are_refused() {
        for (response, expected) in [
            ("HTTP/1.1 307 Redirect\r\nLocation: http://127.0.0.1:9/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(), "REDIRECT_REFUSED"),
            ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4097\r\nConnection: close\r\n\r\n".into(), "RESPONSE_TOO_LARGE"),
            (reply(200, "{\"token\":\"bad\\r\\nheader\"}"), "INVALID_RESPONSE"),
        ] {
            let (url, server) = scripted(vec![response]);
            let error = Transport::default().login(&url,"Alice".into(),"secret".into()).await.unwrap_err();
            assert_eq!(error,expected);server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn large_writes_are_rejected_before_network_and_failed_logout_still_closes() {
        let (url, server) = scripted(vec![login_reply()]);
        let transport = Transport::default();
        let handle = login(&transport, &url).await;
        server.join().unwrap();
        assert_eq!(
            transport
                .json(
                    &handle,
                    Operation::Append {
                        document: DOC.into(),
                        event: json!({"text":"x".repeat(MAX_WRITE)})
                    }
                )
                .await
                .unwrap_err(),
            "REQUEST_TOO_LARGE"
        );
        assert_eq!(
            transport
                .upload(&handle, DOC, vec![0; MAX_PDF + 1])
                .await
                .unwrap_err(),
            "INVALID_PDF"
        );
        assert_eq!(
            transport.logout(&handle).await.unwrap_err(),
            "LOGOUT_UNCONFIRMED"
        );
        assert!(transport.session(&handle).is_err());
    }

    #[tokio::test]
    async fn response_stream_is_bounded_without_content_length() {
        let body = "x".repeat(MAX_JSON + 1);
        let huge = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}"
        );
        let (url, server) = scripted(vec![login_reply(), huge]);
        let transport = Transport::default();
        let handle = login(&transport, &url).await;
        assert_eq!(
            transport
                .json(
                    &handle,
                    Operation::Snapshot {
                        document: DOC.into()
                    }
                )
                .await
                .unwrap_err(),
            "RESPONSE_TOO_LARGE"
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn logout_discards_an_in_flight_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (ready, started) = std::sync::mpsc::channel();
        let server = thread::spawn(move || {
            let mut first = accept(&listener);
            read(&mut first);
            first.write_all(login_reply().as_bytes()).unwrap();
            drop(first);
            let mut pending = accept(&listener);
            read(&mut pending);
            ready.send(()).unwrap();
            let mut logout = accept(&listener);
            read(&mut logout);
            logout.write_all(reply(200, "{}").as_bytes()).unwrap();
            drop(logout);
            pending
                .write_all(reply(200, "{\"private\":true}").as_bytes())
                .unwrap();
        });
        let transport = Arc::new(Transport::default());
        let handle = login(&transport, &url).await;
        let other = transport.clone();
        let copied = handle.clone();
        let pending = tokio::spawn(async move {
            other
                .json(
                    &copied,
                    Operation::Snapshot {
                        document: DOC.into(),
                    },
                )
                .await
        });
        let start = std::time::Instant::now();
        while started.try_recv().is_err() {
            assert!(start.elapsed() < Duration::from_secs(3));
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        transport.logout(&handle).await.unwrap();
        assert_eq!(pending.await.unwrap().unwrap_err(), "SESSION_CLOSED");
        server.join().unwrap();
    }
}
