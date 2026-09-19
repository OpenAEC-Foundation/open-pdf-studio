"""Onafhankelijk orakel voor PAdES-integriteit en -dekking.

Leest handtekeningen met PDFium (pypdfium2), niet met de eigen PDF-lezer; CMS
en tijdstempels met een eigen kleine DER-lezer in Python; handtekeningwaarden
met `cryptography`. Voor wat PDFium niet prijsgeeft (welk exemplaar van een
handtekeningwoordenboek geldt, veldnamen, reden en `/M`) een eigen kleine
PDF-lezer die objectkoppen in de bytes zoekt, met RC4-ontsleuteling van
tekstvelden. Uitkomst per handtekening, in dezelfde termen als de verifier in
de app:

  soort          handtekening | documenttijdstempel | leeg-veld | onbekend
  veldnaamSha256 SHA-256 (hex) van de UTF-8-tekst van de volledige naam van het
                 veld; bij meer velden met dezelfde /V het veld waarvan de
                 objectkop binnen het bytebereik ligt, anders het eerste in
                 /Fields. Als hash, want veldnamen in het corpus bevatten namen
                 van producten
  integriteit    intact | gewijzigd | ongeldig | niet-te-controleren
  reden          bij niet-te-controleren: cms-onleesbaar | geen-certificaat |
                 algoritme-niet-ondersteund | bytebereik-ongeldig | verouderd-formaat
  dekt           bereikt het bytebereik het einde van het bestand? Alleen
                 PDF-witruimte (NUL, tab, LF, FF, CR, spatie) erna telt als gedekt.
  bereikEinde    eerste byte na het bytebereik (bij een bruikbaar bereik)
  woordenboekOndertekend
                 ligt de objectkop van het gebruikte exemplaar van het
                 handtekeningwoordenboek vóór het einde van het eigen bereik?
                 Bij meer exemplaren telt het nieuwste binnen het bereik,
                 anders het nieuwste.
  opgegevenRedenSha256
                 SHA-256 (hex) van de UTF-8-tekst van /Reason uit dat exemplaar;
                 als hash, want redenen in het corpus bevatten namen van
                 personen en producten
  tijdBron       tijdstempel (intact tijdstempel) | opgegeven (geldige /M) | onbekend
  tijdstempel    integriteit van een handtekeningtijdstempel, indien aanwezig

De reden van het vertrouwensoordeel staat er niet in: die hangt af van het
rootarchief van de machine en van de klok.

Volgorde: op het einde van het bytebereik (revisievolgorde); lege velden achteraan.

Kan PDFium een bestand niet openen, dan zoekt het orakel `/ByteRange` en het
bijbehorende gat rechtstreeks in de bytes (alleen voor bestanden met één
handtekening).

Gebruik (vanuit de repo-root):
  python scripts/pades-orakel.py              # uitkomsten als JSON
  python scripts/pades-orakel.py --controleer # vergelijken met het manifest

Vereist: pip install pypdfium2 cryptography
"""
import ctypes
import hashlib
import json
import os
import re
import struct
import sys
import zlib

import pypdfium2 as pdfium
import pypdfium2.raw as raw
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "scripts", "handtekening-testdata.json")
MAP = os.path.join(ROOT, "testdata", "handtekeningen", "pades")

HASH = {"1.3.14.3.2.26": "sha1", "2.16.840.1.101.3.4.2.1": "sha256",
        "2.16.840.1.101.3.4.2.2": "sha384", "2.16.840.1.101.3.4.2.3": "sha512"}
HASH_OID = {naam: o for o, naam in HASH.items()}
RSA_V15 = {"1.2.840.113549.1.1.5": "sha1", "1.2.840.113549.1.1.11": "sha256",
           "1.2.840.113549.1.1.12": "sha384", "1.2.840.113549.1.1.13": "sha512"}
ECDSA = {"1.2.840.10045.4.1": "sha1", "1.2.840.10045.4.3.2": "sha256",
         "1.2.840.10045.4.3.3": "sha384", "1.2.840.10045.4.3.4": "sha512"}
RSA_ENCRYPTION = "1.2.840.113549.1.1.1"
RSASSA_PSS = "1.2.840.113549.1.1.10"
EC_PUBLIC_KEY = "1.2.840.10045.2.1"
ID_DATA = "1.2.840.113549.1.7.1"
ID_TSTINFO = "1.2.840.113549.1.9.16.1.4"
ID_SIGNED_DATA = "1.2.840.113549.1.7.2"
CONTENT_TYPE = "1.2.840.113549.1.9.3"
MESSAGE_DIGEST = "1.2.840.113549.1.9.4"
TIMESTAMP_TOKEN = "1.2.840.113549.1.9.16.2.14"
PDF_WITRUIMTE = b"\0\t\n\x0c\r "


class Niet(Exception):
    """Niet te controleren, met reden."""


# ---------- DER / BER ----------

def kop(b, i):
    tag = b[i]
    if tag & 0x1F == 0x1F:
        raise ValueError("hoge tag")
    l0 = b[i + 1]
    if l0 == 0x80:
        return tag, None, i + 2
    if l0 < 0x80:
        return tag, l0, i + 2
    n = l0 & 0x7F
    return tag, int.from_bytes(b[i + 2:i + 2 + n], "big"), i + 2 + n


def lengte(n):
    if n < 0x80:
        return bytes([n])
    x = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(x)]) + x


def normaliseer(b, i=0, diepte=0):
    """BER -> DER (onbepaalde lengtes, samengestelde OCTET STRING). Geeft (der, volgende)."""
    if diepte > 64:
        raise ValueError("te diep")
    tag, n, s = kop(b, i)
    if not tag & 0x20:
        if n is None or s + n > len(b):
            raise ValueError("primitief ongeldig")
        return bytes([tag]) + lengte(n) + b[s:s + n], s + n
    delen = []
    if n is None:
        j = s
        while b[j:j + 2] != b"\x00\x00":
            d, j = normaliseer(b, j, diepte + 1)
            delen.append(d)
        einde = j + 2
    else:
        einde = s + n
        if einde > len(b):
            raise ValueError("afgekapt")
        j = s
        while j < einde:
            d, j = normaliseer(b, j, diepte + 1)
            delen.append(d)
    if tag == 0x24:
        inhoud = b"".join(inh(d) for d in delen)
        return b"\x04" + lengte(len(inhoud)) + inhoud, einde
    inhoud = b"".join(delen)
    return bytes([tag]) + lengte(len(inhoud)) + inhoud, einde


def tlv(b, i=0):
    tag, n, s = kop(b, i)
    if n is None or s + n > len(b):
        raise ValueError("geen DER")
    return tag, s, s + n


def inh(b):
    _, s, e = tlv(b)
    return b[s:e]


def kinderen(b):
    """Kinderen van een samengesteld DER-element `b` (volledige TLV's)."""
    _, s, e = tlv(b)
    uit, j = [], s
    while j < e:
        _, cs, ce = tlv(b, j)
        uit.append(b[j:ce])
        j = ce
    return uit


def oid(b):
    t, s, e = tlv(b)
    if t != 0x06:
        raise ValueError("geen OID")
    delen, v, eerste = [], 0, True
    for x in b[s:e]:
        v = (v << 7) | (x & 0x7F)
        if not x & 0x80:
            if eerste:
                a = min(v // 40, 2)
                delen += [a, v - 40 * a]
                eerste = False
            else:
                delen.append(v)
            v = 0
    return ".".join(map(str, delen))


def attributen(b):
    """Attributen als lijst (oid, waarden), in de volgorde van de SET."""
    uit = []
    for a in kinderen(b):
        k = kinderen(a)
        uit.append((oid(k[0]), kinderen(k[1])))
    return uit


def enkel_attribuut(attrs, doel):
    """RFC 5652 §5.3: het attribuut precies één keer, met precies één waarde."""
    treffers = [w for o, w in attrs if o == doel]
    if len(treffers) != 1 or len(treffers[0]) != 1:
        raise Niet("cms-onleesbaar")
    return treffers[0][0]


def signed_data(contents):
    der, _ = normaliseer(contents)
    ci = kinderen(der)
    if oid(ci[0]) != ID_SIGNED_DATA:
        raise ValueError("geen SignedData")
    sd = kinderen(ci[1])[0]
    velden = kinderen(sd)
    eci = kinderen(velden[2])
    econtent = inh(kinderen(eci[1])[0]) if len(eci) > 1 else None
    certs, signers = [], None
    for v in velden[3:]:
        if v[0] == 0xA0:
            certs = [c for c in kinderen(v) if c[0] == 0x30]
        elif v[0] == 0x31:
            signers = kinderen(v)
    if not signers:
        raise ValueError("geen ondertekenaar")
    si = kinderen(signers[0])
    j = 1
    sid = si[j]; j += 1
    digalg = oid(kinderen(si[j])[0]); j += 1
    sa = None
    attrs = []
    if si[j][0] == 0xA0:
        sa = b"\x31" + si[j][1:]
        attrs = attributen(si[j])
        j += 1
    alg = kinderen(si[j]); j += 1
    handtekening = inh(si[j]); j += 1
    unsigned = {}
    if j < len(si) and si[j][0] == 0xA1:
        for o, w in attributen(si[j]):
            unsigned.setdefault(o, w)
    return {"econtype": oid(eci[0]), "econtent": econtent, "certs": certs, "sid": sid,
            "digalg": digalg, "signed_attrs": sa, "attrs": attrs, "sigalg": oid(alg[0]),
            "sigparams": alg[1] if len(alg) > 1 else None, "handtekening": handtekening,
            "unsigned": unsigned}


def zoek_certs(sd):
    """Alle leesbare certificaten die bij de SignerIdentifier passen, in volgorde."""
    sid, uit = sd["sid"], []
    for c in sd["certs"]:
        try:
            cert = x509.load_der_x509_certificate(c)
        except ValueError:
            continue
        if sid[0] == 0x30:
            ias = kinderen(sid)
            serie = int.from_bytes(inh(ias[1]), "big", signed=True)
            if cert.serial_number == serie and cert.issuer.public_bytes() == ias[0]:
                uit.append(cert)
        else:
            try:
                ski = cert.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).value.digest
            except x509.ExtensionNotFound:
                continue
            if ski == inh(sid):
                uit.append(cert)
    return uit


def hashobj(naam):
    return {"sha1": hashes.SHA1(), "sha256": hashes.SHA256(),
            "sha384": hashes.SHA384(), "sha512": hashes.SHA512()}[naam]


def pss_hash(params):
    h, mgf, zout = "sha1", "sha1", 20
    if params:
        for v in kinderen(params):
            b = inh(v)
            if v[0] == 0xA0:
                h = HASH.get(oid(kinderen(b)[0]))
            elif v[0] == 0xA1:
                mgf = HASH.get(oid(kinderen(kinderen(b)[1])[0]))
            elif v[0] == 0xA2:
                zout = int.from_bytes(inh(b), "big")
    if h is None or h != mgf:
        raise Niet("algoritme-niet-ondersteund")
    return h, zout


def controleer_waarde(cert, sd, gegevens):
    """True als de waarde klopt, False als niet; Niet als niet te controleren."""
    pk = cert.public_key()
    alg, standaard = sd["sigalg"], HASH.get(sd["digalg"])
    try:
        if alg in RSA_V15 or alg == RSA_ENCRYPTION:
            h = RSA_V15.get(alg, standaard)
            if alg in RSA_V15 and standaard is not None and h != standaard:
                raise Niet("algoritme-niet-ondersteund")
            if not isinstance(pk, rsa.RSAPublicKey) or h is None:
                raise Niet("algoritme-niet-ondersteund")
            pk.verify(sd["handtekening"], gegevens, padding.PKCS1v15(), hashobj(h))
        elif alg == RSASSA_PSS:
            h, zout = pss_hash(sd["sigparams"])
            if not isinstance(pk, rsa.RSAPublicKey):
                raise Niet("algoritme-niet-ondersteund")
            pk.verify(sd["handtekening"], gegevens, padding.PSS(padding.MGF1(hashobj(h)), zout), hashobj(h))
        elif alg in ECDSA or alg == EC_PUBLIC_KEY:
            h = ECDSA.get(alg, standaard)
            if not isinstance(pk, ec.EllipticCurvePublicKey) or pk.curve.name not in ("secp256r1", "secp384r1") or h is None:
                raise Niet("algoritme-niet-ondersteund")
            pk.verify(sd["handtekening"], gegevens, ec.ECDSA(hashobj(h)))
        else:
            raise Niet("algoritme-niet-ondersteund")
        return True
    except InvalidSignature:
        return False


NIET_VAN_TOEPASSING = object()


def digest_info(b, h):
    """DigestInfo, strikt: SEQUENCE { SEQUENCE { OID, NULL? }, OCTET STRING }, zonder restbytes."""
    try:
        tag, s, e = tlv(b)
        if tag != 0x30 or e != len(b):
            return None
        alg, waarde = kinderen(b)
        alg_delen = kinderen(alg)
        if alg[0] != 0x30 or oid(alg_delen[0]) != HASH_OID[h] or alg_delen[1:] not in ([], [b"\x05\x00"]):
            return None
        digest = inh(waarde)
        if waarde[0] != 0x04 or len(digest) != hashlib.new(h).digest_size:
            return None
        return digest
    except (ValueError, IndexError):
        return None


def pkcs1_digest(cert, sd, standaard):
    """RSA PKCS#1 v1.5: de ondertekende digest terughalen (s^e mod n).

    NIET_VAN_TOEPASSING bij een ander algoritme of een andere sleutel; None bij
    een ongeldige codering; anders de digest."""
    alg = sd["sigalg"]
    if alg == RSA_ENCRYPTION:
        h = standaard
    elif alg in RSA_V15 and RSA_V15[alg] == standaard:
        h = standaard
    else:
        return NIET_VAN_TOEPASSING
    pk = cert.public_key()
    if h is None or not isinstance(pk, rsa.RSAPublicKey):
        return NIET_VAN_TOEPASSING
    getallen = pk.public_numbers()
    k = (getallen.n.bit_length() + 7) // 8
    s = sd["handtekening"]
    x = int.from_bytes(s, "big")
    if len(s) != k or x >= getallen.n:
        return None
    em = pow(x, getallen.e, getallen.n).to_bytes(k, "big")
    if em[:2] != b"\x00\x01":
        return None
    j = 2
    while j < k and em[j] == 0xFF:
        j += 1
    if j - 2 < 8 or em[j:j + 1] != b"\x00":
        return None
    return digest_info(em[j + 1:], h)


def controleer_ondertekenaar(sd, inhoud):
    """intact | gewijzigd | ongeldig; Niet bij niet te controleren."""
    h = HASH.get(sd["digalg"])
    if h is None:
        raise Niet("algoritme-niet-ondersteund")
    if sd["signed_attrs"] is not None:
        try:
            soort = oid(enkel_attribuut(sd["attrs"], CONTENT_TYPE))
        except ValueError:
            raise Niet("cms-onleesbaar")
        if soort != sd["econtype"]:
            raise Niet("cms-onleesbaar")
        md = enkel_attribuut(sd["attrs"], MESSAGE_DIGEST)
        if hashlib.new(h, inhoud).digest() != inh(md):
            return "gewijzigd"
        gegevens = sd["signed_attrs"]
    else:
        gegevens = inhoud
    kandidaten = zoek_certs(sd)
    if not kandidaten:
        raise Niet("geen-certificaat")
    niet_ondersteund = False
    for cert in kandidaten:
        try:
            if controleer_waarde(cert, sd, gegevens):
                return "intact"
        except Niet:
            niet_ondersteund = True
    if niet_ondersteund:
        raise Niet("algoritme-niet-ondersteund")
    if sd["signed_attrs"] is not None:
        return "ongeldig"
    # Zonder ondertekende attributen: geldige PKCS#1-codering met een andere
    # digest is gewijzigde inhoud, een ongeldige codering een ongeldige waarde.
    toepasbaar = False
    for cert in kandidaten:
        digest = pkcs1_digest(cert, sd, h)
        if digest is NIET_VAN_TOEPASSING:
            continue
        if digest is None:
            toepasbaar = True
            continue
        return "gewijzigd" if digest != hashlib.new(h, inhoud).digest() else "ongeldig"
    return "ongeldig" if toepasbaar else "gewijzigd"


def controleer_token(token, gegevens):
    try:
        sd = signed_data(token)
    except (ValueError, IndexError):
        raise Niet("cms-onleesbaar")
    if sd["econtype"] != ID_TSTINFO or sd["econtent"] is None:
        raise Niet("cms-onleesbaar")
    velden = kinderen(sd["econtent"])
    mi = kinderen(velden[2])
    h = HASH.get(oid(kinderen(mi[0])[0]))
    if h is None:
        raise Niet("algoritme-niet-ondersteund")
    if hashlib.new(h, gegevens).digest() != inh(mi[1]):
        return "gewijzigd"
    uitkomst = controleer_ondertekenaar(sd, sd["econtent"])
    return "ongeldig" if uitkomst == "gewijzigd" else uitkomst


def soort_van(subfilter):
    if subfilter == "ETSI.RFC3161":
        return "documenttijdstempel"
    if subfilter in ("ETSI.CAdES.detached", "adbe.pkcs7.detached"):
        return "handtekening"
    return "onbekend"


# ---------- PDF: eigen kleine lezer ----------

SCHEIDING = b"()<>[]{}/%"
WIT = PDF_WITRUIMTE
KOP = re.compile(rb"(?<![0-9A-Za-z])(\d+)[\0\t\n\x0c\r ]+(\d+)[\0\t\n\x0c\r ]+obj(?![0-9A-Za-z])")
GETAL = re.compile(rb"[+-]?(?:\d+\.?\d*|\.\d+)")
VERWIJZING = re.compile(rb"[\0\t\n\x0c\r ]+(\d+)[\0\t\n\x0c\r ]+R(?![^\0\t\n\x0c\r ()<>\[\]{}/%])")
OCTAAL = re.compile(rb"[0-7]{1,3}")
ESCAPES = {ord("n"): b"\n", ord("r"): b"\r", ord("t"): b"\t", ord("b"): b"\b", ord("f"): b"\f",
           ord("("): b"(", ord(")"): b")", ord("\\"): b"\\"}
OPVULLING = bytes.fromhex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A")
# PDFDocEncoding (ISO 32000-1 bijlage D) waar het afwijkt van Latin-1.
PDFDOC = {0x18: "˘", 0x19: "ˇ", 0x1A: "ˆ", 0x1B: "˙", 0x1C: "˝", 0x1D: "˛",
          0x1E: "˚", 0x1F: "˜", 0x80: "•", 0x81: "†", 0x82: "‡", 0x83: "…",
          0x84: "—", 0x85: "–", 0x86: "ƒ", 0x87: "⁄", 0x88: "‹", 0x89: "›",
          0x8A: "−", 0x8B: "‰", 0x8C: "„", 0x8D: "“", 0x8E: "”", 0x8F: "‘",
          0x90: "’", 0x91: "‚", 0x92: "™", 0x93: "ﬁ", 0x94: "ﬂ", 0x95: "Ł",
          0x96: "Œ", 0x97: "Š", 0x98: "Ÿ", 0x99: "Ž", 0x9A: "ı", 0x9B: "ł",
          0x9C: "œ", 0x9D: "š", 0x9E: "ž", 0xA0: "€"}


class Naam(str):
    pass


class Tekst(bytes):
    pass


class Ref(tuple):
    pass


def sla_wit_over(b, i):
    while i < len(b):
        if b[i] in WIT:
            i += 1
        elif b[i] == 0x25:
            while i < len(b) and b[i] not in b"\r\n":
                i += 1
        else:
            break
    return i


def lees_letterlijk(b, i):
    uit, diepte, i = bytearray(), 0, i + 1
    while True:
        c = b[i]
        if c == 0x5C:
            n = b[i + 1]
            if n in ESCAPES:
                uit += ESCAPES[n]
                i += 2
            elif 0x30 <= n <= 0x37:
                m = OCTAAL.match(b, i + 1)
                uit.append(int(m.group(0), 8) & 0xFF)
                i = m.end()
            elif n == 0x0D:
                i += 3 if b[i + 2:i + 3] == b"\n" else 2
            elif n == 0x0A:
                i += 2
            else:
                i += 1
        elif c == 0x28:
            diepte += 1
            uit.append(c)
            i += 1
        elif c == 0x29:
            if diepte == 0:
                return Tekst(bytes(uit)), i + 1
            diepte -= 1
            uit.append(c)
            i += 1
        else:
            uit.append(c)
            i += 1


def lees_waarde(b, i, diepte=0):
    """Eén PDF-object vanaf `i`: (waarde, positie erna)."""
    if diepte > 100:
        raise ValueError("te diep")
    i = sla_wit_over(b, i)
    if b.startswith(b"<<", i):
        d, i = {}, i + 2
        while True:
            i = sla_wit_over(b, i)
            if b.startswith(b">>", i):
                return d, i + 2
            k, i = lees_waarde(b, i, diepte + 1)
            if not isinstance(k, Naam):
                raise ValueError("sleutel is geen naam")
            d[k], i = lees_waarde(b, i, diepte + 1)
    c = b[i:i + 1]
    if c == b"[":
        a, i = [], i + 1
        while True:
            i = sla_wit_over(b, i)
            if b[i:i + 1] == b"]":
                return a, i + 1
            v, i = lees_waarde(b, i, diepte + 1)
            a.append(v)
    if c == b"(":
        return lees_letterlijk(b, i)
    if c == b"<":
        j = b.index(b">", i)
        cijfers = bytes(x for x in b[i + 1:j] if x not in WIT)
        if len(cijfers) % 2:
            cijfers += b"0"
        return Tekst(bytes.fromhex(cijfers.decode("ascii"))), j + 1
    if c == b"/":
        j = i + 1
        while j < len(b) and b[j] not in WIT and b[j] not in SCHEIDING:
            j += 1
        naam = re.sub(rb"#([0-9A-Fa-f]{2})", lambda m: bytes([int(m.group(1), 16)]), b[i + 1:j])
        return Naam(naam.decode("latin-1")), j
    m = GETAL.match(b, i)
    if m:
        tekst = m.group(0)
        if b"." in tekst:
            return float(tekst), m.end()
        r = VERWIJZING.match(b, m.end())
        if r and tekst[:1] not in b"+-":
            return Ref((int(tekst), int(r.group(1)))), r.end()
        return int(tekst), m.end()
    for woord, waarde in ((b"true", True), (b"false", False), (b"null", None)):
        if b.startswith(woord, i):
            return waarde, i + len(woord)
    raise ValueError(f"onbekend token op {i}")


def rc4(sleutel, data):
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + sleutel[i % len(sleutel)]) & 0xFF
        s[i], s[j] = s[j], s[i]
    uit, i, j = bytearray(), 0, 0
    for x in data:
        i = (i + 1) & 0xFF
        j = (j + s[i]) & 0xFF
        s[i], s[j] = s[j], s[i]
        uit.append(x ^ s[(s[i] + s[j]) & 0xFF])
    return bytes(uit)


def decodeer_tekst(b):
    """Tekststring (ISO 32000-1 §7.9.2.2): UTF-16BE of UTF-8 met BOM, anders PDFDocEncoding."""
    try:
        if b.startswith(b"\xfe\xff"):
            return b[2:].decode("utf-16-be")
        if b.startswith(b"\xef\xbb\xbf"):
            return b[3:].decode("utf-8")
    except UnicodeDecodeError:
        return None
    return "".join(PDFDOC.get(x, chr(x)) for x in b)


def pdf_datum_geldig(tekst):
    """Is `tekst` een bruikbare PDF-datum (ISO 32000-1 §7.9.4)?"""
    s = tekst[2:] if tekst.startswith("D:") else tekst
    if not re.fullmatch(r"[0-9]{4}", s[:4]):
        return False
    jaar, delen, p = int(s[:4]), [1, 1, 0, 0, 0], 4
    for k in range(5):
        if p >= len(s) or s[p] in "Z+-":
            break
        if not re.fullmatch(r"[0-9]{2}", s[p:p + 2]):
            return False
        delen[k] = int(s[p:p + 2])
        p += 2
    maand, dag, uur, minuut, seconde = delen
    schrikkel = jaar % 4 == 0 and (jaar % 100 != 0 or jaar % 400 == 0)
    dagen = {2: 29 if schrikkel else 28, 4: 30, 6: 30, 9: 30, 11: 30}.get(maand, 31)
    if not (1 <= maand <= 12 and 1 <= dag <= dagen and uur <= 23 and minuut <= 59 and seconde <= 60):
        return False
    if p < len(s) and s[p] in "+-":
        return len(re.findall(r"[0-9]", s[p + 1:])) >= 2
    return True


class Pdf:
    """Objecten uit de bytes: elk exemplaar van een objectkop, plus objectstromen."""

    def __init__(self, data):
        self.data = data
        self.exemplaren = {}
        for m in KOP.finditer(data):
            try:
                waarde, einde = lees_waarde(data, m.end())
            except (ValueError, IndexError):
                continue
            self.exemplaren.setdefault((int(m.group(1)), int(m.group(2))), []).append((m.start(), waarde, True, einde))
        self.pak_objectstromen_uit()
        self.sleutel = self.bestandssleutel()

    def nieuwste(self, id):
        exemplaren = self.exemplaren.get(tuple(id))
        return max(exemplaren, key=lambda e: e[0]) if exemplaren else None

    def los_op(self, waarde):
        for _ in range(32):
            if not isinstance(waarde, Ref):
                return waarde
            exemplaar = self.nieuwste(waarde)
            if exemplaar is None:
                return None
            waarde = exemplaar[1]
        return None

    def pak_objectstromen_uit(self):
        for id, exemplaren in list(self.exemplaren.items()):
            for pos, d, _, einde in exemplaren:
                if not isinstance(d, dict) or d.get("Type") != "ObjStm" or d.get("Filter") != "FlateDecode":
                    continue
                m = re.compile(rb"[\0\t\n\x0c\r ]*stream(\r\n|\n)").match(self.data, einde)
                lengte_ = self.los_op(d.get("Length"))
                if not m or not isinstance(lengte_, int):
                    continue
                try:
                    inhoud = zlib.decompress(self.data[m.end():m.end() + lengte_])
                    getallen = [int(x) for x in inhoud[:d["First"]].split()]
                    for k in range(0, 2 * d["N"], 2):
                        waarde, _ = lees_waarde(inhoud, d["First"] + getallen[k + 1])
                        self.exemplaren.setdefault((getallen[k], 0), []).append((pos, waarde, False, None))
                except (zlib.error, ValueError, IndexError, KeyError):
                    continue

    def laatste_verwijzing(self, sleutel):
        treffers = list(re.finditer(re.escape(sleutel) + rb"[\0\t\n\x0c\r ]*(\d+)[\0\t\n\x0c\r ]+(\d+)[\0\t\n\x0c\r ]+R", self.data))
        return Ref((int(treffers[-1].group(1)), int(treffers[-1].group(2)))) if treffers else None

    def bestandssleutel(self):
        """None zonder versleuteling; 'onbekend' als niet te ontsleutelen; anders de RC4-sleutel."""
        verwijzing = self.laatste_verwijzing(b"/Encrypt")
        if verwijzing is None:
            return None
        v = self.los_op(verwijzing)
        ids = list(re.finditer(rb"/ID[\0\t\n\x0c\r ]*\[", self.data))
        if not isinstance(v, dict) or v.get("Filter") != "Standard" or v.get("V") not in (1, 2) or v.get("R") not in (2, 3) or not ids:
            return "onbekend"
        id0 = lees_waarde(self.data, ids[-1].end())[0]
        n = 5 if v["R"] == 2 else v.get("Length", 40) // 8
        h = hashlib.md5(OPVULLING + v["O"] + struct.pack("<i", v["P"]) + id0).digest()
        if v["R"] >= 3:
            for _ in range(50):
                h = hashlib.md5(h[:n]).digest()
        return h[:n]

    def tekst(self, waarde, houder):
        if not isinstance(waarde, Tekst) or self.sleutel == "onbekend":
            return None
        b = bytes(waarde)
        if self.sleutel is not None:
            nummer, generatie = houder
            objectsleutel = hashlib.md5(self.sleutel + nummer.to_bytes(3, "little") + generatie.to_bytes(2, "little")).digest()
            b = rc4(objectsleutel[:min(len(self.sleutel) + 5, 16)], b)
        return decodeer_tekst(b)

    def handtekeningvelden(self):
        """/FT /Sig-velden bovenaan in /Fields, in volgorde: (id, woordenboek)."""
        catalogus = self.los_op(self.laatste_verwijzing(b"/Root"))
        formulier = self.los_op(catalogus.get("AcroForm")) if isinstance(catalogus, dict) else None
        velden = self.los_op(formulier.get("Fields")) if isinstance(formulier, dict) else None
        uit = []
        for v in velden if isinstance(velden, list) else []:
            d = self.los_op(v)
            if isinstance(v, Ref) and isinstance(d, dict) and d.get("FT") == "Sig":
                uit.append((tuple(v), d))
        return uit

    def volledige_naam(self, id, d):
        delen = []
        for _ in range(32):
            deel = self.tekst(d.get("T"), id)
            if deel is not None:
                delen.insert(0, deel)
            ouder = d.get("Parent")
            if not isinstance(ouder, Ref) or not isinstance(self.los_op(ouder), dict):
                break
            id, d = tuple(ouder), self.los_op(ouder)
        return ".".join(delen) if delen else None

    def woordenboek(self, br, contents):
        """Het gebruikte exemplaar van het handtekeningwoordenboek met dit bereik
        en deze /Contents: (houder, positie, woordenboek, indirect)."""
        kandidaten = []
        for id, exemplaren in self.exemplaren.items():
            for pos, waarde, los, _ in exemplaren:
                if not los or not isinstance(waarde, dict):
                    continue
                for d, indirect in [(waarde, True)] + [(w, False) for w in waarde.values() if isinstance(w, dict)]:
                    if d.get("ByteRange") == br and isinstance(d.get("Contents"), Tekst) and bytes(d["Contents"]) == contents:
                        kandidaten.append((id, pos, d, indirect))
        kandidaten.sort(key=lambda k: k[1])
        einde = br[2] + br[3]
        binnen = [k for k in kandidaten if k[1] < einde]
        return (binnen or kandidaten or [None])[-1]

    def veldnaam(self, gekozen, einde):
        id, _, _, indirect = gekozen
        volgorde = {veld: i for i, (veld, _) in enumerate(self.handtekeningvelden())}
        kandidaten = []
        for veld in self.exemplaren:
            pos, d, los, _ = self.nieuwste(veld)
            if not isinstance(d, dict):
                continue
            if (indirect and d.get("V") == Ref(id)) or (not indirect and veld == id and isinstance(d.get("V"), dict)):
                kandidaten.append((los and pos < einde, veld, d))
        if not kandidaten:
            return None
        binnen = [k for k in kandidaten if k[0]]
        _, veld, d = min(binnen or kandidaten, key=lambda k: (volgorde.get(k[1], float("inf")), k[1]))
        return self.volledige_naam(veld, d)


def integriteit_cms(contents, inhoud, rij):
    """Integriteit van een CAdES/PKCS#7-handtekening; zet ook `tijdstempel` in `rij`."""
    try:
        sd = signed_data(contents)
    except (ValueError, IndexError):
        raise Niet("cms-onleesbaar")
    if sd["econtent"] is not None or sd["econtype"] != ID_DATA:
        raise Niet("cms-onleesbaar")
    token = sd["unsigned"].get(TIMESTAMP_TOKEN)
    if token:
        try:
            rij["tijdstempel"] = controleer_token(token[0], sd["handtekening"])
        except Niet:
            rij["tijdstempel"] = "niet-te-controleren"
    return controleer_ondertekenaar(sd, inhoud)


def sha256_hex(tekst):
    return hashlib.sha256(tekst.encode("utf-8")).hexdigest()


def beoordeel(data, br, contents, subfilter, pdf):
    rij = {"soort": soort_van(subfilter)}
    gekozen = pdf.woordenboek(br, contents)
    if gekozen is None:
        raise SystemExit(f"handtekeningwoordenboek met bytebereik {br} niet gevonden")
    houder, positie, woordenboek, _ = gekozen
    bruikbaar = len(br) == 4 and min(br) >= 0 and br[0] == 0 and br[1] + 2 <= br[2] and br[2] + br[3] <= len(data)
    einde = br[2] + br[3] if len(br) == 4 else None
    naam = pdf.veldnaam(gekozen, einde if einde is not None else -1)
    if naam is not None:
        rij["veldnaamSha256"] = sha256_hex(naam)
    rij["woordenboekOndertekend"] = einde is not None and min(br) >= 0 and positie < einde
    reden = pdf.tekst(woordenboek.get("Reason"), houder)
    if reden is not None:
        rij["opgegevenRedenSha256"] = sha256_hex(reden)
    m = pdf.tekst(woordenboek.get("M"), houder)
    rij["tijdBron"] = "opgegeven" if m is not None and pdf_datum_geldig(m) else "onbekend"
    if bruikbaar:
        rij["bereikEinde"] = einde
    geldig = bruikbaar and data[br[1]:br[1] + 1] == b"<" and data[br[2] - 1:br[2]] == b">"
    if not geldig:
        rij.update(integriteit="niet-te-controleren", reden="bytebereik-ongeldig", dekt=False)
        return rij, None
    rij["dekt"] = all(c in PDF_WITRUIMTE for c in data[br[2] + br[3]:])
    inhoud = data[br[0]:br[0] + br[1]] + data[br[2]:br[2] + br[3]]
    try:
        if rij["soort"] == "onbekend":
            raise Niet("verouderd-formaat")
        if rij["soort"] == "documenttijdstempel":
            rij["integriteit"] = controleer_token(contents, inhoud)
            if rij["integriteit"] == "intact":
                rij["tijdBron"] = "tijdstempel"
        else:
            rij["integriteit"] = integriteit_cms(contents, inhoud, rij)
    except Niet as n:
        rij.update(integriteit="niet-te-controleren", reden=str(n))
    if rij.get("tijdstempel") == "intact":
        rij["tijdBron"] = "tijdstempel"
    return rij, einde


def lees_str(fn, obj):
    n = fn(obj, None, 0)
    if n <= 0:
        return ""
    buf = ctypes.create_string_buffer(n)
    fn(obj, buf, n)
    return buf.raw[:n].rstrip(b"\x00").decode("latin-1")


def onderzoek(pad):
    data = open(pad, "rb").read()
    pdf = Pdf(data)
    rijen = []
    try:
        doc = pdfium.PdfDocument(pad)
    except pdfium.PdfiumError:
        doc = None
    if doc is not None:
        velden = pdf.handtekeningvelden()
        for i in range(raw.FPDF_GetSignatureCount(doc.raw)):
            sig = raw.FPDF_GetSignatureObject(doc.raw, i)
            nbr = raw.FPDFSignatureObj_GetByteRange(sig, None, 0)
            if nbr <= 0:
                rij = {"soort": "leeg-veld"}
                naam = pdf.volledige_naam(*velden[i]) if i < len(velden) else None
                if naam is not None:
                    rij["veldnaamSha256"] = sha256_hex(naam)
                rijen.append((rij, None))
                continue
            buf = (ctypes.c_int * nbr)()
            raw.FPDFSignatureObj_GetByteRange(sig, buf, nbr)
            n = raw.FPDFSignatureObj_GetContents(sig, None, 0)
            cb = ctypes.create_string_buffer(max(n, 1))
            raw.FPDFSignatureObj_GetContents(sig, cb, n)
            rijen.append(beoordeel(data, list(buf), cb.raw[:n], lees_str(raw.FPDFSignatureObj_GetSubFilter, sig), pdf))
        doc.close()
    else:
        treffers = list(re.finditer(rb"/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]", data))
        if len(treffers) != 1:
            raise SystemExit(f"{pad}: ruwe scan ondersteunt precies één handtekening")
        br = [int(x) for x in treffers[0].groups()]
        gat = re.sub(rb"\s", b"", data[br[1]:br[2]].strip(b"<>"))
        sf = re.search(rb"/SubFilter\s*/([A-Za-z0-9.]+)", data)
        rijen.append(beoordeel(data, br, bytes.fromhex(gat.decode()), sf.group(1).decode() if sf else "", pdf))
    rijen.sort(key=lambda r: r[1] if r[1] is not None else float("inf"))
    return [r for r, _ in rijen]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    uitkomst, fouten = {}, []
    for b in manifest["bronnen"]["pades"]["bestanden"]:
        rijen = onderzoek(os.path.join(MAP, b["bestand"]))
        uitkomst[b["bestand"]] = rijen
        if "--controleer" in sys.argv and rijen != b.get("handtekeningen"):
            fouten.append(f"{b['bestand']}: orakel {rijen} != manifest {b.get('handtekeningen')}")
    if "--controleer" in sys.argv:
        print("\n".join(fouten) if fouten else f"{len(uitkomst)} bestanden gelijk aan het manifest")
        sys.exit(1 if fouten else 0)
    print(json.dumps(uitkomst, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
