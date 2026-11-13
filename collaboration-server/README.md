# Gedeelde reviewserver — eerste stap van #1067

**Concept, niet inzetbaar als samenwerkingsdienst.** Dit pakket bevat de
geteste SQLite-kern. Er is nog geen netwerkserver, S3-opslag, Docker-image of
Tauri-netwerkadapter. De huidige gedeelde-mapfunctie blijft werken zoals voorheen.
Issue #1067 wordt door deze eerste stap niet gesloten.

## Wat nu werkt

`opds_collaboration.Store` gebruikt alleen de standaardbibliotheek van Python
3.10 of nieuwer. Iedere aanroep opent een eigen databaseverbinding. Een schrijfactie
controleert sessie en documentrechten binnen dezelfde `BEGIN IMMEDIATE`-transactie
als de wijziging. Event, actuele annotatie en documentcursor worden samen
vastgelegd of samen teruggedraaid. De SQLite-verbindingen gebruiken parameters,
foreign keys en WAL. Zie de [Python SQLite-documentatie](https://docs.python.org/3/library/sqlite3.html).

- Lokale gebruikersaanmaak; namen zijn NFC-genormaliseerd en hoofdletterongevoelig.
- Individueel gezouten PBKDF2-HMAC-SHA256-wachtwoorden (600.000 iteraties).
- Willekeurige sessietokens van 32 bytes; alleen hun SHA-256-digest wordt opgeslagen.
  Sessies verlopen na acht uur. Uitloggen en uitschakelen trekken toegang in.
- De maker is documenteigenaar en kan lees-/bewerkrechten uitdelen of intrekken.
- Een duurzaam eventlogboek met momentopname en paginering op documentrevisie.
- Een exact herhaald verzoek levert hetzelfde event op. Een gewijzigd verzoek
  met hetzelfde ID of dezelfde ID van een andere gebruiker geeft een conflict.
- Een bewerking of verwijdering noemt het actuele basisevent. Een verouderde basis
  geeft een conflict met de huidige event-ID; de bestaande annotatie blijft staan.
- Verwijderde annotaties houden een tombstone en historie. Herstellen vereist een
  expliciete bewerking gebaseerd op het verwijder-event.

De sleutelafleiding en tokenaanmaak gebruiken
[`hashlib.pbkdf2_hmac`](https://docs.python.org/3/library/hashlib.html#hashlib.pbkdf2_hmac)
en [`secrets`](https://docs.python.org/3/library/secrets.html). Dit is geen
kwalificatie van een openbare authenticatiedienst: transport, loginbegrenzing,
beheer en herstel ontbreken nog.

## Contract

Alle documentmethoden krijgen een sessietoken, nooit een door de client gekozen
gebruikers-ID. `create_user` en `set_disabled` zijn uitsluitend lokale
beheerfuncties; maak hiervan geen onbeveiligde HTTP-endpoints.

Een `append(token, document, request)` accepteert precies:

```json
{"id":"event-uuid","ann":"annotation-uuid","op":"edit","base":"previous-event-uuid","data":{"id":"annotation-uuid","type":"textbox","page":1,"text":"Revised"}}
```

`create` heeft `base: null`; `delete` heeft `data: null`. Een snapshot heeft een
passende `id`, een type en een positief paginanummer. Overige geometrie en
annotatie-eigenschappen blijven JSON-data. De kern begrenst omvang en diepte,
weigert niet-eindige getallen en onveilige JavaScript-objectkeys. De toekomstige
transportlaag moet daarnaast inkomende bytes begrenzen vóór het parsen.

De server voegt het bestaande v1-reviewenvelop toe (`uk`, `user`, `seq`, `clock`,
`at`) plus `revision`. `uk` is een onveranderlijke account-ID; `user` is de
weergavenaam. `seq` en `clock` volgen de serverrevisie, `at` is alleen een ISO-datum
voor weergave. De echte `shared-review-core.js` kan deze events al herhalen.
De bestaande maptransporten blijven ongewijzigd. Hun tolerante samenvoegbeleid
blijft bestaan; de centrale server weigert verouderde schrijfacties, zodat de
latere UI een expliciete keuze kan bieden.

`replay(..., after=cursor, limit=100)` retourneert `events`, `cursor`, `head` en
`hasMore`. Gebruik de **teruggegeven cursor**, niet `head`, voor de volgende
pagina. `snapshot` retourneert annotaties met hun actuele `base` en dezelfde
revisiecursor; `data: null` betekent verwijderd. Een netwerkadapter moet ook bij
iedere reconnect en ieder uitgaand bericht de documentrechten opnieuw toetsen.

## Testen

Vanuit `collaboration-server`:

```sh
python -m unittest discover -s tests -v
node tests/review-compatibility.mjs
```

De eerste opdracht test 17 scenario's met echte tijdelijke databases: meerdere
schrijvers, herhaalde verzoeken, herstart, paginering, rechten, verlopen sessies,
rollback bij een geïnjecteerde databasefout en ongeldige snapshots. De tweede
maakt via Python een echte reviewhistorie en speelt deze met de productiecode
van de app af, inclusief dubbele replay na herverbinden en verwijderen/herstellen.
`PYTHON` kan desgewenst een ander Python-executable aanwijzen. De bestaande
Python-CI-matrix voert beide controles op Linux, Windows en macOS uit.

## Vervolg in dezelfde concept-PR

1. Geauthenticeerde HTTP- en realtime-adapter, requestlimieten en loginbegrenzing;
   lees-/bewerkrechten blijven per aanvraag gecontroleerd.
2. S3-documentopslag met onveranderlijke documentversies; een review mag nooit
   ongemerkt op een vervangen PDF worden toegepast. Uploadfouten mogen geen
   bruikbare documentreferentie achterlaten.
3. Docker-deployment, configuratie, lokaal accountbeheer en herstel/backup.
4. Tauri-adapter met reconnect, zichtbare conflicten en import/export via het
   bestaande PDF-/XFDF-model; twee echte clients testen op één document.
5. Installerbouw en integratietests. Pas daarna is #1067 gereed voor oplevering.

Databasebestanden en sessietokens horen niet in Git of logregels. Deze eerste
stap start geen listener, wijzigt geen gebruikersdocumenten en maakt geen
netwerkverbindingen met opslagdiensten.
