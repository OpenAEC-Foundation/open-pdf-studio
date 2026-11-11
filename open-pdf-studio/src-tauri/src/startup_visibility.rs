//! One-shot startup reveal policy; independent of the window runtime for tests.
use std::sync::Mutex;

pub fn gated(label: &str, headless: bool) -> bool {
    label == "main" && !headless
}

#[derive(Default)]
pub struct RevealOnce(Mutex<bool>);

impl RevealOnce {
    // Serialize frontend and watchdog requests. A failed show can be retried;
    // a successful reveal must never undo a later user hide/minimize action.
    pub fn reveal<E>(&self, show: impl FnOnce() -> Result<(), E>) -> Result<bool, E> {
        let mut shown = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if *shown {
            return Ok(false);
        }
        show()?;
        *shown = true;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_interactive_main_is_gated() {
        assert!(gated("main", false));
        assert!(!gated("main", true));
        assert!(!gated("print-queue", false));
        assert!(!gated("pdf-1", false));
    }
    #[test]
    fn frontend_then_watchdog_does_not_show_twice() {
        let gate = RevealOnce::default();
        assert_eq!(gate.reveal(|| Ok::<_, ()>(())), Ok(true));
        assert_eq!(
            gate.reveal(|| panic!("must not re-show a hidden window")),
            Ok::<_, ()>(false)
        );
    }
    #[test]
    fn watchdog_then_late_frontend_does_not_show_twice() {
        let gate = RevealOnce::default();
        assert_eq!(gate.reveal(|| Ok::<_, ()>(())), Ok(true));
        assert_eq!(
            gate.reveal(|| panic!("must not re-show")),
            Ok::<_, ()>(false)
        );
    }
    #[test]
    fn failed_show_can_be_retried() {
        let gate = RevealOnce::default();
        assert_eq!(gate.reveal(|| Err("not ready")), Err("not ready"));
        assert_eq!(gate.reveal(|| Ok::<_, &str>(())), Ok(true));
    }
    #[test]
    fn racing_requests_show_once() {
        let gate = std::sync::Arc::new(RevealOnce::default());
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let gate = gate.clone();
                let calls = calls.clone();
                std::thread::spawn(move || {
                    gate.reveal(|| {
                        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        Ok::<_, ()>(())
                    })
                    .unwrap()
                })
            })
            .collect();
        let shown = threads
            .into_iter()
            .filter_map(|t| t.join().ok())
            .filter(|v| *v)
            .count();
        assert_eq!(shown, 1);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
