// De assistent-vaardigheid "Plattegrond": een bouwkundige plattegrond tekenen
// waarin de onderdelen elkaar kennen.
//
// Dit bestand bevat alleen GEGEVENS — de chip voor het assistentvenster en de
// instructie voor het model dat de MCP-opdrachten uitvoert. De rekenkunde zit
// in sparing.js, ruimte.js en maatvoering.js; de opdracht zelf in
// mcp-plattegrond.js achter `app_floorplan`. Vliesgevels en kozijnen als
// gevelelement lopen via `app_facade_element` (js/gevelelement/).
//
// Waarom een eigen instructie: de bestaande "Teken"-vaardigheid is één zin en
// levert losse vormen op. Een plattegrond vraagt om volgorde (stramien →
// dragende wanden → scheidingswanden → kozijnen → ruimten → maatvoering), om
// een schaal vóór de eerste lijn, en om controleren wat er staat.

export const PLATTEGROND_SKILL = {
  id: 'floorplan',
  icon: '🏠',
  label: 'Plattegrond',
  hint: 'Teken een bouwkundige plattegrond: wanden, kozijnen, ruimten, maatvoering en inrichting (sanitair, keuken)',
  invoke: 'Teken een bouwkundige plattegrond. Werk als tekenaar: zet eerst de schaal, teken dan de wanden met hun deuren en ramen erin, laat de ruimten zichzelf herkennen en zet er maatvoering bij. Wat er getekend moet worden: ',
  needsInput: true,
};

// Wandjoin en de Nederlandse spouwmuur (#476): hoe de app aansluitende wanden
// afsluit, en hoe je een gevel uit losse lagen tekent zonder dat de lagen in
// een hoek door elkaar heen steken. Eigen blok, ingevoegd na de wandmaten.
export const SPOUWMUUR_INSTRUCTIE =
  '   Wandjoin: wanden die elkaar raken sluit de app zelf af. Samenvallende eindpunten gaan in verstek (elk materiaal); einden die een wand van HETZELFDE materiaal net passeren of net niet halen, worden tot een dichte hoek getrimd. Een wand wordt nooit doorgetrokken of afgekapt tegen een wand van een ander materiaal. Wil je aan een uiteinde geen join (stompe aansluiting: de ene wand loopt door, de andere stopt precies tegen zijn vlak), geef dan joinStart:false en/of joinEnd:false mee (begin/eind van de loop). Achteraf: app_update_annotation {id, props:{noJoinStart:true}} of {noJoinEnd:true} (true = join uit, false = weer aan).\n' +
  '   Spouwmuur (gevel): een Nederlandse spouwmuur is van buiten naar binnen metselwerk 100 (nen47-metselwerk-baksteen), luchtspouw 40, isolatie 100 (isolatie, bijvoorbeeld insulation:"pir") en kalkzandsteen 120 (nen47-metselwerk-kunststeen, het binnenblad), samen 360 mm.\n' +
  '   - Teken hem als losse wanden: per gevel een app_floorplan-aanroep per laag. De luchtspouw is GEEN wand; daar blijft 40 mm open tussen metselwerk en isolatie. De laaghartlijnen liggen evenwijdig aan het buitenvlak, op 50 (metselwerk), 190 (isolatie) en 300 mm (kalkzandsteen) naar binnen.\n' +
  '   - Hoeken per laag: laat in een hoek de hartlijnen van DEZELFDE laag van beide gevels in één punt samenvallen (metselwerk op metselwerk, isolatie op isolatie, kalkzandsteen op kalkzandsteen). Dan verstekt elke laag met zichzelf en steekt geen laag door een andere laag of door de spouw. Moet een losse spouwmuurlaag stomp stoppen in plaats van verstekken, zet dan de join uit (joinStart/joinEnd:false) en laat hem precies op het vlak van de doorgaande laag eindigen.\n' +
  '   - Sparingen: geef een deur of raam aan ALLE lagen van die gevel mee met dezelfde widthMm, zodat alle lagen op dezelfde plek onderbroken worden. alongMm telt vanaf het eigen beginpunt van elke laag; begint een laag op een ander punt (bij een verstekhoek ligt het begin per laag anders), reken dat verschil om, zodat het hart van de sparing in elke laag op dezelfde plek ligt.\n' +
  '   - Binnenwanden sluiten aan op het binnenblad: laat ze eindigen op het binnenvlak van de kalkzandsteen (niet op de hartlijn van de gevel) en zet daar de join uit, zodat de binnenwand geen deel wordt van de gevelhoek.\n' +
  '   - {action:"inspect"} geeft per wand joinStart en joinEnd terug.\n';

// Inrichten (#478): sanitair en keuken als parametrische symbolen op
// werkelijke maat, geplaatst met app_create_annotation. Apart gehouden zodat
// de symbool-ids en parameters op één plek staan (skill.test.mjs toetst ze
// tegen de templates).
export const INRICHTING_PROMPT =
  '\nINRICHTEN - sanitair en keuken (na de wanden): app_create_annotation {type:"parametricSymbol", props:{symbolId, x, y, rotation, anchor, params:{...}}}. Elk onderdeel staat op WERKELIJKE MAAT (mm, via de schaal op dat punt).\n' +
  '   Richting: ongedraaid ligt de ACHTERKANT (wandzijde) boven; rotation 90 = wand rechts, 180 = wand onder, 270 = wand links. anchor:"back" maakt x/y het midden van de achterkant: geef dan een punt OP HET WANDVLAK (hartlijn plus halve wanddikte naar de ruimte toe) en de app legt het toestel ertegen, ook gedraaid. anchor:"back-left"/"back-right" is de linker-/rechterhoek van de achterkant (een aanrecht dat in een hoek begint); zonder anchor is x/y het midden.\n' +
  '   Sanitair: "wandcloset" {breedte 360, diepte 530}, "staand-closet" {breedte 380, diepte 680}, "fontein" {breedte 380, diepte 250, kraan:"midden"|"zijkant", spiegelen}, "hoekfontein" {breedte 330, diepte 330, spiegelen} (de hoek ligt linksboven, gespiegeld rechtsboven: zet hem met anchor:"back-left" in de binnenhoek). Toiletruimte, vuistregel: netto minstens 900 x 1200 mm, hart closet minstens 400 mm uit een zijwand, 600 mm vrij voor de pot; de fontein naast of tegenover het closet, buiten de draaicirkel van de deur.\n' +
  '   Keuken: "aanrecht" (recht; lengte, diepte 600), "aanrecht-hoek" (L-vorm; lengte = been 1 langs de achterwand, lengte2 = been 2 langs de rechterwand, buitenhoek rechtsboven, gespiegeld linksboven; diepte 600) en "kookeiland" (lengte 2400, diepte 1000, overstek = zitgedeelte). Allemaal met spiegelen en onderdelen. Een blok met zijn onderdelen is EEN symbool: het verplaatst en draait als geheel.\n' +
  '   onderdelen: [{soort, vanaf, breedte, been}]. soort: spoelbak, spoelbak-dubbel, kookplaat-4, kookplaat-5, inductie, vaatwasser, koelkast, hoge-kast. vanaf = mm van het begin van het been tot de linkerkant van het onderdeel (kijkend naar de wand); breedte standaard 600 (spoelbak-dubbel en kookplaat-5 900, inductie 800); been 1|2 alleen bij aanrecht-hoek, been 2 gemeten vanaf de buitenhoek en pas vrij na het hoekvak (vanaf >= diepte). Wat buiten het blad valt, schuift de app erin; lees het resultaat terug met app_get_annotation.\n' +
  '   Wijzigen: app_update_annotation {id, props:{params:{...}}} VOEGT params SAMEN (alleen de lengte meegeven laat de onderdelen staan) en zet de werkelijke maat opnieuw; een aanrecht groeit vanaf zijn begin (aanrecht-hoek vanaf de buitenhoek), een toestel vanaf de wand.\n' +
  '   Keuken, vuistregels: vaatwasser direct naast de spoelbak; minstens 600 mm werkblad tussen spoelbak en kookplaat; kookplaat minstens 300 mm uit een wand of hoge kast; loopruimte voor een aanrecht en tussen aanrecht en eiland minstens 1000 mm.';

export const PLATTEGROND_PROMPT =
  '\n\nPLATTEGROND TEKENEN (vaardigheid "Plattegrond", opdracht app_floorplan):\n' +
  'Teken een plattegrond NOOIT als losse vormen op elkaar. Gebruik app_floorplan, dat de drie relaties van een bouwtekening legt: een sparing hoort bij een wand, een ruimte bij de wanden eromheen, een maat bij wat hij meet.\n' +
  'Coordinatenruimte: alle x/y zijn paginapunten op 100% zoom; app_get_viewport_state geeft pageW/pageH. Alle maten (wanddikte, dagmaat, borstwering, offset) zijn WERKELIJKE MILLIMETERS.\n' +
  'Werkvolgorde:\n' +
  '1. Schaal eerst. Zonder schaal weigert app_floorplan. Zet hem met app_set_measure_scale: pixelsPerUnit = 2.8346 / noemer, unit "mm" (1:50 -> 0.0567, 1:100 -> 0.0283). Reken daarna zelf om: 1 mm werkelijk = pixelsPerUnit paginapunt, dus een gevel van 10 m op 1:50 is 567 punten lang. Kies een beginpunt zo dat de hele plattegrond op de pagina past.\n' +
  '2. Wanden met hun kozijnen, per gevel of wandloop een aanroep: app_floorplan {action:"wall", start:{x,y}, end:{x,y}, thicknessMm, material, openings:[...]}. start/end zijn de HARTLIJN van de wand; laat de hartlijnen van aansluitende wanden in de hoekpunten samenvallen, dan verstekt de app de hoek zelf. Elke opening is {kind:"door"|"window", widthMm (dagmaat), alongMm (hart, gemeten vanaf start langs de wand), sillMm (borstwering), heightMm, swing:"left"|"right" (scharnierkant) en openTo:{x,y} (een punt in de ruimte waarin de deur draait)}. De wand wordt op elke sparing opgeknipt, dus het kozijn onderbreekt de wand echt. Bewaar de teruggegeven wallIds op volgorde.\n' +
  '   Materialen: nen47-metselwerk-baksteen (buitenblad), nen47-metselwerk-kunststeen (kalkzandsteen, binnenwand), nen47-beton-gewapend, nen47-beton-prefab, isolatie (met insulation: steenwol/glaswol/pir/eps/kooltherm/pur), none.\n' +
  '   Gangbare maten: buitenwand 300-350 mm, dragende binnenwand 200-250, scheidingswand 70-100. Deur 900 x 2315, binnendeur 830, raam 1200-2400 breed met borstwering 850.\n' +
  SPOUWMUUR_INSTRUCTIE +
  '2b. Vliesgevels en puien: gebruik app_facade_element, niet een rij losse ramen. Een gevelelement is EEN object langs een lijn: kader aan beide uiteinden, stijlen op de veldgrenzen, per veld een paneel. preset "curtainWall" (vliesgevel, aluminium stijlen alu-50x150/alu-50x200/alu-65x250, panelen glass, solid, door, open) of "windowFrame" (kozijn, kozijnhout hout-67x114/hout-67x139/hout-90x114, panelen glass, turnSash, door, solid).\n' +
  '   In een wand: app_facade_element {action:"create", preset, wallId (een wallId uit stap 2), fromMm (begin, vanaf het beginpunt van de wand) of alongMm (midden), lengthMm, fields (aantal gelijke velden) of fieldWidthsMm (hart-op-hart), panels:["glass","door",...]}. De wand wordt dan over de lengte van het element onderbroken, net als bij een kozijn uit stap 2, en een vliesgevel telt daarna als omsluiting van de ruimte. Los: {action:"create", start:{x,y}, end:{x,y}, ...}.\n' +
  '   Een deur is {type:"door", hinge:"start"|"end", swing:"inside"|"outside"}; binnen is standaard rechts van de tekenrichting (insideSide).\n' +
  '   Bewerken met het teruggegeven id: {action:"addMullion", id, atMm} (veld splitsen), {action:"removeMullion", id, mullion} (velden samenvoegen), {action:"moveMullion", id, mullion, toMm}, {action:"setMullionType", id, mullion, mullionType}, {action:"setPanel", id, field, panel}, {action:"divide", id, fields}. Stijl 0 en de laatste stijl zijn het kader; veld i ligt tussen stijl i en i+1. Terugvragen: {action:"get", id} of {action:"get"} voor alle elementen op de pagina.\n' +
  '3. Ruimten: app_floorplan {action:"rooms", place:true, seeds:[{x,y,name:"Woonkamer"}, ...]}. De ruimte volgt uit de wanden: netto oppervlakte binnen de wandvlakken, label in het hart. Zonder seeds krijg je alleen een overzicht van wat er gevonden is. openEnds in het antwoord zijn wandeinden waar de contour niet sluit - meld die, ga niet raden. Verschoof er later een wand, draai dan {action:"rooms", refresh:true}: elke geplaatste ruimte rekent zichzelf opnieuw uit.\n' +
  '4. Maatvoering: app_floorplan {action:"dimensions", wallIds:[...uit stap 2, op volgorde], offsetMm:500, side:"left"|"right"}. Dat levert een maatketting (penant, dagmaat, penant, ...) plus een totaalmaat, met de eindpunten vast aan de wandstukken. Na een wijziging: {action:"dimensions", refresh:true}.\n' +
  '5. Controleren: app_floorplan {action:"inspect"} geeft terug wat er staat - wanden met lengte en dikte, sparingen met dagmaat en borstwering, de gevonden ruimten met oppervlakte, en openEnds. Gebruik dat om te verifieren, niet alleen een schermafdruk. Bekijk daarna eventueel met app_fit_page + app_screenshot_view of het beeld klopt.\n' +
  'Elke aanroep is één undo-stap. Gaat er iets mis, dan is app_undo genoeg. Teksten op de tekening (ruimtenamen, titel) gaan in de taal van de gebruiker.' +
  kozijnInstructie() +
  INRICHTING_PROMPT;

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
