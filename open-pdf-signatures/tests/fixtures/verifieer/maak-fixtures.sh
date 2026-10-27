#!/usr/bin/env bash
# Maakt de testfixtures voor het verifiëren van handtekeningen (opnieuw) aan.
# Wegwerpsleutels staan alleen in een tijdelijke map; in de repo komen enkel
# certificaten, CMS-structuren en een tijdstempeltoken.
#
# Gebruik: maak-fixtures.sh [alles|los|zonder-attributen|rsa8192|keten|zelfuitgegeven|eku]
#   alles (standaard)  alle fixtures
#   los                alleen de fixtures met een eigen, zelfondertekend
#                      certificaat (cms-attribuutvolgorde.der, cms-sleutel-id.der);
#                      de overige bestanden blijven ongemoeid
#   zonder-attributen  alleen cms-zonder-attributen.der (eigen, zelfondertekend
#                      certificaat); de overige bestanden blijven ongemoeid
#   rsa8192            alleen de keten onder een RSA-8192-wortel
#                      (root-rsa8192.der, blad-onder-rsa8192.der,
#                      blad-sha1-onder-rsa8192.der); de overige bestanden
#                      blijven ongemoeid
#   keten              alleen de fixtures voor de strengere ketencontrole
#                      (k-*.der); de overige bestanden blijven ongemoeid
#   zelfuitgegeven     alleen z-zelfuitgegeven.der en z-blad.der (tien
#                      zelfuitgegeven CA's met één sleutel, voor het
#                      knoopbudget); de overige bestanden blijven ongemoeid
#   eku                alleen de e-*.der-fixtures (extendedKeyUsage van
#                      tussencertificaten); de overige bestanden blijven ongemoeid
set -euo pipefail
MODUS="${1:-alles}"
case "$MODUS" in
  alles | los | zonder-attributen | rsa8192 | keten | zelfuitgegeven | eku) ;;
  *) echo "gebruik: $0 [alles|los|zonder-attributen|rsa8192|keten|zelfuitgegeven|eku]" >&2; exit 2 ;;
esac
export MSYS_NO_PATHCONV=1
# Onder Git Bash een Windows-pad, zodat de (native) openssl het kan openen.
M="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cd "$T"

cat > ext.cnf <<'CNF'
[root]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
[tussen]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[blad]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[blad_verkeerd]
basicConstraints=critical,CA:FALSE
keyUsage=critical,keyEncipherment
[tsa]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,timeStamping
[los]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
subjectKeyIdentifier=hash
[zonder_attributen]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
CNF

cat > tsa.cnf <<'CNF'
[tsa_config]
serial = tsaserial
signer_digest = sha256
default_policy = 1.2.3.4.1
digests = sha256, sha384, sha512
accuracy = secs:1
ordering = no
tsa_name = no
ess_cert_id_chain = no
ess_cert_id_alg = sha256
CNF
echo 01 > tsaserial

if [ "$MODUS" = alles ]; then
openssl req -x509 -newkey rsa:2048 -nodes -keyout root.key -out root.pem -subj "/CN=OPDS Test Root" \
  -days 3650 -extensions root -config ext.cnf -sha256
openssl req -newkey rsa:2048 -nodes -keyout tussen.key -out tussen.csr -subj "/CN=OPDS Test Tussen"
openssl x509 -req -in tussen.csr -CA root.pem -CAkey root.key -set_serial 2 -days 3650 \
  -extfile ext.cnf -extensions tussen -out tussen.pem -sha256
openssl req -newkey rsa:2048 -nodes -keyout blad.key -out blad.csr -subj "/CN=OPDS Test Blad"
openssl x509 -req -in blad.csr -CA tussen.pem -CAkey tussen.key -set_serial 3 -days 3650 \
  -extfile ext.cnf -extensions blad -out blad.pem -sha256
openssl x509 -req -in blad.csr -CA tussen.pem -CAkey tussen.key -set_serial 4 -days 3650 \
  -extfile ext.cnf -extensions blad_verkeerd -out blad-verkeerd-gebruik.pem -sha256
openssl ecparam -name prime256v1 -genkey -noout -out ec.key
openssl req -new -key ec.key -out ec.csr -subj "/CN=OPDS Test EC"
openssl x509 -req -in ec.csr -CA tussen.pem -CAkey tussen.key -set_serial 5 -days 3650 \
  -extfile ext.cnf -extensions blad -out ec.pem -sha256
openssl req -newkey rsa:2048 -nodes -keyout tsa.key -out tsa.csr -subj "/CN=OPDS Test TSA"
openssl x509 -req -in tsa.csr -CA tussen.pem -CAkey tussen.key -set_serial 6 -days 3650 \
  -extfile ext.cnf -extensions tsa -out tsa.pem -sha256
openssl ecparam -name secp384r1 -genkey -noout -out ec-root.key
openssl req -x509 -new -key ec-root.key -out ec-root.pem -subj "/CN=OPDS Test EC Root" \
  -days 3650 -extensions root -config ext.cnf -sha384
openssl x509 -req -in blad.csr -CA ec-root.pem -CAkey ec-root.key -set_serial 7 -days 3650 \
  -extfile ext.cnf -extensions blad -out blad-onder-ec-root.pem -sha384

printf 'Ondertekende testinhoud voor OPDS.\n' > "$M/data.bin"
openssl cms -sign -binary -in "$M/data.bin" -signer blad.pem -inkey blad.key -certfile tussen.pem \
  -md sha256 -outform DER -out "$M/cms-rsa-sha256.der"
openssl cms -sign -binary -in "$M/data.bin" -signer blad.pem -inkey blad.key -certfile tussen.pem \
  -md sha256 -keyopt rsa_padding_mode:pss -outform DER -out "$M/cms-rsa-pss.der"
openssl cms -sign -binary -in "$M/data.bin" -signer ec.pem -inkey ec.key -certfile tussen.pem \
  -md sha384 -outform DER -out "$M/cms-ec-p256-sha384.der"
openssl cms -sign -binary -in "$M/data.bin" -signer blad.pem -inkey blad.key -nocerts \
  -md sha256 -outform DER -out "$M/cms-zonder-certificaat.der"
openssl cms -sign -binary -stream -in "$M/data.bin" -signer blad.pem -inkey blad.key -certfile tussen.pem \
  -md sha256 -outform DER -out "$M/cms-rsa-ber.der"
openssl ts -query -data "$M/data.bin" -sha256 -cert -out req.tsq
openssl ts -reply -queryfile req.tsq -inkey tsa.key -signer tsa.pem -chain tussen.pem \
  -config tsa.cnf -section tsa_config -token_out -out "$M/tst-data.der" 2>/dev/null

for f in root tussen blad blad-verkeerd-gebruik ec tsa ec-root blad-onder-ec-root; do
  openssl x509 -in "$f.pem" -outform DER -out "$M/$f.der"
done
fi

if [ "$MODUS" = alles ] || [ "$MODUS" = zonder-attributen ]; then
# Zonder ondertekende attributen (-noattr): de handtekening gaat rechtstreeks
# over de inhoud, met rsaEncryption en SHA-256.
openssl req -x509 -newkey rsa:2048 -nodes -keyout zonder.key -out zonder.pem   -subj "/CN=OPDS Test Zonder Attributen" -days 3650 -extensions zonder_attributen -config ext.cnf -sha256
openssl cms -sign -binary -noattr -in "$M/data.bin" -signer zonder.pem -inkey zonder.key   -md sha256 -outform DER -out "$M/cms-zonder-attributen.der"
openssl cms -verify -binary -noverify -inform DER -in "$M/cms-zonder-attributen.der" -content "$M/data.bin"   -out geverifieerd.bin
fi

if [ "$MODUS" = alles ] || [ "$MODUS" = rsa8192 ]; then
# Een wortel met een RSA-sleutel groter dan 4096 bits en twee bladen eronder:
# een met SHA-256 en een met SHA-1 ondertekend (zwak, maar in ketens toegestaan).
openssl req -x509 -newkey rsa:8192 -nodes -keyout root8192.key -out root-rsa8192.pem   -subj "/CN=OPDS Test Root RSA-8192" -days 3650 -extensions root -config ext.cnf -sha256
openssl req -newkey rsa:2048 -nodes -keyout blad8192.key -out blad8192.csr -subj "/CN=OPDS Test Blad onder RSA-8192"
openssl x509 -req -in blad8192.csr -CA root-rsa8192.pem -CAkey root8192.key -set_serial 8 -days 3650   -extfile ext.cnf -extensions blad -out blad-onder-rsa8192.pem -sha256
openssl x509 -req -in blad8192.csr -CA root-rsa8192.pem -CAkey root8192.key -set_serial 9 -days 3650   -extfile ext.cnf -extensions blad -out blad-sha1-onder-rsa8192.pem -sha1
for f in root-rsa8192 blad-onder-rsa8192 blad-sha1-onder-rsa8192; do
  openssl verify -CAfile root-rsa8192.pem "$f.pem"
  openssl x509 -in "$f.pem" -outform DER -out "$M/$f.der"
done
fi

if [ "$MODUS" = alles ] || [ "$MODUS" = keten ]; then
# Strengere ketencontrole: eigen wortel met tussencertificaten en bladen met
# afwijkend sleutelgebruik, pathlen, v1, kritieke extensies en geldigheid.
cat > keten.cnf <<'CNF'
[req_v1]
distinguished_name = dn
prompt = no
[dn]
CN = onbekend
[ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[ca_pathlen0]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
[ca_naambeperking]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
nameConstraints=critical,permitted;DNS:example.org
[wortel_zonder_bc]
keyUsage=critical,digitalSignature
subjectKeyIdentifier=hash
[blad]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
[blad_email]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
extendedKeyUsage=emailProtection
[blad_serverauth]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
extendedKeyUsage=serverAuth
[blad_onbekend_kritiek]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
1.3.6.1.4.1.55555.1=critical,DER:05:00
[blad_beleid_kritiek]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
certificatePolicies=critical,1.2.3.4.5
subjectAltName=critical,email:test@example.org
[tsa_niet_kritiek]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=timeStamping
[tsa_extra_eku]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,timeStamping,emailProtection
CNF
NU="-days 3650"
OUD="-not_before 20000101000000Z -not_after 20010101000000Z"
csr() { openssl req -newkey rsa:2048 -nodes -keyout "$1.key" -out "$1.csr" -subj "/CN=$2"; }
# teken <uitgever> <aanvraag> <uit> <sectie> <serienummer> [geldigheid]
teken() {
  openssl x509 -req -in "$2.csr" -CA "$1.pem" -CAkey "$1.key" -set_serial "$5" ${6:-$NU} \
    -extfile keten.cnf -extensions "$4" -out "$3.pem" -sha256
}
openssl req -x509 -newkey rsa:2048 -nodes -keyout k-root.key -out k-root.pem -subj "/CN=OPDS Test Ketenwortel" \
  $NU -extensions ca -config keten.cnf -sha256
# Zelfde sleutel en naam, geldig in 2000.
openssl req -new -key k-root.key -out k-root.csr -subj "/CN=OPDS Test Ketenwortel"
openssl x509 -req -in k-root.csr -key k-root.key -set_serial 101 $OUD \
  -extfile keten.cnf -extensions ca -out k-root-verlopen.pem -sha256
openssl req -x509 -newkey rsa:2048 -nodes -keyout kruis.key -out kruis.pem -subj "/CN=OPDS Test Kruiswortel" \
  $NU -extensions ca -config keten.cnf -sha256
csr k-tussen "OPDS Test Ketentussen"
teken k-root k-tussen k-tussen ca 102
# Zelfde sleutel en naam als k-tussen, uitgegeven door een wortel buiten elk archief.
teken kruis k-tussen k-tussen-kruis ca 103
csr blad "OPDS Test Ketenblad"
teken k-tussen blad k-blad-email blad_email 104
teken k-tussen blad k-blad-serverauth blad_serverauth 105
teken k-tussen blad k-blad-onbekend-kritiek blad_onbekend_kritiek 106
teken k-tussen blad k-blad-beleid-kritiek blad_beleid_kritiek 107
teken k-tussen blad k-tsa-niet-kritiek tsa_niet_kritiek 108
teken k-tussen blad k-tsa-extra-eku tsa_extra_eku 109
csr k-tussen-pathlen0 "OPDS Test Ketentussen pathlen 0"
teken k-root k-tussen-pathlen0 k-tussen-pathlen0 ca_pathlen0 110
csr k-subtussen "OPDS Test Ketensubtussen"
teken k-tussen-pathlen0 k-subtussen k-subtussen ca 111
teken k-subtussen blad k-blad-onder-subtussen blad 112
# v1 zonder extensies: als tussencertificaat en als wortel.
openssl genrsa -out k-tussen-v1.key 2048
sed 's/^CN = .*/CN = OPDS Test Ketentussen v1/' keten.cnf > v1.cnf
openssl req -x509v1 -config v1.cnf -section req_v1 -new -key k-tussen-v1.key -CA k-root.pem -CAkey k-root.key \
  -set_serial 113 $NU -out k-tussen-v1.pem -sha256
teken k-tussen-v1 blad k-blad-onder-v1 blad 114
openssl genrsa -out k-wortel-v1.key 2048
sed 's/^CN = .*/CN = OPDS Test Wortel v1/' keten.cnf > v1.cnf
openssl req -x509v1 -config v1.cnf -section req_v1 -new -key k-wortel-v1.key $NU -out k-wortel-v1.pem -sha256
teken k-wortel-v1 blad k-blad-onder-wortel-v1 blad 115
openssl req -x509 -newkey rsa:2048 -nodes -keyout k-wortel-zonder-bc.key -out k-wortel-zonder-bc.pem \
  -subj "/CN=OPDS Test Wortel zonder basicConstraints" $NU -extensions wortel_zonder_bc -config keten.cnf -sha256
teken k-wortel-zonder-bc blad k-blad-onder-wortel-zonder-bc blad 116
csr k-tussen-naambeperking "OPDS Test Ketentussen met naambeperking"
teken k-root k-tussen-naambeperking k-tussen-naambeperking ca_naambeperking 117
teken k-tussen-naambeperking blad k-blad-onder-naambeperking blad 118
csr k-tussen-verlopen "OPDS Test Ketentussen verlopen"
teken k-root k-tussen-verlopen k-tussen-verlopen ca 119 "$OUD"
teken k-tussen-verlopen blad k-blad-onder-tussen-verlopen blad 120
for f in k-tussen k-blad-email k-blad-serverauth k-blad-beleid-kritiek \
  k-tussen-pathlen0 k-tussen-v1 k-tussen-naambeperking; do
  openssl verify -partial_chain -CAfile k-root.pem -untrusted k-tussen.pem "$f.pem"
done
# Tijdstempeltoken over data.bin (TSTInfo uit tst-data.der), ondertekend door
# een blad zonder timeStamping.
openssl cms -verify -binary -noverify -inform DER -in "$M/tst-data.der" -out tstinfo.der
openssl cms -sign -binary -nodetach -econtent_type 1.2.840.113549.1.9.16.1.4 -in tstinfo.der \
  -signer k-blad-email.pem -inkey blad.key -certfile k-tussen.pem -md sha256 -outform DER \
  -out "$M/k-tst-zonder-timestamping.der"
for f in k-root k-root-verlopen k-tussen k-tussen-kruis k-blad-email k-blad-serverauth \
  k-blad-onbekend-kritiek k-blad-beleid-kritiek k-tsa-niet-kritiek k-tsa-extra-eku \
  k-tussen-pathlen0 k-subtussen k-blad-onder-subtussen k-tussen-v1 k-blad-onder-v1 \
  k-wortel-v1 k-blad-onder-wortel-v1 k-wortel-zonder-bc k-blad-onder-wortel-zonder-bc \
  k-tussen-naambeperking k-blad-onder-naambeperking k-tussen-verlopen k-blad-onder-tussen-verlopen; do
  openssl x509 -in "$f.pem" -outform DER -out "$M/$f.der"
done
# Keten van elf certificaten (P-256): blad, negen tussencertificaten en een
# wortel, als DER achter elkaar in één bestand, blad eerst.
openssl ecparam -name prime256v1 -genkey -noout -out lang10.key
openssl req -x509 -new -key lang10.key -out lang10.pem -subj "/CN=OPDS Test Lang 10" \
  $NU -extensions ca -config keten.cnf -sha256
for i in 9 8 7 6 5 4 3 2 1 0; do
  openssl ecparam -name prime256v1 -genkey -noout -out "lang$i.key"
  openssl req -new -key "lang$i.key" -out "lang$i.csr" -subj "/CN=OPDS Test Lang $i"
  sectie=ca
  if [ "$i" = 0 ]; then sectie=blad; fi
  teken "lang$((i + 1))" "lang$i" "lang$i" "$sectie" "$((130 + i))"
done
cat lang1.pem lang2.pem lang3.pem lang4.pem lang5.pem lang6.pem lang7.pem lang8.pem lang9.pem > lang-tussen.pem
openssl verify -CAfile lang10.pem -untrusted lang-tussen.pem lang0.pem
: > "$M/k-lange-keten.der"
for i in 0 1 2 3 4 5 6 7 8 9 10; do
  openssl x509 -in "lang$i.pem" -outform DER >> "$M/k-lange-keten.der"
done
fi

if [ "$MODUS" = alles ] || [ "$MODUS" = zelfuitgegeven ]; then
# Tien zelfuitgegeven CA-certificaten met dezelfde sleutel en dezelfde naam
# (onderwerp = uitgever), elk met een eigen serienummer: elk ondertekent elk.
# Plus een blad onder die naam en sleutel. Geen wortel in een archief.
cat > zelf.cnf <<'CNF'
[ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
[blad_email]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
extendedKeyUsage=emailProtection
CNF
openssl genrsa -out z.key 2048
: > "$M/z-zelfuitgegeven.der"
for i in 0 1 2 3 4 5 6 7 8 9; do
  openssl req -x509 -new -key z.key -subj "/CN=OPDS Test Zelfuitgegeven" -set_serial "$((200 + i))"     -days 3650 -extensions ca -config zelf.cnf -sha256 -out "z$i.pem"
  openssl x509 -in "z$i.pem" -outform DER >> "$M/z-zelfuitgegeven.der"
done
openssl req -newkey rsa:2048 -nodes -keyout zblad.key -out zblad.csr -subj "/CN=OPDS Test Zelfuitgegeven Blad"
openssl x509 -req -in zblad.csr -CA z0.pem -CAkey z.key -set_serial 210 -days 3650   -extfile zelf.cnf -extensions blad_email -out z-blad.pem -sha256
openssl verify -CAfile z9.pem z-blad.pem
openssl x509 -in z-blad.pem -outform DER -out "$M/z-blad.der"
fi

if [ "$MODUS" = alles ] || [ "$MODUS" = eku ]; then
# extendedKeyUsage in tussencertificaten: eigen wortel, tussencertificaten met
# alleen serverAuth, alleen emailProtection, alleen timeStamping en
# anyExtendedKeyUsage, en daaronder bladen voor ondertekenen en tijdstempels.
cat > eku.cnf <<'CNF'
[ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
[ca_serverauth]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
extendedKeyUsage=serverAuth
[ca_email]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
extendedKeyUsage=emailProtection
[ca_timestamping]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
extendedKeyUsage=timeStamping
[ca_any]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
extendedKeyUsage=anyExtendedKeyUsage
[blad_email]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
extendedKeyUsage=emailProtection
[tsa]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,timeStamping
CNF
openssl req -x509 -newkey rsa:2048 -nodes -keyout e-root.key -out e-root.pem -subj "/CN=OPDS Test EKU-wortel"   -days 3650 -extensions ca -config eku.cnf -sha256
openssl req -newkey rsa:2048 -nodes -keyout eblad.key -out eblad.csr -subj "/CN=OPDS Test EKU-blad"
serie=300
for soort in serverauth email timestamping any; do
  openssl req -newkey rsa:2048 -nodes -keyout "e-tussen-$soort.key" -out "e-tussen-$soort.csr"     -subj "/CN=OPDS Test EKU-tussen $soort"
  serie=$((serie + 1))
  openssl x509 -req -in "e-tussen-$soort.csr" -CA e-root.pem -CAkey e-root.key -set_serial "$serie" -days 3650     -extfile eku.cnf -extensions "ca_$soort" -out "e-tussen-$soort.pem" -sha256
  serie=$((serie + 1))
  openssl x509 -req -in eblad.csr -CA "e-tussen-$soort.pem" -CAkey "e-tussen-$soort.key" -set_serial "$serie"     -days 3650 -extfile eku.cnf -extensions blad_email -out "e-blad-onder-$soort.pem" -sha256
  serie=$((serie + 1))
  openssl x509 -req -in eblad.csr -CA "e-tussen-$soort.pem" -CAkey "e-tussen-$soort.key" -set_serial "$serie"     -days 3650 -extfile eku.cnf -extensions tsa -out "e-tsa-onder-$soort.pem" -sha256
done
for f in e-root e-tussen-serverauth e-tussen-email e-tussen-timestamping e-tussen-any   e-blad-onder-serverauth e-blad-onder-email e-blad-onder-timestamping e-blad-onder-any   e-tsa-onder-serverauth e-tsa-onder-email e-tsa-onder-timestamping e-tsa-onder-any; do
  openssl x509 -in "$f.pem" -outform DER -out "$M/$f.der"
done
fi

if [ "$MODUS" = zonder-attributen ] || [ "$MODUS" = rsa8192 ] || [ "$MODUS" = keten ] || [ "$MODUS" = zelfuitgegeven ] || [ "$MODUS" = eku ]; then
  echo "fixtures aangemaakt in $M"
  exit 0
fi

# Ondertekende attributen die niet in DER-volgorde staan: OpenSSL tekent altijd
# gesorteerd, dus de attributen worden herschikt (omgekeerde DER-volgorde) en
# de SET met tag 0x31 in die nieuwe volgorde wordt opnieuw ondertekend.
cat > herschik.py <<'PY'
import sys


def kop(b, i):
    tag, l = b[i], b[i + 1]
    i += 2
    if l == 0x80:
        raise SystemExit("onbepaalde lengte niet verwacht")
    if l & 0x80:
        n = l & 0x7F
        l = int.from_bytes(b[i:i + n], "big")
        i += n
    return tag, i, i + l


def kinderen(b, start, eind):
    uit, i = [], start
    while i < eind:
        tag, s, e = kop(b, i)
        uit.append((tag, i, s, e))
        i = e
    return uit


def tlv(tag, inhoud):
    n = len(inhoud)
    lengte = bytes([n]) if n < 0x80 else bytes([0x80 | ((n.bit_length() + 7) // 8)]) + n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([tag]) + lengte + inhoud


cms = open(sys.argv[1], "rb").read()
_, ci_s, ci_e = kop(cms, 0)
ci = kinderen(cms, ci_s, ci_e)
_, a0_i, a0_s, a0_e = ci[1]
_, sd_s, sd_e = kop(cms, a0_s)
sd = kinderen(cms, sd_s, sd_e)
_, sis_i, sis_s, sis_e = [k for k in sd if k[0] == 0x31][-1]
sis = kinderen(cms, sis_s, sis_e)
if len(sis) != 1:
    raise SystemExit("precies een SignerInfo verwacht")
_, si_i, si_s, si_e = sis[0]
si = kinderen(cms, si_s, si_e)
attrs_k = [k for k in si if k[0] == 0xA0][0]
attrs = [cms[i:e] for (_, i, _, e) in kinderen(cms, attrs_k[2], attrs_k[3])]
if attrs != sorted(attrs):
    raise SystemExit("invoer staat niet in DER-volgorde")
herschikt = list(reversed(attrs))
if herschikt == sorted(herschikt):
    raise SystemExit("herschikking is nog steeds DER-volgorde")
set_der = tlv(0x31, b"".join(herschikt))
if len(sys.argv) == 3:
    open(sys.argv[2], "wb").write(set_der)
    raise SystemExit(0)
if open(sys.argv[2], "rb").read() != set_der:
    raise SystemExit("ondertekende SET wijkt af")
handtekening = open(sys.argv[3], "rb").read()
delen = []
for tag, i, s, e in si:
    if tag == 0xA0:
        delen.append(tlv(0xA0, b"".join(herschikt)))
    elif tag == 0x04:
        delen.append(tlv(0x04, handtekening))
    else:
        delen.append(cms[i:e])
si_nieuw = tlv(0x30, b"".join(delen))
sis_nieuw = tlv(0x31, si_nieuw)
sd_nieuw = tlv(0x30, cms[sd_s:sis_i] + sis_nieuw + cms[sis_e:sd_e])
ci_nieuw = tlv(0x30, cms[ci_s:a0_i] + tlv(0xA0, sd_nieuw) + cms[a0_e:ci_e])
open(sys.argv[4], "wb").write(ci_nieuw)
PY

openssl req -x509 -newkey rsa:2048 -nodes -keyout los.key -out los.pem -subj "/CN=OPDS Test Los"   -days 3650 -extensions los -config ext.cnf -sha256
openssl cms -sign -binary -in "$M/data.bin" -signer los.pem -inkey los.key -keyid   -md sha256 -outform DER -out "$M/cms-sleutel-id.der"
openssl cms -sign -binary -in "$M/data.bin" -signer los.pem -inkey los.key   -md sha256 -outform DER -out gesorteerd.der
python herschik.py gesorteerd.der attributen.der
openssl dgst -sha256 -binary -out attributen.sha256 attributen.der
openssl pkeyutl -sign -inkey los.key -pkeyopt digest:sha256 -in attributen.sha256 -out attributen.sig
python herschik.py gesorteerd.der attributen.der attributen.sig "$M/cms-attribuutvolgorde.der"
for f in cms-sleutel-id cms-attribuutvolgorde; do
  openssl cms -verify -binary -noverify -inform DER -in "$M/$f.der" -content "$M/data.bin" -out geverifieerd.bin
done
echo "fixtures aangemaakt in $M"
