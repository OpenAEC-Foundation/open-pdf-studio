//! Bound a worker exchange without retrying exhausted work in the GUI process.
use anyhow::{anyhow, Result};
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt};

pub const MAX_RESPONSE_BYTES: u64 = 16 * 1024;

#[derive(Debug)]
pub struct ResourceLimit(pub &'static str);
impl std::fmt::Display for ResourceLimit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(self.0) }
}
impl std::error::Error for ResourceLimit {}

pub fn is_resource_limit(error: &anyhow::Error) -> bool {
    error.downcast_ref::<ResourceLimit>().is_some()
}

/// The worker answered the request with `ok: false` (output budget, unreadable
/// page, ...). The exchange itself went fine: the worker is healthy and its
/// pipes are in step, so it must not be restarted for this.
#[derive(Debug)]
pub struct WorkerReported(pub String);
impl std::fmt::Display for WorkerReported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.0) }
}
impl std::error::Error for WorkerReported {}

pub fn is_worker_reported(error: &anyhow::Error) -> bool {
    error.downcast_ref::<WorkerReported>().is_some()
}

/// Must a failed exchange restart the worker? Not when it is gone already
/// (Unavailable) and not when it answered with an error of its own.
pub fn needs_recovery(error: &anyhow::Error) -> bool {
    !is_unavailable(error) && !is_worker_reported(error)
}

pub async fn read_response<R: AsyncBufRead + Unpin>(reader: &mut R, deadline: Duration) -> Result<String> {
    let mut bytes = Vec::new();
    let mut bounded = reader.take(MAX_RESPONSE_BYTES + 1);
    tokio::time::timeout(deadline, bounded.read_until(b'\n', &mut bytes)).await
        .map_err(|_| ResourceLimit("PDF_RENDER_TIMEOUT"))??;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(ResourceLimit("PDF_WORKER_RESPONSE_LIMIT").into());
    }
    if bytes.is_empty() { return Err(anyhow!("worker EOF")); }
    if !bytes.ends_with(b"\n") { return Err(anyhow!("worker truncated response EOF")); }
    Ok(String::from_utf8(bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncWriteExt, BufReader};
    #[tokio::test]
    async fn timed_out_read_is_a_resource_limit_even_with_context() {
        let (_writer, reader) = tokio::io::duplex(64);
        let error = read_response(&mut BufReader::new(reader), Duration::from_millis(10)).await.unwrap_err();
        assert!(is_resource_limit(&error.context("render")));
    }
    #[tokio::test]
    async fn oversized_and_truncated_responses_never_become_success() {
        let data = vec![b'x'; MAX_RESPONSE_BYTES as usize + 1];
        let error = read_response(&mut &data[..], Duration::from_secs(1)).await.unwrap_err();
        assert!(is_resource_limit(&error));
        assert!(read_response(&mut &b"{\"ok\":true}"[..], Duration::from_secs(1)).await.is_err());
    }
    #[test]
    fn reported_errors_keep_the_worker_and_broken_exchanges_restart_it() {
        let reported: anyhow::Error = WorkerReported("worker 0 render error: PDF_OUTPUT_LIMIT: bitmap exceeds the caller's RGBA budget".into()).into();
        assert!(!needs_recovery(&reported));
        assert!(reported.to_string().contains("PDF_OUTPUT_LIMIT"), "message unchanged for the callers");
        assert!(!needs_recovery(&reported.context("render")));
        assert!(!needs_recovery(&Unavailable.into()));
        assert!(needs_recovery(&anyhow!("worker EOF")));
        assert!(needs_recovery(&ResourceLimit("PDF_RENDER_TIMEOUT").into()));
    }
    #[tokio::test]
    async fn one_read_does_not_consume_the_next_response() {
        let (mut writer, reader) = tokio::io::duplex(64);
        writer.write_all(b"first\nsecond\n").await.unwrap();
        let mut reader = BufReader::new(reader);
        assert_eq!(read_response(&mut reader, Duration::from_secs(1)).await.unwrap(), "first\n");
        assert_eq!(read_response(&mut reader, Duration::from_secs(1)).await.unwrap(), "second\n");
    }
}

/// A queued request must not tear down a replacement for the worker it lost.
#[derive(Debug)]
pub struct Unavailable;
impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("PDF_WORKER_UNAVAILABLE EOF") }
}
impl std::error::Error for Unavailable {}
pub fn is_unavailable(error: &anyhow::Error) -> bool { error.downcast_ref::<Unavailable>().is_some() }
