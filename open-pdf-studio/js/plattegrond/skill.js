// De assistent-vaardigheid "Plattegrond": een bouwkundige plattegrond tekenen
// waarin de onderdelen elkaar kennen.
//
// Dit bestand bevat alleen GEGEVENS — de chip voor het assistentvenster en de
// instructie voor het model dat de MCP-opdrachten uitvoert. De rekenkunde zit
// in sparing.js, ruimte.js en maatvoering.js; de opdracht zelf in
// mcp-plattegrond.js achter `app_floorplan`.
//
// Waarom een eigen instructie: de bestaande "Teken"-vaardigheid is één zin en
// levert losse vormen op. Een plattegrond vraagt om volgorde (stramien →
// dragende wanden → scheidingswanden → kozijnen → ruimten → maatvoering), om
// een schaal vóór de eerste lijn, en om controleren wat er staat.

export const PLATTEGROND_SKILL = {
  id: 'floorplan',
  icon: '🏠',
  label: 'Plattegrond',
  hint: 'Teken een bouwkundige plattegrond: wanden, kozijnen, ruimten en maatvoering',
  invoke: 'Teken een bouwkundige plattegrond. Werk als tekenaar: zet eerst de schaal, teken dan de wanden met hun deuren en ramen erin, laat de ruimten zichzelf herkennen en zet er maatvoering bij. Wat er getekend moet worden: ',
  needsInput: true,
};

export const PLATTEGROND_PROMPT =
  '\n\nPLATTEGROND TEKENEN (vaardigheid "Plattegrond", opdracht app_floorplan):\n' +
  'Teken een plattegrond NOOIT als losse vormen op elkaar. Gebruik app_floorplan, dat de drie relaties van een bouwtekening legt: een sparing hoort bij een wand, een ruimte bij de wanden eromheen, een maat bij wat hij meet.\n' +
  'Coordinatenruimte: alle x/y zijn paginapunten op 100% zoom; app_get_viewport_state geeft pageW/pageH. Alle maten (wanddikte, dagmaat, borstwering, offset) zijn WERKELIJKE MILLIMETERS.\n' +
  'Werkvolgorde:\n' +
  '1. Schaal eerst. Zonder schaal weigert app_floorplan. Zet hem met app_set_measure_scale: pixelsPerUnit = 2.8346 / noemer, unit "mm" (1:50 -> 0.0567, 1:100 -> 0.0283). Reken daarna zelf om: 1 mm werkelijk = pixelsPerUnit paginapunt, dus een gevel van 10 m op 1:50 is 567 punten lang. Kies een beginpunt zo dat de hele plattegrond op de pagina past.\n' +
  '2. Wanden met hun kozijnen, per gevel of wandloop een aanroep: app_floorplan {action:"wall", start:{x,y}, end:{x,y}, thicknessMm, material, openings:[...]}. start/end zijn de HARTLIJN van de wand; laat de hartlijnen van aansluitende wanden in de hoekpunten samenvallen, dan verstekt de app de hoek zelf. Elke opening is {kind:"door"|"window", widthMm (dagmaat), alongMm (hart, gemeten vanaf start langs de wand), sillMm (borstwering), heightMm, swing:"left"|"right" (scharnierkant) en openTo:{x,y} (een punt in de ruimte waarin de deur draait)}. De wand wordt op elke sparing opgeknipt, dus het kozijn onderbreekt de wand echt. Bewaar de teruggegeven wallIds op volgorde.\n' +
  '   Materialen: nen47-metselwerk-baksteen (buitenblad), nen47-metselwerk-kunststeen (kalkzandsteen, binnenwand), nen47-beton-gewapend, nen47-beton-prefab, isolatie (met insulation: steenwol/glaswol/pir/eps/kooltherm/pur), none.\n' +
  '   Gangbare maten: buitenwand 300-350 mm, dragende binnenwand 200-250, scheidingswand 70-100. Deur 900 x 2315, binnendeur 830, raam 1200-2400 breed met borstwering 850.\n' +
  '3. Ruimten: app_floorplan {action:"rooms", place:true, seeds:[{x,y,name:"Woonkamer", number:"0.01"}, ...]} (number mag weg). De ruimte volgt uit de wanden: netto oppervlakte binnen de wandvlakken. Per ruimte komt er een ingetogen ruimtevlak (dunne grijze rand, geen arcering of vulling, ACHTER de wanden en kozijnen) en EEN ruimtetag met naam, netto oppervlakte en nummer, in het hart van de ruimte. Zet ruimtenamen dus nooit als los tekstvak; de tag is verplaatsbaar en de gebruiker kan naam en nummer in het eigenschappenpaneel wijzigen. Zonder seeds krijg je alleen een overzicht van wat er gevonden is. openEnds in het antwoord zijn wandeinden waar de contour niet sluit - meld die, ga niet raden. Verschoof er later een wand, draai dan {action:"rooms", refresh:true}: elk ruimtevlak rekent zichzelf opnieuw uit en elke ruimtetag krijgt de nieuwe oppervlakte en schuift mee met zijn ruimte.\n' +
  '4. Maatvoering: app_floorplan {action:"dimensions", wallIds:[...uit stap 2, op volgorde], side:"left"|"right"}. Dat levert een maatketting (penant, dagmaat, penant, ...) plus een totaalmaat. Een bouwkundige meet vanaf het WANDVLAK, en zo werkt de ketting ook: de punten liggen op het vlak aan de maatzijde (bij een spouwmuur uit losse lagen op het buitenvlak van de buitenste laag - geef gerust de wallIds van een binnenlaag, de app zoekt de buitenste zelf) en de uiterste punten liggen op de buitenhoek van het gebouw, ook als het wandstuk bij een stompe hoek eerder stopt. side is de kant van de ketting, gezien langs de looprichting van de wand: bij een met de klok mee getekende omtrek is "left" buiten. Laat offsetMm en totalOffsetMm weg: de standaard (500 en 850 mm vanaf het wandvlak op 1:50) groeit mee met de schaal, zodat teksten niet tegen de maatlijnen of de totaalmaat aan komen. Maten zijn zwart en dun en tonen alleen het getal in mm; showUnit:true zet de eenheid erachter. De maatlijn loopt 2 mm (op papier) door voorbij de buitenste hulplijnen en de hulplijnen beginnen 1,5 mm van het wandvlak - dat hoeft niet opgegeven. Na een wijziging: {action:"dimensions", refresh:true} - ook dan blijven de punten op het wandvlak en de buitenhoek.\n' +
  '   Ketting uitbreiden in plaats van een nieuwe maatlijn tekenen: {action:"dimensions", chainOf:"<id van een maat uit de ketting>", addPoints:[{x,y}, ...]} zet er hulplijnen bij (tussen twee hulplijnen splitst het segment, erbuiten wordt de ketting langer, de totaalmaat gaat mee); removePoints:[{x,y}] haalt een hulplijn weg. Een punt op een wandvlak wordt aan die wand verankerd. chainId in het antwoord van "dimensions" hoort bij de hele ketting.\n' +
  '5. Controleren: app_floorplan {action:"inspect"} geeft terug wat er staat - wanden met lengte en dikte, sparingen met dagmaat en borstwering, de gevonden ruimten met oppervlakte, en openEnds. Gebruik dat om te verifieren, niet alleen een schermafdruk. Bekijk daarna eventueel met app_fit_page + app_screenshot_view of het beeld klopt.\n' +
  'Elke aanroep is één undo-stap. Gaat er iets mis, dan is app_undo genoeg. Teksten op de tekening (ruimtenamen, titel) gaan in de taal van de gebruiker.';
