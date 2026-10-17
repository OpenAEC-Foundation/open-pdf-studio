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

    // Windows: de miniatuurhandler voor Verkenner (#605), open-pdf-thumbnails.dll,
    // gaat als resource mee (tauri.windows.conf.json). Net als de worker wordt
    // hij door het npm-voorscript gebouwd en hier alleen gekopieerd; alleen als
    // de bron nieuwer is, zodat een in CI al ondertekende kopie in binaries/
    // niet door een onondertekende wordt overschreven. Zonder bron (een kale
    // `cargo build` van dit pakket) komt er een leeg bestand, want
    // tauri_build eist dat elke resource bestaat; de app ziet aan het ontbreken
    // van de PE-kop dat de handler er niet is en biedt de optie dan niet aan.
    if target.contains("windows") {
        let naam = "open_pdf_thumbnails.dll";
        let mut bronnen: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            if let Some(profile_dir) = std::path::Path::new(&out_dir).ancestors().nth(3) {
                bronnen.push(profile_dir.join(naam));
            }
        }
        bronnen.push(std::path::PathBuf::from("../../target").join(&profile).join(naam));
        let doel = std::path::PathBuf::from("binaries").join("open-pdf-thumbnails.dll");
        let gewijzigd = |p: &std::path::Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
        let _ = std::fs::create_dir_all("binaries");
        if let Some(bron) = bronnen.iter().find(|p| p.exists()) {
            println!("cargo:rerun-if-changed={}", bron.display());
            let verouderd = match (gewijzigd(bron), gewijzigd(&doel)) {
                (Some(b), Some(d)) => b > d,
                _ => true,
            };
            let leeg = std::fs::metadata(&doel).map(|m| m.len() == 0).unwrap_or(true);
            if verouderd || leeg {
                if let Err(e) = std::fs::copy(bron, &doel) {
                    println!("cargo:warning=open-pdf-thumbnails kopie faalde ({} -> {}): {}", bron.display(), doel.display(), e);
                }
            }
        } else if !doel.exists() {
            let _ = std::fs::write(&doel, b"");
            println!(
                "cargo:warning=open-pdf-thumbnails.dll niet gevonden in {:?} — Verkenner-miniaturen ontbreken in deze build; draai `cargo build -p open-pdf-thumbnails`",
                bronnen.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
            );
        }
    }

    // Windows: link Simple MAPI for MAPISendMail (src/email.rs). The in-source
    // #[link(name = "mapi32")] is not reliably honoured across every rustc/SDK
    // setup (CI left __imp_MAPISendMail unresolved), so force the link here.
    if target.contains("windows") {
        println!("cargo:rustc-link-lib=mapi32");
    }

    // Windows met de GNU-toolchain: test.res (gecompileerd uit test.rc en
    // test.manifest) geeft de testbinaries van dit pakket een manifest. Zonder
    // manifest past Windows XP-compatibiliteitsshims toe die de doorverwijzing
    // van de WinRT-API-sets breken, en laadt comctl32 v6 niet. Dit stond als
    // absoluut pad van één ontwikkelmachine in src-tauri/.cargo/config.toml;
    // op elke andere machine faalde daardoor elke link, ook die van de
    // build-scripts van alle afhankelijkheden (#582). Hier geldt het alleen
    // voor dit pakket, met een pad vanaf CARGO_MANIFEST_DIR. De MSVC-builds
    // (CI en releases) raakt dit niet.
    if target == "x86_64-pc-windows-gnu" {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("."));
        let test_res = manifest_dir.join("test.res");
        if test_res.exists() {
            println!("cargo:rerun-if-changed={}", test_res.display());
            println!("cargo:rustc-link-arg={}", test_res.display());
        }
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
