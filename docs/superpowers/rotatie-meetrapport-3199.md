# Meetrapport — gedraaide FreeText-labels in `3199-CP-21 Constructieoverzicht.pdf`

> Pure meting, GEEN codewijziging. Doel: de conventie-botsing tussen onze SAVER
> (`js/pdf/saver.js`) en onze LOADER/CONVERTER (`js/pdf/loader/annotation-converter.js`
> + `js/pdf/loader/color-extraction.js`) bewijzen met getallen, coderegels en
> ground-truth-screenshots. De "hoe-hoort-het"-kant komt van een aparte research-agent.

Datum meting: 2026-07-22. App-versie context: v1.81.

---

## 0. Samenvatting (de bewezen kern)

Het probleembestand is **door onze eigen app geschreven** (Producer = `pdf-lib`). Externe
engines (PyMuPDF, pypdfium2) lezen die save **correct** terug omdat zij de
**appearance stream (AP)** renderen. Onze app negeert de AP en **reconstrueert** de
tekstbox-afmetingen uit `/Rect` + rotatiehoek met een **verliesgevende / singuliere
inverse-formule** (`annotation-converter.js` r1019–1041). Daardoor:

- **HEA180** (afgekapt tot "HEA"): onze converter berekent `ftWidth = 22` pt terwijl de
  echte box 46,57 pt breed is → "HEA180" wordt door `rendering.js` r985 (`ctx.clip()`)
  weggeknipt tot "HEA".
- **HEA160** (verkeerde grootte/rotatie): bij exact 45° is de inverse-formule **singulier**
  (`det = cos²−sin² = 0`) → val terug op de AP-**BBox**, die een vierkant is → box wordt
  53×53 i.p.v. de echte 53,69×21,84 → dikke vierkante doos i.p.v. dunne rechthoek.

De **exacte onverdraaide afmetingen staan letterlijk in de AP-stream** (`… re`-operator),
maar `color-extraction.js` leest die niet uit — het leest alleen de AP-**BBox**
(r885-886), wat juist de omhullende bounding box is. Dát is de gemiste bron-van-waarheid.

---

## 1. Provenance van de bestanden (gemeten)

| Bestand | PDF-header | Producer / Creator | #FreeText | Rol |
|---|---|---|---|---|
| `-CP-21 Constructieoverzicht-2.pdf` | 1.4 | GPL Ghostscript 10.04.0 / PDFCreator | 15 | "origineel" (via PDFCreator geflatten) |
| `-CP-21 Constructieoverzicht.pdf` | 1.7 | pdf-lib / PDFCreator | — | onze save |
| `-CP-21 Constructieoverzicht-3.pdf` | 1.7 | pdf-lib / PDFCreator | 9 | onze save |
| `-CP-21 Constructieoverzicht-4.pdf` | 1.7 | pdf-lib / PDFCreator | — | onze save |
| **`3199-CP-21 Constructieoverzicht.pdf`** | **1.7** | **pdf-lib** / PDFCreator | **21** | **probleembestand (symptoom)** |
| `VO Constructie.pdf` | 1.4 | — | — | testset |
| `tekening-2.pdf` | 1.4 | — | — | testset |

**Bevinding:** de teal profiel-labels (HEA160 gedraaid ~45°, HEA180/HEA220/UNP280/HB 71x221)
bestaan **alleen** in onze pdf-lib-saves, niet als 45°-gedraaide labels in het 1.4-origineel.
Ze zijn dus binnen onze app geauthord (`/T (matti)`, `/M 2026-06-24T23:16:31Z`) en door onze
saver weggeschreven. Er is geen "Ghostscript-origineel vs onze save" voor deze specifieke
labels — ze zijn puur onze creatie. De diagnose is daarmee volledig een **eigen
saver↔loader round-trip-botsing**.

### Antwoord op de PDF-versie-hypothese (1.4 vs 1.7)
De bug is **niet** het PDF-versienummer. Het versieverschil (1.4 vs 1.7) is louter een
bijproduct van de producer (Ghostscript schrijft 1.4, pdf-lib schrijft 1.7). De echte
splitsing zit niet in de headerversie maar in **twee verschillende rotatie-encodings die
binnen één en hetzelfde 1.7-bestand naast elkaar bestaan** (zie §3). Externe engines
renderen beide 1.4 én 1.7 correct; onze loader struikelt over de encoding, niet over de versie.

---

## 2. Ground truth (extern) — hoe het hoort

Gerenderd met **PyMuPDF 1.26.7** (rendert de AP-stream as-is; identiek gedrag als het
externe referentieprogramma). Screenshots:

- `docs/superpowers/meetrapport-3199-assets/crop_HEA160.png` — **dunne teal rechthoek, ~45°
  gedraaid, "HEA160" volledig leesbaar, strak passend.**
- `docs/superpowers/meetrapport-3199-assets/crop_HEA180.png` — **horizontale teal doos,
  "HEA180" volledig leesbaar, geen rotatie.**
- `crop_HEA220.png`, `crop_UNP280.png`, `crop_HB_71x221.png` — horizontale dozen, correct.

Conclusie ground truth: de AP-streams die onze saver schreef zijn **op zichzelf correct** —
een spec-conforme viewer toont alles goed. Het probleem ontstaat pas bij **onze eigen
terug-lezing**.

---

## 3. De twee rotatie-encodings in één bestand (het bewijsstuk)

Gemeten annotatie-dicts + AP-streams uit `3199-CP-21 Constructieoverzicht.pdf`:

### 3a. HEA220 (xref 434) — referentie, geen rotatie (correct in onze app)
```
/Rect [807.885 894.897 861.577 916.737]      → 53,69 × 21,84  (horizontaal)
geen /Rotate, geen /Rotation, geen /OPS_Rotation
AP /Matrix [1 0 0 1 ...]  (hoek 0)
AP-stream:  807.885 894.897 53.69189 21.84006 re B      ← onverdraaide box = Rect
            /SegoeUI 12 Tf  808.885 901.537 Td (HEA220) Tj   (horizontaal)
```

### 3b. HEA160 (xref 439) — **encoding A**: OPS_Rotation + vierkante bbox-Rect + geroteerde AP
```
/Rect [634.587 902.152 687.996 955.561]      → 53,41 × 53,41  (VIERKANT = bounding box)
/OPS_Rotation -45          ← alleen onze privésleutel; GEEN /Rotate, GEEN /Rotation
AP /Matrix [1 0 0 1 ...]   (translatie; hoek in de content, niet in de Matrix)
AP-stream (rotatie INGEBAKKEN):
   1 0 0 1 661.291 928.857 cm                        ← naar Rect-centrum
   0.70710 0.70710 -0.70710 0.70710 0 0 cm           ← roteer +45° (CCW) om centrum
   1 0 0 1 -26.846 -10.920 cm                         ← half van (53.69, 21.84)
   0 0 53.69189 21.84006 re B                         ← ECHTE onverdraaide box: 53,69 × 21,84
   /SegoeUI 12 Tf  1 6.640 Td (HEA160) Tj
```

### 3c. HEA180 (xref 441) — **encoding B**: /Rotation + OPS_Rotation + ONverdraaide Rect + horizontale AP
```
/Rect [744.726 970.055 791.296 991.895]      → 46,57 × 21,84  (HORIZONTAAL = onverdraaide box)
/Rotation 270              ← niet-standaard viewer-sleutel (van OUDERE saver-versie)
/OPS_Rotation -90          ← onze privésleutel
AP /Matrix [1 0 0 1 ...]   (hoek 0)
AP-stream (NIET geroteerd):
   744.726 970.055 46.56919 21.84006 re B            ← horizontale box = Rect
   /SegoeUI 12 Tf  745.726 976.695 Td (HEA180) Tj     (horizontaal)
```

**De botsing, zwart-op-wit:** in HÉTZELFDE bestand, HÉTZELFDE save (zelfde `/M`), staan twee
onverenigbare afspraken over wat `/Rect` betekent:
- Encoding A (HEA160): `/Rect` = **axis-aligned bounding box** van de gedraaide inhoud.
- Encoding B (HEA180): `/Rect` = **de onverdraaide box** zelf; rotatie zit in `/Rotation`.

De huidige saver (`saver.js` r981-984, comment: *"we do NOT set the standard /Rotation key …
round-trips via our private /OPS_Rotation key"*) schrijft **alleen** encoding A. Encoding B
(met `/Rotation 270` + horizontale Rect + horizontale AP) is een **restant van een oudere
saver-generatie** dat bij de laatste save niet is genormaliseerd — het archeologische spoor
van de ~15 fix-pogingen. Geen enkele inverse-formule kan bij beide encodings tegelijk kloppen.

---

## 4. Wat onze CONVERTER berekent vs. ground truth (getallen + coderegels)

Codepad: `annotation-converter.js` r965–1053.
- r972-976: `ftRotation` = `OPS_Rotation` als aanwezig (exact).
- r1019-1041: box-afmetingen "hersteld" uit `/Rect` met inverse-rotatie:
  `ftWidth = (rectW·c − rectH·s)/det`, `ftHeight = (rectH·c − rectW·s)/det`, `det = c²−s²`,
  met `c=|cos θ|`, `s=|sin θ|`.

| Label | θ (OPS) | /Rect (W×H) | Converter-tak | Onze ftWidth×ftHeight | Echte box (uit AP `re`) | Ground truth | Fout |
|---|---|---|---|---|---|---|---|
| HEA220 | 0 | 53,69×21,84 | r1042-1047 (geen rotatie → viewport-rect) | 53,69×21,84 | 53,69×21,84 | horizontaal, "HEA220" | ✅ correct |
| **HEA180** | −90 | 46,57×21,84 | r1025-1027 (formule, det=−1) | **22×47** (W/H omgewisseld) | **46,57×21,84** | horizontaal, "HEA180" | ❌ box klapt naar 22pt breed → "HEA180" clipt tot **"HEA"** |
| **HEA160** | −45 | 53,41×53,41 | r1032-1041 (det=0 → **bbox-fallback**) | **53×53** (vierkant) | **53,69×21,84** | ~45° dunne rechthoek | ❌ dikke vierkante doos i.p.v. dunne strook |

Rekenkundig geverifieerd (simulatie van exact de coderegels):
```
HEA180 (-90): det=-1  → ftWidth=round((46.569*0 - 21.840*1)/-1)=22 ; ftHeight=round((21.840*0-46.569*1)/-1)=47
HEA160 (-45): det= 0  → |det|<0.01 → else-tak → bboxWidth/bboxHeight = AP-BBox = 53.41 (vierkant) → ftWidth=ftHeight≈53
```

**Truncatie-mechanisme (HEA180):** `rendering.js` r981-985 zet een `ctx.clip()` op de
tekstbox. "HEA180" is één onbreekbaar woord; in een logische box van 22pt breed overschrijdt
het de rand en wordt hard geklipt → zichtbaar blijft "HEA". Dit is **geen** font-auto-size-
probleem: `/DA` is `/SegoeUI 12 Tf` (vaste 12pt, niet 0/auto). De oorzaak is puur de
gekrompen `ftWidth`.

**Grootte-/rotatie-mechanisme (HEA160):** bij exact 45° is de omhullende bounding box een
vierkant, ongeacht de aspectratio van het origineel; de inverse is dan singulier
(`det=0`). De fallback leest `extraColors.bboxWidth/Height` (`color-extraction.js` r885-886),
maar dat is óók de vierkante AP-BBox → de dunne 53,69×21,84 aspectratio is definitief verloren.

---

## 5. De gemiste bron-van-waarheid

De **onverdraaide afmetingen zijn exact aanwezig** in de AP-stream van beide labels, in de
`… re`-operator die de saver zelf schreef:
- HEA160: `0 0 53.69189 21.84006 re`  → 53,69 × 21,84
- HEA180: `744.726 970.055 46.56919 21.84006 re`  → 46,57 × 21,84

`color-extraction.js` extraheert nu wél de AP-**BBox** (r885-886) en de Matrix-hoek (r824),
maar **niet** de inner `re`-rechthoek. Daardoor moet de converter de dims *reconstrueren* met
een verliesgevende/singuliere inverse i.p.v. ze *af te lezen*. Dit is de structurele reden dat
elke eerdere fix één bestand repareerde en een ander brak: men bleef aan de inverse-formule /
rotatiesign draaien, terwijl de betrouwbare waarde (de `re`-box) ongebruikt in de AP staat.

---

## 6. Hypothese-toetsing (welke oorzaak, welke uitgesloten)

| Kandidaat | Oordeel | Bewijs |
|---|---|---|
| (a) rotatiehoek verkeerd | **niet de kern** | `ftRotation` uit `OPS_Rotation` is exact (−45, −90); hoek klopt. Het probleem is de box-dim. |
| (b) box-afmeting-herstel uit gedraaide Rect | **JA — root cause** | HEA180 22×47 i.p.v. 46,57×21,84 (r1025-27); HEA160 53×53 i.p.v. 53,69×21,84 (r1032-41) |
| (c) font-auto-size / text-fit | **uitgesloten** | `/DA … 12 Tf` vast; truncatie volgt uit gekrompen ftWidth + clip, niet uit auto-size |
| (d) zelfheling te agressief/niet | **niet betrokken** | `apLegacyUnrotated`-heal (r1007-1010) vuurt alleen bij pageRot≠0; deze pagina heeft `/Rotate 0` |
| (e) PDF-versie-afhankelijk | **uitgesloten** | zie §1; versie is bijproduct van producer, niet de oorzaak. De echte splitsing = twee AP/Rect-encodings binnen één 1.7-bestand |

**Root cause (bewezen):** de converter leidt tekstbox-afmetingen af uit `/Rect` + hoek met een
inverse-rotatie die (1) verkeerd is voor de oude encoding B (Rect = onverdraaide box → W/H
onterecht omgewisseld) en (2) singulier bij 45° voor encoding A (det=0 → vierkante fallback).
De authoritatieve onverdraaide `re`-box in de AP-stream wordt niet gelezen.

---

## 7. Betrokken coderegels (voor de fix-fase, NIET nu gewijzigd)

- `js/pdf/loader/annotation-converter.js`
  - r972-999: `ftRotation`-bepaling (OPS_Rotation vs matrix-heuristiek)
  - **r1018-1048: box-dim-herstel — hier zit de fout** (r1025-1027 W/H-swap; r1032-1041 45°-singulariteit/bbox-fallback)
- `js/pdf/loader/color-extraction.js`
  - r824 matrixAngle; r885-886 bboxWidth/bboxHeight (= AP-BBox, niet de `re`-box)
  - **ontbrekend:** parsing van de inner `re`-operator uit de AP content-stream
- `js/annotations/rendering.js`
  - r981-985: `ctx.clip()` op tekstbox (het clip-mechanisme dat "HEA180" tot "HEA" knipt)
- `js/pdf/saver.js`
  - r866-1197: huidige AP-generatie (encoding A: OPS_Rotation + bbox-Rect + ingebakken rotatie)
  - r981-984: bewuste keuze om `/Rotation` NIET te schrijven → verklaart waarom HEA180's
    `/Rotation 270` een oud restant is

---

## 8. Meetartefacten

- Ground-truth-crops: `docs/superpowers/meetrapport-3199-assets/crop_*.png`
- Dump-scripts (scratchpad, ephemeer): `dump_all.py`, `dump_one.py`, `render_gt.py`
- Volledige annotatie-dump: scratchpad `full_dump.txt` (21 FreeText 3199 + varianten)

*Geen codewijziging en geen sweep uitgevoerd; dit is uitsluitend een meetrapport.*
