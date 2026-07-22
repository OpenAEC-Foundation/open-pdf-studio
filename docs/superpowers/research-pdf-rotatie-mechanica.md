# Naslagwerk: PDF-rotatie-mechanica van images, tekstvakken (FreeText) en annotaties

**Status:** autoritatief naslagwerk (spec-onderbouwd)
**Scope:** exacte, spec-correcte werking van rotatie/plaatsing van images, Form-XObjects, annotatie-appearance-streams en FreeText, over PDF-versies (1.3 → 2.0) en producers/viewers heen.
**Doel:** één eenduidige conventie vaststellen die tegelijk correct is voor de eigen saver, de eigen loader én externe viewers, zodat gedraaide FreeText-labels met achtergrond overal gelijk renderen.

> **Aanleiding (context, niet de scope van dit document):** een desktop-PDF-app rendert gedraaide, gekleurde FreeText-labels (stalen-profiel-labels met teal achtergrond) anders dan een extern referentie-PDF-programma. De probleembestanden worden geschreven door de eigen saver (Producer = pdf-lib, PDF-1.7); de originelen door Ghostscript/PDFCreator (PDF-1.4). Dit document stelt de spec-correcte werking vast; het lost geen code op.

---

## 0. Managementsamenvatting (lees dit eerst)

- **Zit het in het PDF-versienummer? Nee.** Noch ISO 32000-1 (PDF 1.7) noch ISO 32000-2 (PDF 2.0) definieert een rotatie-key voor FreeText-annotaties. Tussen PDF 1.4 en 2.0 is het **appearance-stream-mapping-algoritme (§12.5.5) ongewijzigd**. Het verschil tussen "1.4-origineel" en "1.7-savebestand" is dus **producer-gedrag**, niet versie-semantiek.
- **Waar zit het echt in?** In **hoe de rotatie in de appearance stream wordt geëncodeerd** en **of `/Rect` consistent is met de door `/Matrix` getransformeerde `/BBox`**. Elke viewer past hetzelfde algoritme toe: transformeer de vier BBox-hoeken met `/Matrix`, neem de omhullende rechthoek (AABB), en bereken een matrix **A** die die AABB **niet-uniform op `/Rect` schaalt**. Als de saver rotatie in `/Matrix` zet maar `/Rect` niet gelijkmaakt aan de getransformeerde AABB, dan **squasht/rekt** stap (b) de inhoud — precies de waargenomen vervorming en de "HEA180 → HEA"-afkapping.
- **De niet-standaard `/Rotate`-valkuil.** Diverse tools (het externe referentie-programma, sommige SDK's) schrijven een **niet-gestandaardiseerde `/Rotate`-key** (veelvoud van 90°) op de FreeText-annotatie én bakken de rotatie óók in de AP. Viewers die `/Rotate` negeren (pdfium, PDF.js) zien alleen de AP; viewers die `/Rotate` honoreren kunnen **dubbel roteren**. Dit is de klassieke "gefixt op bestand X, gebroken op bestand Y".
- **De ene conventie die alles oplost:** schrijf de rotatie **uitsluitend in de appearance stream** en houd `/Matrix` = identiteit. Bak de volledige rotatie **in het content-stream** via een `cm`-operator, en zet `/BBox` gelijk aan de annotatie-`/Rect` (beide de assen-uitgelijnde omhullende rechthoek). Dan is stap (b) van §12.5.5 een **identiteit** (sx = sy = 1, geen translatie), en zien saver, loader, pdfium, PDF.js, MuPDF én het externe programma exact hetzelfde. Schrijf **geen** top-level `/Rotate`-key.
- **Achtergrond (teal vak):** teken de gevulde rechthoek als eerste operatie **binnen dezelfde geroteerde `cm`**, zodat vak én tekst samen roteren en de vulling het geroteerde tekstkader exact volgt.
- **Font-auto-size/tekst-fit:** meet de tekst in de **niet-geroteerde** lokale ruimte (de box vóór de `cm`-rotatie). Bereken word-wrap en fontgrootte op de **onbewerkte** breedte/hoogte van het label, en pas dan pas de rotatie toe. Zo blijft "HEA180" volledig; afkapping ontstaat alleen wanneer men de tekst tegen de *geroteerde* (verkleinde) AABB meet.
- **Teststrategie:** één golden-set met FreeText-labels op 0/30/45/90/180° over álle producer-varianten (pdf-lib-save, Ghostscript-origineel, extern-referentie-import). Verifieer per bestand dat de getransformeerde BBox-AABB **pixel-gelijk** op `/Rect` valt (A ≈ identiteit) en dat pdfium- en PDF.js-render byte-stabiel overeenkomen. Nooit meer op één enkel bestand ijken.

---

## 1. PDF-coördinatenstelsel en transformatiematrices

### 1.1 Coördinaatruimtes
PDF definieert meerdere coördinaatruimtes (ISO 32000-1 §8.3.2). Relevant hier:
- **Default user space** — apparaatonafhankelijk; positieve x naar rechts, positieve y omhoog (standaard wiskundige oriëntatie, behoudens de page-`/Rotate`). Eenheid standaard 1/72 inch (§8.3.2.3).
- **Form space** — het eigen coördinaatstelsel van een Form-XObject; `/BBox` en alle padcoördinaten zijn hierin uitgedrukt. De `/Matrix` van het Form-XObject mapt form space → user space (§8.3.2.4, §8.10.1).
- **Image space** — elk sampled image is **1 eenheid breed × 1 eenheid hoog** in user space, ongeacht het aantal pixels; plaatsing gebeurt door de CTM tijdelijk te wijzigen (§8.3.2.4).

> Citaat (§8.3.2.4): *"All images shall be 1 unit wide by 1 unit high in user space, regardless of the number of samples in the image. To be painted, an image shall be mapped to a region of the page by temporarily altering the CTM."*

### 1.2 De matrix `[a b c d e f]`
Een transformatie is zes getallen (§8.3.3–8.3.4). Als 3×3:

```
        | a  b  0 |
[a b c d e f]  ≡  | c  d  0 |
        | e  f  1 |
```

Een punt `(x, y)` wordt geschreven als rijvector `[x y 1]` en getransformeerd via **`[x' y' 1] = [x y 1] · M`**, dus:

```
x' = a·x + c·y + e
y' = b·x + d·y + f
```

Belangrijk (§8.3.4): *"Transformations alter coordinate systems, not graphics objects."* De matrix mapt van het **nieuwe** (getransformeerde) stelsel terug naar het **oude**.

### 1.3 Elementaire matrices (§8.3.3)
| Transformatie | Matrix |
|---|---|
| Translatie | `[1 0 0 1 tx ty]` |
| Schaling | `[sx 0 0 sy 0 0]` |
| Rotatie (θ, tegen de klok in) | `[cos θ  sin θ  −sin θ  cos θ  0 0]` |
| Skew | `[1  tan α  tan β  1  0 0]` |

> Citaat (§8.3.3): *"Rotations shall be produced by [ cos q  sin q  −sin q  cos q  0  0 ], which has the effect of rotating the coordinate system axes by an angle q counter clockwise."*

### 1.4 De `cm`-operator en samenstelling
`cm` (concatenate matrix, §8.4.4) **pre-concateneert** de opgegeven matrix met de huidige CTM: `CTM_nieuw = M_cm · CTM_oud`. De volgorde is significant. De spec beveelt de volgorde **Translate → Rotate → Scale** aan (§8.3.3, NOTE):

> *"to obtain the expected results, transformations should be done in the following order: Translate, Rotate, Scale or skew."*

Een "roteer rondom pivot (px, py) met hoek θ" is dus de samenstelling: verplaats pivot naar oorsprong, roteer, verplaats terug:

```
M = T(px,py) · R(θ) · T(−px,−py)
```

In content-stream-operatoren (die pre-concateneren) schrijf je dit als één `cm` met de uitgerekende getallen, of als een reeks. De netto matrix voor rotatie om (px, py):

```
a = cos θ           b = sin θ
c = −sin θ          d = cos θ
e = px − px·cos θ + py·sin θ
f = py − px·sin θ − py·cos θ
```

**Rekenvoorbeeld** (θ = 30°, pivot (100, 200)): cos30 = 0.86603, sin30 = 0.5.
`a=0.86603, b=0.5, c=−0.5, d=0.86603, e = 100 − 86.603 − 100 = ... ` → `e = 100 − 100·0.86603 + 200·0.5 = 100 − 86.603 + 100 = 113.397`, `f = 200 − 100·0.5 − 200·0.86603 = 200 − 50 − 173.206 = −23.206`. Content-operand: `0.86603 0.5 -0.5 0.86603 113.397 -23.206 cm`.

---

## 2. Image-plaatsing en -rotatie

### 2.1 Het unit square
Een Image-XObject wordt getekend met `Do`. Vóór `Do` bepaalt de CTM (typisch een `cm`) waar het **eenheidsvierkant** [0,0]–[1,1] terechtkomt. Een niet-geroteerde plaatsing op `(x, y)` met breedte `w` en hoogte `h`:

```
q
w 0 0 h x y cm      % schaal unit square naar w×h op (x,y)
/Im0 Do
Q
```

### 2.2 Geroteerde afbeelding
Voor rotatie θ om het midden `(cx, cy)`, met plaatsing-hoek `(x,y)` en grootte `w×h`, componeer je **Translate · Rotate · Scale** in één `cm`:

```
CTM_image = T(cx,cy) · R(θ) · T(−w/2,−h/2) · S(w,h)
```

Praktisch (linksonder op (x,y), midden (x+w/2, y+h/2)):

```
q
<a> <b> <c> <d> <e> <f> cm    % = T(mid)·R(θ)·S(w,h) rondom midden
/Im0 Do
Q
```

waarbij `[a b c d]` = `R(θ)·S(w,h)` = `[w·cosθ  w·sinθ  −h·sinθ  h·cosθ]` en `(e,f)` de translatie die het midden op `(x+w/2, y+h/2)` legt. De afbeelding zelf blijft het onveranderde unit square; **álle** plaatsing/schaal/rotatie zit in de CTM.

### 2.3 Verschil met een Form-XObject
- Bij een **direct getekend image** (`Do` op een Image-XObject) bepaalt **alleen de CTM** (de `cm` ervoor) de plaatsing. Het image heeft géén eigen `/Matrix`.
- Een **Form-XObject** heeft wél een eigen **`/Matrix`** en **`/BBox`** (Tabel 95). Bij `Do` op een form voert de viewer uit (§8.10.1):
  1. `q` (graphics state opslaan);
  2. `/Matrix` concateneren met de CTM;
  3. clippen op `/BBox`;
  4. content-stream tekenen;
  5. `Q` (herstellen).

Dat betekent: een geroteerde afbeelding **binnen** een form kan óók via de form-`/Matrix`, maar dan geldt de clip op `/BBox` ná die matrix. Voor annotatie-appearances (§4) is dit cruciaal, want de appearance ís een Form-XObject.

---

## 3. Form-XObject `/Matrix` + `/BBox`

Tabel 95 (§8.10.2):
- **`/BBox`** (required) — vier getallen `[left bottom right top]` in **form space**; gebruikt om te **clippen** en voor cache-grootte.
- **`/Matrix`** (optional, default identity `[1 0 0 1 0 0]`) — mapt **form space → user space**.

Samenwerking (§8.10.1): *"The Matrix entry in the form dictionary shall specify the mapping from form space to the current user space. Each time the form XObject is painted by the Do operator, this matrix shall be concatenated with the current transformation matrix."* De clip gebeurt op `/BBox` **in form space** — dus vóórdat de content getekend wordt, maar de clip-regio wordt zelf door `/Matrix`+CTM meegetransformeerd. Als de `/Matrix` roteert, roteert het clip-kader mee (het wordt een geroteerd parallellogram in user space).

**Gevolg voor rotatie:** wie via de form-`/Matrix` roteert moet de `/BBox` zó kiezen dat de bedoelde inhoud er ná rotatie nog in past; anders clipt de viewer content weg. Bij annotaties komt daar bovenop de §12.5.5-hermapping naar `/Rect` (§4) — de bron van de meeste bugs.

---

## 4. Annotatie-appearance-streams — de kern (§12.5.5)

### 4.1 Wat een appearance is
Vanaf PDF 1.2 kan een annotatie een of meer **appearance streams** hebben (`/AP` → `/N`, `/R`, `/D`). Elke appearance is **een Form-XObject** (§12.5.5): een zelfstandig content-stream met eigen `/BBox` en `/Matrix`, dat **binnen de annotatie-`/Rect`** wordt gerenderd.

### 4.2 Het exacte mapping-algoritme (verbatim)
> **Algorithm: Appearance streams** (ISO 32000-1:2008, §12.5.5)
> a) *The appearance's bounding box (specified by its BBox entry) shall be transformed, using Matrix, to produce a quadrilateral with arbitrary orientation. The **transformed appearance box** is the smallest upright rectangle that encompasses this quadrilateral.*
> b) *A matrix **A** shall be computed that scales and translates the transformed appearance box to align with the edges of the annotation's rectangle (specified by the Rect entry). A maps the lower-left corner (the corner with the smallest x and y coordinates) and the upper-right corner (the corner with the greatest x and y coordinates) of the transformed appearance box to the corresponding corners of the annotation's rectangle.*
> c) *Matrix shall be concatenated with A to form a matrix **AA** that maps from the appearance's coordinate system to the annotation's rectangle in default user space:* **AA = Matrix × A**

Ontleed:
1. Neem de vier hoeken van `/BBox`. Transformeer elk met `/Matrix`. Dit levert een (mogelijk gedraaid) parallellogram.
2. **Transformed appearance box** = de kleinste **assen-uitgelijnde** rechthoek (AABB) om dat parallellogram.
3. Bereken **A** = pure **schaal + translatie** die de linksonder- en rechtsboven-hoek van die AABB op de overeenkomstige hoeken van `/Rect` legt:
   - `sx = (Rect.width) / (AABB.width)`, `sy = (Rect.height) / (AABB.height)`
   - `A = [sx 0 0 sy  (Rect.llx − sx·AABB.llx)  (Rect.lly − sy·AABB.lly)]`
4. Render met **AA = Matrix · A** als extra CTM boven de page-CTM.

> **Kritiek inzicht:** stap (b) schaalt de **AABB** (assen-uitgelijnd), niet de originele BBox. `sx` en `sy` worden **onafhankelijk** berekend. Zijn ze ongelijk (omdat `/Rect` een andere aspect-ratio heeft dan de getransformeerde AABB), dan wordt de appearance **niet-uniform vervormd** (uitgerekt/geplet en gescheefd t.o.v. de bedoeling). Dít is de nummer-1-oorzaak van rotatie/positie-bugs bij FreeText: de saver roteert via `/Matrix`, maar `/Rect` blijft de ongeroteerde box → aspect-mismatch → vervorming en schijnbare "verkeerde rotatie".

### 4.3 Concrete implementatie in een viewer (pdfium)
pdfium's `CPDF_Annot::AnnotGetMatrix()` is een letterlijke implementatie van §12.5.5:

```cpp
CFX_Matrix form_matrix = pForm->m_pFormDict->GetMatrixFor("Matrix");
CFX_FloatRect form_bbox =
    form_matrix.TransformRect(pForm->m_pFormDict->GetRectFor("BBox"));  // stap (a): AABB
matrix->MatchRect(pAnnot->GetRect(), form_bbox);                         // stap (b): A
matrix->Concat(*pUser2Device);                                          // stap (c) + page-CTM
```

`TransformRect` levert de assen-uitgelijnde omhullende (AABB); `MatchRect(Rect, form_bbox)` is exact matrix **A**. pdfium **negeert** een top-level `/Rotate`-key op FreeText — het vertrouwt volledig op de AP. PDF.js en MuPDF doen materieel hetzelfde.

### 4.4 Rekenvoorbeeld — 45°-geroteerd vak
Neem een label van 100×30 pt. De appearance-form heeft `/BBox [0 0 100 30]`.

**Aanpak A (rotatie in `/Matrix`) — fout-gevoelig.**
Zet `/Matrix = R(45°) = [0.70711 0.70711 −0.70711 0.70711 0 0]`. Transformeer de BBox-hoeken:

| Hoek (form) | x' = 0.70711(x−y) | y' = 0.70711(x+y) |
|---|---|---|
| (0,0)   | 0      | 0      |
| (100,0) | 70.71  | 70.71  |
| (100,30)| 49.50  | 91.92  |
| (0,30)  | −21.21 | 21.21  |

AABB = `[−21.21, 0, 70.71, 91.92]` → breedte 91.92, hoogte 91.92 (een vierkant).

- **Correct**: als de saver `/Rect` óók op 91.92×91.92 zet (bv. `[200 500 291.92 591.92]`), dan `sx = sy = 1`, `A = [1 0 0 1 221.21 500]`, en `AA = Matrix·A` roteert het label netjes 45° zonder vervorming.
- **Fout (typische bug)**: de saver laat `/Rect = [200 500 300 530]` (de **ongeroteerde** 100×30). Dan `sx = 100/91.92 = 1.088`, `sy = 30/91.92 = 0.326`. `A` **plet** het geroteerde vierkant tot 100×30 → de tekst wordt verticaal samengedrukt en gescheefd; "HEA180" wordt onleesbaar/afgekapt en de teal-achtergrond dekt het verkeerde gebied. Elke conforme viewer doet dit — het is spec-correct gedrag op een spec-incorrect geschreven bestand.

**Aanpak B (rotatie in het content-stream) — robuust.**
Zet `/Matrix = identiteit`. Kies `/Rect` = de gewenste plaatsing op de pagina, bv. de 91.92×91.92-AABB, en `/BBox` **gelijk** aan die Rect-afmeting: `/BBox [0 0 91.92 91.92]`. Roteer in de content:

```
q
0.70711 0.70711 -0.70711 0.70711 <e> <f> cm   % R(45°) om het midden van de box
<teal-fill: re + f>                            % achtergrondvak
BT /Helv <size> Tf <tekst> ET                  % tekst
Q
```

Nu is stap (a) een identiteit (Matrix = I, BBox = Rect), de AABB = BBox = Rect, dus stap (b) geeft `A = I`. **AA = I.** Geen enkele viewer kan afwijken. De rotatie zit volledig in de door de saver gecontroleerde `cm`.

---

## 5. FreeText specifiek

### 5.1 Definitie en keys (Tabel 174, §12.5.6.6)
Een FreeText-annotatie (PDF 1.3) toont tekst **direct** op de pagina (geen pop-up). Relevante keys:

| Key | Type | Sinds | Betekenis |
|---|---|---|---|
| `/Subtype` | name | 1.3 | `FreeText` |
| `/DA` | string | 1.3 | **Default appearance**: tekst-/graphics-state-operatoren (minimaal `Tf` met font + grootte). **Grootte 0 = auto-size**. `/AP` heeft voorrang op `/DA`. |
| `/Q` | integer | 1.4 | Quadding/uitlijning: 0 = links, 1 = gecentreerd, 2 = rechts. |
| `/RC` | text/stream | 1.5 | Rich-text-string (XHTML-subset) om de appearance te genereren. |
| `/DS` | text string | 1.5 | Default style string (CSS-achtig) voor rich text. |
| `/CL` | array | 1.6 | Callout-lijn (4 of 6 getallen), alleen bij `IT = FreeTextCallout`. |
| `/IT` | name | 1.6 | Intent: `FreeText`, `FreeTextCallout`, `FreeTextTypeWriter`. |
| `/BE`, `/BS` | dict | 1.6 | Border effect / border style. |
| `/RD` | rectangle | 1.6 | Verschil tussen `/Rect` en de **inner rectangle** waarin de tekst hoort; border/effect gelden voor de inner rectangle. |

> **`/Rect` vs `/RD`:** de tekst hoort in de **inner rectangle** = `/Rect` verkleind met `/RD` aan alle vier zijden. Word-wrap en auto-size moeten tegen de **inner rectangle** rekenen, niet tegen `/Rect`.

### 5.2 Geen standaard rotatie-key
**Cruciaal:** Tabel 174 in ISO 32000-1 (PDF 1.7) bevat **géén** rotatie-key. Ook ISO 32000-2 (PDF 2.0) voegt **geen** genormeerde `/Rotate` aan FreeText toe. De **enige** genormeerde rotatie-key is `/R` in de **appearance characteristics dictionary (`/MK`)** — en die geldt **alleen voor widget-annotaties** (Tabel 189):

> Citaat (Tabel 189, MK): *"R — integer — (Optional) The number of degrees by which the widget annotation shall be rotated counterclockwise relative to the page. The value shall be a multiple of 90."*

FreeText heeft géén `/MK`. De "Rotation" die SDK's voor FreeText aanbieden (bv. Apryse `FreeText.GetRotation/SetRotation`, PyMuPDF `set_rotation`) is een **de-facto conventie**: ze schrijven doorgaans een **top-level `/Rotate`-integer** (veelvoud van 90) op de annotatie én bakken de rotatie in de AP. Apryse documenteert het als *"The Rotation specifies the number of degrees by which the annotation shall be rotated counterclockwise relative to the page. The value shall be a multiple of 90."* — maar dit staat **niet** in de ISO-tabel voor FreeText. PyMuPDF: voor `PDF_ANNOT_FREE_TEXT` zijn *"only ... 0, 90, 180 and 270 ... possible and will rotate the text inside the current rectangle (which remains unchanged)"*; andere waarden worden **stil genegeerd en op 0 gezet**.

**Conclusie 5.2:** wie op `/Rotate` vertrouwt bouwt op een niet-interoperabele extensie. pdfium en PDF.js **negeren** het. De enige portable rotatie is die in de **AP-appearance stream** (§4).

### 5.3 Variable text, `/DA` en auto-size (§12.7.3.3)
De appearance van FreeText/formuliervelden wordt opgebouwd zoals variable text (§12.7.3.3). De marked-content-structuur:

```
/Tx BMC
  q
    ... clip / graphics state ...
    BT ...DA... <tekst-positionering + Tj/TJ> ET
  Q
EMC
```

`/DA` bevat minimaal een `Tf font size`. Spec:

> Citaat (§12.7.3.3): *"A zero value for size means that the font shall be auto-sized: its size shall be computed as a function of the height of the annotation rectangle."*

En over positionering:

> *"The default appearance string shall contain at most one Tm ... If the default appearance string contains no Tm operator, the viewer shall insert one ... with appropriate horizontal and vertical translation components ... based on the field value, the quadding (Q) attribute, and any layout rules it employs."*

De BBox-initialisatie voor een dynamisch opgebouwde appearance (§12.7.3.3):

> *"The lower-left corner of the bounding box (BBox) is set to coordinates (0, 0) in the form coordinate system. The box's top and right coordinates are taken from the dimensions of the annotation rectangle (the Rect entry)."*

Dit is precies **Aanpak B** uit §4.4: `/BBox = [0 0 RectW RectH]`, `/Matrix = I`. De spec-bedoelde manier zet de appearance-BBox gelijk aan de Rect-afmetingen en laat `/Matrix` identiteit.

### 5.4 Layout, word-wrap en auto-size binnen een geroteerde box
De juiste volgorde (zodat "HEA180" niet tot "HEA" afkapt):
1. Bepaal de **inner rectangle** = `/Rect` − `/RD`. **In de ongeroteerde lokale ruimte.**
2. Bereken word-wrap en (bij grootte 0) auto-size fontgrootte tegen die **ongeroteerde** inner-breedte/hoogte. De tekst "weet niet" dat er geroteerd wordt; de rotatie is puur een `cm` eromheen.
3. Teken achtergrondvak + tekst in die lokale ruimte.
4. Pas de rotatie toe als `cm` om het geheel (Aanpak B), met `/BBox`/`/Rect` op de assen-uitgelijnde omhullende.

Afkapping ("HEA180"→"HEA") ontstaat wanneer men de tekst tegen de **geroteerde** (en dus door stap-4b verkleinde/geplette) AABB meet i.p.v. de oorspronkelijke labelbreedte. De meting hoort vóór de rotatie, in ongeroteerde ruimte.

### 5.5 Hoe wordt gedraaide FreeText in de praktijk geëncodeerd?
- **Spec-correct / portable:** rotatie in het **AP-content-stream** via `cm` (Aanpak B). `/Matrix` = I, `/BBox` = Rect-afmeting. Werkt in alle viewers.
- **Ook geldig maar fout-gevoelig:** rotatie in de **AP-`/Matrix`** (Aanpak A). Werkt alléén als `/Rect` exact de getransformeerde AABB is; anders vervorming (§4.4).
- **Niet-portable:** top-level `/Rotate`-key zonder (of bovenop) een correcte AP. Genegeerd door pdfium/PDF.js; risico op dubbele rotatie bij tools die hem wél honoreren.

---

## 6. Versieverschillen (1.4 → 1.5/1.6/1.7 → 2.0)

| Aspect | PDF 1.3 | 1.4 | 1.5 | 1.6 | 1.7 | 2.0 (32000-2) |
|---|---|---|---|---|---|---|
| FreeText bestaat | ✔ | | | | | |
| `/Q` (quadding) | | ✔ | | | | |
| `/RC`, `/DS` (rich text) | | | ✔ | | | |
| `/CL`, `/IT`, `/BE`, `/BS`, `/RD` | | | | ✔ | | |
| Appearance-stream-algoritme §12.5.5 | ✔ (sinds 1.2) | ongewijzigd | ongewijzigd | ongewijzigd | ongewijzigd | ongewijzigd |
| Genormeerde FreeText-`/Rotate` | ✘ | ✘ | ✘ | ✘ | ✘ | **✘** |
| Widget-`/MK`-`/R` (90°-veelvoud) | ✔ | | | | | ✔ |
| Transparantie in appearance | | ✔ (1.4) | | | | |

**Antwoord op "zit het in het versienummer?": nee.** Het **appearance-mapping-algoritme is identiek** van PDF 1.2 t/m 2.0. De rich-text- en callout-keys kwamen erbij (1.5/1.6), maar die veranderen de **rotatie/positie-mechanica niet**. Een 1.4-origineel (Ghostscript/PDFCreator) en een 1.7-save (pdf-lib) verschillen dus niet door versie-semantiek, maar door **hoe elke producer de appearance encodeert** (Aanpak A vs B, wel/geen `/Rotate`, wel/niet `/Rect` == AABB).

---

## 7. Producer-verschillen

| Producer | Genereert FreeText-AP? | Rotatie-encodering | `/Rect` == getransformeerde AABB? | Valkuil |
|---|---|---|---|---|
| **pdf-lib** | **Nee** — geen ingebouwde FreeText-AP-generatie; de app moet het Form-XObject-content-stream **handmatig** bouwen (zie pdf-lib issue #475). pdf-lib's rotatie-helpers emitteren `cos/sin/-sin/cos`-`cm` in het stream. | Wat de app schrijft. Meestal **`cm` in het stream**, `/Matrix` default identiteit. | Alleen als de app het zelf klopt maakt. | App-fout mogelijk: rotatie in stream **maar** `/Rect` = ongeroteerde box → §4.4-vervorming. |
| **Ghostscript / PDFCreator** | Ja (bij distillatie/normalisatie). | Bakt alles in het content-stream; `/Matrix` doorgaans identiteit. | Ja (consistent). | Zelden problematisch; dit is waarom de originelen "goed" ogen. |
| **Extern referentie-PDF-programma** | Ja. | Schrijft vaak een **niet-standaard `/Rotate`** (90°-veelvoud) **plus** een AP die de rotatie al bevat; honoreert zijn eigen `/Rotate` bij re-render. | Wisselend. | Dubbel-rotatie / mismatch in vreemde viewers die `/Rotate` negeren of anders interpreteren. |
| **Adobe Acrobat** | Ja. | Beperkte FreeText-rotatie, primair 90°-stappen om page-`/Rotate` te compenseren; regenereert AP bij edit. | Ja. | Regenereert AP van andere tools → kan afwijkende rotatie/props verliezen. |
| **PyMuPDF/MuPDF** | Ja (`update()`), 0/90/180/270. | `set_rotation` → roteert **tekst binnen ongewijzigde Rect**; regenereert AP. Arbitraire hoeken worden op 0 gezet. | Ja. | Geen arbitraire hoeken. |

**pdf-lib-specifiek (de eigen saver):** omdat pdf-lib **geen** FreeText-AP voor je maakt, ligt de volledige verantwoordelijkheid voor de §12.5.5-consistentie bij de app-code. De keuze tussen Aanpak A en B, en of `/Rect` gelijk is aan de getransformeerde AABB, is **volledig een app-beslissing**. Dat verklaart waarom ~15 fixes elkaar braken: zonder één vaste conventie werd per bestand een andere (A- of B-)aanname gemaakt.

---

## 8. Viewer-verschillen

| Viewer | Leest AP `/Matrix`+`/BBox`→`/Rect` volgens §12.5.5? | Honoreert top-level FreeText-`/Rotate`? | Opmerking |
|---|---|---|---|
| **pdfium** (Chrome, vele apps) | Ja, letterlijk (`AnnotGetMatrix` → `TransformRect` + `MatchRect`). | **Nee.** | Vertrouwt volledig op AP; niet-uniforme `A` vervormt. |
| **PDF.js** (Firefox) | Ja, met eigen implementatie; historisch afwijkingen in edge-cases (bv. ontbrekende AP, CJK-encoding — zie mozilla/pdf.js #20117, #6810). | Nee (rendert AP). | Kan FreeText zonder AP anders/naar wens regenereren. |
| **MuPDF** | Ja. | Alleen 0/90/180/270 via eigen rotatie, regenereert AP. | Geen arbitraire hoeken. |
| **Extern referentie-programma** | Ja, maar honoreert **óók** zijn `/Rotate`. | **Ja.** | Kan als enige "goed" ogen op zijn eigen bestanden; wijkt af van pdfium/PDF.js. |

**Waarom ziet hetzelfde bestand er per viewer anders uit?**
1. **`/Rotate` wel/niet gehonoreerd** → een bestand dat op rotatie via `/Rotate` leunt roteert in het externe programma, maar niet in pdfium/PDF.js.
2. **Niet-uniforme `A`** → als `/Rect` ≠ getransformeerde AABB, past elke conforme viewer §12.5.5 correct toe en toont **vervorming**; verschillen ontstaan alleen als een viewer AP negeert/regenereert.
3. **Ontbrekende AP** → pdfium toont dan niets/kaal; PDF.js kan uit `/DA`+`/Contents`+`/RC` een eigen appearance opbouwen (mozilla/pdf.js #6810, #20117).
4. **Encoding** (`/Contents` UTF-16BE) → CJK/speciale tekens kunnen in de ene viewer leeg blijven (mozilla/pdf.js #20117).

De les: bouw **altijd** een correcte, self-contained AP en leun **nooit** op viewer-specifiek regenereer-gedrag of op `/Rotate`.

---

## 9. Conclusie + aanbeveling

### 9.1 De eenduidige, spec-correcte manier (schrijven én teruglezen)
**Schrijf gedraaide FreeText met achtergrond als Aanpak B:**
1. `/AP /N` = een Form-XObject.
2. `/Matrix = [1 0 0 1 0 0]` (identiteit).
3. `/BBox = [0 0 W H]`, waarbij `W×H` = de afmetingen van de annotatie-`/Rect` (de **assen-uitgelijnde omhullende** van het uiteindelijke geroteerde label op de pagina).
4. `/Rect` = die W×H op de gewenste positie. Zo geldt: getransformeerde AABB = BBox = Rect ⇒ matrix **A = identiteit** ⇒ **AA = identiteit**. Geen enkele viewer kan de plaatsing herinterpreteren.
5. In het **content-stream**: één `cm` die de rotatie θ om het midden van de box uitvoert (Translate·Rotate·Scale), dan **eerst** het teal-achtergrondvak (`re`/`f`), **dan** de tekst (`BT … Tj/TJ … ET`). Vak en tekst delen dezelfde `cm` en roteren samen.
6. Schrijf **géén** top-level `/Rotate`-key. (Optioneel, puur informatief voor eigen round-trip, mag een privé-key in een eigen namespace — maar de render mag er nooit van afhangen.)

**Teruglezen (loader):** vertrouw **uitsluitend** op de AP volgens §12.5.5. Negeer een eventuele `/Rotate` voor de render (die is niet-interoperabel). Wil de app de rotatie-hoek voor bewerking terugvinden, dan leidt hij die af uit de `cm` in het eigen AP-stream (of uit een eigen privé-key), niet uit `/Rotate`.

### 9.2 Welke ene conventie
> **Rotatie uitsluitend in de AP-content-stream (`cm`), `/Matrix` = identiteit, `/BBox` = `/Rect`-afmeting, `/Rect` = de assen-uitgelijnde omhullende, geen top-level `/Rotate`.**

Onderbouwing: dit is exact wat §12.7.3.3 voorschrijft voor dynamisch opgebouwde variable-text-appearances (BBox lower-left (0,0), top/right uit Rect, Matrix default). Het maakt stap (b) van §12.5.5 een identiteit, waardoor pdfium (`MatchRect` → I), PDF.js, MuPDF én het externe programma **allemaal** hetzelfde renderen — ongeacht of ze `/Rotate` kennen. Aanpak A (rotatie in `/Matrix`) is óók spec-geldig maar vereist dat `/Rect` perfect de getransformeerde AABB volgt; die extra invariant is fragiel en was vermoedelijk de bron van de wisselende fixes.

### 9.3 Font-auto-size / tekst-fit binnen een geroteerde box
- Reken layout in **ongeroteerde lokale ruimte** tegen de **inner rectangle** (`/Rect` − `/RD`).
- Bij `/DA`-grootte 0: auto-size als functie van de inner-**hoogte** (§12.7.3.3), begrensd door word-wrap-breedte. Meet de langste woordbreedte tegen de inner-**breedte** vóór rotatie → "HEA180" blijft heel.
- Pas rotatie pas daarna toe als `cm`. De rotatie mag de layout-meting nooit beïnvloeden.

### 9.4 Teststrategie (borgt één conventie over alle producers)
1. **Golden-set**: FreeText-labels (teal achtergrond, teksten "HEA180", "IPE300", "HEB1000") op hoeken **0°, 30°, 45°, 90°, 180°**, in drie herkomsten: (a) door de eigen saver geschreven, (b) uit een Ghostscript/PDFCreator-1.4-origineel geïmporteerd en heropgeslagen, (c) uit een extern-referentie-bestand met `/Rotate` geïmporteerd en heropgeslagen.
2. **Invariant-assert per bestand** (statisch, zonder render): parse elke FreeText-AP en verifieer `Matrix == I`, `BBox == [0 0 RectW RectH]`, en dat de getransformeerde AABB pixel-gelijk op `/Rect` valt (⇒ A ≈ I binnen ε). Faal als er een top-level `/Rotate` op de render-pad zit.
3. **Cross-viewer-render-diff**: render elk bestand met pdfium én PDF.js én MuPDF; eis dat de labelposities/hoeken binnen ε samenvallen (geen viewer-afhankelijke afwijking). Voeg het externe programma toe als extra referentie.
4. **Round-trip**: open → save → open; assert dat hoek, tekst (volledig, niet afgekapt), vakkleur en positie behouden blijven.
5. **Regressiehek**: draai deze sweep verplicht vóór elke build/push bij wijzigingen aan saver/loader/rotatie/appearance (conform het bestaande all-PDF-sweep-protocol). Nooit meer op één enkel bestand ijken.

---

## Bronnenlijst

**Normen / specificaties**
- ISO 32000-1:2008 (PDF 1.7), volledige tekst — Adobe-mirror: https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf
  - §8.3.2 Coordinate Spaces; §8.3.3 Common Transformations; §8.3.4 Transformation Matrices
  - §8.10 Form XObjects (Tabel 95: `/BBox`, `/Matrix`); §8.10.1 General (`Do`-algoritme)
  - §12.5.5 Appearance Streams (het "Algorithm: Appearance streams", `AA = Matrix × A`)
  - §12.5.6.6 Free Text Annotations (Tabel 174: `/DA`,`/Q`,`/RC`,`/DS`,`/CL`,`/IT`,`/BE`,`/BS`,`/RD`)
  - §12.7.3.3 Variable Text (Tabel 222; auto-size bij `Tf`-grootte 0; BBox-initialisatie)
  - Tabel 189 Appearance characteristics dictionary (`/MK` `/R`, alleen widgets)
- ISO 32000-2 (PDF 2.0) overzichten: https://pdfa.org/resource/iso-32000-2/ ; https://www.pdflib.com/pdf-knowledge-base/pdf-20/new-capabilities/ ; https://www.qualitylogic.com/knowledge-center/technical-review-iso-32000-2-pdf-2-0/
- ISO 32000-1:2008 sample (front matter): https://cdn.standards.iteh.ai/samples/51502/a0f48fe34d5e43989cde77ca2e3e951d/ISO-32000-1-2008.pdf

**Viewer-broncode / -documentatie**
- pdfium `core/fpdfdoc/cpdf_annot.cpp` (`AnnotGetMatrix`, `MatchRect`): https://pdfium.googlesource.com/pdfium/+/163817/core/fpdfdoc/cpdf_annot.cpp
- PDF.js — FreeText zonder AP / encoding: https://github.com/mozilla/pdf.js/issues/20117 ; https://github.com/mozilla/pdf.js/issues/6810
- PyMuPDF/MuPDF FreeText-rotatie (0/90/180/270, tekst binnen vaste Rect): https://pymupdf.readthedocs.io/en/latest/annot.html

**Producer / SDK-gedrag**
- pdf-lib — geen ingebouwde FreeText-AP-generatie, handmatig Form-XObject: https://github.com/Hopding/pdf-lib/issues/475 ; https://github.com/Hopding/pdf-lib/issues/360
- Apryse SDK `FreeText.GetRotation` (niet-standaard rotatie, veelvoud van 90, tegen de klok in): https://sdk.apryse.com/api/uwp/guides/html/53d29453-cdc4-141a-322d-bbe45bc29b8d.htm
- Nutrient (PSPDFKit) — rotatie via AP-regeneratie, niet in de PDF-spec gedefinieerd: https://www.nutrient.io/guides/ios/annotations/annotation-rotation/

**Achtergrond**
- Minimum bounding rectangle (AABB-begrip): https://en.wikipedia.org/wiki/Minimum_bounding_rectangle
