# Parametrische symbolen kiezen (#1167)

Het kiesvenster gaf altijd `template.name` (Nederlands) vet weer, met
`nameEn` als kleine tweede regel. De bestaande browserproef faalt op main
met `Deur !== Door` terwijl Engels actief is.

De hoofdnaam volgt nu de taalkeuze: Nederlands gebruikt de Nederlandse
naam, andere talen de beschikbare Engelse naam. Dit is een Engelse
terugval, geen nieuwe vertaling van de symbolencatalogus naar alle talen.
Een eigen template met slechts één naam houdt die naam. Symbool-ID's,
standaardparameters en plaatsing blijven dezelfde.

Elke tegel toont een PNG-miniatuur via de bestaande symboolrenderer, met
de standaardparameters en verhoudingen van het template. De renderer is
ook de uitvoerroute voor opgeslagen symbolen; er worden geen externe
plaatjes opgehaald. Vloeren met uitgesteld geladen geometrie kunnen hun
bestaande vereenvoudigde weergave tonen. De miniatuur is een herkenningshulp,
geen maatvaste uitvoer of voorvertoning van persoonlijke parameterdefaults.

`node scripts/test-parametric-picker-browser.mjs` opent de echte interface
in Chromium en controleert Engelse/Nederlandse namen, taalwisseling terwijl
het venster open is, Engelse terugval voor Duits, eigen namen zonder
Engelse metadata, niet-lege verschillende miniaturen en selectie van het
ongewijzigde symbool-ID. De Linux-CI voert dezelfde proef uit. Met
`PICKER_SCREENSHOT=/absoluut/pad.png` wordt een beeld van het venster bewaard.
De browserproef vervangt geen kwalificatie van een geïnstalleerde Tauri-app.
