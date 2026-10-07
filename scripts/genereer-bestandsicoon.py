#!/usr/bin/env python3
"""Genereert het Windows-bestandstype-icoon voor PDF's.

Schrijft file-icon-{16,32,48,64,128,256}.png, file-icon.png (= 256) en
file-icon.ico naar open-pdf-studio/src-tauri/icons/.

Elke maat wordt apart getekend met een eigen, op hele pixels uitgelijnde
opmaak; er wordt niets van een grotere maat verkleind. Op 16 px staan de
letters "PDF" als handgeplaatste pixels, op 32 en 48 px als vormen met
rechte randen op hele pixels en afgeronde bogen, daarboven via een vet
schreefloos lettertype.

Gebruik:
    python scripts/genereer-bestandsicoon.py
    python scripts/genereer-bestandsicoon.py --voorbeeld preview.png [--oud-ref HEAD]
"""

import argparse
import io
import math
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
ICOON_MAP = REPO / "open-pdf-studio" / "src-tauri" / "icons"
MATEN = (16, 32, 48, 64, 128, 256)

# Supersampling voor schuine en ronde randen; rechte randen vallen op hele pixels.
K = 8

# Kleuren (gelijk aan het oude ontwerp).
PAGINA = (255, 255, 255, 255)
RAND = (192, 192, 192, 255)
EZELSOOR = (232, 232, 232, 255)
REGEL = (208, 208, 208, 255)
ROOD_BOVEN = (228, 57, 53)
ROOD_ONDER = (184, 28, 28)
BALK_ONDER = (199, 40, 40)
WIT = (255, 255, 255, 255)

# Lettertypen, eerste die bestaat wint.
LETTERTYPEN = (
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)

# Opmaak per maat, in hele pixels; rechthoeken als (x0, y0, x1, y1) met
# exclusieve eindcoordinaten.
#   pagina    : buitenrand van het blad
#   rand      : dikte van de grijze rand
#   oor       : zijde van het omgevouwen hoekje
#   balk      : rode balk bovenin (+ hoekstraal), of None
#   regels    : grijze tekstregels (rechthoeken, halfrond afgerond)
#   label     : rode label onderin (+ hoekstraal); steekt links en rechts uit
#   tekst     : ("pixel" of "vorm", glyph-maten) of ("font", kaphoogte in px)
#   schaduw   : zachte slagschaduw (alleen grote maten)
OPMAAK = {
    16: dict(
        pagina=(2, 0, 14, 16), rand=1, oor=4,
        balk=((4, 4, 12, 5), 0), regels=[],
        label=((0, 8, 16, 15), 1.5),
        tekst=("pixel", dict(s=1, t=1, h=5, b=3, f=2, br=(3, 4, 3), tus=1, hoek=(0, 1, 0))),
        schaduw=False,
    ),
    32: dict(
        pagina=(4, 1, 28, 31), rand=1, oor=7,
        balk=((7, 10, 25, 12), 0),
        regels=[(8, 14, 20, 15)],
        label=((1, 17, 31, 30), 2),
        tekst=("vorm", dict(s=2, t=2, h=9, b=6, f=4, br=(6, 7, 5), tus=2, r=(2, 0, 2.5, 0))),
        schaduw=False,
    ),
    48: dict(
        pagina=(5, 1, 43, 47), rand=1, oor=10,
        balk=((9, 14, 39, 18), 1),
        regels=[(10, 21, 36, 23)],
        label=((1, 26, 47, 44), 3),
        tekst=("vorm", dict(s=3, t=2, h=12, b=7, f=6, br=(9, 10, 7), tus=2, r=(3.5, 1, 4, 1.5))),
        schaduw=False,
    ),
    64: dict(
        pagina=(7, 1, 57, 61), rand=1, oor=13,
        balk=((11, 17, 53, 22), 1),
        regels=[(13, 26, 49, 28), (13, 30, 41, 32)],
        label=((2, 36, 62, 57), 3),
        tekst=("font", 15),
        schaduw=True,
    ),
    128: dict(
        pagina=(14, 5, 114, 123), rand=1, oor=24,
        balk=((22, 34, 106, 45), 2),
        regels=[(26, 53, 98, 57), (26, 61, 86, 65), (26, 69, 74, 73)],
        label=((5, 79, 123, 117), 5),
        tekst=("font", 26),
        schaduw=True,
    ),
    256: dict(
        pagina=(28, 10, 228, 246), rand=2, oor=48,
        balk=((44, 68, 212, 90), 4),
        regels=[(52, 106, 196, 114), (52, 122, 172, 130), (52, 138, 148, 146)],
        label=((10, 158, 246, 234), 10),
        tekst=("font", 52),
        schaduw=True,
    ),
}


def k(v, eind=False):
    # Pillow vult tot en met de opgegeven coordinaat: een eindrand ligt op v*K-1.
    return v * K - (1 if eind else 0)


def blad_punten(o):
    """Omtrek van het blad op het K-doek (met de klok mee)."""
    x0, y0, x1, y1 = o["pagina"]
    f = o["oor"]
    return [(k(x0), k(y0)), (k(x1 - f), k(y0)), (k(x1, 1), k(y0 + f, 1)),
            (k(x1, 1), k(y1, 1)), (k(x0), k(y1, 1))]


def oor_punten(o):
    """Omgevouwen hoekje; de schuine zijde valt precies op die van het blad."""
    x0, y0, x1, y1 = o["pagina"]
    f = o["oor"]
    return [(k(x1 - f), k(y0)), (k(x1, 1), k(y0 + f, 1)), (k(x1 - f), k(y0 + f, 1))]


def inkrimpen(punten, d):
    """Verschuift elke zijde van een convexe veelhoek (met de klok mee) d naar binnen."""
    n = len(punten)
    lijnen = []
    for i in range(n):
        (x0, y0), (x1, y1) = punten[i], punten[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        lengte = math.hypot(dx, dy)
        nx, ny = -dy / lengte, dx / lengte  # binnenwaartse normaal (y omlaag)
        lijnen.append(((x0 + nx * d, y0 + ny * d), (dx, dy)))
    uit = []
    for i in range(n):
        (p, r), (q, s) = lijnen[i - 1], lijnen[i]
        kruis = r[0] * s[1] - r[1] * s[0]
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / kruis
        # Afronden: Pillow kapt af, dus 15,9999999 mag geen 15 worden.
        uit.append((round(p[0] + t * r[0], 6), round(p[1] + t * r[1], 6)))
    return uit


def verloop(breedte, hoogte, boven, onder):
    """Verticaal kleurverloop als RGBA-beeld."""
    beeld = Image.new("RGBA", (breedte, hoogte))
    trek = ImageDraw.Draw(beeld)
    for y in range(hoogte):
        a = y / max(1, hoogte - 1)
        kleur = tuple(round(boven[i] + (onder[i] - boven[i]) * a) for i in range(3))
        trek.line([(0, y), (breedte, y)], fill=kleur + (255,))
    return beeld


def afgeronde_vulling(doek, rechthoek, straal, vulling):
    """Plakt een afgeronde rechthoek (effen kleur of verloop) op het K-doek."""
    x0, y0, x1, y1 = (v * K for v in rechthoek)
    masker = Image.new("L", doek.size, 0)
    ImageDraw.Draw(masker).rounded_rectangle(
        [x0, y0, x1 - 1, y1 - 1], radius=straal * K, fill=255)
    if isinstance(vulling, Image.Image):
        laag = Image.new("RGBA", doek.size, (0, 0, 0, 0))
        laag.paste(vulling.resize((x1 - x0, y1 - y0)), (x0, y0))
    else:
        laag = Image.new("RGBA", doek.size, vulling)
    doek.paste(laag, (0, 0), masker)


def teken_vormen(maat, o):
    """Blad, ezelsoor, balk, regels en label op K-maal resolutie, dan verkleind."""
    doek = Image.new("RGBA", (maat * K, maat * K), (0, 0, 0, 0))
    trek = ImageDraw.Draw(doek)
    r = o["rand"] * K

    blad = blad_punten(o)
    trek.polygon(blad, fill=RAND)
    trek.polygon(inkrimpen(blad, r), fill=PAGINA)

    oor = oor_punten(o)
    trek.polygon(oor, fill=RAND)
    trek.polygon(inkrimpen(oor, r), fill=EZELSOOR)

    if o["balk"]:
        (bx0, by0, bx1, by1), straal = o["balk"]
        afgeronde_vulling(doek, (bx0, by0, bx1, by1), straal,
                          verloop(bx1 - bx0, by1 - by0, ROOD_BOVEN, BALK_ONDER))
    for regel in o["regels"]:
        afgeronde_vulling(doek, regel, (regel[3] - regel[1]) / 2, REGEL)

    (lx0, ly0, lx1, ly1), straal = o["label"]
    afgeronde_vulling(doek, (lx0, ly0, lx1, ly1), straal,
                      verloop(lx1 - lx0, ly1 - ly0, ROOD_BOVEN, ROOD_ONDER))

    # Verkleinen met voorvermenigvuldigde alfa, anders krijgen randen een grauwe zoom.
    return doek.convert("RGBa").reduce(K).convert("RGBA")


def schaduw(maat, o):
    """Zachte slagschaduw onder blad en label."""
    masker = Image.new("L", (maat * K, maat * K), 0)
    trek = ImageDraw.Draw(masker)
    trek.polygon(blad_punten(o), fill=255)
    (lx0, ly0, lx1, ly1), straal = o["label"]
    trek.rounded_rectangle([lx0 * K, ly0 * K, lx1 * K - 1, ly1 * K - 1], radius=straal * K, fill=255)
    masker = masker.reduce(K)
    verschuif = max(1, maat // 128)
    masker = masker.transform(masker.size, Image.AFFINE, (1, 0, 0, 0, 1, -verschuif))
    masker = masker.filter(ImageFilter.GaussianBlur(maat / 96))
    masker = masker.point(lambda v: v * 40 // 255)
    laag = Image.new("RGBA", (maat, maat), (0, 0, 0, 0))
    laag.putalpha(masker)
    return laag


def pixel_glyphs(s, t, h, b, f, br, hoek):
    """Bouwt P, D en F uit hele pixels (voor de kleinste maat).

    s = dikte staande streek, t = dikte liggende streek, h = letterhoogte,
    b = onderkant van de P-bol, f = hoogte (bovenkant) van de F-middenbalk,
    br = breedtes (P, D, F), hoek = af te snijden hoekpixel per letter.
    """
    def leeg(w):
        return [[0] * w for _ in range(h)]

    def vul(g, x0, y0, x1, y1):
        for y in range(y0, y1):
            for x in range(x0, x1):
                g[y][x] = 1

    wp, wd, wf = br
    hp, hd, _ = hoek

    p = leeg(wp)
    vul(p, 0, 0, s, h)
    vul(p, 0, 0, wp - hp, t)
    vul(p, 0, b - t, wp - hp, b)
    vul(p, wp - s, hp, wp, b - hp)
    if not hp:
        vul(p, wp - s, 0, wp, b)

    d = leeg(wd)
    vul(d, 0, 0, s, h)
    vul(d, 0, 0, wd - hd, t)
    vul(d, 0, h - t, wd - hd, h)
    vul(d, wd - s, hd, wd, h - hd)

    fg = leeg(wf)
    vul(fg, 0, 0, s, h)
    vul(fg, 0, 0, wf, t)
    vul(fg, 0, f, wf - 1, f + t)

    maskers = []
    for g in (p, d, fg):
        m = Image.new("L", (len(g[0]), h), 0)
        m.putdata([255 * v for rij in g for v in rij])
        maskers.append(m)
    return maskers


def vorm_glyphs(s, t, h, b, f, br, r):
    """Bouwt P, D en F als vormen op K-maal resolutie.

    Rechte randen vallen op hele pixels en blijven scherp; alleen de bogen
    krijgen tussentinten. Maten als bij pixel_glyphs; r = stralen
    (P-bol buiten, P-bol binnen, D buiten, D binnen).
    """
    wp, wd, wf = br
    rpb, rpi, rdb, rdi = r

    def blok(trek, x0, y0, x1, y1, vul, straal=0):
        # Alleen de rechterhoeken rond; links sluit de stam aan. Zelf
        # opgebouwd omdat Pillow geen straal van de halve hoogte toestaat.
        x0, y0, x1, y1 = x0 * K, y0 * K, x1 * K - 1, y1 * K - 1
        r = min(round(straal * K), (y1 - y0 + 1) // 2, (x1 - x0 + 1) // 2)
        trek.rectangle([x0, y0, x1 - r, y1], fill=vul)
        if r:
            if y0 + r <= y1 - r:
                trek.rectangle([x0, y0 + r, x1, y1 - r], fill=vul)
            trek.ellipse([x1 - 2 * r + 1, y0, x1, y0 + 2 * r - 1], fill=vul)
            trek.ellipse([x1 - 2 * r + 1, y1 - 2 * r + 1, x1, y1], fill=vul)

    p, d, fg = (Image.new("L", (w * K, h * K), 0) for w in br)
    tp, td, tf = (ImageDraw.Draw(g) for g in (p, d, fg))
    blok(tp, 0, 0, wp, b, 255, rpb)
    blok(tp, s, t, wp - s, b - t, 0, rpi)
    blok(tp, 0, 0, s, h, 255)
    blok(td, 0, 0, wd, h, 255, rdb)
    blok(td, s, t, wd - s, h - t, 0, rdi)
    blok(td, 0, 0, s, h, 255)
    blok(tf, 0, 0, s, h, 255)
    blok(tf, 0, 0, wf, t, 255)
    blok(tf, 0, f, wf - 1, f + t, 255)
    return [g.reduce(K) for g in (p, d, fg)]


def lettertype_pad():
    for pad in LETTERTYPEN:
        if Path(pad).exists():
            return pad
    sys.exit("Geen vet lettertype gevonden; pas LETTERTYPEN aan.")


def font_glyphs(kaphoogte):
    """Zet "PDF" met een vette font, kaphoogte zoals opgegeven.

    Het masker wordt bijgesneden tot de getekende letters, zodat het
    centreren op de werkelijke inkt gebeurt en niet op de fontmetriek.
    """
    pad = lettertype_pad()
    for stap in range(kaphoogte, kaphoogte * 3):
        font = ImageFont.truetype(pad, stap)
        if -font.getbbox("PDF", anchor="ls")[1] >= kaphoogte:
            break
    links, top, rechts, onder = font.getbbox("PDF", anchor="ls")
    m = Image.new("L", (rechts - links + 4, onder - top + 4), 0)
    ImageDraw.Draw(m).text((2 - links, 2 - top), "PDF", font=font, fill=255, anchor="ls")
    return [m.crop(m.getbbox())]


def teken_tekst(beeld, label, glyphs, tus):
    """Centreert de letters (op hun getekende pixels) in het label, in wit."""
    breedte = sum(g.width for g in glyphs) + tus * (len(glyphs) - 1)
    hoogte = max(g.height for g in glyphs)
    (lx0, ly0, lx1, ly1), _ = label
    x = lx0 + (lx1 - lx0 - breedte) // 2
    y = ly0 + (ly1 - ly0 - hoogte) // 2
    for g in glyphs:
        beeld.paste(WIT, (x, y, x + g.width, y + g.height), g)
        x += g.width + tus
    return breedte, hoogte


def teken(maat):
    o = OPMAAK[maat]
    beeld = Image.new("RGBA", (maat, maat), (0, 0, 0, 0))
    if o["schaduw"]:
        beeld.alpha_composite(schaduw(maat, o))
    beeld.alpha_composite(teken_vormen(maat, o))
    soort, waarde = o["tekst"]
    if soort == "font":
        glyphs, tus = font_glyphs(waarde), 0
    else:
        maten = dict(waarde)
        tus = maten.pop("tus")
        glyphs = (pixel_glyphs if soort == "pixel" else vorm_glyphs)(**maten)
    return beeld, teken_tekst(beeld, o["label"], glyphs, tus)


def bmp_ingang(beeld):
    """ICO-ingang als 32-bits DIB met AND-masker (klassiek formaat)."""
    b, h = beeld.size
    kop = struct.pack("<IiiHHIIiiII", 40, b, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = beeld.load()
    kleur = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(b):
            r, g, bl, a = px[x, y]
            kleur += bytes((bl, g, r, a))
    rij = ((b + 31) // 32) * 4
    masker = bytearray()
    for y in range(h - 1, -1, -1):
        bits = bytearray(rij)
        for x in range(b):
            if px[x, y][3] == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        masker += bits
    return kop + bytes(kleur) + bytes(masker)


def schrijf_ico(pad, beelden):
    """256 als PNG, kleinere maten als BMP; volgorde van groot naar klein."""
    ingangen = []
    for maat in sorted(beelden, reverse=True):
        beeld = beelden[maat]
        if maat >= 256:
            buf = io.BytesIO()
            beeld.save(buf, "PNG", optimize=True)
            data = buf.getvalue()
        else:
            data = bmp_ingang(beeld)
        ingangen.append((maat, data))
    kop = struct.pack("<HHH", 0, 1, len(ingangen))
    plek = 6 + 16 * len(ingangen)
    map_ = b""
    for maat, data in ingangen:
        z = 0 if maat >= 256 else maat
        map_ += struct.pack("<BBBBHHII", z, z, 0, 0, 1, 32, len(data), plek)
        plek += len(data)
    Path(pad).write_bytes(kop + map_ + b"".join(d for _, d in ingangen))


def controleer_rand(maat, beeld):
    """Buiten blad en label geen enkele pixel; de bladrand zelf volledig dekkend."""
    o = OPMAAK[maat]
    x0, y0, x1, y1 = o["pagina"]
    f = o["oor"]
    (lx0, ly0, lx1, ly1), _ = o["label"]
    a = beeld.getchannel("A").load()
    for y in range(maat):
        for x in range(maat):
            in_blad = x0 <= x < x1 and y0 <= y < y1
            in_label = lx0 <= x < lx1 and ly0 <= y < ly1
            if not (in_blad or in_label) and a[x, y]:
                sys.exit(f"{maat} px: zachte zoom buiten het blad op ({x}, {y})")
            rand = (x == x0 or y == y1 - 1 or (x == x1 - 1 and y >= y0 + f)
                    or (y == y0 and x < x1 - f))
            if in_blad and rand and not in_label and a[x, y] != 255:
                sys.exit(f"{maat} px: bladrand niet dekkend op ({x}, {y})")


def controleer_ico(pad, beelden):
    ico = Image.open(pad)
    gevonden = sorted(s[0] for s in ico.info["sizes"])
    if gevonden != sorted(beelden) or any(s[0] != s[1] for s in ico.info["sizes"]):
        sys.exit(f"ICO bevat onverwachte maten: {sorted(ico.info['sizes'])}")
    for maat, beeld in beelden.items():
        ico.size = (maat, maat)
        ico.load()
        if ico.convert("RGBA").tobytes() != beeld.tobytes():
            sys.exit(f"ICO-ingang {maat} wijkt af van de PNG")
    return gevonden


def oude_iconen(ref):
    """Haalt de oude PNG's uit git (alleen lezen)."""
    oud = {}
    for maat in MATEN:
        rel = f"open-pdf-studio/src-tauri/icons/file-icon-{maat}.png"
        data = subprocess.run(["git", "-C", str(REPO), "show", f"{ref}:{rel}"],
                              capture_output=True, check=True).stdout
        oud[maat] = Image.open(io.BytesIO(data)).convert("RGBA")
    return oud


def voorbeeldblad(pad, oud, nieuw):
    """Oud naast nieuw, 1x en 4x (naaste buur), op wit en op #202020."""
    achtergronden = (("wit", (255, 255, 255, 255)), ("donker", (32, 32, 32, 255)))
    marge, tussen = 24, 16
    font = ImageFont.truetype(lettertype_pad(), 18)
    grijs = (128, 128, 128, 255)

    def tegel(icoon, factor, kleur):
        t = Image.new("RGBA", (icoon.width * factor, icoon.height * factor), kleur)
        groot = icoon.resize(t.size, Image.NEAREST)
        t.alpha_composite(groot)
        return t

    blokken = []  # (titel, [[tegels per rij]])
    # 1x: per achtergrond twee rijen (oud, nieuw) met alle maten.
    for naam, kleur in achtergronden:
        rijen = []
        for soort, set_ in (("oud", oud), ("nieuw", nieuw)):
            rijen.append((soort, [tegel(set_[m], 1, kleur) for m in MATEN]))
        blokken.append((f"1x op {naam}", rijen))
    # 4x: per maat een rij met oud/nieuw op wit en op donker.
    for maat in MATEN:
        rij = []
        for naam, kleur in achtergronden:
            rij += [tegel(oud[maat], 4, kleur), tegel(nieuw[maat], 4, kleur)]
        if maat >= 256:
            blokken.append((f"{maat} px 4x (oud | nieuw)", [("wit", rij[:2]), ("donker", rij[2:])]))
        else:
            blokken.append((f"{maat} px 4x (oud | nieuw | oud | nieuw)", [("", rij)]))

    kolom = 70
    breedte = max(kolom + sum(t.width for t in tegels) + tussen * len(tegels)
                  for _, rijen in blokken for _, tegels in rijen) + 2 * marge
    hoogte = marge + sum(30 + sum(max(t.height for t in tegels) + tussen for _, tegels in rijen)
                         for _, rijen in blokken)
    blad = Image.new("RGBA", (breedte, hoogte), (236, 236, 236, 255))
    trek = ImageDraw.Draw(blad)
    y = marge
    for titel, rijen in blokken:
        trek.text((marge, y), titel, font=font, fill=(40, 40, 40, 255))
        y += 30
        for label, tegels in rijen:
            trek.text((marge, y + 4), label, font=font, fill=grijs)
            x = marge + kolom
            for t in tegels:
                blad.alpha_composite(t, (x, y))
                x += t.width + tussen
            y += max(t.height for t in tegels) + tussen
    Path(pad).parent.mkdir(parents=True, exist_ok=True)
    blad.convert("RGB").save(pad, optimize=True)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--uit", type=Path, default=ICOON_MAP, help="doelmap voor PNG's en ICO")
    p.add_argument("--voorbeeld", type=Path, help="schrijf ook een vergelijkingsblad")
    p.add_argument("--oud-ref", default="HEAD", help="git-ref voor de oude iconen in het blad")
    args = p.parse_args()

    args.uit.mkdir(parents=True, exist_ok=True)
    beelden, geschreven = {}, []
    for maat in MATEN:
        beeld, (tw, th) = teken(maat)
        if not OPMAAK[maat]["schaduw"]:
            controleer_rand(maat, beeld)
        beelden[maat] = beeld
        pad = args.uit / f"file-icon-{maat}.png"
        beeld.save(pad, optimize=True)
        geschreven.append(pad)
        (lx0, ly0, lx1, ly1), _ = OPMAAK[maat]["label"]
        print(f"{maat:>3} px: label {lx1 - lx0} x {ly1 - ly0} px, tekst {tw} x {th} px")
    pad = args.uit / "file-icon.png"
    beelden[256].save(pad, optimize=True)
    geschreven.append(pad)
    pad = args.uit / "file-icon.ico"
    schrijf_ico(pad, beelden)
    geschreven.append(pad)
    print("ico-maten:", controleer_ico(pad, beelden))
    if args.voorbeeld:
        voorbeeldblad(args.voorbeeld, oude_iconen(args.oud_ref), beelden)
        geschreven.append(args.voorbeeld)
    for pad in geschreven:
        print("geschreven:", pad)


if __name__ == "__main__":
    main()
