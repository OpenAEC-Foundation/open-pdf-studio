use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
#[ignore] // requires built pdfium-worker.exe + a test PDF
fn render_via_worker_subprocess_matches_in_proc() {
    // 1. Spawn the worker binary
    let mut child = Command::new(env!("CARGO_BIN_EXE_pdfium-worker"))
        .arg("99") // slot 99 — separate SHM file from real workers
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn worker");

    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);

    // 2. Read ready line
    let mut ready_line = String::new();
    reader.read_line(&mut ready_line).expect("read ready");
    assert!(ready_line.contains("\"op\":\"ready\""));

    // 3. Send a render request — use a known test PDF
    let req = r#"{"op":"render","id":1,"path":"C:/Users/rickd/Documents/GitHub/open-pdf-studio/fixtures/pdf/Tekst.pdf","page_index":0,"scale":1.0,"rotation":0}"#;
    writeln!(stdin, "{}", req).expect("write request");

    // 4. Read response
    let mut resp_line = String::new();
    reader.read_line(&mut resp_line).expect("read response");
    assert!(resp_line.contains("\"ok\":true"), "response was: {}", resp_line);
    assert!(resp_line.contains("\"w\":"));
    assert!(resp_line.contains("\"shm_bytes\":"));

    // 5. Send shutdown
    writeln!(stdin, "{}", r#"{"op":"shutdown"}"#).expect("write shutdown");
    drop(stdin);

    // 6. Wait for clean exit
    let status = child.wait().expect("wait worker");
    assert!(status.success(), "worker exited with {}", status);
}
