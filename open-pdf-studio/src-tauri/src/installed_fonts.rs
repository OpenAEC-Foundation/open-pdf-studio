//! Installed family names for the text properties dropdown (#1011).
//! This deliberately does not load font bytes or decide PDF embedding rights.

pub fn installed_font_families() -> Result<Vec<String>, String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let mut families = query_font_families()?;
        families.retain(|name| !name.trim().is_empty());
        families.sort();
        families.dedup();
        Ok(families)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    Err("Installed font enumeration is only available on desktop".into())
}

#[cfg(target_os = "windows")]
fn query_font_families() -> Result<Vec<String>, String> {
    // font-kit's DirectWrite source uses get_system(false), which may return
    // a stale catalogue just after a font is installed. Refresh once at app
    // startup, including OS-installed TTC families and per-user fonts.
    dwrote::FontCollection::get_system(true)
        .families_iter()
        .map(|family| family.family_name().map_err(|error|
            format!("Cannot read installed font family: {error:?}")))
        .collect()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn query_font_families() -> Result<Vec<String>, String> {
    // CoreText on macOS, Fontconfig on Linux. No fixed list of font names.
    font_kit::source::SystemSource::new()
        .all_families()
        .map_err(|error| format!("Cannot enumerate installed fonts: {error:?}"))
}
