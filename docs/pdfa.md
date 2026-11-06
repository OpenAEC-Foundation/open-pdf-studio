# PDF/A valideren en opslaan als PDF/A (#379)

**Bestand → PDF/A...** opent een venster met twee acties voor het actieve
document, voor PDF/A-1b, -2b of -3b:

- **Valideren** controleert het bestand zoals het op schijf staat en toont per
  overtreding de clausule, de pagina (klikbaar), de bevinding en het object
  (`12 0 R` of een pad zoals `page 3/Font/F1`).
- **Opslaan als PDF/A...** converteert het document (met onopgeslagen
  wijzigingen) en schrijft een nieuw bestand. Daarna staan de wijzigingen in
  het venster. Lukt de conversie niet volledig, dan wordt er niets geschreven en
  staan de resterende problemen in de lijst.

De PDF/A-balk heeft een knop **Valideren**. **Bewerken inschakelen** vraagt
eerst of het document bij opslaan weer PDF/A moet worden (standaard) of een
gewone PDF. Bij opslaan wordt het document dan opnieuw geconverteerd; lukt dat
niet, dan wordt het een gewone PDF en meldt de app waarom. De PDF/A-identificatie
verdwijnt dus nooit meer stilzwijgend.

De code staat in `open-pdf-studio/js/pdf/pdfa/` en heeft geen
app-afhankelijkheden (behalve `pdfa-service.js`); de tests staan in
`js/pdf/pdfa/pdfa.test.mjs`.

## Wat de validatie controleert

Clausules: deel 1 = ISO 19005-1, deel 2/3 = ISO 19005-2/-3.

| Code | Regel | Delen | Clausule (1 / 2-3) |
|---|---|---|---|
| `file.header` | `%PDF-1.n` en een commentaarregel met 4 binaire bytes | 1, 2, 3 | 6.1.2 / 6.1.2 |
| `file.trailerId` | trailer heeft `/ID` | 1, 2, 3 | 6.1.3 / 6.1.3 |
| `file.encrypted` | geen `/Encrypt` | 1, 2, 3 | 6.1.3 / 6.1.3 |
| `file.dataAfterEof` | `%%EOF` aanwezig, daarna hooguit een regeleinde | 1, 2, 3 | 6.1.3 / 6.1.3 |
| `file.xrefStream` | geen xref- of objectstreams | 1 | 6.1.4 |
| `file.lzw` | geen LZW (ook in inline images) | 1, 2, 3 | 6.1.10 / 6.1.7.2 |
| `file.externalStream` | geen `F`/`FFilter`/`FDecodeParms` op streams | 1, 2, 3 | 6.1.7 / 6.1.7.1 |
| `file.cryptFilter` | geen Crypt-filter | 2, 3 | 6.1.7.2 |
| `file.limits` | getallen, strings, namen, arrays, dicts, q-diepte | 1, 2, 3 | 6.1.12 / 6.1.13 |
| `meta.missing` | document-XMP aanwezig | 1, 2, 3 | 6.7.2 / 6.6.2.1 |
| `meta.filtered` | XMP-stream niet gecomprimeerd | 1 | 6.7.2 |
| `meta.packet` | xpacket-kop en -voet, RDF, geen `bytes`/`encoding` (deel 1) | 1, 2, 3 | 6.7.5 / 6.6.2.1 |
| `meta.pdfaid` | `pdfaid:part` = gekozen deel, conformance A/B(/U) | 1, 2, 3 | 6.7.11 / 6.6.4 |
| `meta.infoMismatch` | elk gevuld `/Info`-veld gelijk aan zijn XMP-eigenschap (datums als moment) | 1, 2, 3 | 6.7.3 / 6.6.2.3 |
| `oi.missing` | apparaatkleur zonder PDF/A-OutputIntent | 1, 2, 3 | 6.2.2 / 6.2.3 |
| `oi.profile` | ICC-profiel aanwezig en leesbaar, versie < 3 (deel 1) of < 5, klasse `mntr`/`prtr`, RGB/CMYK/GRAY, `/N` klopt | 1, 2, 3 | 6.2.2 / 6.2.3 |
| `oi.multiple` | alle OutputIntents met profiel wijzen naar hetzelfde profiel | 1, 2, 3 | 6.2.2 / 6.2.3 |
| `color.device` | DeviceRGB/DeviceCMYK zonder passende OutputIntent of `/DefaultRGB`/`/DefaultCMYK` (operatoren, kleurruimten, afbeeldingen, inline images, shadings, groepen) | 1, 2, 3 | 6.2.3.3 / 6.2.4.3 |
| `color.renderingIntent` | alleen de vier standaard-intenties | 1, 2, 3 | 6.2.9 / 6.2.5 |
| `gs.transfer` | geen `TR`, `TR2` alleen `Default` | 1, 2, 3 | 6.2.8 / 6.2.5 |
| `font.notEmbedded` | elk gebruikt font ingebed (Type3 en alleen-onzichtbare tekst uitgezonderd) | 1, 2, 3 | 6.3.4 / 6.2.11.4 |
| `font.widths` | `/Widths` (TrueType) en `/W` (CIDFontType2) gelijk aan het programma, ±1 | 1, 2, 3 | 6.3.6 / 6.2.11.5 |
| `font.encoding` | niet-symbolisch TrueType: WinAnsi of MacRoman | 1, 2, 3 | 6.3.7 / 6.2.11.6 |
| `font.cidToGid` | ingebed CIDFontType2 heeft `/CIDToGIDMap` | 1, 2, 3 | 6.3.3.2 / 6.2.11.3.2 |
| `font.subsetSet` | subsets (`ABCDEF+`): CIDSet resp. CharSet | 1 | 6.3.5 |
| `transp.smask` | geen soft masks (graphics state, afbeelding) | 1 | 6.4 |
| `transp.alpha` | geen `CA`/`ca` < 1 | 1 | 6.4 |
| `transp.blend` | deel 1: alleen Normal/Compatible; deel 2/3: alleen standaard-mengmodi | 1, 2, 3 | 6.4 / 6.2.10 |
| `transp.group` | geen transparantiegroepen | 1 | 6.4 |
| `image.interpolate` | geen `Interpolate true` | 1, 2, 3 | 6.2.4 / 6.2.8 |
| `image.alternates` | geen `Alternates`/`OPI` | 1, 2, 3 | 6.2.4 / 6.2.8 |
| `image.jpx` | geen JPEG 2000 | 1 | 6.1.10 |
| `xobject.forbidden` | geen PostScript-XObjects, `OPI`, `PS`, `Ref`, `Subtype2 PS` | 1, 2, 3 | 6.2.5 / 6.2.9 |
| `action.forbidden` | alleen GoTo, GoToR, (GoToE), Thread, URI, Named, SubmitForm; deel 1: geen `/A` op widgets | 1, 2, 3 | 6.6.1 / 6.5.1 |
| `action.named` | alleen NextPage, PrevPage, FirstPage, LastPage | 1, 2, 3 | 6.6.1 / 6.5.1 |
| `action.javascript` | geen `Names/JavaScript` | 1, 2, 3 | 6.6.1 / 6.5.1 |
| `action.additional` | geen `AA` in catalogus, pagina, annotatie of veld | 1, 2, 3 | 6.6.2 / 6.5.2 |
| `embed.forbidden` | geen ingesloten bestanden | 1 | 6.1.11 |
| `embed.notPdfA` | ingesloten bestanden zijn PDF/A-1 of -2 | 2 | 6.8 |
| `embed.spec` | `F`, `UF`, `AFRelationship`, MIME-`Subtype`, gekoppeld via `/AF` | 3 | 6.8 |
| `annot.type` | deel 1: typen uit PDF 1.4 zonder FileAttachment/Sound/Movie; deel 2/3: geen 3D/Sound/Screen/Movie | 1, 2, 3 | 6.5.2 / 6.3.1 |
| `annot.flags` | `F` aanwezig, Print aan, Hidden/Invisible/NoView (en ToggleNoView in 2/3) uit | 1, 2, 3 | 6.5.3 / 6.3.2 |
| `annot.appearance` | alleen `/N`; `/N` is een stream (behalve knoppen); deel 2/3: verplicht | 1, 2, 3 | 6.5.3 / 6.3.3 |
| `annot.alpha` | geen `CA` ≠ 1 op annotaties | 1 | 6.5.3 |
| `annot.color` | `C`/`IC` alleen met een RGB-OutputIntent | 1 | 6.5.3 |
| `form.needAppearances` | geen `NeedAppearances true` | 1, 2, 3 | 6.9 / 6.4.1 |
| `form.xfa` | geen XFA | 2, 3 | 6.4.2 |
| `oc.forbidden` | geen optionele inhoud | 1 | 6.1.13 |
| `oc.config` | configuraties hebben een unieke naam, geen `AS`, alle lagen in `Order` | 2, 3 | 6.9 |
| `catalog.forbidden` | geen `AlternatePresentations`, `NeedsRendering`, `PresSteps` | 2, 3 | 6.1.3 |

Niet gecontroleerd (het venster zegt dat het geen certificering is):

- de syntaxis van xref, objecten en streamlengtes byte voor byte;
- breedtes van Type1- en CFF-fontprogramma's, ingebedde CMaps, CharSet-inhoud;
- de tabellen in ICC-profielen (alleen de kop);
- van ingesloten PDF's (deel 2) alleen de PDF/A-identificatie;
- niveau a/u (toegankelijkheid, ToUnicode, structuur);
- XMP-extensieschema's voor eigen eigenschappen.

## Wat de conversie doet

1. Haalt weg: JavaScript, verboden acties (ook in `/Next`-ketens en
   bladwijzers), `AA`, XFA, `NeedAppearances`, alternatieve presentaties,
   externe streams, transferfuncties, `Interpolate`/`Alternates`/`OPI`; LZW
   wordt Flate; PostScript-XObjects worden leeg; deel 1: te grote reële getallen
   worden afgerond.
2. Ingesloten bestanden: deel 1 haalt ze weg, deel 2 houdt alleen PDF/A-bestanden,
   deel 3 vult `AFRelationship` (Unspecified), `UF`, MIME-type, `ModDate` en `/AF` aan.
3. Lagen: deel 1 haalt ze weg (verborgen inhoud wordt zichtbaar), deel 2/3
   repareren de configuratie.
4. Annotaties: verborgen annotaties weg, Print-vlag aan, verboden typen plat in de
   pagina (deel 1: Polygon, PolyLine, Caret, FileAttachment …), ontbrekende
   appearance streams aanmaken, alleen `/N`.
5. OutputIntent: een geldige bestaande blijft (ook een CMYK-drukprofiel van de
   PDF/X-export); anders een in code gebouwd sRGB-profiel (ICC v2.1, eigen werk).
6. Fonts: een niet-ingebed simpel font wordt ingebed met Liberation Sans (SIL OFL,
   wordt met PDF.js meegeleverd). Voor Helvetica/Arial is dat maatvast; andere
   fonts (Times, Courier, systeemfonts) worden vervangen, en het venster meldt dat.
   Breedtes, codering, `CIDToGIDMap` en CIDSet worden gelijkgetrokken.
7. Deel 1: lege transparantiegroepen gaan weg; een pagina met echte transparantie,
   een niet in te bedden font (Symbol, ZapfDingbats, samengestelde fonts zonder
   programma) of JPEG 2000 wordt een afbeelding van 200 dpi (via PDF.js). Alleen
   koppelingen blijven daar als annotatie staan. Gebruik PDF/A-2b of -3b om
   transparante pagina's als vector te houden.
8. Kleur: `/DefaultRGB` (sRGB) of `/DefaultCMYK` (een klein CC0-profiel,
   `CGATS001Compat-v2-micro.icc`, dat ook in pdfjs-dist zit) waar apparaatkleur niet
   bij de OutputIntent past.
9. `/Info` opgeschoond, XMP met alleen voorgedefinieerde schema's en `pdfaid`,
   nieuw bestands-ID, kop `%PDF-1.4` (deel 1) of `%PDF-1.7`, opslaan zonder
   objectstreams. Daarna valideert de conversie het resultaat.

## Externe validatie

Een extern PDF/A-validatieprogramma was bij het bouwen niet beschikbaar (geen Java
en geen validatieprogramma op de bouwmachine). Conversies zijn daarom alleen met
de eigen validatie gecontroleerd, op de testbestanden in de unit-tests en op de
PDF's in `test pdf-bestanden/` (1b, 2b en 3b zonder bevindingen). **Controleer bij
de review een paar geconverteerde bestanden met veraPDF** (1b, 2b en 3b, ook een
document met transparantie en een met bijlagen).
