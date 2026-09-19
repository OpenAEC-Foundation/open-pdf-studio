fn main() {
    // Copy the pdfium-worker binary into src-tauri/binaries/ so Tauri's
    // sidecar bundler picks it up. The binary must be named with the
    // target triple suffix per Tauri's externalBin convention.
    // This must happen BEFORE tauri_build::build() so the validator finds the file.
    //
    // De worker wordt vlak vóór deze app-build vers gecompileerd door het
    // npm-voorscript (predev/prebuild -> `cargo build -p pdfium-worker`). Wij
    // KOPIEREN hem alleen; we bouwen hem hier NIET (een cargo-aanroep vanuit
    // een build-script deadlockt op de target-lock die de ouder-cargo houdt).
    let target = std::env::var("TARGET").unwrap_or_else(|_| "x86_64-pc-windows-msvc".to_string());
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };
    let worker_name = format!("pdfium-worker{}", exe_suffix);

    // De worker staat in DEZELFDE target-directory als deze app-build. Bij een
    // gezette CARGO_TARGET_DIR (test-rig) is dat NIET `../../target`, dus leiden
    // we het pad af van OUT_DIR: `<target>/<profiel>/build/<crate>-<hash>/out`.
    // Drie niveaus omhoog vanaf OUT_DIR geeft de `<profiel>`-map waar de worker
    // ligt — ongeacht CARGO_TARGET_DIR of een cross-target-subpad.
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(out_dir) = std::env::var("OUT_DIR") {
        if let Some(profile_dir) = std::path::Path::new(&out_dir).ancestors().nth(3) {
            candidates.push(profile_dir.join(&worker_name));
        }
    }
    // Terugval: de klassieke workspace-target-map (geen CARGO_TARGET_DIR).
    candidates.push(
        std::path::PathBuf::from("../../target").join(&profile).join(&worker_name),
    );

    let dst = std::path::PathBuf::from("binaries")
        .join(format!("pdfium-worker-{}{}", target, exe_suffix));
    if let Some(src) = candidates.iter().find(|p| p.exists()) {
        println!("cargo:rerun-if-changed={}", src.display());
        let _ = std::fs::create_dir_all("binaries");
        if let Err(e) = std::fs::copy(src, &dst) {
            println!("cargo:warning=pdfium-worker kopie faalde ({} -> {}): {}", src.display(), dst.display(), e);
        }
    } else {
        println!(
            "cargo:warning=pdfium-worker niet gevonden in {:?} — sidecar mogelijk verouderd; draai `cargo build -p pdfium-worker`",
            candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
        );
    }

    // Windows: link Simple MAPI for MAPISendMail (src/email.rs). The in-source
    // #[link(name = "mapi32")] is not reliably honoured across every rustc/SDK
    // setup (CI left __imp_MAPISendMail unresolved), so force the link here.
    if target.contains("windows") {
        println!("cargo:rustc-link-lib=mapi32");
    }

    // tauri.conf.json lists resources/tessdata and resources/fonts as bundle
    // resources (OCR trained-data + the CJK embed font). Those directories are
    // gitignored and only populated by `npm run prepare:ocr-runtime`
    // (scripts/ocr-runtime.mjs), which downloads them. tauri_build::build()
    // below validates every bundle resource path exists, so a plain `cargo
    // build` run outside the npm predev/prebuild hooks — a bare `cargo build`
    // on this crate, or a CI job that only runs `cargo build`/`cargo test` —
    // would otherwise fail before it even reaches OCR code. Create them empty
    // if missing so the build succeeds; OCR just won't find trained-data at
    // runtime until the real assets are fetched.
    for dir in ["resources/tessdata", "resources/fonts"] {
        if !std::path::Path::new(dir).exists() {
            let _ = std::fs::create_dir_all(dir);
        }
    }

    tauri_build::build();
}
