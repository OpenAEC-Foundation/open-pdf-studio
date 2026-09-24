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
  '3. Ruimten: app_floorplan {action:"rooms", place:true, seeds:[{x,y,name:"Woonkamer"}, ...]}. De ruimte volgt uit de wanden: netto oppervlakte binnen de wandvlakken, label in het hart. Zonder seeds krijg je alleen een overzicht van wat er gevonden is. openEnds in het antwoord zijn wandeinden waar de contour niet sluit - meld die, ga niet raden. Verschoof er later een wand, draai dan {action:"rooms", refresh:true}: elke geplaatste ruimte rekent zichzelf opnieuw uit.\n' +
  '4. Maatvoering: app_floorplan {action:"dimensions", wallIds:[...uit stap 2, op volgorde], offsetMm:500, side:"left"|"right"}. Dat levert een maatketting (penant, dagmaat, penant, ...) plus een totaalmaat, met de eindpunten vast aan de wandstukken. Na een wijziging: {action:"dimensions", refresh:true}.\n' +
  '5. Controleren: app_floorplan {action:"inspect"} geeft terug wat er staat - wanden met lengte en dikte, sparingen met dagmaat en borstwering, de gevonden ruimten met oppervlakte, en openEnds. Gebruik dat om te verifieren, niet alleen een schermafdruk. Bekijk daarna eventueel met app_fit_page + app_screenshot_view of het beeld klopt.\n' +
  'Elke aanroep is één undo-stap. Gaat er iets mis, dan is app_undo genoeg. Teksten op de tekening (ruimtenamen, titel) gaan in de taal van de gebruiker.' +
  kozijnInstructie();

/**
 * Eigen blok: kozijnen op ware grootte en een spouwmuur met de sparing per
 * laag (layers). Als functie onderaan, zodat het blok los staat van de rest
 * van de instructie.
 */
function kozijnInstructie() {
  return '\n\nKOZIJNEN EN SPOUWMUREN:\n' +
    '- Een kozijn wordt op ware grootte getekend: kozijnhout 67 x 114 mm met een sponning, dubbel glas (24 mm) of een deurblad van 40 mm met draaicirkel. widthMm is de KOZIJNMAAT (buitenwerks); in een enkele wand is dat ook de dagmaat. Standaard binnendeur: kozijnmaat 930 (blad 830). Op 1:50 komen sponning en dubbel glas in beeld, op 1:100 wordt het vereenvoudigd.\n' +
    '- Een spouwmuur teken je met EEN aanroep met layers (van buiten naar binnen), niet als losse wanden per laag: app_floorplan {action:"wall", start, end, insideSide:"right", layers:[{thicknessMm:100, material:"nen47-metselwerk-baksteen"}, {thicknessMm:40, material:"none"}, {thicknessMm:100, material:"isolatie", insulation:"pir"}, {thicknessMm:120, material:"nen47-metselwerk-kunststeen"}], openings:[...]}. Met layers zijn start/end het BUITENVLAK van de gevel (buitenwerks), niet de hartlijn; insideSide is de kant van de binnenruimte gezien van start naar end (een met de klok mee getekende omtrek heeft binnen rechts: "right"). material "none" is de luchtspouw: ruimte, geen wand. thicknessMm en material van de wand zelf tellen dan niet.\n' +
    '- Het kozijn staat dan in de spouw, direct achter het buitenblad. Het buitenblad heeft 20 mm aanslag over het kozijn (sparing in het metselwerk = kozijnmaat - 40), de isolatie sluit tegen het kozijn, het binnenblad heeft een dagkant met 10 mm speling (sparing = kozijnmaat + 20). Per opening aan te passen: framePositionMm (buitenvlak wand tot buitenkant kozijn), overlapMm (aanslag), clearanceMm (speling), stileWidthMm en frameDepthMm (kozijnhout), leafThicknessMm (deurblad). Het antwoord meldt per opening frame en layerOpeningsMm.\n' +
    '- Laat de buitenvlakken van aansluitende gevels in de hoekpunten samenvallen (zelfde layers, zelfde insideSide): dan verstekt de app elke laag in de hoek; corners in het antwoord telt de verstekte lagen.\n' +
    '- Deuren in een spouwmuur draaien standaard naar binnen; openTo of openSide wijst een andere kant aan. swing is de draairichting: de kant van de scharnieren gezien vanaf de kant waar de deur van weg draait. Een raam heeft windowType fixed (vast), turn (draairaam, met gestreepte draaicirkel naar binnen), pivot of tilt.\n' +
    '- Maatvoering langs een spouwgevel: geef de wallIds van het buitenblad mee (layers[0].wallIds uit het antwoord), dan meet de ketting de sparingen in het metselwerk.';
}
