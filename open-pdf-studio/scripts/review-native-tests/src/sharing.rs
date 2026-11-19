//! Windows sharing semantics of the files the app touches in a synchronised
//! folder (#1115): what a second party (a cloud sync client, a viewer, a
//! virus scanner) can and cannot do while the app holds a file the way the
//! production code opens it, and the other way round.
//!
//! Sharing is checked per handle, not per process, so a second handle in this
//! test process behaves like a handle of another program.
//!
//! `cargo test -- --nocapture sharing` prints the measured tables.
use crate::{atomic_file, bestand_openen};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const SHARE_READ: u32 = 1;
const SHARE_WRITE: u32 = 2;
const SHARE_DELETE: u32 = 4;
const GENERIC_READ: u32 = 0x8000_0000;
const DELETE: u32 = 0x0001_0000;
const FILE_WRITE_ATTRIBUTES: u32 = 0x100;
const MOVEFILE_REPLACE_EXISTING: u32 = 1;

extern "system" {
    fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    fn ReplaceFileW(replaced: *const u16, replacement: *const u16, backup: *const u16, flags: u32, exclude: *mut u8, reserved: *mut u8) -> i32;
}

fn wide(p: &Path) -> Vec<u16> {
    p.as_os_str().encode_wide().chain(Some(0)).collect()
}

static N: AtomicU64 = AtomicU64::new(0);

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("opds-sharing-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn open_read(p: &Path, share: u32) -> io::Result<File> {
    OpenOptions::new().read(true).share_mode(share).open(p)
}

fn read_all(p: &Path, share: u32) -> io::Result<()> {
    let mut f = open_read(p, share)?;
    let mut v = Vec::new();
    f.read_to_end(&mut v).map(|_| ())
}

/// What a second party tries on a file somebody holds.
const OPERATIONS: &[(&str, fn(&Path) -> io::Result<()>)] = &[
    ("read, sharing read+write+delete", |p| read_all(p, SHARE_READ | SHARE_WRITE | SHARE_DELETE)),
    ("read, sharing read+write", |p| read_all(p, SHARE_READ | SHARE_WRITE)),
    ("read, sharing read", |p| read_all(p, SHARE_READ)),
    ("read, sharing nothing", |p| read_all(p, 0)),
    ("read attributes", |p| fs::metadata(p).map(|_| ())),
    ("set modified time", |p| {
        let f = OpenOptions::new().access_mode(FILE_WRITE_ATTRIBUTES).share_mode(7).open(p)?;
        f.set_modified(std::time::SystemTime::now())
    }),
    ("list the folder", |p| fs::read_dir(p.parent().unwrap()).map(|d| { let _ = d.count(); })),
    ("open with delete access", |p| {
        OpenOptions::new().access_mode(GENERIC_READ | DELETE).share_mode(7).open(p).map(|_| ())
    }),
    ("open for writing", |p| OpenOptions::new().write(true).share_mode(7).open(p).map(|_| ())),
    ("rename away", |p| fs::rename(p, p.with_extension("moved"))),
    ("delete", |p| fs::remove_file(p)),
    ("replace by rename (plain)", |p| {
        let other = p.with_extension("incoming");
        fs::write(&other, b"newer")?;
        // The classic rename: no POSIX semantics.
        if unsafe { MoveFileExW(wide(&other).as_ptr(), wide(p).as_ptr(), MOVEFILE_REPLACE_EXISTING) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }),
    ("replace by rename (std)", |p| {
        let other = p.with_extension("incoming");
        fs::write(&other, b"newer")?;
        fs::rename(&other, p)
    }),
    ("replace (ReplaceFile)", |p| {
        let other = p.with_extension("incoming");
        fs::write(&other, b"newer")?;
        let ok = unsafe { ReplaceFileW(wide(p).as_ptr(), wide(&other).as_ptr(), std::ptr::null(), 0, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok == 0 { return Err(io::Error::last_os_error()); }
        Ok(())
    }),
];

/// How the app (or a candidate change) holds a file.
const HOLDERS: &[(&str, fn(&Path) -> io::Result<File>)] = &[
    ("document lock", |p| bestand_openen::vergrendel(&p.to_string_lossy())),
    ("read, sharing read+delete", |p| open_read(p, SHARE_READ | SHARE_DELETE)),
    ("reading (document, review file)", |p| bestand_openen::open_om_te_lezen(&p.to_string_lossy())),
    ("std write handle (staged file)", |p| OpenOptions::new().write(true).open(p)),
];

fn code(r: &io::Result<()>) -> String {
    match r {
        Ok(()) => "ok".into(),
        Err(e) => format!("os {}", e.raw_os_error().unwrap_or(-1)),
    }
}

fn measure(holder: fn(&Path) -> io::Result<File>, op: fn(&Path) -> io::Result<()>) -> String {
    let dir = TestDir::new();
    let path = dir.0.join("drawing.pdf");
    fs::write(&path, b"%PDF-1.7 original").unwrap();
    let held = holder(&path).unwrap();
    let r = op(&path);
    drop(held);
    code(&r)
}

fn table() -> Vec<(String, Vec<String>)> {
    OPERATIONS.iter().map(|(name, op)| {
        (name.to_string(), HOLDERS.iter().map(|(_, h)| measure(*h, *op)).collect())
    }).collect()
}

/// Measured on Windows 11 (NTFS). Columns: the document lock, the candidate
/// lock that also shares deleting, a read handle, a staged file being written.
const EXPECTED: &[(&str, [&str; 4])] = &[
    ("read, sharing read+write+delete", ["ok", "ok", "ok", "ok"]),
    ("read, sharing read+write", ["ok", "ok", "ok", "ok"]),
    ("read, sharing read", ["ok", "ok", "ok", "os 32"]),
    ("read, sharing nothing", ["os 32", "os 32", "os 32", "os 32"]),
    ("read attributes", ["ok", "ok", "ok", "ok"]),
    ("set modified time", ["ok", "ok", "ok", "ok"]),
    ("list the folder", ["ok", "ok", "ok", "ok"]),
    ("open with delete access", ["os 32", "ok", "ok", "ok"]),
    ("open for writing", ["os 32", "os 32", "ok", "ok"]),
    ("rename away", ["os 32", "ok", "ok", "ok"]),
    ("delete", ["os 32", "ok", "ok", "ok"]),
    ("replace by rename (plain)", ["os 5", "os 5", "os 5", "os 5"]),
    ("replace by rename (std)", ["os 5", "ok", "ok", "ok"]),
    ("replace (ReplaceFile)", ["os 32", "ok", "ok", "ok"]),
];

/// The document lock (#1115): a sync client can read and scan a locked PDF
/// (any open that shares reading), read and set its attributes and list the
/// folder. It cannot write, rename, delete or replace it: that is the
/// protection against two programs writing one PDF, and it also holds back a
/// newer copy that a sync client downloads while the document is open here.
/// The candidate that shares deleting would let that copy in, and with it any
/// other program that saves by replacing the file, unseen by the app.
#[test]
fn what_a_second_party_can_do_while_the_app_holds_a_file() {
    let rows = table();
    println!("\n{:<34} | {}", "second party", HOLDERS.iter().map(|(n, _)| format!("{n:<32}")).collect::<Vec<_>>().join(" | "));
    for (name, cells) in &rows {
        println!("{:<34} | {}", name, cells.iter().map(|c| format!("{c:<32}")).collect::<Vec<_>>().join(" | "));
    }
    assert_eq!(rows.len(), EXPECTED.len());
    for ((name, cells), (expected_name, expected)) in rows.iter().zip(EXPECTED) {
        assert_eq!(name, expected_name);
        assert_eq!(cells.iter().map(String::as_str).collect::<Vec<_>>(), expected.to_vec(), "{name}");
    }
}

/// How a second party holds a review file while the app reads or writes it:
/// the share mode, then what the read and the write give and the content after.
const OTHERS: &[(&str, u32, &str, &str, &str)] = &[
    ("read, sharing read+write+delete", SHARE_READ | SHARE_WRITE | SHARE_DELETE, "ok", "ok", "new\n"),
    ("read, sharing read+write", SHARE_READ | SHARE_WRITE, "ok", "os 5", "old\n"),
    ("read, sharing read", SHARE_READ, "ok", "os 5", "old\n"),
    ("read, sharing nothing", 0, "os 32", "os 5", "old\n"),
];

/// A review file another program keeps in use is never written in place: the
/// write reports it (after its waits) and leaves the file and the folder as
/// they were. The holder only delays it; see the tests in atomic_file.rs.
#[test]
fn what_the_app_can_do_while_a_second_party_holds_a_review_file() {
    println!();
    for (name, share, expected_read, expected_write, expected_content) in OTHERS {
        let dir = TestDir::new();
        let path = dir.0.join("drawing_Annotation_Alice.jsonl");
        fs::write(&path, b"old\n").unwrap();
        let held = open_read(&path, *share).unwrap();
        let read = fs::read(&path).map(|_| ());
        let write = atomic_file::write_shared(&path, b"new\n");
        assert_eq!(write.as_ref().err().map(|e| e.in_use), if *expected_write == "ok" { None } else { Some(true) }, "{name}");
        let write = write.map_err(|e| e.error);
        drop(held);
        let after = String::from_utf8(fs::read(&path).unwrap()).unwrap();
        let left = fs::read_dir(&dir.0).unwrap().count();
        println!("{:<34} | read {:<8} | write {:<8} | content {:?} | files {}", name, code(&read), code(&write), after, left);
        assert_eq!((code(&read).as_str(), code(&write).as_str(), after.as_str(), left), (*expected_read, *expected_write, *expected_content, 1), "{name}");
    }
}
