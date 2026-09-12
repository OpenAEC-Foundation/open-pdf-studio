# Indienen bij de extensiebibliotheek van Claude

Alles wat het indienformulier voor desktopextensies vraagt, op één plek.
Het formulier zelf moet door de OpenAEC Foundation worden ingevuld
(<https://clau.de/desktop-extention-submission>): wie indient, aanvaardt de
voorwaarden van de bibliotheek.

## Vooraf klaarzetten

| Nodig | Waar |
|---|---|
| De bundel | `mcpb/dist/open-pdf-studio.mcpb` (`node mcpb/scripts/pack.mjs`), of het bestand bij de GitHub-release |
| Documentatie (openbaar) | <https://open-aec.com/open-pdf-studio/claude/> |
| Privacybeleid (openbaar, HTTPS) | <https://open-aec.com/open-pdf-studio/privacy/> |
| Icoon | `mcpb/icon.png` (256 × 256) |
| Contact voor de beoordeling | OpenAEC Foundation — info@open-aec.com |
| Broncode | <https://github.com/OpenAEC-Foundation/open-pdf-studio> (LGPL-3.0-or-later) |

## Antwoorden

**Naam:** Open PDF Studio

**Tagline (max. 55 tekens):** Measure and annotate PDF drawings (43)

**Beschrijving:**

> Open PDF Studio is a free, open-source PDF editor for the construction
> industry. With this extension Claude works in the drawing itself: opening
> files, reading and navigating pages, placing scale regions, measuring areas
> and lengths, creating and editing annotations, cutting a detail from one
> drawing into another as vector data, filling title block fields, placing a
> quantity schedule on the sheet and saving the result.
>
> The app does the arithmetic — subtracting openings, unit conversion, building
> the schedule — so the numbers come from the software, not from the model.
>
> Everything runs locally. The extension talks to the app on 127.0.0.1; the PDF
> file is never sent to an external service. Claude only sees what it asks for,
> such as a picture of the current page view. The user turns the connection on
> in the app (Settings > General > AI link) and it is off by default.

**Categorieën:** productivity / developer tools (afhankelijk van de keuzelijst;
het gaat om documenten en technische tekeningen)

**Belangrijkste gebruiksscenario's:**
1. Een aanzichtenblad opmeten: schaal aflezen en bevestigen, netto geveloppervlak
   met kozijnen eruit, dakvlakken met hellingcorrectie, en een staat op het blad.
2. Een detail uit de ene tekening in een andere plaatsen zonder overtrekken,
   met behoud van vectordata.
3. Een tekening klaarmaken voor uitgifte: bladhoofd invullen, revisiewolken en
   notities plaatsen, opslaan.

**Wat de gebruiker vooraf nodig heeft:** Open PDF Studio geïnstalleerd (gratis,
Windows, macOS, Linux) en de AI-koppeling aangezet in Instellingen › Algemeen.
Geen account, geen abonnement, geen sleutel.

**Leest of schrijft de connector gegevens?** Beide. Leesgereedschappen dragen
`readOnlyHint`; gereedschappen die een document of bestand wijzigen dragen
`destructiveHint`, zodat Claude er altijd toestemming voor vraagt.

**Authenticatie:** geen. De koppeling is lokaal en wordt door de gebruiker in de
app aangezet.

**Eigen API?** Ja. De extensie praat uitsluitend met onze eigen applicatie op de
computer van de gebruiker.

**Testinstructies voor de beoordelaar:**
1. Installeer Open PDF Studio van <https://open-aec.com/open-pdf-studio/#download>
   (Windows, macOS of Linux; geen account nodig).
2. Start de app en zet **Settings > General > AI link (MCP)** aan. De statusregel
   toont *Active on 127.0.0.1:9223*.
3. Installeer de extensie en laat de poort op 9223 staan.
4. Open in de app een PDF, of vraag Claude: *"Open C:\…\drawing.pdf and tell me
   how many pages it has."*
5. Voorbeeldopdrachten: *"List the annotations on this page."* (alleen lezen),
   *"Add a note in the top right corner saying 'checked'."* (vraagt toestemming),
   *"Save the document."* (vraagt toestemming).
6. Zonder draaiende app blijven de gereedschappen zichtbaar; een aanroep geeft
   dan de melding dat de app gestart moet worden.

**Opmerking over de generieke gereedschappen:** `app_run_command`,
`app_click_element` en de muis-/toetsenbordgereedschappen bedienen de
gebruikersinterface van onze eigen app. Ze dragen `destructiveHint`, zodat elke
aanroep om toestemming vraagt. Vindt de beoordeling dit ongewenst, dan kunnen ze
naar het ontwikkelprofiel — één regel in
`open-pdf-studio/src-tauri/src/mcp_tool_meta.rs`.

## Eisen die de beoordeling stelt, en hoe we eraan voldoen

| Eis | Status |
|---|---|
| Titel + `readOnlyHint`/`destructiveHint` op elk gereedschap | `mcp_tool_meta.rs`, bewaakt door een Rust-test |
| Privacybeleid in README én `privacy_policies` in de manifest (HTTPS) | ja |
| Openbare documentatie | website-pagina |
| Aparte lees- en schrijfgereedschappen | ja; geen gereedschap met een methode-parameter in het publieke profiel |
| Korte gereedschapsnamen (≤ 64 tekens) | langste is 22 tekens |
| Geen prompt-injectiepatronen in beschrijvingen | beschrijvingen zeggen alleen wat het gereedschap doet |
| Elk gereedschap geeft een bruikbaar antwoord of een duidelijke fout | ja; onbekende parameters geven een concrete melding |
| Open source | LGPL-3.0-or-later, publieke repository |
