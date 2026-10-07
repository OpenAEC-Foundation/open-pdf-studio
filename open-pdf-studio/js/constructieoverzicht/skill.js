// De assistent-vaardigheid "Constructieoverzicht": per bouwlaag een
// constructieplattegrond op knipsels van de architectentekening, met markering,
// legenda en toelichting zoals een constructeur hem verstuurt.
//
// Dit bestand bevat alleen GEGEVENS: de chip voor het assistentvenster en de
// instructie voor het model. Het model werkt met bestaande MCP-opdrachten
// (knipsels, annotaties, schikken, raster-PDF); er is geen eigen opdracht.
//
// Waarom een eigen instructie: een constructieoverzicht volgt andere regels dan
// een bouwkundige plattegrond. Een vloer ligt op de bouwlaag eronder, dus die
// laag is de onderlegger en haar dragende wanden worden gestippeld; platte
// daken horen bij de verdieping waarop ze liggen en het dakplan toont alleen
// het hellende dak.

export const CONSTRUCTIEOVERZICHT_SKILL = {
  id: 'structural-overview',
  icon: '📐',
  label: 'Constructieoverzicht',
  hint: 'Constructieoverzicht per bouwlaag op de plattegronden van de architect: fundering, vloeren met overspanning, onderliggende dragende wanden, liggers en kolommen, legenda en toelichting',
  invoke: 'Maak een constructieoverzicht op dit blad met knipsels uit de plattegronden van de architect, per bouwlaag en volgens de conventies. Bron, bouwlagen en constructieprincipe: ',
  needsInput: true,
};

export const CONSTRUCTIEOVERZICHT_PROMPT =
  '\n\nCONSTRUCTIEOVERZICHT (vaardigheid "Constructieoverzicht"):\n' +
  'Een constructieoverzicht laat per bouwlaag zien wat waarop draagt. De architectentekening is context, de markering is de informatie. Werk op een sjabloonblad met titelblok en open de architectentekening in een tweede tabblad.\n' +
  'Dit is geen stramienplan: gebruik hier geen app_structural_layout. De markering bestaat uit losse annotaties (app_create_annotation) op de onderlegger.\n' +
  'Blad:\n' +
  '- Eén plattegrond per bouwlaag, van links naar rechts en van boven naar onder: begane grond (fundering en begane grondvloer), 1e verdieping, 2e verdieping (bijvoorbeeld een vlieringvloer of een plat dak tussen de kappen), dak. Elk met een titellabel: "CONSTRUCTIE BEGANE GROND", "CONSTRUCTIE 1E VERDIEPING", enzovoort.\n' +
  '- Legenda en toelichting samen in één kolom. Renvooien en titelblok van het sjabloon laten staan, uitgelijnd op dezelfde linkerkant en breedte.\n' +
  'Onderleggers:\n' +
  '- De plattegrond van een vloer krijgt de ONDERLIGGENDE bouwlaag als onderlegger, want de vloer ligt op die wanden: de 1e verdieping op de begane grond, de 2e verdieping op de 1e verdieping, het dak op de bovenste verdieping. Dat is anders dan bij een bouwkundige tekening.\n' +
  '- Knip met app_snippet_cut in het tabblad van de architect (paginapunten, linksboven = 0,0) en plak met app_snippet_paste in het overzicht. Dat gaat op ware grootte, dus de schaal blijft gelijk (1:100). Neem de hele bouwlaag mee, ook aan- en uitbouwen.\n' +
  '- Zet het knipsel op halftoon met app_update_annotation {id, props:{opacity:0.2}}: echt licht. Leg het onder de markering: app_select_annotation {id}, dan app_run_command {command:"ribbon:#arr-send-back"}, dan app_clear_selection.\n' +
  '- Andere uitsnede nodig? Knip en plak opnieuw, verwijder het oude knipsel met app_delete_annotation en verschuif de markering mee.\n' +
  'Dragende wanden en kolommen:\n' +
  '- Teken de dragende wanden van de onderliggende laag als penanten tussen de kozijnen, zonder lateien, GESTIPPELD: app_create_annotation type "box" met fillColor null, borderStyle "dashed", lineWidth 0.8 en color en strokeColor "#000000". De breedte is de wanddikte op schaal: kalkzandsteen 120 mm = 3,4 pt op 1:100.\n' +
  '- De penanten volgen uit de arcering van de architectentekening: bij kalkzandsteen diagonale lijntjes op circa 10 pt, met het midden op de hartlijn van de wand. Neem alle bouwdelen mee, ook een aanbouw.\n' +
  '- Kolom: rood gevuld vierkant (8 x 8 pt) met een label met het profiel, bijvoorbeeld "hoekkolom koker 100x100". Bij een glazen hoek of pui: een ligger boven de pui en kolommetjes op de stijlen van het kozijn.\n' +
  'Vloeren en daken:\n' +
  '- Per vloerveld een rode dubbele pijl in de overspanningsrichting: type "arrow" met startHead en endHead "closed", lineWidth 2 en headSize 7. Alle pijlen van één plattegrond op één lijn, ongeveer midden in de vloervelden, elk met een label met systeem en dikte (bijvoorbeeld "BPV 240"). Op de begane grond ook de overspanning h.o.h. funderingsbalken (bijvoorbeeld "ribcassettevloer l = 5,9 m").\n' +
  '- Platte daken op de hoogte van een verdiepingsvloer (aanbouw, uitbouw) horen op de plattegrond van die verdieping, niet op het dakplan; een plat dak tussen de kappen hoort op de plattegrond van de laag waarop het ligt. Het dakplan toont alleen het hellende dak: kap, spanten en de doorgezette kap boven een veranda.\n' +
  '- Sparing (trapgat, vide): type "box" met cross:true, rood, zonder vulling. Ligger: rode lijn met lineWidth 4.5 en een label ("ligger n.t.b." zolang het profiel niet vastligt).\n' +
  'Begane grond:\n' +
  '- Funderingsbalk: blauwe lijn ("#0000FF") met lineWidth 7 op de hartlijn van de wand. Randbalk van een terras of veranda: blauw, lineWidth 4.5, borderStyle "long-dash". Poer onder een kolom: blauw gevuld vierkant.\n' +
  'Stijl:\n' +
  '- Labels: type "textbox" met fillColor "#45b6a8", color en strokeColor "#350e35", lineWidth 0.6, fontFamily "Segoe UI", fontSize 6.5 en textColor "#000000". Titellabels: fontFamily "SegoeUI", fontBold true, fontSize 12, textColor "#350e35".\n' +
  '- Rood = staal, liggers, kolommen en pijlen; blauw = fundering; groen gestippeld = houten vlieringvloer; zwart gestippeld = onderliggende dragende wand.\n' +
  '- Een legenda met elk gebruikt symbool. Een beknopte toelichting: vloersystemen, fundering, stabiliteit en een verwijzing naar het uitgangspuntendocument; geen Rc-waarden.\n' +
  'Controle en uitvoer:\n' +
  '- Controleer met app_list_annotations en bekijk het blad met app_fit_page en app_screenshot_view. Sla niet zelf op: dat beslist de gebruiker, en het geopende sjabloon mag niet overschreven worden.\n' +
  '- Bied de gebruiker aan het overzicht als Raster-PDF te versturen (knop "Raster-PDF" op het tabblad Start): dan ziet elke lezer hetzelfde beeld. Druk die knop niet zelf in; hij opent een opslagvenster.';
