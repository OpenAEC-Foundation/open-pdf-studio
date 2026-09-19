//! Het ondertekende bytebereik (`/ByteRange`, ISO 32000-1 §12.8.1): lezen,
//! controleren en dekking. Puur, zonder I/O. Plaatshouders schrijven en
//! in-place patchen komen hier bij het ondertekenen bij.

/// De twee ondertekende stukken van het bestand; daartussen ligt het gat met `/Contents`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bytebereik {
    pub start1: usize,
    pub lengte1: usize,
    pub start2: usize,
    pub lengte2: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BereikFout {
    GeenVierGetallen,
    Negatief,
    BeginNietNul,
    /// Het gat is kleiner dan `<>`, of het tweede stuk begint vóór het einde van het eerste.
    GatTeKlein,
    VoorbijEinde,
    GatGeenHexString,
}

impl std::fmt::Display for BereikFout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let tekst = match self {
            BereikFout::GeenVierGetallen => "het bytebereik heeft geen vier getallen",
            BereikFout::Negatief => "het bytebereik bevat een negatief getal",
            BereikFout::BeginNietNul => "het bytebereik begint niet bij 0",
            BereikFout::GatTeKlein => "het gat in het bytebereik is te klein",
            BereikFout::VoorbijEinde => "het bytebereik reikt voorbij het einde van het bestand",
            BereikFout::GatGeenHexString => "het gat in het bytebereik is geen hex-string",
        };
        f.write_str(tekst)
    }
}

impl BereikFout {
    /// Het machineleesbare signaal (zie [`super::status::signaal`]).
    pub fn signaal(&self) -> &'static str {
        use super::status::signaal;
        match self {
            BereikFout::GeenVierGetallen => signaal::BYTEBEREIK_GEEN_VIER_GETALLEN,
            BereikFout::Negatief => signaal::BYTEBEREIK_NEGATIEF,
            BereikFout::BeginNietNul => signaal::BYTEBEREIK_BEGINT_NIET_BIJ_NUL,
            BereikFout::GatTeKlein => signaal::BYTEBEREIK_GAT_TE_KLEIN,
            BereikFout::VoorbijEinde => signaal::BYTEBEREIK_VOORBIJ_EINDE,
            BereikFout::GatGeenHexString => signaal::BYTEBEREIK_GAT_GEEN_HEX_STRING,
        }
    }
}

/// Witruimte volgens ISO 32000-1 §7.2.2, tabel 1.
fn is_pdf_witruimte(b: u8) -> bool {
    matches!(b, b'\0' | b'\t' | b'\n' | b'\x0c' | b'\r' | b' ')
}

impl Bytebereik {
    /// Uit de getallen van `/ByteRange`, gecontroleerd tegen de bestandslengte.
    pub fn uit_getallen(getallen: &[i64], bestandslengte: usize) -> Result<Bytebereik, BereikFout> {
        let [a, b, c, d] = <[i64; 4]>::try_from(getallen).map_err(|_| BereikFout::GeenVierGetallen)?;
        let naar = |x: i64| usize::try_from(x).map_err(|_| BereikFout::Negatief);
        let (start1, lengte1, start2, lengte2) = (naar(a)?, naar(b)?, naar(c)?, naar(d)?);
        if start1 != 0 {
            return Err(BereikFout::BeginNietNul);
        }
        match lengte1.checked_add(2) {
            Some(minimum) if start2 >= minimum => {}
            _ => return Err(BereikFout::GatTeKlein),
        }
        match start2.checked_add(lengte2) {
            Some(einde) if einde <= bestandslengte => {}
            _ => return Err(BereikFout::VoorbijEinde),
        }
        Ok(Bytebereik { start1, lengte1, start2, lengte2 })
    }

    /// Eerste byte ná het bereik.
    pub fn einde(&self) -> usize {
        self.start2.saturating_add(self.lengte2)
    }

    /// Reikt het bereik tot het einde van het bestand? Alleen PDF-witruimte
    /// (ISO 32000-1 §7.2.2: NUL, tab, LF, FF, CR, spatie) na het bereik telt
    /// niet als toevoeging; al het andere betekent dat er na het ondertekenen
    /// iets is toegevoegd.
    pub fn dekt_hele_document(&self, bytes: &[u8]) -> bool {
        bytes.get(self.einde()..).is_some_and(|rest| rest.iter().all(|&b| is_pdf_witruimte(b)))
    }

    /// De bytes tussen de twee stukken, inclusief `<` en `>`.
    pub fn gat<'a>(&self, bytes: &'a [u8]) -> Option<&'a [u8]> {
        bytes.get(self.start1.checked_add(self.lengte1)?..self.start2)
    }

    /// Het gat moet precies één hex-string zijn: `<`, hexcijfers of witruimte, `>`.
    ///
    /// Witruimte binnen `<…>` wordt genegeerd (ISO 32000-1 §7.3.4.3), en daartoe
    /// hoort ook NUL (§7.2.2, tabel 1), net als bij de dekkingsregel in
    /// [`Self::dekt_hele_document`]. Buiten `<…>` staat niets in het gat: het
    /// bytebereik moet precies de hex-string uitsluiten, dus ook geen witruimte
    /// of NUL ervoor of erna.
    pub fn controleer_gat(&self, bytes: &[u8]) -> Result<(), BereikFout> {
        let gat = self.gat(bytes).ok_or(BereikFout::VoorbijEinde)?;
        match gat {
            [b'<', midden @ .., b'>'] if midden.iter().all(|&x| x.is_ascii_hexdigit() || is_pdf_witruimte(x)) => Ok(()),
            _ => Err(BereikFout::GatGeenHexString),
        }
    }

    /// De bytes van de hex-string in het gat, zoals een PDF-lezer ze decodeert
    /// (witruimte overgeslagen, een oneven laatste cijfer aangevuld met 0).
    /// `None` als het gat geen hex-string is (zie [`Self::controleer_gat`]).
    pub fn gat_inhoud(&self, bytes: &[u8]) -> Option<Vec<u8>> {
        self.controleer_gat(bytes).ok()?;
        let gat = self.gat(bytes)?;
        let midden = gat.get(1..gat.len().checked_sub(1)?)?;
        let cijfers: Vec<u8> = midden
            .iter()
            .filter_map(|&c| char::from(c).to_digit(16).and_then(|d| u8::try_from(d).ok()))
            .collect();
        Some(
            cijfers
                .chunks(2)
                .map(|paar| (paar.first().copied().unwrap_or(0) << 4) | paar.get(1).copied().unwrap_or(0))
                .collect(),
        )
    }

    /// De twee ondertekende stukken; `None` als het bereik niet in `bytes` past.
    pub fn delen<'a>(&self, bytes: &'a [u8]) -> Option<[&'a [u8]; 2]> {
        Some([
            bytes.get(self.start1..self.start1.checked_add(self.lengte1)?)?,
            bytes.get(self.start2..self.start2.checked_add(self.lengte2)?)?,
        ])
    }

    /// Het bestand zoals het ondertekend werd: alles tot het einde van het bereik.
    pub fn ondertekende_versie<'a>(&self, bytes: &'a [u8]) -> Option<&'a [u8]> {
        bytes.get(..self.start2.checked_add(self.lengte2)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PDF: &[u8] = b"%PDF-1.7 hallo <0A1b> einde";

    #[test]
    fn geldig_bereik_dat_het_hele_document_dekt() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], PDF.len()).unwrap();
        assert_eq!(b, Bytebereik { start1: 0, lengte1: 15, start2: 21, lengte2: 6 });
        assert_eq!(b.einde(), 27);
        assert!(b.dekt_hele_document(PDF));
        assert_eq!(b.controleer_gat(PDF), Ok(()));
    }

    #[test]
    fn bereik_dat_niet_tot_het_einde_reikt() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 3], PDF.len()).unwrap();
        assert_eq!(b.einde(), 24);
        assert!(!b.dekt_hele_document(PDF));
    }

    #[test]
    fn ongeldige_getallen_geven_een_fout() {
        let n = PDF.len();
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 21], n), Err(BereikFout::GeenVierGetallen));
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 21, 6, 1], n), Err(BereikFout::GeenVierGetallen));
        assert_eq!(Bytebereik::uit_getallen(&[0, -15, 21, 6], n), Err(BereikFout::Negatief));
        assert_eq!(Bytebereik::uit_getallen(&[1, 15, 21, 6], n), Err(BereikFout::BeginNietNul));
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 16, 11], n), Err(BereikFout::GatTeKlein));
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 21, 7], n), Err(BereikFout::VoorbijEinde));
        assert_eq!(Bytebereik::uit_getallen(&[0, i64::MAX, i64::MAX, i64::MAX], n), Err(BereikFout::GatTeKlein));
        assert_eq!(Bytebereik::uit_getallen(&[0, 1, i64::MAX, i64::MAX], n), Err(BereikFout::VoorbijEinde));
    }

    #[test]
    fn gat_moet_een_hex_string_zijn() {
        let b = Bytebereik::uit_getallen(&[0, 14, 21, 6], PDF.len()).unwrap();
        assert_eq!(b.controleer_gat(PDF), Err(BereikFout::GatGeenHexString));
        let met_witruimte = b"%PDF-1.7 hallo <0A 1\nb> einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 23, 6], met_witruimte.len()).unwrap();
        assert_eq!(b.controleer_gat(met_witruimte), Ok(()));
        let geen_hex = b"%PDF-1.7 hallo <0A1g> einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], geen_hex.len()).unwrap();
        assert_eq!(b.controleer_gat(geen_hex), Err(BereikFout::GatGeenHexString));
    }

    #[test]
    fn nul_telt_als_witruimte_binnen_de_hex_string_maar_niet_erbuiten() {
        // ISO 32000-1 §7.3.4.3: witruimte in een hex-string wordt genegeerd; NUL is witruimte (§7.2.2).
        let met_nul = b"%PDF-1.7 hallo <0A\x001b\x00> einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 23, 6], met_nul.len()).unwrap();
        assert_eq!(b.controleer_gat(met_nul), Ok(()));
        assert_eq!(b.gat_inhoud(met_nul), Some(vec![0x0A, 0x1B]));
        // Buiten `<…>` hoort niets in het gat, ook geen NUL of andere witruimte.
        let nul_ervoor = b"%PDF-1.7 hallo \x00<0A1b> einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 22, 6], nul_ervoor.len()).unwrap();
        assert_eq!(b.controleer_gat(nul_ervoor), Err(BereikFout::GatGeenHexString));
        let nul_erna = b"%PDF-1.7 hallo <0A1b>\x00 einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 22, 6], nul_erna.len()).unwrap();
        assert_eq!(b.controleer_gat(nul_erna), Err(BereikFout::GatGeenHexString));
    }

    #[test]
    fn delen_sluiten_precies_het_gat_uit() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], PDF.len()).unwrap();
        let [een, twee] = b.delen(PDF).unwrap();
        assert_eq!(een, b"%PDF-1.7 hallo ");
        assert_eq!(twee, b" einde");
        assert_eq!(b.gat(PDF).unwrap(), b"<0A1b>");
        assert_eq!(een.len() + b.gat(PDF).unwrap().len() + twee.len(), PDF.len());
    }

    #[test]
    fn ondertekende_versie_eindigt_bij_het_bereik() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 3], PDF.len()).unwrap();
        assert_eq!(b.ondertekende_versie(PDF).unwrap(), b"%PDF-1.7 hallo <0A1b> ei");
    }

    #[test]
    fn handmatig_ongeldig_bereik_geeft_geen_paniek() {
        let b = Bytebereik { start1: 0, lengte1: usize::MAX, start2: usize::MAX, lengte2: usize::MAX };
        assert_eq!(b.delen(PDF), None);
        assert_eq!(b.gat(PDF), None);
        assert_eq!(b.ondertekende_versie(PDF), None);
        assert_eq!(b.einde(), usize::MAX);
        assert_eq!(b.controleer_gat(PDF), Err(BereikFout::VoorbijEinde));
    }

    #[test]
    fn alleen_witruimte_na_het_bereik_dekt_het_hele_document() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], PDF.len()).unwrap();
        let met = |staart: &[u8]| [PDF, staart].concat();
        assert!(b.dekt_hele_document(&met(b"\r\n")));
        assert!(b.dekt_hele_document(&met(b"\0\t\n\x0c\r ")));
        assert!(!b.dekt_hele_document(&met(b"\n%")));
        assert!(!b.dekt_hele_document(&met(b"x")));
        assert!(!b.dekt_hele_document(&met(b"\x0b")), "verticale tab is geen PDF-witruimte");
        // Een bestand korter dan het bereik dekt niets.
        assert!(!b.dekt_hele_document(&PDF[..PDF.len() - 1]));
    }

    #[test]
    fn grenzen_van_het_gat() {
        // Kleinste gat: `<>`.
        let kort = b"ab<>cd";
        let b = Bytebereik::uit_getallen(&[0, 2, 4, 2], kort.len()).unwrap();
        assert_eq!(b.controleer_gat(kort), Ok(()));
        assert_eq!(b.gat_inhoud(kort), Some(Vec::new()));
        assert!(b.dekt_hele_document(kort));
        // Tweede stuk van lengte 0: het bereik eindigt direct na het gat.
        let b = Bytebereik::uit_getallen(&[0, 2, 4, 0], kort.len()).unwrap();
        assert_eq!(b.einde(), 4);
        assert_eq!(b.delen(kort).unwrap(), [b"ab".as_slice(), b"".as_slice()]);
        assert!(!b.dekt_hele_document(kort));
        let b = Bytebereik::uit_getallen(&[0, 2, 4, 0], 4).unwrap();
        assert!(b.dekt_hele_document(&kort[..4]));
        // Gat zonder afsluitende `>`, en `>` midden in het gat.
        let open = b"ab<0Acd";
        let b = Bytebereik::uit_getallen(&[0, 2, 5, 2], open.len()).unwrap();
        assert_eq!(b.controleer_gat(open), Err(BereikFout::GatGeenHexString));
        assert_eq!(b.gat_inhoud(open), None);
        let midden = b"ab<0A>1b>cd";
        let b = Bytebereik::uit_getallen(&[0, 2, 9, 2], midden.len()).unwrap();
        assert_eq!(b.controleer_gat(midden), Err(BereikFout::GatGeenHexString));
    }

    #[test]
    fn gat_inhoud_zoals_een_pdf_lezer_hem_decodeert() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], PDF.len()).unwrap();
        assert_eq!(b.gat_inhoud(PDF), Some(vec![0x0A, 0x1B]));
        let oneven = b"%PDF-1.7 hallo <0A 1\nb 3> einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 25, 6], oneven.len()).unwrap();
        assert_eq!(b.gat_inhoud(oneven), Some(vec![0x0A, 0x1B, 0x30]));
    }

    #[test]
    fn foutmelding_is_leesbaar() {
        assert_eq!(BereikFout::GatGeenHexString.to_string(), "het gat in het bytebereik is geen hex-string");
    }

    #[test]
    fn elke_fout_heeft_een_eigen_signaal() {
        let fouten = [
            BereikFout::GeenVierGetallen,
            BereikFout::Negatief,
            BereikFout::BeginNietNul,
            BereikFout::GatTeKlein,
            BereikFout::VoorbijEinde,
            BereikFout::GatGeenHexString,
        ];
        let signalen: std::collections::HashSet<_> = fouten.iter().map(BereikFout::signaal).collect();
        assert_eq!(signalen.len(), fouten.len());
        assert!(signalen.iter().all(|s| crate::handtekening::status::signaal::ALLE.contains(s)));
    }
}
