//! Installed family names for the text properties dropdown (#1011).
//! This deliberately does not load font bytes or decide PDF embedding rights.

pub fn installed_font_families() -> Result<Vec<String>, String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        // DirectWrite on Windows (including TTC families), CoreText on macOS,
        // Fontconfig on Linux. Query the OS catalogue, not a fixed name list.
        let mut families = font_kit::source::SystemSource::new()
            .all_families()
            .map_err(|error| format!("Cannot enumerate installed fonts: {error:?}"))?;
        families.retain(|name| !name.trim().is_empty());
        families.sort();
        families.dedup();
        Ok(families)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    Err("Installed font enumeration is only available on desktop".into())
}
