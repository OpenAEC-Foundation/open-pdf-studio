# Certificaat-testfixtures

Wegwerpcertificaten, uitsluitend voor tests.

- `ed25519-zonder-keyusage.der`: zelfondertekend Ed25519-certificaat `CN=OPDS Ed25519 Test`,
  tien jaar geldig, met basicConstraints en subjectKeyIdentifier (geen keyUsage). Gemaakt met
  `openssl req -x509 -new -key <ed25519-sleutel> -subj "/CN=OPDS Ed25519 Test" -days 3650
  -config <leeg bestand> -addext "basicConstraints=critical,CA:FALSE" -outform DER`
  (OpenSSL 3.5); de sleutel is direct weer verwijderd. Dient als voorbeeld van een
  niet-ondersteund sleuteltype zonder sleutelgebruik-extensie.
