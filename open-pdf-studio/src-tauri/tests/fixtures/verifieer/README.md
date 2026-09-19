# Testfixtures voor het verifiëren van handtekeningen

Wegwerpcertificaten en handtekeningen, uitsluitend voor tests. Opnieuw aan te
maken met `maak-fixtures.sh` (OpenSSL 3, Git Bash); de privésleutels bestaan
alleen tijdens dat script in een tijdelijke map.

`maak-fixtures.sh los` maakt alleen de twee fixtures met een eigen certificaat
(`cms-attribuutvolgorde.der`, `cms-sleutel-id.der`) opnieuw en laat de andere
bestanden ongemoeid. OpenSSL heeft geen optie voor een afwijkende
attribuutvolgorde; het script herschikt de attributen met een klein
Python-script, tekent de nieuwe SET (tag `0x31`) met `openssl pkeyutl -sign` en
controleert beide fixtures met `openssl cms -verify`.

`maak-fixtures.sh rsa8192` maakt alleen de keten onder een RSA-8192-wortel
(`root-rsa8192.der`, `blad-onder-rsa8192.der`, `blad-sha1-onder-rsa8192.der`)
opnieuw en laat de andere bestanden ongemoeid.

`maak-fixtures.sh zonder-attributen` maakt alleen `cms-zonder-attributen.der`
opnieuw, met een eigen tijdelijke sleutel, en laat de andere bestanden
ongemoeid.

`maak-fixtures.sh zelfuitgegeven` maakt alleen `z-zelfuitgegeven.der` en
`z-blad.der` (voor het knoopbudget van de ketenzoektocht) en
`maak-fixtures.sh eku` alleen de `e-*.der`-fixtures (extendedKeyUsage van
tussencertificaten), elk met eigen tijdelijke sleutels; de andere bestanden
blijven ongemoeid.

`maak-fixtures.sh keten` maakt alleen de `k-*.der`-fixtures voor de strengere
ketencontrole opnieuw (eigen wortel `CN=OPDS Test Ketenwortel`, RSA-2048, en
een P-256-keten van elf certificaten) en laat de andere bestanden ongemoeid.

| Bestand | Inhoud |
|---|---|
| `data.bin` | ondertekende inhoud |
| `root.der` | `CN=OPDS Test Root`, RSA-2048, CA |
| `tussen.der` | `CN=OPDS Test Tussen`, CA, uitgegeven door root |
| `blad.der` | `CN=OPDS Test Blad`, digitalSignature + nonRepudiation, uitgegeven door tussen |
| `blad-verkeerd-gebruik.der` | zelfde sleutel, alleen keyEncipherment |
| `ec.der` | `CN=OPDS Test EC`, P-256, uitgegeven door tussen |
| `tsa.der` | `CN=OPDS Test TSA`, EKU timeStamping (kritiek), uitgegeven door tussen |
| `ec-root.der` | `CN=OPDS Test EC Root`, P-384, CA |
| `blad-onder-ec-root.der` | blad-sleutel, ecdsa-with-SHA384 door EC-root |
| `root-rsa8192.der` | `CN=OPDS Test Root RSA-8192`, RSA-8192, CA (sleutel groter dan 4096 bits) |
| `blad-onder-rsa8192.der` | `CN=OPDS Test Blad onder RSA-8192`, RSA-2048, digitalSignature + nonRepudiation, sha256WithRSAEncryption door de RSA-8192-wortel |
| `blad-sha1-onder-rsa8192.der` | zelfde sleutel en naam, sha1WithRSAEncryption door de RSA-8192-wortel |
| `cms-rsa-sha256.der` | detached CMS over `data.bin`, `rsaEncryption` + SHA-256 |
| `cms-rsa-pss.der` | idem, RSASSA-PSS SHA-256 |
| `cms-ec-p256-sha384.der` | idem, ecdsa-with-SHA384 met de EC-sleutel |
| `cms-zonder-certificaat.der` | idem, zonder ingebedde certificaten |
| `cms-rsa-ber.der` | als `cms-rsa-sha256.der` maar BER met onbepaalde lengtes én ingebedde eContent (`-stream`); via `integriteit_cms` niet te controleren, ondertekenaar los intact |
| `tst-data.der` | RFC 3161-token over `data.bin`, SHA-256, door de TSA |
| `cms-attribuutvolgorde.der` | detached CMS over `data.bin`, SHA-256, eigen zelfondertekend certificaat `CN=OPDS Test Los` (RSA-2048); ondertekende attributen in omgekeerde DER-volgorde en opnieuw ondertekend over die volgorde, dus hersorteren breekt de handtekening |
| `cms-zonder-attributen.der` | detached CMS over `data.bin` zonder ondertekende attributen (`-noattr`), `rsaEncryption` + SHA-256, eigen zelfondertekend certificaat `CN=OPDS Test Zonder Attributen` (RSA-2048) |
| `cms-sleutel-id.der` | detached CMS over `data.bin`, SHA-256, zelfde soort certificaat; SignerIdentifier is de subjectKeyIdentifier (`-keyid`) |
| `k-root.der` | `CN=OPDS Test Ketenwortel`, CA |
| `k-root-verlopen.der` | zelfde sleutel en naam, geldig van 2000 tot 2001 |
| `k-tussen.der` | `CN=OPDS Test Ketentussen`, CA, uitgegeven door k-root |
| `k-tussen-kruis.der` | zelfde sleutel en naam als k-tussen, uitgegeven door een wortel die nergens in staat (doodlopend) |
| `k-blad-email.der` | `CN=OPDS Test Ketenblad`, EKU emailProtection, onder k-tussen |
| `k-blad-serverauth.der` | zelfde sleutel, EKU alleen serverAuth |
| `k-blad-onbekend-kritiek.der` | zelfde sleutel, onbekende kritieke extensie `1.3.6.1.4.1.55555.1` |
| `k-blad-beleid-kritiek.der` | zelfde sleutel, kritieke certificatePolicies en subjectAltName |
| `k-tsa-niet-kritiek.der` | zelfde sleutel, EKU timeStamping niet kritiek |
| `k-tsa-extra-eku.der` | zelfde sleutel, EKU kritiek met timeStamping en emailProtection |
| `k-tussen-pathlen0.der` | CA met pathlen 0, onder k-root |
| `k-subtussen.der` | CA onder k-tussen-pathlen0 (schendt pathlen) |
| `k-blad-onder-subtussen.der` | blad onder k-subtussen |
| `k-tussen-v1.der` | v1-certificaat zonder extensies, onder k-root |
| `k-blad-onder-v1.der` | blad onder k-tussen-v1 |
| `k-wortel-v1.der` | zelfondertekende v1-wortel zonder extensies |
| `k-blad-onder-wortel-v1.der` | blad onder k-wortel-v1 |
| `k-wortel-zonder-bc.der` | zelfondertekende v3-wortel zonder basicConstraints, keyUsage alleen digitalSignature |
| `k-blad-onder-wortel-zonder-bc.der` | blad onder k-wortel-zonder-bc |
| `k-tussen-naambeperking.der` | CA met kritieke nameConstraints, onder k-root |
| `k-blad-onder-naambeperking.der` | blad onder k-tussen-naambeperking |
| `k-tussen-verlopen.der` | CA onder k-root, geldig van 2000 tot 2001 |
| `k-blad-onder-tussen-verlopen.der` | blad (nu geldig) onder k-tussen-verlopen |
| `k-tst-zonder-timestamping.der` | tijdstempeltoken met de TSTInfo uit `tst-data.der`, ondertekend met k-blad-email (geen timeStamping), met k-tussen |
| `k-lange-keten.der` | elf P-256-certificaten als DER achter elkaar, blad eerst: `OPDS Test Lang 0` (blad) tot `OPDS Test Lang 10` (wortel) |
| `z-zelfuitgegeven.der` | tien zelfuitgegeven CA-certificaten `CN=OPDS Test Zelfuitgegeven` (onderwerp = uitgever) met één RSA-2048-sleutel en elk een eigen serienummer, als DER achter elkaar: elk ondertekent elk |
| `z-blad.der` | `CN=OPDS Test Zelfuitgegeven Blad`, EKU emailProtection, uitgegeven onder die naam en sleutel |
| `e-root.der` | `CN=OPDS Test EKU-wortel`, CA |
| `e-tussen-serverauth.der`, `e-tussen-email.der`, `e-tussen-timestamping.der`, `e-tussen-any.der` | CA's onder e-root met extendedKeyUsage alleen serverAuth, alleen emailProtection, alleen timeStamping en anyExtendedKeyUsage |
| `e-blad-onder-<soort>.der` | `CN=OPDS Test EKU-blad`, EKU emailProtection, onder `e-tussen-<soort>` |
| `e-tsa-onder-<soort>.der` | zelfde sleutel en naam, EKU kritiek en alleen timeStamping, onder `e-tussen-<soort>` |

Alle certificaten zijn tien jaar geldig vanaf het aanmaakmoment (behalve
`k-root-verlopen.der` en `k-tussen-verlopen.der`, 2000–2001); tests lezen
de geldigheid uit het certificaat en hangen niet van de huidige datum af.
