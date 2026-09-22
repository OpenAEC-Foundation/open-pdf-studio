//! Fouttype van de export.

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum ExportError {
    /// PDFium kon niet geladen worden of weigerde het document of de pagina.
    Pdfium(String),
    /// Lezen van de PDF of schrijven van de uitvoer mislukte.
    Io(String),
    /// De gevraagde pagina bestaat niet.
    PageOutOfRange { page_index: u32, page_count: u32 },
    /// De CAD-schrijver gaf een fout.
    Write(String),
    /// De gebruiker brak de export af.
    Cancelled,
    /// Meer entiteiten dan de ingestelde grens; de gebruiker kiest of het toch
    /// moet.
    TooLarge { entities: u64, limit: u64 },
    /// Gevraagd is de oorsprong van het model, maar de pagina draagt geen
    /// terugweg naar CAD (`/OPS_ModelMatrix`).
    NoModelSpace,
    /// De pagina draagt meer viewports met een eigen terugweg, en uit het
    /// exportgebied volgt niet welke bedoeld is (geen gebied, of een gebied
    /// dat niet binnen één viewport ligt).
    AmbiguousModelSpace { viewports: u32 },
    /// De gekozen viewport noemt in `/OPS_ModelUnits` een eenheid die de
    /// export niet kent (de naam, ingekort); stil millimeter aannemen zou de
    /// tekening op de verkeerde maat terugzetten.
    UnknownModelUnits(String),
}

impl fmt::Display for ExportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExportError::Pdfium(m) => write!(f, "PDFium: {m}"),
            ExportError::Io(m) => write!(f, "bestandsfout: {m}"),
            ExportError::PageOutOfRange { page_index, page_count } => write!(
                f,
                "pagina {} bestaat niet (document heeft {} pagina's)",
                page_index + 1,
                page_count
            ),
            ExportError::Write(m) => write!(f, "CAD-bestand schrijven mislukt: {m}"),
            ExportError::Cancelled => write!(f, "export afgebroken"),
            // Vaste vorm: de app herkent deze fout aan het voorvoegsel.
            ExportError::TooLarge { entities, limit } => write!(f, "TOO_LARGE:{entities}:{limit}"),
            ExportError::NoModelSpace => write!(f, "NO_MODEL_SPACE"),
            ExportError::AmbiguousModelSpace { viewports } => write!(f, "MODEL_SPACE_AMBIGUOUS:{viewports}"),
            ExportError::UnknownModelUnits(unit) => write!(f, "MODEL_UNITS_UNKNOWN:{unit}"),
        }
    }
}

impl std::error::Error for ExportError {}
