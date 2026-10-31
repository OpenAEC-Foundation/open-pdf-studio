//! RFC 3161-verzoek aan een tijdstempeldienst bouwen en het antwoord lezen. De
//! HTTP-verbinding zelf maakt de app-crate (POST met
//! `Content-Type: application/timestamp-query`); deze module blijft zonder I/O.

use der::asn1::{OctetString, Uint};
use der::{Encode, Sequence};
use sha2::{Digest, Sha256};
use spki::AlgorithmIdentifierOwned;

use super::ber::{kinderen, lees_tlv};
use super::cms_bouw::ID_SHA256;
use super::status::Integriteit;
use super::tijdstempel::controleer_token;

/// MessageImprint ::= SEQUENCE { hashAlgorithm AlgorithmIdentifier, hashedMessage OCTET STRING }
#[derive(Clone, Debug, Eq, PartialEq, Sequence)]
struct MessageImprint {
    hash_algorithm: AlgorithmIdentifierOwned,
    hashed_message: OctetString,
}

/// TimeStampReq (RFC 3161 §2.4.1), zonder beleid en extensies.
#[derive(Clone, Debug, Eq, PartialEq, Sequence)]
struct TimeStampReq {
    version: u8,
    message_imprint: MessageImprint,
    #[asn1(optional = "true")]
    nonce: Option<Uint>,
    /// certReq TRUE: het token bevat het certificaat van de dienst.
    #[asn1(optional = "true")]
    cert_req: Option<bool>,
}

/// Een verzoek met SHA-256-imprint over `handtekeningwaarde` en een willekeurige
/// nonce. Geeft de DER van het verzoek en de nonce (voor de controle).
pub fn verzoek(handtekeningwaarde: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let mut nonce = [0u8; 8];
    rand::Rng::fill(&mut rand::thread_rng(), &mut nonce);
    // Positief en zonder voorloopnul in de minimale codering.
    nonce[0] = (nonce[0] & 0x7F) | 0x01;
    let req = TimeStampReq {
        version: 1,
        message_imprint: MessageImprint {
            hash_algorithm: AlgorithmIdentifierOwned { oid: ID_SHA256, parameters: None },
            hashed_message: OctetString::new(Sha256::digest(handtekeningwaarde).to_vec()).map_err(|e| e.to_string())?,
        },
        nonce: Some(Uint::new(&nonce).map_err(|e| e.to_string())?),
        cert_req: Some(true),
    };
    Ok((req.to_der().map_err(|e| e.to_string())?, nonce.to_vec()))
}

/// Haalt het TimeStampToken uit een TimeStampResp (RFC 3161 §2.4.2) en
/// controleert het: status granted, imprint over `handtekeningwaarde`, de
/// handtekening van de dienst, en de nonce uit het verzoek.
pub fn token_uit_antwoord(antwoord: &[u8], handtekeningwaarde: &[u8], nonce: &[u8]) -> Result<Vec<u8>, String> {
    let (resp, _) = lees_tlv(antwoord).map_err(|e| format!("antwoord onleesbaar: {e}"))?;
    if resp.tag != 0x30 {
        return Err("antwoord is geen TimeStampResp".to_string());
    }
    let delen = kinderen(resp.inhoud).map_err(|e| format!("antwoord onleesbaar: {e}"))?;
    let status = delen.first().ok_or("antwoord zonder status")?;
    let status_delen = kinderen(status.inhoud).map_err(|e| format!("status onleesbaar: {e}"))?;
    let code = status_delen.first().filter(|t| t.tag == 0x02).ok_or("status onleesbaar")?;
    // 0 = granted, 1 = grantedWithMods.
    if !matches!(code.inhoud, [0] | [1]) {
        return Err(format!("de tijdstempeldienst weigerde het verzoek (status {:?})", code.inhoud));
    }
    let token = delen.get(1).ok_or("antwoord zonder tijdstempel")?;
    let uitkomst = controleer_token(token.geheel, &[handtekeningwaarde]);
    if uitkomst.integriteit != Integriteit::Intact {
        return Err(format!(
            "het tijdstempel klopt niet ({:?}{})",
            uitkomst.integriteit,
            uitkomst.detail.map(|d| format!(": {d}")).unwrap_or_default()
        ));
    }
    if !bevat_nonce(token.geheel, nonce) {
        return Err("het tijdstempel hoort niet bij dit verzoek (nonce wijkt af)".to_string());
    }
    Ok(token.geheel.to_vec())
}

/// Zoekt de nonce als INTEGER in de TSTInfo van het token. Eenvoudig maar
/// voldoende: de TSTInfo is ondertekend en de nonce is 8 willekeurige bytes.
fn bevat_nonce(token: &[u8], nonce: &[u8]) -> bool {
    let mut zoek = vec![0x02, nonce.len() as u8];
    zoek.extend_from_slice(nonce);
    token.windows(zoek.len()).any(|w| w == zoek.as_slice())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verzoek_is_geldige_der_met_sha256_en_nonce() {
        let (der, nonce) = verzoek(b"handtekening").unwrap();
        let (seq, rest) = lees_tlv(&der).unwrap();
        assert!(rest.is_empty());
        let delen = kinderen(seq.inhoud).unwrap();
        assert_eq!(delen.len(), 4);
        assert_eq!(delen[0].inhoud, [1]);
        let imprint = kinderen(delen[1].inhoud).unwrap();
        assert_eq!(imprint[1].inhoud, Sha256::digest(b"handtekening").as_slice());
        assert_eq!(delen[2].inhoud, nonce.as_slice());
        assert_eq!(delen[3].geheel, [0x01, 0x01, 0xFF]);
    }

    #[test]
    fn geweigerd_of_onleesbaar_antwoord_is_een_fout() {
        // TimeStampResp { status { 2 (rejection) } }
        let geweigerd = [0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02];
        assert!(token_uit_antwoord(&geweigerd, b"x", &[1]).unwrap_err().contains("weigerde"));
        assert!(token_uit_antwoord(b"rommel", b"x", &[1]).is_err());
        let zonder_token = [0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00];
        assert!(token_uit_antwoord(&zonder_token, b"x", &[1]).unwrap_err().contains("zonder tijdstempel"));
    }
}
