use anyhow::{bail, Result};
use flate2::read::GzDecoder;
use hex_literal::hex;
use serde::Deserialize;
use serde_json::Deserializer;
use sha2::{Digest, Sha256};
use tar::Archive;

use std::{
    ffi::OsString,
    fmt::Display,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    process::Command,
    str::FromStr,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Arch {
    Aarch64,
    X86_64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Target {
    Linux(Arch),
    MacOS(Arch),
    Windows(Arch),
}
impl Display for Target {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Target::Linux(_) => f.write_str("linux"),
            Target::MacOS(_) => f.write_str("macos"),
            Target::Windows(_) => f.write_str("windows"),
        }
    }
}

#[derive(Debug)]
struct WebFile<'a, F: Fn(File, PathBuf, Target) -> Result<()>> {
    name: &'a str,
    url: &'a str,
    sha256: [u8; 32],
    extract: F,
}

#[allow(unused)]
#[derive(Deserialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "reason")]
enum Record {
    #[serde(rename = "build-finished")]
    BuildFinished { success: bool },

    #[serde(rename = "compiler-artifact")]
    CompilerArtifact {
        #[serde(default)]
        executable: Option<String>,
    },

    // ignore everything else
    #[serde(other)]
    Other,
}

fn main() -> Result<()> {
    let root = PathBuf::from_str(
        &std::env::var("CARGO_WORKSPACE_DIR")
            .expect("Failed to fetch CARGO_WORKSPACE_DIR from env"),
    )
    .expect("Failed to parse CARGO_WORKSPACE_DIR as path")
    .join("target");

    let target_str = std::env::var("TARGET").expect("Failed to fetch TARGET from env");
    let target = match target_str.as_str() {
        "aarch64-unknown-linux-gnu" => Target::Linux(Arch::Aarch64),
        "aarch64-apple-darwin" => Target::MacOS(Arch::Aarch64),
        "aarch64-pc-windows-msvc" => Target::Windows(Arch::Aarch64),

        "x86_64-unknown-linux-gnu" => Target::Linux(Arch::X86_64),
        "x86_64-apple-darwin" => Target::MacOS(Arch::X86_64),
        "x86_64-pc-windows-msvc" => Target::Windows(Arch::X86_64),

        t => bail!("Platform {t} is unsupported."),
    };

    let binaries_path = root.join("runtime-deps");
    if !binaries_path.is_dir() {
        fs::create_dir(&binaries_path)?;
    }

    //
    // Build and copy pdfium-worker to binaries
    //
    let worker_build_path = build_worker(&root)?;

    let mut worker_bin_name = OsString::from(
        worker_build_path
            .file_name()
            .expect("Failed to parse pdfium-worker executable path as file"),
    );
    worker_bin_name.push(format!("-{target_str}"));

    let worker_bin_dest = binaries_path.join(worker_bin_name);
    fs::copy(worker_build_path, worker_bin_dest)?;

    //
    // Download required libraries
    //
    let libs_path = binaries_path.join(target.to_string());
    if !libs_path.is_dir() {
        fs::create_dir(&libs_path)?;
    }

    // To upgrade pdfium go to https://github.com/bblanchon/pdfium-binaries/releases
    // and replace the urls and checksums below with the desired pdfium version.
    let pdfium_release =
        "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F7825"
            .to_string();
    let pdfium_linux_aarch64 = format!("{pdfium_release}/pdfium-linux-arm64.tgz");
    let pdfium_macos_aarch64 = format!("{pdfium_release}/pdfium-mac-arm64.tgz");
    let pdfium_windows_aarch64 = format!("{pdfium_release}/pdfium-win-arm64.tgz");

    let pdfium_linux_x86_64 = format!("{pdfium_release}/pdfium-linux-x64.tgz");
    let pdfium_macos_x86_64 = format!("{pdfium_release}/pdfium-mac-x64.tgz");
    let pdfium_windows_x86_64 = format!("{pdfium_release}/pdfium-win-x64.tgz");

    let libs = match target {
        Target::Linux(arch) => match arch {
            Arch::Aarch64 => vec![WebFile {
                name: "libpdfium.so",
                url: &pdfium_linux_aarch64,
                sha256: hex!("b063f5244586f5e0c025cd4d74dd10f75bbb41e28bcdc1032349ca27814a06cf"),
                extract: extract_pdfium_release,
            }],
            Arch::X86_64 => vec![WebFile {
                name: "libpdfium.so",
                url: &pdfium_linux_x86_64,
                sha256: hex!("ae0e276bcdf276dca2746adb4780f79949620e5c655973ca252a3994bc516a13"),
                extract: extract_pdfium_release,
            }],
        },
        Target::MacOS(arch) => match arch {
            Arch::Aarch64 => vec![WebFile {
                name: "libpdfium.dylib",
                url: &pdfium_macos_aarch64,
                sha256: hex!("0e9692fa2063f5b5e6f6129680fe618f47efb9d728dd02e9db9b8999e386c84e"),
                extract: extract_pdfium_release,
            }],
            Arch::X86_64 => vec![WebFile {
                name: "libpdfium.dylib",
                url: &pdfium_macos_x86_64,
                sha256: hex!("1e2f0a38bd7a8c369b0a1655a527c6b5491086fe3a45d1d82432e9229ac9b40c"),
                extract: extract_pdfium_release,
            }],
        },
        Target::Windows(arch) => match arch {
            Arch::Aarch64 => vec![
                WebFile {
                    name: "pdfium.dll",
                    url: &pdfium_windows_aarch64,
                    sha256: hex!(
                        "83035269850b85a2367593e146d6fe98520a10a6f656a9dc462e1bce32adb501"
                    ),
                    extract: extract_pdfium_release,
                }, // Todo: Add WebView2Loader.dll download here so it doesn't need to be part of the source code.
            ],
            Arch::X86_64 => vec![
                WebFile {
                    name: "pdfium.dll",
                    url: &pdfium_windows_x86_64,
                    sha256: hex!(
                        "eefb48c845ab22f0945151093ce8fd611a33687796728051f9a1b2b341e1b980"
                    ),
                    extract: extract_pdfium_release,
                }, // Todo: Add WebView2Loader.dll download here so it doesn't need to be part of the source code.
            ],
        },
    };

    let mut hasher = Sha256::new();
    for lib in libs {
        if libs_path.join(lib.name).is_file() {
            continue;
        }

        let tmp_path = binaries_path.join("dl.tmp");

        {
            let mut response = reqwest::blocking::get(lib.url)?.error_for_status()?;
            let mut tmp = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp_path)?;

            let mut buf = Vec::new();
            response.read_to_end(&mut buf)?;

            hasher.update(&buf);
            assert_eq!(hasher.finalize_reset(), lib.sha256);

            tmp.write_all(&buf)?;
            tmp.flush()?;
            tmp.rewind()?;

            (lib.extract)(tmp, libs_path.join(lib.name), target)?;
        }

        fs::remove_file(tmp_path)?;
    }

    //
    // Link MAPI on Windows
    //
    if let Target::Windows(_) = target {
        println!("cargo:rustc-link-lib=mapi32");
    }

    //
    // Tauri Build
    //
    tauri_build::build();
    Ok(())
}

fn build_worker(root: &Path) -> Result<PathBuf> {
    let worker_cmd = {
        let mut cmd = Command::new("cargo");

        cmd.args([
            "build",
            "--package",
            "pdfium-worker",
            "--bin",
            "pdfium-worker",
            "--message-format",
            "json",
            "--locked",
            "--target-dir",
            root.join("pdfium-worker").to_str().unwrap(),
        ]);

        if let Some(arg) = std::env::var("PROFILE")
            .map(|s| {
                if s == "release" {
                    Some("--release")
                } else {
                    None
                }
            })
            .unwrap_or_default()
        {
            cmd.arg(arg);
        }

        cmd.output()
    }?;

    let records: Vec<Record> = Deserializer::from_slice(&worker_cmd.stdout)
        .into_iter::<Record>()
        .collect::<Result<_, _>>()?;

    if records
        .iter()
        .any(|r| &Record::BuildFinished { success: false } == r)
    {
        bail!("Failed to compile pdfium-worker");
    }

    for r in &records {
        if let Record::CompilerArtifact {
            executable: Some(path),
        } = r
        {
            return Ok(
                PathBuf::from_str(path).expect("Failed to parse pdfium-worker executable path")
            );
        }
    }

    bail!("pdfium-worker compiled but didn't produce an executable");
}

fn extract_pdfium_release(from: File, to: PathBuf, target: Target) -> Result<()> {
    let mut archive = Archive::new(GzDecoder::new(from));
    for file in archive
        .entries()
        .expect("Failed to read downloaded file as tar archive")
    {
        let mut file = file?;
        let target_path = match target {
            Target::Linux(_) => Path::new("lib/libpdfium.so"),
            Target::MacOS(_) => Path::new("lib/libpdfium.dylib"),
            Target::Windows(_) => Path::new("bin/pdfium.dll"),
        };

        if file.header().path()? == target_path {
            file.unpack(&to)?;
            return Ok(());
        }
    }

    bail!("Failed to find pdfium in the downloaded tar")
}
