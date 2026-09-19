# PKCS#12-testfixtures

Wegwerpcertificaten, uitsluitend voor tests. Niet gebruiken voor echte
ondertekening.

- Wachtwoord: `proef123`
- Eén RSA-2048-sleutel met zelfondertekend certificaat `CN=OPDS Test Ondertekenaar`,
  sleutelgebruik digitalSignature en nonRepudiation, tien jaar geldig.

| Bestand | Gemaakt met | Versleuteling | MAC |
|---|---|---|---|
| `windows-export-3des.p12` | `Export-PfxCertificate -CryptoAlgorithmOption TripleDES_SHA1` | PKCS#12-PBE 3DES | SHA-1 |
| `certutil-3des.p12` | `certutil -exportPFX` | PKCS#12-PBE 3DES | SHA-1 |
| `openssl3-aes256.p12` | `openssl pkcs12 -export` (OpenSSL 3) | PBES2, AES-256-CBC | SHA-256 |
| `zonder-mac-3des.p12` | `openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -nomac` (OpenSSL 3.5) | sleutel PKCS#12-PBE 3DES; certificaat onversleuteld (OpenSSL versleutelt het certificaat niet bij `-nomac`) | geen |
| `zonder-wachtwoord.p12` | `openssl pkcs12 -export -passout pass:` (OpenSSL 3.5) | PBES2, AES-256-CBC | SHA-256 |
| `alleen-certificaat.p12` | `openssl pkcs12 -export -nokeys` (OpenSSL 3.5) | certificaat PBES2, AES-256-CBC; geen privésleutel | SHA-256 |
| `sleutel-zonder-certificaat.p12` | `openssl pkcs12 -export -nocerts` (OpenSSL 3.5) | sleutel PBES2, AES-256-CBC; geen certificaat | SHA-256 |

Zelfde sleutel en certificaat in alle bestanden (voor zover aanwezig), zodat een test per exportformaat
precies dezelfde uitkomst mag verwachten.

De laatste vier zijn gemaakt uit `windows-export-3des.p12` (sleutel en
certificaat via een tijdelijke PEM, direct weer verwijderd). Wachtwoord van
`zonder-mac-3des.p12` is `proef123`; `zonder-wachtwoord.p12` heeft een leeg
wachtwoord, dat de MAC als BMP `00 00` bevestigt (wachtwoordvorm `Leeg`).
`alleen-certificaat.p12` en `sleutel-zonder-certificaat.p12` hebben wachtwoord
`proef123` en dienen voor de meldingen "geen privésleutel" en "geen certificaat".

Een bestand zonder MAC waarin ook het certificaat versleuteld is, maken de
tests zelf door de MacData uit `windows-export-3des.p12` weg te laten.
