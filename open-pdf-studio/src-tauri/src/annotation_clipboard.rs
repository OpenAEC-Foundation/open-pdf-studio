//! Session-only clipboard broker inherited by detached app processes (#1274).
//! Loopback + random capability token; no clipboard/document files on disk.
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{Arc, Mutex},
    time::Duration,
};
const MAX_BYTES: usize = 64 * 1024 * 1024;
#[derive(Clone)]
pub struct Broker {
    pub address: SocketAddr,
    token: String,
}
fn read(stream: &mut TcpStream) -> Result<Value, String> {
    let mut size = [0; 4];
    stream
        .read_exact(&mut size)
        .map_err(|_| "clipboard frame unavailable")?;
    let size = u32::from_be_bytes(size) as usize;
    if size > MAX_BYTES {
        return Err("clipboard payload exceeds 64 MiB".into());
    }
    let mut bytes = vec![0; size];
    stream
        .read_exact(&mut bytes)
        .map_err(|_| "clipboard frame incomplete")?;
    serde_json::from_slice(&bytes).map_err(|_| "invalid clipboard JSON".into())
}
fn write(stream: &mut TcpStream, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "clipboard serialization failed")?;
    if bytes.len() > MAX_BYTES {
        return Err("clipboard payload exceeds 64 MiB".into());
    }
    stream
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .and_then(|_| stream.write_all(&bytes))
        .map_err(|_| "clipboard write failed".into())
}
fn valid(p: &Value) -> bool {
    p["version"] == 1
        && p["kind"] == "copy"
        && p["at"].as_f64().map(|x| x.is_finite()).unwrap_or(false)
        && p["id"].as_str().is_some()
        && p["annotations"]
            .as_array()
            .map(|a| !a.is_empty() && a.iter().all(|v| v["type"].is_string()))
            .unwrap_or(false)
}
fn newer(a: &Value, b: &Value) -> bool {
    let aa = a["at"].as_f64().unwrap_or(0.0);
    let bb = b["at"].as_f64().unwrap_or(0.0);
    aa > bb || (aa == bb && a["id"].as_str() > b["id"].as_str())
}
fn serve(listener: TcpListener, token: String) {
    let latest: Arc<Mutex<Option<Value>>> = Arc::new(Mutex::new(None));
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let token = token.clone();
            let latest = latest.clone();
            std::thread::spawn(move || {
                let mut stream = stream;
                let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                let response = (|| -> Result<Value, String> {
                    let request = read(&mut stream)?;
                    if request["token"].as_str() != Some(token.as_str()) {
                        return Err("clipboard authentication failed".into());
                    }
                    let mut guard = latest.lock().map_err(|_| "clipboard unavailable")?;
                    let candidate = &request["candidate"];
                    if !candidate.is_null() {
                        if !valid(candidate) {
                            return Err("invalid annotation clipboard".into());
                        }
                        if guard.as_ref().map(|p| newer(candidate, p)).unwrap_or(true) {
                            *guard = Some(candidate.clone());
                        }
                    }
                    let changed = guard.as_ref().filter(|p| p["id"] != request["known"]);
                    Ok(json!({"latest":changed,"empty":guard.is_none()}))
                })()
                .unwrap_or_else(|error| json!({"error":error}));
                let _ = write(&mut stream, &response);
            });
        }
    });
}
impl Broker {
    pub fn capability(&self) -> &str {
        &self.token
    }
    pub fn start(token: String) -> Result<Self, String> {
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|_| "clipboard broker bind failed")?;
        let address = listener
            .local_addr()
            .map_err(|_| "clipboard broker address unavailable")?;
        serve(listener, token.clone());
        Ok(Self { address, token })
    }
    pub fn inherited(address: &str, token: String) -> Result<Self, String> {
        let address: SocketAddr = address.parse().map_err(|_| "invalid clipboard address")?;
        if !address.ip().is_loopback() || token.len() != 64 {
            return Err("invalid clipboard capability".into());
        }
        Ok(Self { address, token })
    }
    pub fn exchange(
        &self,
        candidate: Option<Value>,
        known: Option<String>,
    ) -> Result<Value, String> {
        // If the process hosting the broker closed, another member takes over
        // the same inherited endpoint. Clients reseed it from their memory copy.
        let mut stream = match TcpStream::connect_timeout(&self.address, Duration::from_secs(1)) {
            Ok(s) => s,
            Err(_) => {
                if let Ok(listener) = TcpListener::bind(self.address) {
                    serve(listener, self.token.clone());
                }
                TcpStream::connect_timeout(&self.address, Duration::from_secs(1))
                    .map_err(|_| "clipboard broker unavailable")?
            }
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
        write(
            &mut stream,
            &json!({"token":self.token,"candidate":candidate,"known":known}),
        )?;
        let response = read(&mut stream)?;
        if let Some(error) = response["error"].as_str() {
            return Err(error.to_owned());
        }
        Ok(response)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn packet(at: u32, id: &str) -> Value {
        json!({"version":1,"kind":"copy","at":at,"id":id,"annotations":[{"type":"line","startX":12}]})
    }
    #[test]
    fn independent_clients_share_latest_without_echo_or_stale_overwrite() {
        let a = Broker::start("a".repeat(64)).unwrap();
        let b = Broker::inherited(&a.address.to_string(), "a".repeat(64)).unwrap();
        a.exchange(Some(packet(2, "new")), None).unwrap();
        assert_eq!(b.exchange(None, None).unwrap()["latest"], packet(2, "new"));
        assert!(b
            .exchange(Some(packet(1, "old")), Some("new".into()))
            .unwrap()["latest"]
            .is_null());
    }
    #[test]
    fn rejects_invalid_data_tokens_and_non_loopback() {
        let a = Broker::start("a".repeat(64)).unwrap();
        let bad = Broker::inherited(&a.address.to_string(), "b".repeat(64)).unwrap();
        assert!(bad.exchange(None, None).is_err());
        assert!(a.exchange(Some(json!({"bad":true})), None).is_err());
        assert!(Broker::inherited("192.0.2.1:1234", "a".repeat(64)).is_err());
    }
    #[test]
    fn takeover_of_closed_endpoint_starts_empty_for_client_reseed() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        let b = Broker::inherited(&addr.to_string(), "a".repeat(64)).unwrap();
        assert_eq!(b.exchange(None, None).unwrap()["empty"], true);
        assert_eq!(
            b.exchange(Some(packet(3, "restored")), None).unwrap()["latest"],
            packet(3, "restored")
        );
    }
    #[test]
    fn separate_process_client() {
        if let Ok(addr) = std::env::var("OPDS_CLIPBOARD_TEST_ADDR") {
            let b = Broker::inherited(&addr, "c".repeat(64)).unwrap();
            assert_eq!(
                b.exchange(None, None).unwrap()["latest"],
                packet(5, "parent")
            );
            b.exchange(Some(packet(6, "child")), None).unwrap();
            return;
        }
        let b = Broker::start("c".repeat(64)).unwrap();
        b.exchange(Some(packet(5, "parent")), None).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "annotation_clipboard::tests::separate_process_client",
                "--exact",
            ])
            .env("OPDS_CLIPBOARD_TEST_ADDR", b.address.to_string())
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(
            b.exchange(None, None).unwrap()["latest"],
            packet(6, "child")
        );
    }
}
