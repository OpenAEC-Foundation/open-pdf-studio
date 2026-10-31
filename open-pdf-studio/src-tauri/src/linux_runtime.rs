#[cfg(any(target_os = "linux", test))]
use std::env;
#[cfg(any(target_os = "linux", test))]
use std::ffi::OsStr;
#[cfg(any(target_os = "linux", test))]
use std::path::{Path, PathBuf};

#[cfg(any(target_os = "linux", test))]
fn packaged_gio_module_dir(
    appimage: Option<&OsStr>,
    app_dir: Option<&OsStr>,
    configured_module_dir: Option<&OsStr>,
    extra_module_dirs: Option<&OsStr>,
    current_exe: Option<&Path>,
) -> Option<PathBuf> {
    if configured_module_dir.is_some() {
        return None;
    }

    let app_dir = Path::new(app_dir?);
    // A mounted AppImage sets APPIMAGE. An extracted one (`--appimage-extract`
    // and then `squashfs-root/AppRun`, as in containers without FUSE, #863)
    // only has APPDIR; then the running binary must live inside it.
    if appimage.is_none() && !current_exe.is_some_and(|exe| exe.starts_with(app_dir)) {
        return None;
    }
    env::split_paths(extra_module_dirs?).find(|candidate| candidate.starts_with(app_dir))
}

pub fn configure_appimage_gio_modules() {
    #[cfg(target_os = "linux")]
    if let Some(module_dir) = packaged_gio_module_dir(
        env::var_os("APPIMAGE").as_deref(),
        env::var_os("APPDIR").as_deref(),
        env::var_os("GIO_MODULE_DIR").as_deref(),
        env::var_os("GIO_EXTRA_MODULES").as_deref(),
        env::current_exe().ok().as_deref(),
    ) {
        // The AppImage bundles GIO from the build host. Point its default module
        // lookup at the matching packaged directory so it cannot load a newer
        // host GVFS module against that older library.
        env::set_var("GIO_MODULE_DIR", module_dir);
    }
}

#[cfg(test)]
mod tests {
    use super::packaged_gio_module_dir;
    use std::env;
    use std::ffi::OsStr;
    use std::path::PathBuf;

    #[test]
    fn selects_a_packaged_gio_module_directory() {
        let app_dir = PathBuf::from("app-image-root");
        let host_modules = PathBuf::from("host-gio-modules");
        let packaged_modules = app_dir.join("usr/lib/gio/modules");
        let extra_modules = env::join_paths([&host_modules, &packaged_modules]).unwrap();

        assert_eq!(
            packaged_gio_module_dir(
                Some(OsStr::new("Open.PDF.Studio.AppImage")),
                Some(app_dir.as_os_str()),
                None,
                Some(extra_modules.as_os_str()),
                None,
            ),
            Some(packaged_modules),
        );
    }

    #[test]
    fn selects_the_packaged_directory_for_an_extracted_appimage() {
        let app_dir = PathBuf::from("squashfs-root");
        let packaged_modules = app_dir.join("usr/lib/x86_64-linux-gnu/gio/modules");
        let exe = app_dir.join("usr/bin/open-pdf-studio");

        assert_eq!(
            packaged_gio_module_dir(
                None,
                Some(app_dir.as_os_str()),
                None,
                Some(packaged_modules.as_os_str()),
                Some(&exe),
            ),
            Some(packaged_modules.clone()),
        );
        // APPDIR inherited by a program that is not inside it: leave GIO alone.
        assert_eq!(
            packaged_gio_module_dir(
                None,
                Some(app_dir.as_os_str()),
                None,
                Some(packaged_modules.as_os_str()),
                Some(&PathBuf::from("elsewhere/bin/other")),
            ),
            None,
        );
    }

    #[test]
    fn respects_an_explicit_gio_module_directory() {
        let app_dir = PathBuf::from("app-image-root");
        let packaged_modules = app_dir.join("usr/lib/gio/modules");

        assert_eq!(
            packaged_gio_module_dir(
                Some(OsStr::new("Open.PDF.Studio.AppImage")),
                Some(app_dir.as_os_str()),
                Some(OsStr::new("custom-gio-modules")),
                Some(packaged_modules.as_os_str()),
                None,
            ),
            None,
        );
    }

    #[test]
    fn ignores_non_appimage_processes_and_host_module_directories() {
        assert_eq!(
            packaged_gio_module_dir(
                None,
                Some(OsStr::new("app-image-root")),
                None,
                Some(OsStr::new("host-gio-modules")),
                None,
            ),
            None,
        );
        assert_eq!(
            packaged_gio_module_dir(
                Some(OsStr::new("Open.PDF.Studio.AppImage")),
                Some(OsStr::new("app-image-root")),
                None,
                Some(OsStr::new("host-gio-modules")),
                None,
            ),
            None,
        );
    }
}
