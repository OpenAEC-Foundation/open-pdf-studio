# Digitale handtekeningen, deel 1: PKCS#12-lezer — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een `.p12`/`.pfx`-bestand betrouwbaar openen in pure Rust en de certificaatgegevens teruggeven via het Tauri-commando `pdf_certificate_info`.

**Architecture:** Nieuwe Rust-map `src-tauri/src/handtekening/` met twee modules: `pkcs12.rs` (MAC controleren, ontsleutelen, sleutel en certificaten eruit, ondertekenaar kiezen) en `certificaat.rs` (certificaatgegevens, foutcodes, Tauri-commando). Getoetst tegen een extern corpus van 31 PKCS#12-bestanden (vastgepind op commit, met SHA-256-controle) en drie eigen RSA-fixtures. Dit is deel 1 van 3 uit de spec; verifiëren en ondertekenen volgen in eigen plannen.

**Tech Stack:** Rust, RustCrypto op de `der 0.7`-lijn (`pkcs12 0.1`, `pkcs5 0.7`, `cms 0.2`, `x509-cert 0.2`, `rsa 0.9`), Tauri 2, Python 3 (testdata-script), PowerShell en OpenSSL (fixtures).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-16-digitale-handtekeningen-design.md` (§5 PKCS#12-lezer, §9.2 testcorpus, §10 buiten scope).
- Werk in een eigen worktree op branch `feat/handtekeningen`; nooit in de hoofd-checkout. `$RIGMAP` is een eigen, tijdelijke map voor de testinstantie van de app.
- Alle RustCrypto-crates op de `der 0.7`-lijn. Niet mengen met `der 0.8`, `x509-cert 0.3`, `pkcs8 0.11`, `sha2 0.11` of `const-oid 0.10`: dat levert onverenigbare typen op.
- Versleuteling die ondersteund moet worden: PKCS#12-PBE 3DES (`1.2.840.113549.1.12.1.3`) en RC2-40 (`1.2.840.113549.1.12.1.6`), PBES2 (`1.2.840.113549.1.5.13`) met PBKDF2-HMAC-SHA1/-SHA256 en AES-256-CBC, en onversleutelde inhoud. MAC: HMAC-SHA1 en HMAC-SHA256.
- PKCS#12 onderscheidt een leeg wachtwoord (BMP `00 00`) van géén wachtwoord (lege bytes); beide proberen bij een leeg ingevoerd wachtwoord.
- Geen paniek en geen `unwrap`/`expect` op invoer uit een bestand in productiecode.
- Alleen RSA-sleutels zijn ondersteund voor ondertekenen; andere sleuteltypen geven een nette melding (spec §10).
- Bestanden van derden (het corpus) komen niet in de repo; alleen het script en het manifest.
- Geen namen van commerciële derde partijen in code, comments, docs of commits. Geen lokale werkpaden of persoonsgebonden paden in de repo.
- Commit-berichten zonder AI-attributie; niet pushen.
- Vóór elke commit: `cargo test --lib handtekening` groen (vanaf Task 3); `npm run test:unit` en `npx vite build` blijven groen.
- Build altijd met `CARGO_TARGET_DIR="$BUILDMAP"`: een eigen build-map buiten gesynchroniseerde mappen.

---

### Task 1: Testdata ophalen met vastgepind manifest

**Files:**
- Create: `scripts/handtekening-testdata.json`
- Create: `scripts/haal-handtekening-testdata.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: map `testdata/handtekeningen/pkcs12/<bestand>` en `testdata/handtekeningen/pades/<bestand>`; manifest met per PKCS#12-bestand `wachtwoord` (string), `sleutel` (bool), `certificaten` (int), `namen` (string[]), `ondertekenaar` (bool); per PAdES-bestand `verwacht` (string).

- [ ] **Step 1: Manifest aanmaken**

`scripts/handtekening-testdata.json` (letterlijk; de hashes en verwachtingen zijn gemeten):

```json
{
  "doel": "testdata/handtekeningen",
  "bronnen": {
    "pkcs12": {
      "repo": "pyca/cryptography",
      "commit": "2ad2c2b06e1ec374c05f0d8291cadce08eb7d102",
      "pad": "vectors/cryptography_vectors/pkcs12",
      "licentie": "Apache-2.0 OR BSD-3-Clause",
      "wachtwoorden": "volgens tests/hazmat/primitives/test_pkcs12.py in dezelfde commit; de corpusdocumentatie noemt voor *-pwd ten onrechte 'cryptography'",
      "bestanden": [
        {
          "bestand": "cert-aes256cbc-no-key.p12",
          "bytes": 605,
          "sha256": "aea2ba682f526f4425c1dd5f3b98b3817e6b1a64d5cb58c3957703bdc1e82b04",
          "wachtwoord": "cryptography",
          "sleutel": false,
          "certificaten": 1,
          "namen": [],
          "ondertekenaar": false
        },
        {
          "bestand": "cert-key-aes256cbc.p12",
          "bytes": 948,
          "sha256": "a7b8f2cf403ff9054dd7337e0d9bccfb72742b859bd73b1e7833ae800cceb213",
          "wachtwoord": "cryptography",
          "sleutel": true,
          "certificaten": 1,
          "namen": [],
          "ondertekenaar": true
        },
        {
          "bestand": "cert-none-key-none.p12",
          "bytes": 756,
          "sha256": "de7ea73ece83b8172466ff97f00cae0942a460e63f9a130ccf7d784fe7296b1e",
          "wachtwoord": "cryptography",
          "sleutel": true,
          "certificaten": 1,
          "namen": [],
          "ondertekenaar": true
        },
        {
          "bestand": "cert-rc2-key-3des.p12",
          "bytes": 854,
          "sha256": "0af54d61e727c41afaa67053ea34251c118cb291de7a57826a37fff9d5ccb4aa",
          "wachtwoord": "cryptography",
          "sleutel": true,
          "certificaten": 1,
          "namen": [],
          "ondertekenaar": true
        },
        {
          "bestand": "java-truststore.p12",
          "bytes": 2845,
          "sha256": "bffae9d410f390f10444747d3951d22811dab81925bf49321e61e65a5167d790",
          "wachtwoord": "",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "cert1"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "name-1-no-pwd.p12",
          "bytes": 3539,
          "sha256": "5c5aae3adf2fa007f09192fe6993f7429d1b0e22de4f6d728bee6643743ba5ac",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-1-pwd.p12",
          "bytes": 3639,
          "sha256": "c7b1ff964c5f3100ca89b4f45d31734f55683d0acc1e5b9103122436bba5f575",
          "wachtwoord": "password",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-2-3-no-pwd.p12",
          "bytes": 3547,
          "sha256": "0105a8fef5ddc843de0cf838371d53075ce66eb3bba2c0616b02c80404a8c6ed",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name2",
            "name3"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-2-3-pwd.p12",
          "bytes": 3650,
          "sha256": "2567aefaab51f6dec295a4189d4a0315c88cf3f273b3a1e5622d961f05e9c45d",
          "wachtwoord": "password",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name2",
            "name3"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-2-no-pwd.p12",
          "bytes": 3518,
          "sha256": "3d69cfd221d2e8eb5e9aa4956ddb9efb895d0403df9fd3679e7a9b0c5eff27cf",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name2"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-2-pwd.p12",
          "bytes": 3618,
          "sha256": "6ff949954ded296da1ec58c3aee5c36b88f0688ede2afad5ef435810edf061d3",
          "wachtwoord": "password",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name2"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-3-no-pwd.p12",
          "bytes": 3518,
          "sha256": "938ef66f16e237515a843e85f0660e34d827a7b601a6ce332d8801d77a9a98ac",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name3"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-3-pwd.p12",
          "bytes": 3618,
          "sha256": "a9bb92d06e039a67a0b1d021763d11f98cd5904259ad6caab4a3ff01d7027976",
          "wachtwoord": "password",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name3"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-all-no-pwd.p12",
          "bytes": 3597,
          "sha256": "c4a0f933f3b68b6d9efdf11725483f637fd9bc8e2074043fa8b9e0e20323fc91",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name",
            "name2",
            "name3"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-all-pwd.p12",
          "bytes": 3703,
          "sha256": "4208b92777e31b8efaafa23362491b1990af947693a6dbe000a0670febe56f4c",
          "wachtwoord": "password",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "name",
            "name2",
            "name3"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-unicode-no-pwd.p12",
          "bytes": 3569,
          "sha256": "a02b0ee6edc706ebe730c952479d158f5f5d7a74e006ed2020f5d76b4a62e345",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "☺",
            "ä",
            "ç"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "name-unicode-pwd.p12",
          "bytes": 3672,
          "sha256": "566614621a1c47672437d03f3c3426949bd51720344a36a415f01b3341f0ae75",
          "wachtwoord": "password",
          "sleutel": true,
          "certificaten": 3,
          "namen": [
            "☺",
            "ä",
            "ç"
          ],
          "ondertekenaar": true
        },
        {
          "bestand": "no-cert-key-aes256cbc.p12",
          "bytes": 353,
          "sha256": "076c214f982d805ef3cc6670595bc2989694cae98b44ad8f67767dfe10d4ffa8",
          "wachtwoord": "cryptography",
          "sleutel": true,
          "certificaten": 0,
          "namen": [],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-2-no-pwd.p12",
          "bytes": 2874,
          "sha256": "7d4c4443b4a63df17e65026b0be144e71c1ae2622b785bca7b9be1892e7dcc5f",
          "wachtwoord": "",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "name2"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-2-pwd.p12",
          "bytes": 2932,
          "sha256": "7d5d154ea4c57323b4a4922824e85867570e14fa601c0a6d078bc0d2888dd7c6",
          "wachtwoord": "password",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "name2"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-3-no-pwd.p12",
          "bytes": 2874,
          "sha256": "2397197bf17d842ad6e01e16838921cdf5c4e289044a5b5b4875c14b796b013a",
          "wachtwoord": "",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "name3"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-3-pwd.p12",
          "bytes": 2932,
          "sha256": "0f75afc6ca7169d899d5490e5a23c804bb2567c41f2471cdedb8e85e6834ffc2",
          "wachtwoord": "password",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "name3"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-all-no-pwd.p12",
          "bytes": 2903,
          "sha256": "d9375e12fb7da37889fe039f514753c39af90bea1acff8e698b2a3c0f2545a53",
          "wachtwoord": "",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "name2",
            "name3"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-all-pwd.p12",
          "bytes": 2956,
          "sha256": "903a5a638d7ebb19fcb4b6c933794d29550b76c918455414e1a98cc275836724",
          "wachtwoord": "password",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "name2",
            "name3"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-unicode-no-pwd.p12",
          "bytes": 2887,
          "sha256": "f522b4e2044c70a1c64ac80b861f40740b5fb5dc0074dc71cdc1d675a00022ff",
          "wachtwoord": "",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "☹",
            "ï"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-name-unicode-pwd.p12",
          "bytes": 2940,
          "sha256": "5fde5234970215e68e85f76b644e921eadaf656ae1a1c2206a89caa0353cf86e",
          "wachtwoord": "password",
          "sleutel": false,
          "certificaten": 2,
          "namen": [
            "☹",
            "ï"
          ],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-no-name-no-pwd.p12",
          "bytes": 2845,
          "sha256": "de2550a9bcee2934b6366876d421fd3ea8cedfc8652a6bb904b91aad9148250a",
          "wachtwoord": "",
          "sleutel": false,
          "certificaten": 2,
          "namen": [],
          "ondertekenaar": false
        },
        {
          "bestand": "no-cert-no-name-pwd.p12",
          "bytes": 2900,
          "sha256": "17615fc3090482251d19fe5d82996a3d5a6b6ef434d342348263c0bfddf69b02",
          "wachtwoord": "password",
          "sleutel": false,
          "certificaten": 2,
          "namen": [],
          "ondertekenaar": false
        },
        {
          "bestand": "no-name-no-pwd.p12",
          "bytes": 3489,
          "sha256": "f10e2bb83a482429202112da201253d2458e53a50e18124d2615250e618abed7",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 3,
          "namen": [],
          "ondertekenaar": true
        },
        {
          "bestand": "no-name-pwd.p12",
          "bytes": 3586,
          "sha256": "58084a5da72dd02e3a6b8a8d32936b8fd50205a2186a15b0fc863f18250fb2ec",
          "wachtwoord": "password",
          "sleutel": true,
          "certificaten": 3,
          "namen": [],
          "ondertekenaar": true
        },
        {
          "bestand": "no-password.p12",
          "bytes": 948,
          "sha256": "cc48f8a70f807e6c64cc7e269685ee29ca1d7ed36934bbf882a7f0845515425d",
          "wachtwoord": "",
          "sleutel": true,
          "certificaten": 1,
          "namen": [
            "cryptography CA"
          ],
          "ondertekenaar": true
        }
      ]
    },
    "pades": {
      "repo": "esig/dss",
      "commit": "c8aea1f90958a851f651fe39f1575fcbd6d4a11d",
      "pad": "dss-pades/src/test/resources/validation",
      "licentie": "LGPL-2.1",
      "bestanden": [
        {
          "bestand": "pades-bes.pdf",
          "bytes": 157068,
          "sha256": "5ad09bb81479f5a1eca46f17a9e37ee002b0a124f3b0327137d43a2f27e9ce73",
          "verwacht": "intact"
        },
        {
          "bestand": "pades3_Baseline_B.pdf",
          "bytes": 387414,
          "sha256": "da288b9ffa67843790b0f30bffe8a901e5490e5e901413ba99875a992b8e7112",
          "verwacht": "intact"
        },
        {
          "bestand": "doc-firmado.pdf",
          "bytes": 70733,
          "sha256": "36b4294a34169d769eae02208ca3c1fd738213a73925289e7618d9411ddeaee0",
          "verwacht": "intact"
        },
        {
          "bestand": "doc-firmado-T.pdf",
          "bytes": 28316,
          "sha256": "cdac360bb3f545ecd6dbc6f622511e3d06e5aca7e77ce2243d7806e18721ba35",
          "verwacht": "intact (met tijdstempel)"
        },
        {
          "bestand": "doc-firmado-LT.pdf",
          "bytes": 49311,
          "sha256": "130ff45493c0cff873b44662bf9bb609820fabe4a0e666604ae1ac2795059eaf",
          "verwacht": "intact (LT)"
        },
        {
          "bestand": "hello_signed_INCSAVE_signed.pdf",
          "bytes": 235978,
          "sha256": "af63353c955aaa66612d87e7340d19726b8127a138fd393dd67840c1dc905625",
          "verwacht": "intact"
        },
        {
          "bestand": "hello_signed_INCSAVE_signed_EDITED.pdf",
          "bytes": 235978,
          "sha256": "cf1ab7b64dc49ee47d101133a57cc51e604eb23dbabb2075732d41804831aba9",
          "verwacht": "gewijzigd"
        },
        {
          "bestand": "modified_after_signature.pdf",
          "bytes": 786071,
          "sha256": "0e41604c8a394bb2cb7aa402cfa6433ce64e49746668b406764561bfc34fdbcf",
          "verwacht": "gewijzigd"
        },
        {
          "bestand": "pades-signed-annot-added.pdf",
          "bytes": 85676,
          "sha256": "cd20365310578663d2f289713de914fb8d5021ed1a801e87ff80c7b7939a1c52",
          "verwacht": "annotatie na ondertekenen toegevoegd"
        },
        {
          "bestand": "pades-5-signatures-and-1-document-timestamp.pdf",
          "bytes": 335556,
          "sha256": "962dd61443f8c124aa029bef2d2150712ed2bc895b2646f38af5f0f9d7bedc8e",
          "verwacht": "meerdere handtekeningen"
        },
        {
          "bestand": "pades-bes-no-certificates.pdf",
          "bytes": 157046,
          "sha256": "5ddf35d7e4268ccb9ead0c49ec0836adb30e2e906ee32e2cef6d4b4d39c0338d",
          "verwacht": "geen certificaat ingebed"
        },
        {
          "bestand": "pades-unsupported-signature-algorithm.pdf",
          "bytes": 156916,
          "sha256": "95bbb8f6017b6df2e00b5972157dbf5ebab09d0cd64c977c816c665564ff73f9",
          "verwacht": "niet-ondersteund algoritme"
        },
        {
          "bestand": "BadEncodedCMS.pdf",
          "bytes": 40272,
          "sha256": "08a33cdbf5b278673a014dfef524cd029fd13c2a286c1deeb91d9c4b60e5ade1",
          "verwacht": "misvormd (mag niet crashen)"
        },
        {
          "bestand": "malformed-pades.pdf",
          "bytes": 151126,
          "sha256": "d5527730c8d2b8ac138db19f506c3cdfc7c8d00fde56560366bd3083eaa5059e",
          "verwacht": "misvormd (mag niet crashen)"
        },
        {
          "bestand": "malformed-rsa-digestinfo.pdf",
          "bytes": 53996,
          "sha256": "0d79e75f95c6de49a1932c7b50578e46568906f87a3ef6c41a7b327f8b9f0eff",
          "verwacht": "misvormd (mag niet crashen)"
        },
        {
          "bestand": "encrypted.pdf",
          "bytes": 160397,
          "sha256": "3548e285787f5b4690202636f904852c84421338200b6b0ccaa9883348c5cb71",
          "verwacht": "versleuteld document"
        },
        {
          "bestand": "pades-spoofing-replaced-reason.pdf",
          "bytes": 177114,
          "sha256": "14b7f31cda8b6966a162c3639d7cb1f092565b8ee95f84734455c3b595174ac2",
          "verwacht": "aanval: vervangen reden"
        },
        {
          "bestand": "pades-alter-signature-appearance-modify-stream.pdf",
          "bytes": 72252,
          "sha256": "939db0e5f65f743de28b62562730dad8fcede57f5e4596990c8f9fdd1f4f2d5a",
          "verwacht": "aanval: gewijzigde weergave"
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Script schrijven**

`scripts/haal-handtekening-testdata.py`:

```python
"""Haalt het testcorpus voor digitale handtekeningen op, vastgepind op commit.

Leest scripts/handtekening-testdata.json, downloadt ontbrekende bestanden van
raw.githubusercontent.com en controleert elk bestand op SHA-256. Bestanden van
derden komen niet in de repo: ze landen in testdata/handtekeningen/ (genegeerd).

Gebruik:
    python scripts/haal-handtekening-testdata.py              # ophalen + controleren
    python scripts/haal-handtekening-testdata.py --controleer # alleen controleren
Exit 0 als alles aanwezig en ongewijzigd is, anders 1.
"""
import hashlib
import json
import os
import sys
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO, "scripts", "handtekening-testdata.json")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    alleen_controleren = "--controleer" in sys.argv
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    doel = os.path.join(REPO, manifest["doel"])
    aanwezig, opgehaald, fouten = 0, 0, []
    for naam, bron in manifest["bronnen"].items():
        map_ = os.path.join(doel, naam)
        os.makedirs(map_, exist_ok=True)
        for f in bron["bestanden"]:
            pad = os.path.join(map_, f["bestand"])
            if os.path.exists(pad):
                with open(pad, "rb") as h:
                    if sha256(h.read()) == f["sha256"]:
                        aanwezig += 1
                        continue
                if alleen_controleren:
                    fouten.append(f"{naam}/{f['bestand']}: SHA-256 wijkt af")
                    continue
            elif alleen_controleren:
                fouten.append(f"{naam}/{f['bestand']}: ontbreekt")
                continue
            url = (f"https://raw.githubusercontent.com/{bron['repo']}/{bron['commit']}/"
                   f"{bron['pad']}/{f['bestand']}")
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    data = r.read()
            except Exception as e:  # netwerk: melden, niet crashen
                fouten.append(f"{naam}/{f['bestand']}: ophalen mislukt ({e})")
                continue
            if sha256(data) != f["sha256"]:
                fouten.append(f"{naam}/{f['bestand']}: SHA-256 van download wijkt af")
                continue
            with open(pad, "wb") as h:
                h.write(data)
            opgehaald += 1
    print(f"{aanwezig} aanwezig, {opgehaald} opgehaald, {len(fouten)} fout")
    for f in fouten:
        print("  FOUT", f)
    return 1 if fouten else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Testdata negeren**

Voeg aan `.gitignore` (repository-root) een regel toe:

```
/testdata/
```

- [ ] **Step 4: Ophalen en controleren**

Run (vanuit de worktree-root):
```bash
python scripts/haal-handtekening-testdata.py
python scripts/haal-handtekening-testdata.py --controleer
git status --short testdata | head -1
```
Expected: eerste run `0 aanwezig, 49 opgehaald, 0 fout`; tweede run `49 aanwezig, 0 opgehaald, 0 fout`; `git status` toont niets onder `testdata`.

- [ ] **Step 5: Manipulatie wordt gezien**

Run:
```bash
python -c "p='testdata/handtekeningen/pkcs12/no-password.p12'; b=bytearray(open(p,'rb').read()); b[100]^=1; open(p,'wb').write(b)"
python scripts/haal-handtekening-testdata.py --controleer; echo "exit=$?"
python scripts/haal-handtekening-testdata.py
python scripts/haal-handtekening-testdata.py --controleer; echo "exit=$?"
```
Expected: eerste controle `1 fout` met `pkcs12/no-password.p12: SHA-256 wijkt af` en `exit=1`; na het herstellen `49 aanwezig, 0 opgehaald, 0 fout` en `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/handtekening-testdata.json scripts/haal-handtekening-testdata.py .gitignore
git commit -m "test(handtekening): vastgepind testcorpus voor PKCS#12 en PAdES"
```

---

### Task 2: Eigen RSA-fixtures met tien jaar geldigheid

**Files:**
- Create: `open-pdf-studio/src-tauri/tests/fixtures/pkcs12/windows-export-3des.p12`
- Create: `open-pdf-studio/src-tauri/tests/fixtures/pkcs12/certutil-3des.p12`
- Create: `open-pdf-studio/src-tauri/tests/fixtures/pkcs12/openssl3-aes256.p12`
- Create: `open-pdf-studio/src-tauri/tests/fixtures/pkcs12/README.md`
- Modify: `.gitattributes`

**Interfaces:**
- Produces: drie `.p12`-bestanden, wachtwoord `proef123`, één RSA-2048-sleutel met certificaat `CN=OPDS Test Ondertekenaar`, sleutelgebruik digitalSignature + nonRepudiation, geldig tien jaar.

- [ ] **Step 1: `.p12` als binair markeren**

Voeg aan `.gitattributes` toe, bij de andere binaire typen:

```
*.p12      binary
*.pfx      binary
```

- [ ] **Step 2: Certificaat maken en exporteren (PowerShell)**

Run in PowerShell vanuit de worktree-root. Het certificaat staat alleen kort in het persoonlijke archief en wordt direct verwijderd:

```powershell
$map = 'open-pdf-studio\src-tauri\tests\fixtures\pkcs12'
New-Item -ItemType Directory -Force $map | Out-Null
$c = New-SelfSignedCertificate -Subject 'CN=OPDS Test Ondertekenaar' `
  -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 2048 `
  -KeyUsage DigitalSignature, NonRepudiation -KeyExportPolicy Exportable `
  -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(10)
try {
  $pw = ConvertTo-SecureString -String 'proef123' -Force -AsPlainText
  Export-PfxCertificate -Cert $c -FilePath "$map\windows-export-3des.p12" -Password $pw `
    -CryptoAlgorithmOption TripleDES_SHA1 | Out-Null
  & certutil -f -p proef123 -exportPFX -user My $c.Thumbprint "$map\certutil-3des.p12" | Select-Object -Last 1
} finally {
  Remove-Item $c.PSPath -Force
}
(Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq 'CN=OPDS Test Ondertekenaar' | Measure-Object).Count
```
Expected: `CertUtil: -exportPFX command completed successfully.` en als laatste regel `0` (niets achtergebleven in het archief).

- [ ] **Step 3: OpenSSL 3-variant**

Run (Git Bash, vanuit de worktree-root). Het tussenbestand bevat de privésleutel en wordt meteen verwijderd:

```bash
M=open-pdf-studio/src-tauri/tests/fixtures/pkcs12
T="$(mktemp -d)"
openssl pkcs12 -in "$M/windows-export-3des.p12" -passin pass:proef123 -nodes -out "$T/sleutel.pem"
openssl pkcs12 -export -in "$T/sleutel.pem" -out "$M/openssl3-aes256.p12" -passout pass:proef123 -name "OPDS Test"
rm -rf "$T"
for f in windows-export-3des certutil-3des openssl3-aes256; do
  printf "%-22s " "$f"
  openssl pkcs12 -in "$M/$f.p12" -passin pass:proef123 -info -noout 2>&1 \
    | grep -iE "^MAC:|Encrypted data:|Shrouded Keybag:" | sed 's/, Iteration [0-9]*//g' | sort -u | tr '\n' '|'
  echo
done
openssl pkcs12 -in "$M/windows-export-3des.p12" -passin pass:proef123 -nokeys 2>/dev/null \
  | openssl x509 -noout -subject -enddate
```
Expected:
- `windows-export-3des` en `certutil-3des`: `MAC: sha1` en `pbeWithSHA1And3-KeyTripleDES-CBC`;
- `openssl3-aes256`: `MAC: sha256` en `PBES2, PBKDF2, AES-256-CBC`;
- subject `CN = OPDS Test Ondertekenaar`, einddatum tien jaar vooruit.

- [ ] **Step 4: README bij de fixtures**

`open-pdf-studio/src-tauri/tests/fixtures/pkcs12/README.md`:

```markdown
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

Zelfde sleutel en certificaat in alle drie, zodat een test per exportformaat
precies dezelfde uitkomst mag verwachten.
```

- [ ] **Step 5: Commit**

```bash
git add .gitattributes open-pdf-studio/src-tauri/tests/fixtures/pkcs12
git commit -m "test(handtekening): RSA-fixtures in drie exportformaten"
```

---

### Task 3: PKCS#12-lezer

**Files:**
- Modify: `open-pdf-studio/src-tauri/Cargo.toml` (dependencies)
- Create: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`
- Create: `open-pdf-studio/src-tauri/src/handtekening/pkcs12.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (moduledeclaratie)

**Interfaces:**
- Consumes: fixtures uit Task 2; manifest en corpus uit Task 1 (tests slaan over als het corpus ontbreekt).
- Produces (in `crate::handtekening::pkcs12`):
  - `pub enum Pkcs12Fout { VerkeerdWachtwoord, AlgoritmeNietOndersteund(String), Onleesbaar(String) }` met `Display`
  - `pub enum Wachtwoordvorm { Gewoon, Leeg, Afwezig }`
  - `pub struct Certificaat { pub der: Vec<u8>, pub local_key_id: Option<Vec<u8>>, pub naam: Option<String> }`
  - `pub struct Pkcs12Inhoud { pub sleutel_pkcs8: Option<zeroize::Zeroizing<Vec<u8>>>, pub sleutel_local_key_id: Option<Vec<u8>>, pub certificaten: Vec<Certificaat>, pub wachtwoordvorm: Wachtwoordvorm }`
  - `pub fn lees(bytes: &[u8], wachtwoord: &str) -> Result<Pkcs12Inhoud, Pkcs12Fout>`
  - `pub fn ondertekenaar_index(inhoud: &Pkcs12Inhoud) -> Option<usize>`

- [ ] **Step 1: Dependencies toevoegen**

In `open-pdf-studio/src-tauri/Cargo.toml`, onder `[dependencies]` (direct na de bestaande regel `sha2 = "0.10"`):

```toml
# Digitale handtekeningen (#374): RustCrypto op de der 0.7-lijn. pkcs12 0.1,
# cms 0.2 en x509-cert 0.2 hangen daar zelf aan; niet mengen met der 0.8.
pkcs12 = { version = "0.1", features = ["kdf"] }
pkcs5 = { version = "0.7", features = ["pbes2", "3des", "sha1-insecure"] }
cms = "0.2"
der = { version = "0.7", features = ["alloc", "derive", "oid"] }
spki = "0.7"
x509-cert = "0.2"
const-oid = { version = "0.9", features = ["db"] }
hmac = "0.12"
sha1 = "0.10"
des = "0.8"
rc2 = "0.8"
cbc = { version = "0.1", features = ["alloc"] }
rsa = "0.9"
zeroize = "1"
```

- [ ] **Step 2: Module declareren**

`open-pdf-studio/src-tauri/src/handtekening/mod.rs`:

```rust
//! Digitale handtekeningen met certificaten (#374).
//! Ontwerp: docs/superpowers/specs/2026-09-16-digitale-handtekeningen-design.md

pub mod pkcs12;
```

In `open-pdf-studio/src-tauri/src/lib.rs`, direct na de regel `pub mod pdfium_renderer;`:

```rust
pub mod handtekening;
```

- [ ] **Step 3: Tests schrijven (falen eerst)**

`open-pdf-studio/src-tauri/src/handtekening/pkcs12.rs` begint met alleen de testmodule, zodat de test eerst faalt:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/pkcs12")
            .join(naam);
        std::fs::read(&pad).unwrap_or_else(|e| panic!("fixture {}: {e}", pad.display()))
    }

    #[test]
    fn eigen_fixtures_openen_in_alle_drie_de_formaten() {
        for naam in ["windows-export-3des.p12", "certutil-3des.p12", "openssl3-aes256.p12"] {
            let inh = lees(&fixture(naam), "proef123").unwrap_or_else(|e| panic!("{naam}: {e}"));
            assert!(inh.sleutel_pkcs8.is_some(), "{naam}: sleutel");
            assert_eq!(inh.certificaten.len(), 1, "{naam}: certificaten");
            assert_eq!(ondertekenaar_index(&inh), Some(0), "{naam}: ondertekenaar");
            assert_eq!(inh.wachtwoordvorm, Wachtwoordvorm::Gewoon, "{naam}");
        }
    }

    #[test]
    fn alle_drie_de_formaten_bevatten_dezelfde_sleutel() {
        let a = lees(&fixture("windows-export-3des.p12"), "proef123").unwrap();
        let b = lees(&fixture("certutil-3des.p12"), "proef123").unwrap();
        let c = lees(&fixture("openssl3-aes256.p12"), "proef123").unwrap();
        assert_eq!(a.certificaten[0].der, b.certificaten[0].der);
        assert_eq!(a.certificaten[0].der, c.certificaten[0].der);
    }

    #[test]
    fn verkeerd_wachtwoord_geeft_nette_fout() {
        for naam in ["windows-export-3des.p12", "certutil-3des.p12", "openssl3-aes256.p12"] {
            match lees(&fixture(naam), "fout") {
                Err(Pkcs12Fout::VerkeerdWachtwoord) => {}
                Err(e) => panic!("{naam}: andere fout {e}"),
                Ok(_) => panic!("{naam}: gelezen met verkeerd wachtwoord"),
            }
        }
    }

    #[test]
    fn rommel_is_onleesbaar_geen_paniek() {
        assert!(matches!(lees(b"geen pkcs12", ""), Err(Pkcs12Fout::Onleesbaar(_))));
        assert!(matches!(lees(&[], "x"), Err(Pkcs12Fout::Onleesbaar(_))));
        let mut half = fixture("openssl3-aes256.p12");
        half.truncate(half.len() / 2);
        assert!(lees(&half, "proef123").is_err());
    }

    /// Het externe corpus (scripts/haal-handtekening-testdata.py). Ontbreekt het,
    /// dan slaat deze test over met een melding in plaats van te falen.
    #[test]
    fn corpus_volgens_manifest() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let map = root.join("testdata/handtekeningen/pkcs12");
        if !map.is_dir() {
            eprintln!("corpus ontbreekt ({}); draai scripts/haal-handtekening-testdata.py", map.display());
            return;
        }
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("scripts/handtekening-testdata.json")).unwrap(),
        )
        .unwrap();
        let bestanden = manifest["bronnen"]["pkcs12"]["bestanden"].as_array().unwrap();
        assert_eq!(bestanden.len(), 31);
        let mut fouten = Vec::new();
        for f in bestanden {
            let naam = f["bestand"].as_str().unwrap();
            let bytes = std::fs::read(map.join(naam)).unwrap();
            let inh = match lees(&bytes, f["wachtwoord"].as_str().unwrap()) {
                Ok(i) => i,
                Err(e) => {
                    fouten.push(format!("{naam}: {e}"));
                    continue;
                }
            };
            let namen: Vec<String> = inh.certificaten.iter().filter_map(|c| c.naam.clone()).collect();
            let verwachte_namen: Vec<String> = f["namen"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            if inh.sleutel_pkcs8.is_some() != f["sleutel"].as_bool().unwrap()
                || inh.certificaten.len() as u64 != f["certificaten"].as_u64().unwrap()
                || namen != verwachte_namen
                || ondertekenaar_index(&inh).is_some() != f["ondertekenaar"].as_bool().unwrap()
            {
                fouten.push(format!(
                    "{naam}: sleutel={} certificaten={} namen={namen:?} ondertekenaar={:?}",
                    inh.sleutel_pkcs8.is_some(),
                    inh.certificaten.len(),
                    ondertekenaar_index(&inh)
                ));
            }
            // Een verkeerd wachtwoord mag nooit tot een geslaagde lezing leiden.
            if !matches!(lees(&bytes, "helemaal-fout-123"), Err(Pkcs12Fout::VerkeerdWachtwoord)) {
                fouten.push(format!("{naam}: verkeerd wachtwoord niet netjes geweigerd"));
            }
        }
        assert!(fouten.is_empty(), "{}", fouten.join("\n"));
    }

    #[test]
    fn leeg_en_afwezig_wachtwoord_worden_onderscheiden() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/handtekeningen/pkcs12");
        if !root.is_dir() {
            eprintln!("corpus ontbreekt; test overgeslagen");
            return;
        }
        let truststore = lees(&std::fs::read(root.join("java-truststore.p12")).unwrap(), "").unwrap();
        assert_eq!(truststore.wachtwoordvorm, Wachtwoordvorm::Leeg);
        let zonder = lees(&std::fs::read(root.join("no-password.p12")).unwrap(), "").unwrap();
        assert_eq!(zonder.wachtwoordvorm, Wachtwoordvorm::Afwezig);
    }
}
```

Run:
```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | tail -15
```
Expected: compileerfout — `lees`, `Pkcs12Fout`, `Wachtwoordvorm` en `ondertekenaar_index` bestaan niet. (De eerste compilatie van de app duurt enkele minuten; draai zo nodig eerst `npx vite build` in `open-pdf-studio/` zodat `dist/` bestaat.)

- [ ] **Step 4: Implementatie**

Zet deze code boven de testmodule in `open-pdf-studio/src-tauri/src/handtekening/pkcs12.rs`:

```rust
//! Een .p12/.pfx openen: MAC controleren, ontsleutelen, sleutel en certificaten eruit.
//!
//! Bestaande crates schieten tekort (spec §5.1): RustCrypto `pkcs12` 0.1 levert
//! typen en de sleutelafleiding maar ontsleutelt niet. PBES2 ontsleutelt `pkcs5`;
//! de oude PKCS#12-PBE (3DES, RC2-40) en de MAC doen we hier zelf.
//!
//! De module heet zelf `pkcs12`; paden naar de crate staan daarom als `::pkcs12::`.

use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, InnerIvInit, KeyIvInit};
use cms::encrypted_data::EncryptedData;
use const_oid::db::rfc5911::{ID_DATA, ID_ENCRYPTED_DATA};
use const_oid::db::rfc5912::{ID_SHA_1, ID_SHA_256};
use const_oid::ObjectIdentifier;
use der::asn1::{BmpString, ContextSpecific, OctetString};
use der::{Decode, Encode};
use hmac::{Hmac, Mac};
use spki::AlgorithmIdentifierOwned;
use zeroize::Zeroizing;

use ::pkcs12::authenticated_safe::AuthenticatedSafe;
use ::pkcs12::cert_type::CertBag;
use ::pkcs12::kdf::{derive_key, Pkcs12KeyType};
use ::pkcs12::pbe_params::{EncryptedPrivateKeyInfo, Pkcs12PbeParams};
use ::pkcs12::pfx::Pfx;
use ::pkcs12::safe_bag::{SafeBag, SafeContents};

const PBES2: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.5.13");
const PBE_SHA1_3DES: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.12.1.3");
const PBE_SHA1_RC2_40: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.12.1.6");
const LOCAL_KEY_ID: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.21");
const FRIENDLY_NAME: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.20");

/// Waarom een .p12 niet te openen is.
#[derive(Debug)]
pub enum Pkcs12Fout {
    /// De MAC klopt niet, of ontsleutelen levert geen geldige opvulling op.
    VerkeerdWachtwoord,
    /// Versleuteling, MAC of inhoudstype die niet ondersteund wordt (OID of naam).
    AlgoritmeNietOndersteund(String),
    /// Geen geldige PKCS#12-structuur.
    Onleesbaar(String),
}

impl std::fmt::Display for Pkcs12Fout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Pkcs12Fout::VerkeerdWachtwoord => write!(f, "verkeerd wachtwoord"),
            Pkcs12Fout::AlgoritmeNietOndersteund(a) => write!(f, "niet-ondersteund algoritme: {a}"),
            Pkcs12Fout::Onleesbaar(d) => write!(f, "onleesbaar PKCS#12-bestand: {d}"),
        }
    }
}

// Bewust géén impl van std::error::Error: dan zou deze algemene From botsen met
// `impl<T> From<T> for T`. Zo kan `?` elke decodeer- of ontsleutelfout omzetten.
impl<E: std::error::Error> From<E> for Pkcs12Fout {
    fn from(e: E) -> Self {
        Pkcs12Fout::Onleesbaar(e.to_string())
    }
}

/// Welke wachtwoordvorm de MAC bevestigde.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wachtwoordvorm {
    Gewoon,
    /// Leeg wachtwoord: BMP-string met alleen de afsluitende `00 00`.
    Leeg,
    /// Geen wachtwoord: lege bytes, zonder afsluiter.
    Afwezig,
}

pub struct Certificaat {
    /// Het X.509-certificaat in DER.
    pub der: Vec<u8>,
    pub local_key_id: Option<Vec<u8>>,
    /// Vriendelijke naam uit het bestand (kan Unicode bevatten).
    pub naam: Option<String>,
}

/// Inhoud van een geopend .p12. Geen `Debug`: de privésleutel mag nooit in een log belanden.
pub struct Pkcs12Inhoud {
    /// Privésleutel als PKCS#8 (DER); gewist uit het geheugen zodra dit vrijkomt.
    pub sleutel_pkcs8: Option<Zeroizing<Vec<u8>>>,
    pub sleutel_local_key_id: Option<Vec<u8>>,
    pub certificaten: Vec<Certificaat>,
    pub wachtwoordvorm: Wachtwoordvorm,
}

/// PKCS#12 onderscheidt een leeg wachtwoord (BMP `00 00`) van géén wachtwoord.
fn wachtwoordvormen(wachtwoord: &str) -> Result<Vec<(Wachtwoordvorm, Zeroizing<Vec<u8>>)>, Pkcs12Fout> {
    let mut bmp = Zeroizing::new(BmpString::from_utf8(wachtwoord)?.into_bytes().to_vec());
    bmp.extend([0u8, 0u8]);
    Ok(if wachtwoord.is_empty() {
        vec![(Wachtwoordvorm::Leeg, bmp), (Wachtwoordvorm::Afwezig, Zeroizing::new(Vec::new()))]
    } else {
        vec![(Wachtwoordvorm::Gewoon, bmp)]
    })
}

fn mac_klopt(pfx: &Pfx, inhoud: &[u8], pass: &[u8]) -> Result<bool, Pkcs12Fout> {
    let Some(md) = &pfx.mac_data else { return Ok(true) };
    let salt = md.mac_salt.as_bytes();
    let verwacht = md.mac.digest.as_bytes();
    let alg = md.mac.algorithm.oid;
    if alg == ID_SHA_1 {
        let sleutel = Zeroizing::new(derive_key::<sha1::Sha1>(pass, salt, Pkcs12KeyType::Mac, md.iterations, 20));
        let mut m = Hmac::<sha1::Sha1>::new_from_slice(&sleutel)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        m.update(inhoud);
        Ok(m.verify_slice(verwacht).is_ok())
    } else if alg == ID_SHA_256 {
        let sleutel = Zeroizing::new(derive_key::<sha2::Sha256>(pass, salt, Pkcs12KeyType::Mac, md.iterations, 32));
        let mut m = Hmac::<sha2::Sha256>::new_from_slice(&sleutel)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        m.update(inhoud);
        Ok(m.verify_slice(verwacht).is_ok())
    } else {
        Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!("MAC {alg}")))
    }
}

/// Ontsleutelt met PBES2 (wachtwoord als UTF-8) of PKCS#12-PBE (wachtwoord als BMP).
fn ontsleutel(
    alg: &AlgorithmIdentifierOwned,
    data: &[u8],
    bmp: &[u8],
    utf8: &str,
) -> Result<Zeroizing<Vec<u8>>, Pkcs12Fout> {
    let params_der = alg
        .parameters
        .as_ref()
        .ok_or_else(|| Pkcs12Fout::Onleesbaar("versleutelingsparameters ontbreken".into()))?
        .to_der()?;
    if alg.oid == PBES2 {
        let params = pkcs5::pbes2::Parameters::from_der(&params_der)?;
        let schema = pkcs5::EncryptionScheme::from(params);
        let mut buf = Zeroizing::new(data.to_vec());
        let klaar = schema
            .decrypt_in_place(utf8, &mut buf)
            .map_err(|_| Pkcs12Fout::VerkeerdWachtwoord)?;
        return Ok(Zeroizing::new(klaar.to_vec()));
    }
    let p = Pkcs12PbeParams::from_der(&params_der)?;
    let salt = p.salt.as_bytes();
    if alg.oid == PBE_SHA1_3DES {
        let sleutel = Zeroizing::new(derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::EncryptionKey, p.iterations, 24));
        let iv = derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::Iv, p.iterations, 8);
        let dec = cbc::Decryptor::<des::TdesEde3>::new_from_slices(&sleutel, &iv)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        return dec
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map(Zeroizing::new)
            .map_err(|_| Pkcs12Fout::VerkeerdWachtwoord);
    }
    if alg.oid == PBE_SHA1_RC2_40 {
        let sleutel = Zeroizing::new(derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::EncryptionKey, p.iterations, 5));
        let iv = derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::Iv, p.iterations, 8);
        let cipher = rc2::Rc2::new_with_eff_key_len(&sleutel, 40);
        let dec = cbc::Decryptor::<rc2::Rc2>::inner_iv_slice_init(cipher, &iv)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        return dec
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map(Zeroizing::new)
            .map_err(|_| Pkcs12Fout::VerkeerdWachtwoord);
    }
    Err(Pkcs12Fout::AlgoritmeNietOndersteund(alg.oid.to_string()))
}

fn attribuut_bytes(bag: &SafeBag, oid: ObjectIdentifier) -> Option<Vec<u8>> {
    let attr = bag.bag_attributes.as_ref()?.iter().find(|a| a.oid == oid)?;
    attr.values.iter().next()?.decode_as::<OctetString>().ok().map(|o| o.as_bytes().to_vec())
}

fn attribuut_naam(bag: &SafeBag) -> Option<String> {
    let attr = bag.bag_attributes.as_ref()?.iter().find(|a| a.oid == FRIENDLY_NAME)?;
    attr.values.iter().next()?.decode_as::<BmpString>().ok().map(|b| b.to_string())
}

fn verwerk(bags: SafeContents, bmp: &[u8], utf8: &str, uit: &mut Pkcs12Inhoud) -> Result<(), Pkcs12Fout> {
    for bag in bags {
        if bag.bag_id == ::pkcs12::PKCS_12_CERT_BAG_OID {
            let cs = ContextSpecific::<CertBag>::from_der(&bag.bag_value)?;
            uit.certificaten.push(Certificaat {
                der: cs.value.cert_value.as_bytes().to_vec(),
                local_key_id: attribuut_bytes(&bag, LOCAL_KEY_ID),
                naam: attribuut_naam(&bag),
            });
        } else if bag.bag_id == ::pkcs12::PKCS_12_PKCS8_KEY_BAG_OID {
            let cs = ContextSpecific::<EncryptedPrivateKeyInfo>::from_der(&bag.bag_value)?;
            let pkcs8 = ontsleutel(&cs.value.encryption_algorithm, cs.value.encrypted_data.as_bytes(), bmp, utf8)?;
            uit.sleutel_pkcs8 = Some(pkcs8);
            uit.sleutel_local_key_id = attribuut_bytes(&bag, LOCAL_KEY_ID);
        } else if bag.bag_id == ::pkcs12::PKCS_12_KEY_BAG_OID {
            let cs = ContextSpecific::<der::Any>::from_der(&bag.bag_value)?;
            uit.sleutel_pkcs8 = Some(Zeroizing::new(cs.value.to_der()?));
            uit.sleutel_local_key_id = attribuut_bytes(&bag, LOCAL_KEY_ID);
        }
    }
    Ok(())
}

/// Opent een .p12/.pfx. Bij een leeg `wachtwoord` worden leeg en afwezig beide geprobeerd.
pub fn lees(bytes: &[u8], wachtwoord: &str) -> Result<Pkcs12Inhoud, Pkcs12Fout> {
    let pfx = Pfx::from_der(bytes)?;
    if pfx.auth_safe.content_type != ID_DATA {
        return Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!(
            "authSafe {}",
            pfx.auth_safe.content_type
        )));
    }
    let os = OctetString::from_der(&pfx.auth_safe.content.to_der()?)?;
    let inhoud = os.as_bytes();

    let mut gevonden = None;
    for (vorm, pass) in wachtwoordvormen(wachtwoord)? {
        if mac_klopt(&pfx, inhoud, &pass)? {
            gevonden = Some((vorm, pass));
            break;
        }
    }
    let Some((vorm, bmp)) = gevonden else { return Err(Pkcs12Fout::VerkeerdWachtwoord) };

    let mut uit = Pkcs12Inhoud {
        sleutel_pkcs8: None,
        sleutel_local_key_id: None,
        certificaten: Vec::new(),
        wachtwoordvorm: vorm,
    };
    for ci in AuthenticatedSafe::from_der(inhoud)? {
        if ci.content_type == ID_DATA {
            let os = OctetString::from_der(&ci.content.to_der()?)?;
            verwerk(SafeContents::from_der(os.as_bytes())?, &bmp, wachtwoord, &mut uit)?;
        } else if ci.content_type == ID_ENCRYPTED_DATA {
            let ed = EncryptedData::from_der(&ci.content.to_der()?)?;
            let ct = ed
                .enc_content_info
                .encrypted_content
                .as_ref()
                .ok_or_else(|| Pkcs12Fout::Onleesbaar("versleutelde inhoud ontbreekt".into()))?;
            let klaar = ontsleutel(&ed.enc_content_info.content_enc_alg, ct.as_bytes(), &bmp, wachtwoord)?;
            verwerk(SafeContents::from_der(&klaar)?, &bmp, wachtwoord, &mut uit)?;
        } else {
            return Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!("inhoud {}", ci.content_type)));
        }
    }
    Ok(uit)
}

/// Het certificaat dat bij de privésleutel hoort: eerst via `localKeyId`,
/// anders door de publieke RSA-sleutel te vergelijken. `None` zonder sleutel
/// of zonder passend certificaat.
pub fn ondertekenaar_index(inhoud: &Pkcs12Inhoud) -> Option<usize> {
    let sleutel = inhoud.sleutel_pkcs8.as_ref()?;
    if let Some(id) = &inhoud.sleutel_local_key_id {
        if let Some(i) = inhoud.certificaten.iter().position(|c| c.local_key_id.as_ref() == Some(id)) {
            return Some(i);
        }
    }
    use rsa::pkcs8::{DecodePrivateKey, EncodePublicKey};
    let prive = rsa::RsaPrivateKey::from_pkcs8_der(sleutel).ok()?;
    let spki = prive.to_public_key().to_public_key_der().ok()?;
    inhoud.certificaten.iter().position(|c| {
        x509_cert::Certificate::from_der(&c.der)
            .ok()
            .and_then(|cert| cert.tbs_certificate.subject_public_key_info.to_der().ok())
            .map(|d| d.as_slice() == spki.as_bytes())
            .unwrap_or(false)
    })
}
```

- [ ] **Step 5: Tests draaien**

Run:
```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test |test result"
```
Expected: 6 tests `ok`, `test result: ok. 6 passed` (met het corpus uit Task 1 aanwezig: geen overslaan-melding).

- [ ] **Step 6: Geen dubbele versies van de RustCrypto-typen**

Run:
```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo tree -d -e normal 2>/dev/null | grep -E "^(der|spki|x509-cert|const-oid|pkcs8|pkcs5|cms|rsa|sha1|sha2|hmac) v" | sort -u
```
Expected: geen regels (geen dubbele versies van deze crates in de app).

- [ ] **Step 7: Rest van de app blijft groen, dan commit**

```bash
cd open-pdf-studio && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npx vite build 2>&1 | grep -iE "error|built in"
cd .. && git add open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/Cargo.lock Cargo.lock open-pdf-studio/src-tauri/src/handtekening open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(handtekening): PKCS#12-bestanden openen in pure Rust"
```
Expected vóór de commit: `fail 0` en `✓ built in`. (Voeg alleen de lockfiles toe die daadwerkelijk gewijzigd zijn; `git status` laat zien welke.)

---

### Task 4: Certificaatgegevens en het Tauri-commando

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/certificaat.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (`generate_handler!`)

**Interfaces:**
- Consumes: `crate::handtekening::pkcs12::{lees, ondertekenaar_index, Pkcs12Fout, Pkcs12Inhoud}` (Task 3).
- Produces (in `crate::handtekening::certificaat`):
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct CertificaatInfo { naam: String, uitgever: String, geldig_van_unix: u64, geldig_tot_unix: u64, sleutelgebruik_ondertekenen: Option<bool>, sleuteltype: String, rsa_bits: Option<usize>, ondersteund: bool }` (alle velden `pub`)
  - `#[derive(Serialize)] #[serde(tag = "code", rename_all = "kebab-case")] pub enum InfoFout { VerkeerdWachtwoord, GeenPriveSleutel, GeenCertificaat, AlgoritmeNietOndersteund { detail: String }, Onleesbaar { detail: String } }`
  - `pub fn certificaat_info(der: &[u8]) -> Result<CertificaatInfo, InfoFout>`
  - `pub fn info_uit_p12(bytes: &[u8], wachtwoord: &str) -> Result<CertificaatInfo, InfoFout>`
  - Tauri-commando `pdf_certificate_info(pad: String, wachtwoord: String) -> Result<CertificaatInfo, InfoFout>`; JS: `invoke('pdf_certificate_info', { pad, wachtwoord })`.

- [ ] **Step 1: Module registreren**

In `open-pdf-studio/src-tauri/src/handtekening/mod.rs`, vervang `pub mod pkcs12;` door:

```rust
pub mod certificaat;
pub mod pkcs12;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

`open-pdf-studio/src-tauri/src/handtekening/certificaat.rs`, eerst alleen de testmodule:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pkcs12").join(naam)).unwrap()
    }

    fn corpus(naam: &str) -> Option<Vec<u8>> {
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/handtekeningen/pkcs12").join(naam);
        std::fs::read(pad).ok()
    }

    #[test]
    fn rsa_fixture_geeft_volledige_gegevens() {
        let info = info_uit_p12(&fixture("openssl3-aes256.p12"), "proef123").unwrap();
        assert_eq!(info.naam, "OPDS Test Ondertekenaar");
        assert_eq!(info.uitgever, "OPDS Test Ondertekenaar");
        assert_eq!(info.sleuteltype, "RSA");
        assert_eq!(info.rsa_bits, Some(2048));
        assert!(info.ondersteund);
        assert_eq!(info.sleutelgebruik_ondertekenen, Some(true));
        let negen_jaar = 9 * 365 * 24 * 3600;
        assert!(info.geldig_tot_unix - info.geldig_van_unix > negen_jaar);
    }

    #[test]
    fn verkeerd_wachtwoord_heeft_eigen_code() {
        assert!(matches!(info_uit_p12(&fixture("certutil-3des.p12"), "fout"), Err(InfoFout::VerkeerdWachtwoord)));
    }

    #[test]
    fn foutcodes_serialiseren_als_kebab_case() {
        let json = serde_json::to_string(&InfoFout::GeenPriveSleutel).unwrap();
        assert_eq!(json, r#"{"code":"geen-prive-sleutel"}"#);
        let json = serde_json::to_string(&InfoFout::Onleesbaar { detail: "x".into() }).unwrap();
        assert_eq!(json, r#"{"code":"onleesbaar","detail":"x"}"#);
    }

    #[test]
    fn corpus_ecdsa_niet_ondersteund_zonder_sleutel_zonder_certificaat() {
        let (Some(ec), Some(geen_sleutel), Some(geen_cert)) = (
            corpus("cert-key-aes256cbc.p12"),
            corpus("cert-aes256cbc-no-key.p12"),
            corpus("no-cert-key-aes256cbc.p12"),
        ) else {
            eprintln!("corpus ontbreekt; test overgeslagen");
            return;
        };
        let info = info_uit_p12(&ec, "cryptography").unwrap();
        assert_eq!(info.naam, "cryptography CA");
        assert_eq!(info.sleuteltype, "EC");
        assert_eq!(info.rsa_bits, None);
        assert!(!info.ondersteund);
        assert!(matches!(info_uit_p12(&geen_sleutel, "cryptography"), Err(InfoFout::GeenPriveSleutel)));
        assert!(matches!(info_uit_p12(&geen_cert, "cryptography"), Err(InfoFout::GeenCertificaat)));
    }

    #[test]
    fn commando_leest_van_schijf_en_meldt_ontbrekend_bestand() {
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pkcs12/windows-export-3des.p12");
        let info = pdf_certificate_info(pad.to_string_lossy().into_owned(), "proef123".into()).unwrap();
        assert_eq!(info.naam, "OPDS Test Ondertekenaar");
        assert!(matches!(
            pdf_certificate_info("Z:/bestaat/niet.p12".into(), "x".into()),
            Err(InfoFout::Onleesbaar { .. })
        ));
    }
}
```

Run:
```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | tail -8
```
Expected: compileerfout — `info_uit_p12`, `InfoFout`, `pdf_certificate_info` bestaan niet.

- [ ] **Step 3: Implementatie**

Zet boven de testmodule in `certificaat.rs`:

```rust
//! Certificaatgegevens uit een .p12, voor de ondertekendialoog (spec §3.1 stap 3)
//! en als Tauri-commando `pdf_certificate_info`.

use const_oid::ObjectIdentifier;
use der::{Decode, Encode};
use serde::Serialize;

use super::pkcs12::{lees, ondertekenaar_index, Pkcs12Fout};

const CN: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.3");
const SLEUTELGEBRUIK: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.15");
const RSA_ENCRYPTION: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.1");
const EC_PUBLIC_KEY: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.2.1");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificaatInfo {
    pub naam: String,
    pub uitgever: String,
    pub geldig_van_unix: u64,
    pub geldig_tot_unix: u64,
    /// `Some(true)` als digitalSignature of nonRepudiation gezet is; `None` zonder
    /// extensie (X.509: dan is het gebruik onbeperkt).
    pub sleutelgebruik_ondertekenen: Option<bool>,
    /// "RSA", "EC" of de OID van een ander sleuteltype.
    pub sleuteltype: String,
    pub rsa_bits: Option<usize>,
    /// Alleen RSA kan ondertekenen (spec §10).
    pub ondersteund: bool,
}

/// Foutcodes voor de dialoog; de tekst voor de gebruiker vertaalt de JS-kant.
#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum InfoFout {
    VerkeerdWachtwoord,
    GeenPriveSleutel,
    GeenCertificaat,
    AlgoritmeNietOndersteund { detail: String },
    Onleesbaar { detail: String },
}

impl From<Pkcs12Fout> for InfoFout {
    fn from(f: Pkcs12Fout) -> Self {
        match f {
            Pkcs12Fout::VerkeerdWachtwoord => InfoFout::VerkeerdWachtwoord,
            Pkcs12Fout::AlgoritmeNietOndersteund(detail) => InfoFout::AlgoritmeNietOndersteund { detail },
            Pkcs12Fout::Onleesbaar(detail) => InfoFout::Onleesbaar { detail },
        }
    }
}

fn onleesbaar(e: impl std::fmt::Display) -> InfoFout {
    InfoFout::Onleesbaar { detail: e.to_string() }
}

/// Common name uit een X.509-naam; anders de volledige naam als tekst.
fn common_name(naam: &x509_cert::name::Name) -> String {
    for rdn in naam.0.iter() {
        for atv in rdn.0.iter() {
            if atv.oid == CN {
                if let Ok(s) = atv.value.decode_as::<der::asn1::Utf8StringRef>() {
                    return s.as_str().to_string();
                }
                if let Ok(s) = atv.value.decode_as::<der::asn1::PrintableStringRef>() {
                    return s.as_str().to_string();
                }
            }
        }
    }
    naam.to_string()
}

pub fn certificaat_info(der_bytes: &[u8]) -> Result<CertificaatInfo, InfoFout> {
    use rsa::pkcs8::DecodePublicKey;
    use rsa::traits::PublicKeyParts;

    let cert = x509_cert::Certificate::from_der(der_bytes).map_err(onleesbaar)?;
    let tbs = &cert.tbs_certificate;
    let sleutelgebruik = tbs.extensions.as_ref().and_then(|exts| {
        exts.iter().find(|e| e.extn_id == SLEUTELGEBRUIK).and_then(|e| {
            x509_cert::ext::pkix::KeyUsage::from_der(e.extn_value.as_bytes())
                .ok()
                .map(|ku| ku.digital_signature() || ku.non_repudiation())
        })
    });
    let spki = &tbs.subject_public_key_info;
    let (sleuteltype, rsa_bits) = if spki.algorithm.oid == RSA_ENCRYPTION {
        let bits = spki
            .to_der()
            .ok()
            .and_then(|d| rsa::RsaPublicKey::from_public_key_der(&d).ok())
            .map(|k| k.size() * 8);
        ("RSA".to_string(), bits)
    } else if spki.algorithm.oid == EC_PUBLIC_KEY {
        ("EC".to_string(), None)
    } else {
        (spki.algorithm.oid.to_string(), None)
    };
    Ok(CertificaatInfo {
        naam: common_name(&tbs.subject),
        uitgever: common_name(&tbs.issuer),
        geldig_van_unix: tbs.validity.not_before.to_unix_duration().as_secs(),
        geldig_tot_unix: tbs.validity.not_after.to_unix_duration().as_secs(),
        sleutelgebruik_ondertekenen: sleutelgebruik,
        ondersteund: rsa_bits.is_some(),
        sleuteltype,
        rsa_bits,
    })
}

pub fn info_uit_p12(bytes: &[u8], wachtwoord: &str) -> Result<CertificaatInfo, InfoFout> {
    let inhoud = lees(bytes, wachtwoord)?;
    if inhoud.sleutel_pkcs8.is_none() {
        return Err(InfoFout::GeenPriveSleutel);
    }
    let i = ondertekenaar_index(&inhoud).ok_or(InfoFout::GeenCertificaat)?;
    certificaat_info(&inhoud.certificaten[i].der)
}

/// Gegevens van het ondertekencertificaat in een .p12, zonder iets te ondertekenen.
#[tauri::command]
pub fn pdf_certificate_info(pad: String, wachtwoord: String) -> Result<CertificaatInfo, InfoFout> {
    let bytes = std::fs::read(&pad).map_err(onleesbaar)?;
    info_uit_p12(&bytes, &wachtwoord)
}
```

- [ ] **Step 4: Commando registreren**

In `open-pdf-studio/src-tauri/src/lib.rs`, in `tauri::generate_handler![ … ]`, direct na de regel `invalidate_pdf_cache,`:

```rust
            handtekening::certificaat::pdf_certificate_info,
```

- [ ] **Step 5: Tests en build**

Run:
```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test |test result"
CARGO_TARGET_DIR="$BUILDMAP" cargo check 2>&1 | grep -E "^(error|warning)" | head -5; echo "check-exit=${PIPESTATUS[0]}"
```
Expected: `test result: ok. 11 passed` (6 uit Task 3 + 5 nieuw); `check-exit=0` zonder nieuwe waarschuwingen uit `handtekening`.

- [ ] **Step 6: Commit**

```bash
cd open-pdf-studio && npm run test:unit 2>&1 | grep -E "^ℹ fail" && npx vite build 2>&1 | grep -iE "error|built in"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(handtekening): certificaatgegevens uit een .p12 via pdf_certificate_info"
```

---

### Task 5: Verificatie in een releasebuild

**Files:** geen wijzigingen; tijdelijke scripts buiten de repo.

- [ ] **Step 1: Volledige Rust-tests met corpus**

```bash
python scripts/haal-handtekening-testdata.py --controleer
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening -- --nocapture 2>&1 | grep -E "corpus ontbreekt|test result"
```
Expected: `49 aanwezig, 0 opgehaald, 0 fout`; `test result: ok. 11 passed`; géén regel `corpus ontbreekt`.

- [ ] **Step 2: Releasebuild en geïsoleerde app-instantie**

```bash
cd open-pdf-studio && CARGO_TARGET_DIR="$BUILDMAP" npm run tauri:build 2>&1 | grep -E "nsis.*setup.exe$|error\[|^error"
R="$RIGMAP"; mkdir -p "$R/webview" "$R/localappdata/OpenPDFStudio"
printf '{"openFiles":[],"activeIndex":0}' > "$R/localappdata/OpenPDFStudio/session.json"
OPDS_DETACHED=1 OPS_ENABLE_MCP=1 LOCALAPPDATA="$(cygpath -w "$R/localappdata")"   WEBVIEW2_USER_DATA_FOLDER="$(cygpath -w "$R/webview")"   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9345"   "$BUILDMAP"/release/open-pdf-studio.exe --mcp-server --mcp-port 9223 > "$R/app.log" 2>&1 &
for i in $(seq 1 60); do curl -s -m 8 -X POST http://127.0.0.1:9223/mcp -H 'Content-Type: application/json'   -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_list_tabs","arguments":{}}}' | grep -q '"result"' && break; sleep 1; done
echo "instantie klaar"
```
Expected: een regel met `setup.exe` (build-exit 1 door alleen de ontbrekende updater-signing is normaal) en `instantie klaar`. De instantie gebruikt een eigen profiel en eigen `LOCALAPPDATA`; de instellingen van de gebruiker blijven onaangeroerd.

- [ ] **Step 3: Commando aanroepen vanuit de webview**

Maak buiten de repo `"$TEMP/cert-info-proef.mjs"`:

```js
// Roept pdf_certificate_info aan in de draaiende releasebuild, zoals de dialoog het straks doet.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require(process.argv[2]);
const fixture = process.argv[3];
const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9345');
const page = browser.contexts()[0].pages()[0];
const roep = (wachtwoord) => page.evaluate(async ([pad, wachtwoord]) => {
  try {
    return { ok: await window.__TAURI_INTERNALS__.invoke('pdf_certificate_info', { pad, wachtwoord }) };
  } catch (e) {
    return { fout: e };
  }
}, [fixture, wachtwoord]);
console.log(JSON.stringify(await roep('proef123')));
console.log(JSON.stringify(await roep('fout')));
process.exit(0);
```

Run (vanuit de worktree-root):
```bash
node "$TEMP/cert-info-proef.mjs" "$(pwd)/open-pdf-studio/node_modules/playwright" \
  "$(pwd)/open-pdf-studio/src-tauri/tests/fixtures/pkcs12/openssl3-aes256.p12"
```
Expected:
- regel 1: `{"ok":{"naam":"OPDS Test Ondertekenaar","uitgever":"OPDS Test Ondertekenaar",…,"sleutelgebruikOndertekenen":true,"sleuteltype":"RSA","rsaBits":2048,"ondersteund":true}}`;
- regel 2: `{"fout":{"code":"verkeerd-wachtwoord"}}`.

- [ ] **Step 4: Instantie stoppen, opruimen**

Stop alleen het proces dat poort 9223 bezit (nooit op procesnaam):

```bash
P=$(powershell -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort 9223 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" | tr -d '\r ')
[ -n "$P" ] && powershell -NoProfile -Command "Stop-Process -Id $P -Force"
rm -f "$TEMP/cert-info-proef.mjs"
git status --short
```
Expected: `git status` leeg (de testdata staat in het genegeerde `testdata/`).
