# Evaluatie incrementeel opslaan (#679)

## Besluit

Niet standaard inschakelen. Het bestaande pdf-lib-model wijzigt meer dan alleen
annotaties; een tweede schrijver mag die wijzigingen niet stil verliezen.
`node --test scripts/experiments/incremental-save.test.mjs` draait een geïsoleerd
prototype met de reeds aanwezige MuPDF-WASM-versie. Het prototype wordt niet
geïmporteerd door de app en schrijft geen bestanden.

## Ondersteunde proef

Een nieuwe tekstnotitie toevoegen aan een bestaand, niet-versleuteld PDF-bestand,
maximaal 32 MiB en 100.000 objecten. De grens is uitsluitend voor deze proef;
het normale openen/opslaan krijgt geen nieuwe bestandslimiet. Elke proef krijgt
een eigen document, geen appcache. De uitvoer bevat aantoonbaar exact de
originele prefix. Zowel klassieke xrefs als objectstreams en twee opeenvolgende
revisies worden met PDF.js én pdf-lib heropend. De scanner weigert ook
handtekeningvelden in gecomprimeerde objecten. De test toont geen algemene
handtekeningvalidatie aan.

| Bewerking | Besluit |
| --- | --- |
| Nieuwe notitie, onveranderde pagina's | Werkend proefpad; alleen bytes als resultaat |
| Bestaande annotatie/formulierwaarde wijzigen | Vervolg: eigenaarschap, appearances en veldhiërarchie eerst kwalificeren |
| Pagina verplaatsen/verwijderen, lagen, tekstedit | Bestaande volledige schrijver behouden |
| Redactie, verborgen informatie verwijderen | Volledige herschrijving en controle; oude revisies mogen niet behouden blijven |
| Versleuteld, ondertekend/gecertificeerd of hersteld document | Prototype weigert; geen impliciete conversie |
| Grote of diep geneste input | Prototype weigert; geen claim op totale parsergeheugenlimiet |

## Voorwaarden voor eventuele integratie

De save-coördinator moet eerst een stabiele snapshot vastleggen van document-id,
revisie en oorspronkelijke bytes. Pas na verificatie en conflictcontrole mag hij
atomisch publiceren. Daarna moeten bytecache, PDF.js-proxy en rendercache samen
naar dezelfde revisie overgaan; undo blijft bij de app. Het prototype doet dit
niet en is daarom geen alternatief save-commando in UI/API/MCP.

De volledige serializer kan een incrementeel resultaat later herschrijven. Er
mag geen automatische wisseling tussen beide schrijfmodellen komen zonder een
capabilitymatrix voor de complete wijzigingsset. Behoud van een ondertekende
byteprefix garandeert niet dat latere wijzigingen toegestaan zijn.

## Reproduceerbare meting

`node scripts/experiments/benchmark-incremental.mjs` meet vijf herhalingen op een
synthetisch document van 100 pagina's. Het rapporteert mediaan, invoer/uitvoerbytes
en procespiek-RSS. Dit is een rookmeting, geen representatief bouwtekeningcorpus;
piek-RSS omvat beide runs en de WASM-runtime, dus is geen per-backend vergelijking.
Voor productinschakeling zijn echte grote tekeningen, bestaande handtekeningen,
verschillende viewers en de save/undo/cache-rondgang nog vereist.
