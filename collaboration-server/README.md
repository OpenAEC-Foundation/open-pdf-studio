# Gedeelde reviewserver — werk in uitvoering voor #1067

**Concept, niet inzetbaar als samenwerkingsdienst.** Dit pakket bevat de
SQLite-kern en een geteste WSGI-adapter voor HTTP en live eventupdates.
S3-opslag, productie-deployment, Docker-image en Tauri-netwerkadapter ontbreken nog. De huidige gedeelde-mapfunctie blijft werken zoals voorheen.
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
kwalificatie van een openbare authenticatiedienst: deployment,
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
weigert niet-eindige getallen en onveilige JavaScript-objectkeys. De HTTP-adapter begrenst daarnaast inkomende bytes vóór het parsen.

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
revisiecursor; `data: null` betekent verwijderd. De HTTP-adapter toetst bij iedere aanvraag en iedere poll opnieuw sessie en
documentrechten in een verse transactie.

## HTTP en live updates

`opds_collaboration.http.Application(Store(databasepad))` is een
[WSGI-callable](https://peps.python.org/pep-3333/). Alle antwoorden zijn JSON en
hebben `Cache-Control: no-store`. Schrijfverzoeken vereisen `Content-Type:
application/json` en een geldige `Content-Length` van maximaal 1 MiB. Dubbele
JSON-keys, ongeldige UTF-8, niet-eindige JSON-constanten en onverwachte velden
worden geweigerd. Geen cookies of tokens in queryparameters; documentroutes
vereisen `Authorization: Bearer <token>`. Cross-originverzoeken worden geweigerd.

| Methode en pad | Verzoek / antwoord |
| --- | --- |
| `POST /v1/login` | `{name,password}` → `{token}` |
| `POST /v1/logout` | `{}` → `{ok:true}` |
| `POST /v1/documents` | `{title}` → `{id}`; alleen reviewidentiteit, nog geen PDF |
| `GET /v1/documents/{id}` | Snapshot met cursor en annotaties/tombstones |
| `POST /v1/documents/{id}/members` | `{userId,role}`; eigenaar, rol `reader`, `editor` of `null` |
| `POST /v1/documents/{id}/events` | Bovenstaand eventverzoek → opgeslagen event |
| `GET /v1/documents/{id}/events` | `after=0`, `limit=100`, `wait=0`; gepagineerde events |

`wait` is een geheel aantal seconden van 0 t/m 25. Bij een lege pagina wacht de
server maximaal die tijd en controleert standaard iedere 250 ms opnieuw.
Een wijziging vanuit een andere databaseverbinding wordt zo ook zichtbaar.
Sessieverloop, uitloggen, uitschakelen of ingetrokken documentrechten beëindigen
het wachten met een weigering. Er blijft geen SQLite-transactie open tijdens het
wachten. Maximaal 32 wachtende aanvragen per applicatie-instantie; daarna `503`.
Een timeout retourneert een lege pagina met dezelfde cursor. Vraag daarna opnieuw
met de teruggegeven cursor; een gebroken verbinding verliest geen opgeslagen event.
Een verbroken client kan zijn pollslot nog tot de deadline bezet houden.

Fouten: `400` ongeldige data/cursor, `401` ontbrekende authenticatie of onjuiste
login, `403` geweigerde sessie/rechten/origin, `409` conflict met huidige event-ID,
`411` ontbrekende/ongeldige lengte, `413` te groot, `415` ongeldig formaat,
`429` loginlimiet en `503` opslag/pollcapaciteit niet beschikbaar. `429` en `503`
bevatten `Retry-After`. Interne exceptions geven geen paden, SQL of tokens terug.

De loginlimiet telt maximaal tien pogingen per minuut per IP én per genormaliseerde
accountnaam, inclusief geslaagde pogingen. Alleen `REMOTE_ADDR` wordt vertrouwd;
forwardingheaders worden genegeerd. De limiter houdt maximaal 10.000 gehashte
sleutels bij en weigert nieuwe pogingen bij een volle tabel. Deze grenzen zijn
**per proces**; een productie-deployment met meerdere workers moet een gedeelde
limiet of een limiter bij de ingang toevoegen. Achter een proxy delen clients
voorlopig het IP-budget van die proxy. Accountgerichte limieten kunnen tijdelijk
ook een legitieme login vertragen.

Er wordt nog geen productieserver geleverd. TLS, socket-/requesttimeouts,
thread-/verbindingslimieten, logging zonder credentials en gedeelde rate limits
horen bij de komende deploymentstap. Long polling heeft meerdere requestthreads
nodig; een enkele synchrone worker blokkeert schrijvers tijdens het wachten.
Snapshotomvang en eventopslag hebben nog geen documentquota; dit is eveneens
werk voor deploymentkwalificatie. De loopback-tests gebruiken uitsluitend
[`wsgiref`](https://docs.python.org/3/library/wsgiref.html), dat Python expliciet
niet voor productie aanbeveelt.

## Testen

Vanuit `collaboration-server`:

```sh
python -m unittest discover -s tests -v
node tests/review-compatibility.mjs
```

De eerste opdracht test 27 scenario's met echte tijdelijke databases: meerdere
schrijvers, herhaalde verzoeken, herstart, paginering, rechten, verlopen sessies,
rollback bij een geïnjecteerde databasefout en ongeldige snapshots. Twee echte
HTTP-clients testen live updates, conflicten, reconnect, rechtenintrekking en
sessieverloop tijdens een poll. WSGI-validatie en grensgevallen testen JSON,
verzoeklengte, loginlimieten en pollcapaciteit. De tweede
maakt via Python een echte reviewhistorie en speelt deze met de productiecode
van de app af, inclusief dubbele replay na herverbinden en verwijderen/herstellen.
`PYTHON` kan desgewenst een ander Python-executable aanwijzen. De bestaande
Python-CI-matrix voert beide controles op Linux, Windows en macOS uit.

## Vervolg in dezelfde concept-PR

1. S3-documentopslag met onveranderlijke documentversies; een review mag nooit
   ongemerkt op een vervangen PDF worden toegepast. Uploadfouten mogen geen
   bruikbare documentreferentie achterlaten.
2. Docker-deployment, configuratie, lokaal accountbeheer en herstel/backup.
3. Tauri-adapter met reconnect, zichtbare conflicten en import/export via het
   bestaande PDF-/XFDF-model; twee echte clients testen op één document.
4. Installerbouw en integratietests. Pas daarna is #1067 gereed voor oplevering.

Databasebestanden en sessietokens horen niet in Git of logregels. Deze eerste
stap start geen listener, wijzigt geen gebruikersdocumenten en maakt geen
netwerkverbindingen met opslagdiensten.
