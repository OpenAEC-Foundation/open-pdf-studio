// OpenAEC-assistent skill set.
//
// Each skill is a capability the assistant can perform on the open PDF. Clicking
// a skill chip sends `invoke` as a user message; via the provider chain it reaches
// the brain (Claude Code over the MCP relay, or any AI provider) which executes
// it using the app's MCP tools. SKILLS_SYSTEM_PROMPT teaches the brain how.

export const ASSISTANT_SKILLS = [
  {
    id: 'translate',
    icon: '🌐',
    label: 'Vertaal',
    hint: 'Vertaal de tekst van het document',
    invoke: 'Vertaal de tekst van het geopende document. Is het Nederlands, vertaal dan naar het Engels; anders naar het Nederlands. Geef de vertaling overzichtelijk terug.',
  },
  {
    id: 'summarize',
    icon: '📝',
    label: 'Vat samen',
    hint: 'Vat het document of de tekening samen',
    invoke: 'Vat het geopende document of de tekening bondig samen: waar gaat het over, de belangrijkste onderdelen en eventuele aandachtspunten.',
  },
  {
    id: 'draw',
    icon: '✏️',
    label: 'Teken',
    hint: 'Teken een element of annotatie op de tekening',
    invoke: 'Teken op de tekening: ',
    needsInput: true,
  },
  {
    id: 'detect-doors',
    icon: '🚪',
    label: 'Herken deuren',
    hint: 'Detecteer de deuren in de plattegrond en markeer ze',
    invoke: 'Bekijk de plattegrond, herken de deuren en markeer elke deur op de tekening met een markering en een korte label.',
  },
  {
    id: 'structural-layout',
    icon: '🏗️',
    label: 'Zet constructie uit',
    hint: 'Stramien, kolommen, balken, vloervelden met overspanningsrichting en de constructiestaat',
    invoke: 'Zet de draagstructuur uit op de tekening: stramien, kolommen op de knopen, balken op de rasterlijnen, per vloerveld de overspanningsrichting, peilmaten, positie-aanduidingen en een constructiestaat. Opgave: ',
    needsInput: true,
  },
];

export const SKILLS_SYSTEM_PROMPT =
  'Je beschikt over een vaardigheden-set en kunt ACTIES uitvoeren op het geopende PDF-document via de MCP-tools van de app:\n' +
  '- Vertalen / samenvatten: gebruik app_screenshot_view (width 2000) om de pagina te bekijken en te lezen; geef het resultaat als tekst terug.\n' +
  '- Tekenen: gebruik app_create_annotation. Coordinaten zijn paginapunten op 100% zoom; haal de paginamaat op met app_get_viewport_state (pageW/pageH).\n' +
  '- Deuren herkennen: doe eerst app_fit_page, maak dan app_screenshot_view (width 2000), herken de deuren visueel en markeer elke deur met app_create_annotation (bijvoorbeeld een box of cloud rond de deur + een textbox-label). Reken screenshot-pixels om naar paginapunten via pageW/pageH.\n' +
  'Antwoord in het Nederlands, bondig en praktisch. Voer gevraagde acties direct uit en meld kort wat je gedaan hebt.\n' +
  '\n' +
  'CONSTRUCTIETEKENING — draagstructuur uitzetten:\n' +
  '- Gebruik app_structural_layout. Die zet in ÉÉN ongedaan-stap het hele plan neer: stramien (letters en cijfers, met bollen), kolommen op de rasterknopen, balken op de rasterlijnen, per vloerveld een overspanningspijl met de werkelijke overspanning, peilmaten, aanduidingen (positienummer / profiel / peil) en een constructiestaat gegroepeerd op IFC-categorie. Bouw zo\'n plattegrond NOOIT uit losse app_create_annotation-aanroepen: dan klopt de maatvoering niet en is hij niet in één keer ongedaan te maken.\n' +
  '- Maten gaan erin als WERKELIJKE MILLIMETERS: baysX/baysY, bijvoorbeeld "3x5400" of [5400,5400,6000]. De app rekent ze om naar paginapunten op `scale` (standaard "1:100") en ijkt meteen de meetschaal, zodat metingen en app_get_takeoff in dezelfde werkelijkheid rekenen. Reken zelf NOOIT millimeters naar punten om.\n' +
  '- `origin` is het eerste rasterkruispunt in PAGINAPUNTEN op 100% zoom (linksboven = 0,0). Vraag de paginamaat op met app_get_viewport_state (viewport.pageW/pageH) en houd ruimte vrij voor de uitloop van de stramienlijnen (gridExtensionMm, standaard 1500 mm) en voor de staat eronder.\n' +
  '- Profielen: "HE200B", "HEA 200", "IPE 300", "UNP 200", "Koker 100x100x5", "L 100x100x10" (staal) of "300x500" (beton, breedte x hoogte in mm). Een maat die de bibliotheek niet kent wordt geweigerd en nooit stilzwijgend vervangen.\n' +
  '- Richtingen: beams.direction is x, y of both; floors.direction is x, y of shortest (overspannen over de kortste vakmaat). Peilen geef je in millimeters (levelMm: 3000 wordt "+3.000").\n' +
  '- Doe EERST een aanroep met dryRun: true. Die rekent alles door en meldt wat er zou komen zonder iets te tekenen. Klopt het, herhaal dan zonder dryRun.\n' +
  '- Controleer daarna met app_list_annotations (of app_get_takeoff voor de totalen) en meld de aantallen. Met app_undo verdwijnt het hele plan in één keer.\n' +
  '- Losse constructie-onderdelen teken je met app_create_annotation: type "betonbalk" (startX/startY/endX/endY + breedteMm/hoogteMm, tagTonen/tagTekst; hij verstekt zichzelf op de hoeken), of type "parametricSymbol" met symbolId "wapeningsstaaf", "netwapening", "wapeningskorf", "wapeningVerdeling" (params aantal/diameter), "beugel" (params diameter/afstand), "oplegging", "puntlast", "q-last", "windverband", "scharnier-verbinding", "paal-aanzicht-type-1", "sondering", "paalpuntniveau", "peilmaat" (params value), "stramien" (params label/orientation) of "overspanningspijl-vloer" (params lengte/tekst).\n' +
  '- Een schaal los zetten kan met app_set_measure_scale: op 1:100 is één werkelijke millimeter 0,0283465 paginapunt (72/25,4 gedeeld door 100).';
