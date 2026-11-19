# Annotatiedatums bij opslaan (#1189)

Een nieuwe oppervlaktemeting kreeg in `/M` een ISO-tekenreeks zoals
`2026-11-19T12:13:14.000Z`. PDF verwacht daar een PDF-datum, bijvoorbeeld
`D:20261119121314Z`. De datumparser van PDF.js gaf voor de ISO-tekenreeks
`null` terug; een externe lezer kon daardoor 1 januari 1970 tonen.
Ook ontbrak `/CreationDate` bij de meeste nieuwe annotaties.

Alle 28 betreffende opslagpaden gebruiken nu de bestaande PDF-datumhelper,
met `modifiedAt` uit het model en de huidige tijd als terugval bij een
ontbrekende of ongeldige waarde. Nieuwe annotaties bewaren hun geldige
`createdAt` in `/CreationDate`. Geïmporteerde annotaties blijven via het
bestaande bronbehoud hun oorspronkelijke aanmaakdatum, tijdzone en precisie
houden. Ongewijzigde bestaande PDF-objecten worden niet preventief herschreven;
al opgeslagen ongeldige datums worden dus niet automatisch gerepareerd.

## Controle

`node --test js/pdf/annotatie-datums-rondgang.test.mjs`

De proef gebruikt de echte saver, PDF.js-datumparser en annotatielader.
Een oppervlaktemeting, rechthoek en notitie houden aanmaak- en wijzigingstijd
na opslaan, heropenen en opnieuw opslaan. Verder worden ongeldige of ontbrekende
wijzigingsdatums en modeldatums met een tijdzone gecontroleerd. Op de oude
code falen de drie rondgangtests doordat PDF.js `/M` niet als datum herkent.

`node --test js/pdf/rondgang-alle-soorten.test.mjs`

Deze bestaande proeven controleren het behoud van alle geïmporteerde
annotatiesleutels, ook na verplaatsen en herschrijven. De tests vervangen geen
handmatige controle in elke externe PDF-lezer.

`node scripts/test-annotation-dates-browser.mjs`

De browserproef maakt een oppervlaktemeting via de echte factory, downloadt
het PDF met Opslaan en Opslaan als, opent het downloadbestand opnieuw en
slaat het nogmaals op. De originele modeldatums blijven in alle drie de
bestanden als geldige PDF-datums aanwezig. Deze proef draait ook in Linux-CI.
