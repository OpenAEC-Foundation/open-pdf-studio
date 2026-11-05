//! Scanner input (#382): the platform-independent part. Option validation,
//! the argument lists for SANE's `scanimage` and for the Windows WIA script,
//! and parsing of what those programs print. Only `std` is used here, so
//! these rules are unit-tested on every platform (also without the Tauri
//! crate: `rustc --edition 2021 --test src/scanner_cmd.rs`).
//!
//! No shell is involved anywhere: every value travels as its own argument of
//! `std::process::Command`, and the WIA script is a constant (WIA_SCRIPT) that
//! reads its parameters; no script text is ever built from user data.

use std::path::{Path, PathBuf};

/// Lowest and highest resolution the dialog may ask for.
pub const MIN_DPI: u32 = 50;
pub const MAX_DPI: u32 = 1200;
/// Upper bound for one acquisition (a feeder that never reports "empty").
pub const MAX_PAGES: u32 = 500;
/// File name prefix of acquired pages: `page-0001.png`, ...
pub const PAGE_PREFIX: &str = "page-";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanMode {
    Color,
    Gray,
    BlackWhite,
}

impl ScanMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "color" => Ok(Self::Color),
            "gray" => Ok(Self::Gray),
            "bw" => Ok(Self::BlackWhite),
            _ => Err(format!("SCAN_BAD_OPTION:mode:{value}")),
        }
    }
    /// The option values every SANE backend knows (SANE_VALUE_SCAN_MODE_*).
    pub fn sane(self) -> &'static str {
        match self {
            Self::Color => "Color",
            Self::Gray => "Gray",
            Self::BlackWhite => "Lineart",
        }
    }
    /// The word the WIA script expects for `-Mode`.
    pub fn wia(self) -> &'static str {
        match self {
            Self::Color => "color",
            Self::Gray => "gray",
            Self::BlackWhite => "bw",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanSource {
    Flatbed,
    Feeder,
    Duplex,
}

impl ScanSource {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "flatbed" => Ok(Self::Flatbed),
            "feeder" => Ok(Self::Feeder),
            "duplex" => Ok(Self::Duplex),
            _ => Err(format!("SCAN_BAD_OPTION:source:{value}")),
        }
    }
    /// The common SANE source names; the flatbed keeps the backend default.
    pub fn sane(self) -> Option<&'static str> {
        match self {
            Self::Flatbed => None,
            Self::Feeder => Some("ADF"),
            Self::Duplex => Some("ADF Duplex"),
        }
    }
    pub fn wia(self) -> &'static str {
        match self {
            Self::Flatbed => "flatbed",
            Self::Feeder => "feeder",
            Self::Duplex => "duplex",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanOptions {
    pub dpi: u32,
    pub mode: ScanMode,
    pub source: ScanSource,
    /// 0 = until the feeder is empty. The flatbed always gives one page.
    pub max_pages: u32,
}

impl ScanOptions {
    pub fn parse(dpi: u32, mode: &str, source: &str, max_pages: u32) -> Result<Self, String> {
        if !(MIN_DPI..=MAX_DPI).contains(&dpi) {
            return Err(format!("SCAN_BAD_OPTION:dpi:{dpi}"));
        }
        if max_pages > MAX_PAGES {
            return Err(format!("SCAN_BAD_OPTION:maxPages:{max_pages}"));
        }
        Ok(Self { dpi, mode: ScanMode::parse(mode)?, source: ScanSource::parse(source)?, max_pages })
    }

    /// How many pages one acquisition may deliver (0 = no limit).
    pub fn page_limit(&self) -> u32 {
        if self.source == ScanSource::Flatbed { 1 } else { self.max_pages }
    }
}

/// A device id as `scanimage -L` or WIA reports it. It is passed as a single
/// argument, never through a shell, but still refused when it could be read
/// as an option (`-x`), contains control characters or a double quote (the
/// Windows command line of powershell.exe), or is absurdly long.
pub fn validate_device_id(id: &str) -> Result<(), String> {
    let bad = id.is_empty()
        || id.len() > 512
        || id.starts_with('-')
        || id.chars().any(|c| c.is_control() || c == '"');
    if bad { Err("SCAN_BAD_DEVICE".to_string()) } else { Ok(()) }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScannerInfo {
    pub id: String,
    pub name: String,
}

/// Parse `scanimage -L`. A device line looks like
/// ``device `epson2:libusb:001:004' is a Epson PerfectionV39 flatbed scanner``
/// (older versions quote with `'…'`). Everything else (the "No scanners were
/// identified" hint, blank lines) is ignored.
pub fn parse_scanimage_list(output: &str) -> Vec<ScannerInfo> {
    let mut found = Vec::new();
    for line in output.lines() {
        let Some(rest) = line.trim().strip_prefix("device ") else { continue };
        let mut chars = rest.chars();
        let Some(open) = chars.next() else { continue };
        if open != '`' && open != '\'' {
            continue;
        }
        let body = &rest[open.len_utf8()..];
        let Some(end) = body.find("' is ") else { continue };
        let id = body[..end].to_string();
        let desc = body[end + "' is ".len()..].trim();
        let desc = desc.strip_prefix("a ").or_else(|| desc.strip_prefix("an ")).unwrap_or(desc).trim();
        let name = if desc.is_empty() { id.clone() } else { desc.to_string() };
        if validate_device_id(&id).is_ok() && !found.iter().any(|s: &ScannerInfo| s.id == id) {
            found.push(ScannerInfo { id, name });
        }
    }
    found
}

/// `%` starts a printf directive in `--batch`: double it in the folder part.
fn batch_pattern(out_dir: &Path) -> String {
    let dir = out_dir.to_string_lossy().replace('%', "%%");
    let sep = std::path::MAIN_SEPARATOR;
    let dir = dir.trim_end_matches(['/', '\\']).to_string();
    format!("{dir}{sep}{PAGE_PREFIX}%04d.png")
}

/// The arguments for one acquisition with `scanimage`. Every option is one
/// `--name=value` token, so a value can never become an option of its own.
pub fn scanimage_acquire_args(device: &str, opts: &ScanOptions, out_dir: &Path) -> Result<Vec<String>, String> {
    validate_device_id(device)?;
    let mut args = vec![
        format!("--device-name={device}"),
        "--format=png".to_string(),
        format!("--resolution={}", opts.dpi),
        format!("--mode={}", opts.mode.sane()),
    ];
    if let Some(source) = opts.source.sane() {
        args.push(format!("--source={source}"));
    }
    args.push(format!("--batch={}", batch_pattern(out_dir)));
    args.push("--batch-start=1".to_string());
    let limit = opts.page_limit();
    if limit > 0 {
        args.push(format!("--batch-count={limit}"));
    }
    Ok(args)
}

/// The fixed powershell.exe switches in front of the script path.
pub const POWERSHELL_PREFIX: [&str; 5] = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

/// `powershell.exe` arguments to list WIA scanners.
pub fn wia_list_args(script: &Path) -> Vec<String> {
    let mut args: Vec<String> = POWERSHELL_PREFIX.iter().map(|s| s.to_string()).collect();
    args.push(script.to_string_lossy().into_owned());
    args.extend(["-Action".to_string(), "list".to_string()]);
    args
}

/// `powershell.exe` arguments for one WIA acquisition into `out_dir`.
pub fn wia_acquire_args(script: &Path, device: &str, opts: &ScanOptions, out_dir: &Path) -> Result<Vec<String>, String> {
    validate_device_id(device)?;
    let out = out_dir.to_string_lossy().into_owned();
    if out.starts_with('-') || out.contains('"') {
        return Err("SCAN_BAD_OUTPUT_DIR".to_string());
    }
    let mut args: Vec<String> = POWERSHELL_PREFIX.iter().map(|s| s.to_string()).collect();
    args.push(script.to_string_lossy().into_owned());
    for (name, value) in [
        ("-Action", "scan".to_string()),
        ("-DeviceId", device.to_string()),
        ("-Dpi", opts.dpi.to_string()),
        ("-Mode", opts.mode.wia().to_string()),
        ("-Source", opts.source.wia().to_string()),
        ("-MaxPages", opts.page_limit().to_string()),
        ("-OutDir", out),
    ] {
        args.push(name.to_string());
        args.push(value);
    }
    Ok(args)
}

/// What the WIA script printed: one record per line, tab-separated.
/// `DEVICE <id> <name>`, `PAGE <path>`, `EMPTY` (feeder ran out before the
/// first page) and `ERROR <code> <message>`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct WiaOutput {
    pub devices: Vec<ScannerInfo>,
    pub pages: Vec<String>,
    pub feeder_empty: bool,
    pub error: Option<String>,
}

pub fn parse_wia_output(stdout: &str) -> WiaOutput {
    let mut out = WiaOutput::default();
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        let mut parts = line.splitn(3, '\t');
        match parts.next() {
            Some("DEVICE") => {
                let id = parts.next().unwrap_or("").to_string();
                let name = parts.next().unwrap_or("").trim().to_string();
                if validate_device_id(&id).is_ok() {
                    let name = if name.is_empty() { id.clone() } else { name };
                    out.devices.push(ScannerInfo { id, name });
                }
            }
            Some("PAGE") => {
                if let Some(path) = parts.next().filter(|p| !p.is_empty()) {
                    out.pages.push(path.to_string());
                }
            }
            Some("EMPTY") => out.feeder_empty = true,
            Some("ERROR") => {
                let code = parts.next().unwrap_or("").to_string();
                let message = parts.next().unwrap_or("").trim().to_string();
                out.error = Some(if message.is_empty() { code } else { format!("{code}: {message}") });
            }
            _ => {}
        }
    }
    out
}

/// The pages an acquisition left in `dir`, in page order. Only our own names
/// (`page-NNNN.png`); anything else in the folder is ignored.
pub fn collect_pages(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut pages: Vec<(u32, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            let number = name.strip_prefix(PAGE_PREFIX)?.strip_suffix(".png")?;
            if number.is_empty() || !number.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let meta = std::fs::metadata(&path).ok()?;
            (meta.is_file() && meta.len() > 0).then_some((number.parse().ok()?, path))
        })
        .collect();
    pages.sort();
    pages.into_iter().map(|(_, p)| p).collect()
}

/// Does `scanimage` say the feeder is empty? It then exits with status 7
/// (SANE_STATUS_NO_DOCS) — after the pages it did scan, if any.
pub fn sane_feeder_empty(status: Option<i32>, stderr: &str) -> bool {
    status == Some(7) || stderr.contains("out of documents") || stderr.contains("Document feeder out of documents")
}

/// The WIA script (Windows). Runs with `powershell.exe -File` and reads all
/// its input from parameters; it never evaluates them as code. Uses the WIA
/// Automation Layer (WIA.DeviceManager), which every Windows since Vista has.
pub const WIA_SCRIPT: &str = r#"param(
  [Parameter(Mandatory=$true)][ValidateSet('list','scan')][string]$Action,
  [string]$DeviceId = '',
  [ValidateRange(50,1200)][int]$Dpi = 300,
  [ValidateSet('color','gray','bw')][string]$Mode = 'color',
  [ValidateSet('flatbed','feeder','duplex')][string]$Source = 'flatbed',
  [ValidateRange(0,500)][int]$MaxPages = 0,
  [string]$OutDir = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PNG = '{B96B3CAF-0728-11D3-9D7B-0000F81E3E2E}'
$PAPER_EMPTY = -2145320957   # 0x80210003 WIA_ERROR_PAPER_EMPTY
function Out-Line([string[]]$parts) { [Console]::Out.WriteLine(($parts -join "`t")) }
function Clean([string]$s) { if ($null -eq $s) { return '' }; return ($s -replace '[\t\r\n]', ' ') }
# The COM error code, also when PowerShell wraps the COM exception.
function Get-HResult($err) {
  $e = $err.Exception
  while ($null -ne $e.InnerException -and -not ($e -is [System.Runtime.InteropServices.COMException])) { $e = $e.InnerException }
  return $e.HResult
}
function Set-Prop($props, [int]$id, $value) {
  foreach ($p in $props) { if ($p.PropertyID -eq $id) { try { $p.Value = $value; return $true } catch { return $false } } }
  return $false
}
try {
  $dm = New-Object -ComObject WIA.DeviceManager
  if ($Action -eq 'list') {
    foreach ($info in $dm.DeviceInfos) {
      if ($info.Type -ne 1) { continue }   # 1 = scanner
      $name = ''
      foreach ($p in $info.Properties) { if ($p.Name -eq 'Name') { $name = [string]$p.Value } }
      Out-Line @('DEVICE', (Clean $info.DeviceID), (Clean $name))
    }
    exit 0
  }
  if (-not (Test-Path -LiteralPath $OutDir -PathType Container)) { Out-Line @('ERROR', 'OUTDIR', ''); exit 2 }
  $device = $null
  foreach ($info in $dm.DeviceInfos) { if ($info.DeviceID -eq $DeviceId) { $device = $info.Connect() } }
  if ($null -eq $device) { Out-Line @('ERROR', 'NODEVICE', ''); exit 3 }
  # WIA_DPS_DOCUMENT_HANDLING_SELECT (3088): 1 feeder, 2 flatbed, 4 duplex (with the feeder: 5).
  $handling = switch ($Source) { 'feeder' { 1 } 'duplex' { 5 } default { 2 } }
  [void](Set-Prop $device.Properties 3088 $handling)
  if ($Source -ne 'flatbed') { [void](Set-Prop $device.Properties 3096 1) }   # WIA_DPS_PAGES: one per transfer
  $item = $device.Items.Item(1)
  # WIA_IPS_CUR_INTENT (6146): 1 colour, 2 greyscale, 4 text (black/white).
  $intent = switch ($Mode) { 'gray' { 2 } 'bw' { 4 } default { 1 } }
  [void](Set-Prop $item.Properties 6146 $intent)
  [void](Set-Prop $item.Properties 6147 $Dpi)   # horizontal resolution
  [void](Set-Prop $item.Properties 6148 $Dpi)   # vertical resolution
  $count = 0
  while ($true) {
    if ($MaxPages -gt 0 -and $count -ge $MaxPages) { break }
    try {
      $img = $item.Transfer($PNG)
    } catch {
      if ((Get-HResult $_) -eq $PAPER_EMPTY) {
        if ($count -eq 0) { Out-Line @('EMPTY') }
        break
      }
      if ($count -gt 0) { break }
      throw
    }
    if ($img.FormatID -ne $PNG) {
      $ip = New-Object -ComObject WIA.ImageProcess
      $ip.Filters.Add($ip.FilterInfos.Item('Convert').FilterID)
      $ip.Filters.Item(1).Properties.Item('FormatID').Value = $PNG
      $img = $ip.Apply($img)
    }
    $count++
    $path = Join-Path -Path $OutDir -ChildPath ('page-{0:D4}.png' -f $count)
    $img.SaveFile($path)
    Out-Line @('PAGE', $path)
    if ($Source -eq 'flatbed') { break }
  }
  exit 0
} catch {
  $code = '{0:X8}' -f (Get-HResult $_)
  Out-Line @('ERROR', $code, (Clean $_.Exception.Message))
  exit 1
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(source: &str, max: u32) -> ScanOptions {
        ScanOptions::parse(300, "color", source, max).unwrap()
    }

    #[test]
    fn parses_scanimage_list_samples() {
        let sample = "device `epson2:libusb:001:004' is a Epson PerfectionV39 flatbed scanner\n\
device `hpaio:/usb/Officejet_Pro_8600?serial=CN2B9F' is a Hewlett-Packard Officejet_Pro_8600 all-in-one\n\
device `v4l:/dev/video0' is a Noname Integrated Camera virtual device\n\
\n\
device 'airscan:e0:Canon MF240' is an eSCL Canon MF240 ip=192.168.1.20\n";
        let list = parse_scanimage_list(sample);
        assert_eq!(list.len(), 4);
        assert_eq!(list[0].id, "epson2:libusb:001:004");
        assert_eq!(list[0].name, "Epson PerfectionV39 flatbed scanner");
        assert_eq!(list[1].id, "hpaio:/usb/Officejet_Pro_8600?serial=CN2B9F");
        assert_eq!(list[3].id, "airscan:e0:Canon MF240");
        assert_eq!(list[3].name, "eSCL Canon MF240 ip=192.168.1.20");
    }

    #[test]
    fn scanimage_list_without_devices_is_empty() {
        let none = "\nNo scanners were identified. If you were expecting something different,\n\
check that the scanner is plugged in, turned on and detected by the\nsane-find-scanner tool (if appropriate).\n";
        assert!(parse_scanimage_list(none).is_empty());
        assert!(parse_scanimage_list("").is_empty());
    }

    #[test]
    fn scanimage_list_drops_duplicates_and_option_like_ids() {
        let sample = "device `a:1' is a One\ndevice `a:1' is a One again\ndevice `-x' is a Trick\n";
        let list = parse_scanimage_list(sample);
        assert_eq!(list, vec![ScannerInfo { id: "a:1".into(), name: "One".into() }]);
    }

    #[test]
    fn options_are_validated() {
        assert!(ScanOptions::parse(49, "color", "flatbed", 0).is_err());
        assert!(ScanOptions::parse(1201, "color", "flatbed", 0).is_err());
        assert!(ScanOptions::parse(300, "Color", "flatbed", 0).is_err());
        assert!(ScanOptions::parse(300, "color", "ADF", 0).is_err());
        assert!(ScanOptions::parse(300, "color", "feeder", 501).is_err());
        assert_eq!(opts("flatbed", 9).page_limit(), 1);
        assert_eq!(opts("feeder", 0).page_limit(), 0);
        assert_eq!(opts("duplex", 6).page_limit(), 6);
    }

    #[test]
    fn device_ids_that_could_be_options_are_refused() {
        assert!(validate_device_id("").is_err());
        assert!(validate_device_id("--help").is_err());
        assert!(validate_device_id("a\nb").is_err());
        assert!(validate_device_id("a\"; Remove-Item C:\\").is_err());
        assert!(validate_device_id(&"x".repeat(513)).is_err());
        assert!(validate_device_id("{6BDD1FC6-810F-11D0-BEC7-08002BE2092F}\\0000").is_ok());
        assert!(validate_device_id("pixma:04A91912_123456").is_ok());
    }

    #[test]
    fn scanimage_args_are_single_tokens() {
        let dir = Path::new("/tmp/scan 1");
        let args = scanimage_acquire_args("epson2:libusb:001:004", &opts("duplex", 0), dir).unwrap();
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(args, vec![
            "--device-name=epson2:libusb:001:004".to_string(),
            "--format=png".into(),
            "--resolution=300".into(),
            "--mode=Color".into(),
            "--source=ADF Duplex".into(),
            format!("--batch=/tmp/scan 1{sep}page-%04d.png"),
            "--batch-start=1".into(),
        ]);
        // A device name with shell characters stays one argument.
        let args = scanimage_acquire_args("net:host;rm -rf ~:dev", &opts("flatbed", 0), dir).unwrap();
        assert_eq!(args[0], "--device-name=net:host;rm -rf ~:dev");
        assert!(args.iter().all(|a| a.starts_with("--")));
        assert!(args.contains(&"--batch-count=1".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--source")));
        assert!(scanimage_acquire_args("-L", &opts("flatbed", 0), dir).is_err());
    }

    #[test]
    fn percent_in_folder_does_not_become_a_directive() {
        let args = scanimage_acquire_args("a:1", &opts("feeder", 3), Path::new("/tmp/100%d")).unwrap();
        let batch = args.iter().find(|a| a.starts_with("--batch=")).unwrap();
        assert!(batch.starts_with("--batch=/tmp/100%%d"));
        assert!(batch.ends_with("page-%04d.png"));
        assert!(args.contains(&"--batch-count=3".to_string()));
        assert!(args.contains(&"--mode=Color".to_string()));
        let gray = ScanOptions::parse(150, "bw", "feeder", 0).unwrap();
        let args = scanimage_acquire_args("a:1", &gray, Path::new("/x")).unwrap();
        assert!(args.contains(&"--mode=Lineart".to_string()));
        assert!(args.contains(&"--source=ADF".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--batch-count")));
    }

    #[test]
    fn wia_args_pass_values_as_separate_arguments() {
        let script = Path::new("C:/cache/opds-wia.ps1");
        let args = wia_acquire_args(script, "{GUID}\\0001", &opts("feeder", 0), Path::new("C:/cache/scan-1")).unwrap();
        assert_eq!(&args[..5], &POWERSHELL_PREFIX.map(String::from));
        assert_eq!(args[5], "C:/cache/opds-wia.ps1");
        let pairs: Vec<(&str, &str)> = args[6..].chunks(2).map(|c| (c[0].as_str(), c[1].as_str())).collect();
        assert_eq!(pairs, vec![
            ("-Action", "scan"), ("-DeviceId", "{GUID}\\0001"), ("-Dpi", "300"), ("-Mode", "color"),
            ("-Source", "feeder"), ("-MaxPages", "0"), ("-OutDir", "C:/cache/scan-1"),
        ]);
        // No argument is a -Command or carries script text.
        assert!(!args.iter().any(|a| a.eq_ignore_ascii_case("-Command") || a.contains('$') || a.contains(';')));
        assert!(wia_acquire_args(script, "-Command", &opts("feeder", 0), Path::new("C:/x")).is_err());
        assert!(wia_acquire_args(script, "x\" -Command \"y", &opts("feeder", 0), Path::new("C:/x")).is_err());
        assert_eq!(wia_list_args(script)[6..], ["-Action".to_string(), "list".to_string()]);
    }

    #[test]
    fn parses_wia_script_output() {
        let out = parse_wia_output("DEVICE\t{A}\\0000\tCanon DR-C225\r\nDEVICE\t-bad\tX\r\nnoise\nPAGE\tC:\\t\\page-0001.png\nPAGE\tC:\\t\\page-0002.png\n");
        assert_eq!(out.devices, vec![ScannerInfo { id: "{A}\\0000".into(), name: "Canon DR-C225".into() }]);
        assert_eq!(out.pages.len(), 2);
        assert!(out.error.is_none());
        let failed = parse_wia_output("ERROR\t80210006\tThe device is busy.\n");
        assert_eq!(failed.error.as_deref(), Some("80210006: The device is busy."));
        assert!(parse_wia_output("EMPTY\n").feeder_empty);
    }

    #[test]
    fn wia_script_takes_only_parameters() {
        assert!(WIA_SCRIPT.starts_with("param("));
        for name in ["$Action", "$DeviceId", "$Dpi", "$Mode", "$Source", "$MaxPages", "$OutDir"] {
            assert!(WIA_SCRIPT.contains(name), "{name}");
        }
        assert!(!WIA_SCRIPT.contains("Invoke-Expression") && !WIA_SCRIPT.contains("iex "));
    }

    #[test]
    fn collects_pages_in_number_order() {
        let dir = std::env::temp_dir().join(format!("opds-scan-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["page-0010.png", "page-0002.png", "page-0001.png", "other.png", "page-x.png"] {
            std::fs::write(dir.join(name), b"png").unwrap();
        }
        std::fs::write(dir.join("page-0003.png"), b"").unwrap(); // an aborted page
        let pages: Vec<String> = collect_pages(&dir)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(pages, vec!["page-0001.png", "page-0002.png", "page-0010.png"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn feeder_empty_detection() {
        assert!(sane_feeder_empty(Some(7), ""));
        assert!(sane_feeder_empty(Some(1), "scanimage: sane_start: Document feeder out of documents"));
        assert!(!sane_feeder_empty(Some(1), "scanimage: open of device failed"));
    }
}
