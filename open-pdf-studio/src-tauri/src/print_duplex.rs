//! Dubbelzijdig afdrukken per opdracht; ontbrekend laat de printerstandaard intact.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Duplex { Printer, Simplex, LongEdge, ShortEdge }
impl Duplex {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value {
            None | Some("printer") => Ok(Self::Printer),
            Some("simplex") => Ok(Self::Simplex),
            Some("long-edge") => Ok(Self::LongEdge),
            Some("short-edge") => Ok(Self::ShortEdge),
            _ => Err("Invalid duplex setting".into()),
        }
    }
    pub fn cups(self) -> Option<&'static str> {
        match self {
            Self::Printer => None,
            Self::Simplex => Some("sides=one-sided"),
            Self::LongEdge => Some("sides=two-sided-long-edge"),
            Self::ShortEdge => Some("sides=two-sided-short-edge"),
        }
    }
    // DMDUP_SIMPLEX / VERTICAL / HORIZONTAL (Windows SDK).
    pub fn windows(self) -> Option<i16> {
        match self { Self::Printer => None, Self::Simplex => Some(1), Self::LongEdge => Some(2), Self::ShortEdge => Some(3) }
    }
    pub fn append_cups(self, options: &mut Vec<String>) {
        if let Some(value) = self.cups() { options.extend(["-o".into(), value.into()]); }
    }
}

/// GTK's horizontal/vertical names differ from the Windows constants.
/// GTK cups backend: DuplexNoTumble -> horizontal, DuplexTumble -> vertical.
pub fn portal_duplex(option: &str) -> Option<&'static str> {
    match option {
        "sides=one-sided" => Some("simplex"),
        "sides=two-sided-long-edge" => Some("horizontal"),
        "sides=two-sided-short-edge" => Some("vertical"),
        _ => None,
    }
}

pub fn require_windows_mode(requested: i16, accepted: Option<i16>) -> Result<(), String> {
    if accepted == Some(requested) { Ok(()) }
    else { Err("The printer did not accept the selected duplex mode".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_does_not_override_driver_settings() {
        assert_eq!(Duplex::parse(None), Ok(Duplex::Printer));
        let mut options = vec!["-o".into(), "media=A4".into()];
        Duplex::Printer.append_cups(&mut options);
        assert_eq!(options, ["-o", "media=A4"]);
        assert_eq!(Duplex::Printer.windows(), None);
    }
    #[test]
    fn binding_edges_reach_the_native_backends() {
        for (choice, cups, code) in [("simplex","one-sided",1),("long-edge","two-sided-long-edge",2),("short-edge","two-sided-short-edge",3)] {
            let duplex=Duplex::parse(Some(choice)).unwrap();
            let mut options=Vec::new();duplex.append_cups(&mut options);
            assert_eq!(options, ["-o".to_string(),format!("sides={cups}")]);
            assert_eq!(duplex.windows(),Some(code));
        }
    }
    #[test]
    fn portal_uses_gtk_binding_names() {
        assert_eq!(portal_duplex("sides=one-sided"),Some("simplex"));
        assert_eq!(portal_duplex("sides=two-sided-long-edge"),Some("horizontal"));
        assert_eq!(portal_duplex("sides=two-sided-short-edge"),Some("vertical"));
        assert_eq!(portal_duplex("media=A4"),None);
    }
    #[test]
    fn driver_rejection_must_not_silently_print_simplex() {
        for code in [1,2,3] { assert!(require_windows_mode(code,Some(code)).is_ok()); }
        assert!(require_windows_mode(2,Some(1)).is_err());
        assert!(require_windows_mode(3,None).is_err());
        assert!(require_windows_mode(1,Some(2)).is_err());
    }
    #[test]
    fn invalid_choices_cannot_be_spooled() {
        for value in ["", "duplex", "long-edge -o copies=100", "default"] { assert!(Duplex::parse(Some(value)).is_err()); }
    }
}
