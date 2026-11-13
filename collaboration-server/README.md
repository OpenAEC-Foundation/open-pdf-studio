# Gedeelde reviewserver — werk in uitvoering voor #1067

**Concept, niet inzetbaar als samenwerkingsdienst.** Dit pakket bevat de
SQLite-kern, WSGI-adapter voor HTTP/live eventupdates en S3-opslagadapter voor
onveranderlijke PDF-bases. Een Waitress-startcommando, lokaal accountbeheer, databaseback-up en
Docker/Compose-configuratie zijn aanwezig. Kwalificatie tegen een echte objectstore,
volledige deploymentkwalificatie en Tauri-netwerkadapter ontbreken nog. De huidige gedeelde-mapfunctie blijft werken zoals voorheen.
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
kwalificatie van een openbare authenticatiedienst: volledige deployment- en
herstelkwalificatie ontbreken nog.

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
[WSGI-callable](https://peps.python.org/pep-3333/). Antwoorden zijn JSON, behalve
de PDF-download; alle antwoorden hebben `Cache-Control: no-store`. JSON-
schrijfverzoeken vereisen `Content-Type:
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
| `PUT /v1/documents/{id}/pdf` | PDF-bytes, eigenaar; maximaal 32 MiB → `{sha256,size}` |
| `GET /v1/documents/{id}/pdf` | Ongewijzigde PDF-bytes als download; lezer/bewerker/eigenaar |

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

Het startcommando gebruikt [Waitress](https://docs.pylonsproject.org/projects/waitress/en/latest/arguments.html)
met standaard zestien requestthreads, acht pollslots, 64 verbindingen, een
32 MiB-bodylimiet en een 16 KiB-headerlimiet. Inactieve kanalen sluiten na
60 seconden; dit is geen absolute deadline voor een langzame actieve client.
Minimaal vier threads blijven buiten long polling beschikbaar. De proxy moet
TLS, totale requestdeadlines en eventueel gedeelde rate limits verzorgen.
Snapshotomvang en eventopslag hebben nog geen documentquota. De eerdere
loopbacktests gebruiken `wsgiref`; de runtime-smoketest start daarnaast een echt
Waitress-proces. Volledige productiekwalificatie is nog niet afgerond.

## Onveranderlijke PDF-opslag

Een review kan één PDF-basis krijgen, uitsluitend voordat er annotatie-events
zijn. Een andere PDF krijgt een nieuwe reviewidentiteit; bestaande annotaties
worden daardoor niet stilzwijgend op andere pagina's toegepast. Een identieke
herhaalde upload geeft dezelfde publieke metadata terug; een andere inhoud geeft
`409`. Bucketnamen, objectsleutels en interne versie-ID's blijven serverintern.

De S3-adapter gebruikt de [Boto3 PutObject-API](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/put_object.html):
een willekeurige nieuwe objectsleutel per poging, `IfNoneMatch="*"` en een
SHA-256-uploadchecksum. Er is geen fallback naar overschrijven. Na een geslaagde
upload legt SQLite de digest, lengte, bucket, sleutel, ETag en eventuele S3-versie
vast. De schrijftransactie controleert opnieuw eigenaar/sessie, bestaande binding
en afwezigheid van events. Dit geldt ook wanneer iemand tijdens de upload begint
te annoteren of de eigenaar uitlogt. Schema 1 wordt atomair naar schema 2 uitgebreid
met `document_files`; accounts en reviewhistorie blijven behouden.

Downloads gebruiken [GetObject](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/get_object.html)
met de vastgelegde versie (indien aanwezig) en `IfMatch` op ETag. De adapter
controleert lengte én SHA-256 vóór er bytes naar de client gaan, sluit de stream
ook bij fouten en controleert sessie/documenttoegang opnieuw na de overdracht.
Een verdwenen, gewijzigde of beschadigde S3-basis geeft `503`; een review zonder
PDF geeft `404`. Bucketbeheer buiten deze dienst kan objecten nog steeds wijzigen
of verwijderen: de adapter merkt dat op, maar is geen vervanging voor backup of
opslagretentie.

Uploads vereisen `Content-Type: application/pdf` en een geldige `Content-Length`.
De 32 MiB-grens wordt vóór het inlezen gecontroleerd, evenals de eigenaarsrechten.
De controle op `%PDF-` is alleen formaatherkenning; de app moet de PDF nog parsen.
Uploads en downloads worden momenteel geheel in geheugen gehouden. Een deployment
moet daarom ook het aantal gelijktijdige overdrachten begrenzen. Grotere PDF's,
streaming/spooling en hervatten van uploads zijn nog niet geïmplementeerd.

SQLite en S3 hebben geen gezamenlijke transactie. Een mislukte of gelijktijdige
upload kan daarom een **ongekoppeld object** achterlaten, maar geen bruikbare
binding naar een mislukte upload. Er wordt nooit automatisch verwijderd bij een
onzekere SQL-commit. Herstel, backup en veilige vergelijking/opruiming van deze
ongekoppelde objecten moeten in de deploymentstap worden uitgewerkt.

De applicatie kan via dependency injection worden samengesteld:

```python
import boto3
from botocore.config import Config
from opds_collaboration import Store
from opds_collaboration.files import Documents, S3Files
from opds_collaboration.http import Application

store = Store(databasepad)
s3 = boto3.client("s3", endpoint_url=s3_endpoint, region_name=s3_region,
    config=Config(connect_timeout=5, read_timeout=30,
                  retries={"mode": "standard", "total_max_attempts": 3},
                  s3={"addressing_style": "path"}))
app = Application(store, files=Documents(store, S3Files(s3, bucketnaam)))
```

Het onderstaande startcommando vult deze variabelen uit de operatorconfiguratie; credentials komen
uit de normale SDK-providerketen, nooit uit HTTP-verzoeken. Gebruik een private
bucket en beperk opslagrechten tot de toegewezen prefix. De adapter maakt geen
bucket aan, wijzigt geen policies en levert geen publieke/presigned URL's. Zonder
`files`-adapter geven PDF-endpoints `503`. Dit voorbeeld start geen server.

## Starten en lokaal beheer

Installeer Python 3.10+ en de vastgezette dependencies in een eigen virtuele
omgeving. Vanuit `collaboration-server`:

```sh
python -m pip install -r requirements.txt
python -m opds_collaboration --database review.db create-user Alice
python -m opds_collaboration --database review.db list-users
```

`create-user` vraagt het wachtwoord tweemaal via een terminal en schrijft alleen
de nieuwe account-ID naar stdout. Gebruik bij automatisering `--password-stdin`
en lever één regel via een beschermd invoerkanaal; er bestaat geen wachtwoordoptie
voor de commandoregel. Beheer is uitsluitend lokaal, nooit via een HTTP-endpoint.

```sh
python -m opds_collaboration --database review.db disable-user ACCOUNT_ID
python -m opds_collaboration --database review.db enable-user ACCOUNT_ID
python -m opds_collaboration --database review.db set-password ACCOUNT_ID
python -m opds_collaboration --database review.db backup review-2026-11-13.backup
```

Uitschakelen en wachtwoordherstel maken bestaande sessies ongeldig. Opnieuw
inschakelen herstelt oude sessies niet. De backupopdracht gebruikt de SQLite
backup-API, inclusief gecommitteerde WAL-data, en weigert een bestaand doelbestand.
De backup bevat accounts, sessies, annotaties en S3-verwijzingen, **geen PDF-objecten**.
Stop voor een gezamenlijk herstelpunt de reviewserver, maak de databaseback-up en
bewaar de bijbehorende S3-objectversies via de backupvoorziening van de objectstore.
Een databasekopie alleen is geen volledige backup. Zet voor herstel de kopie in
een nieuwe database/volume, gebruik dezelfde bucket/objectversies en test eerst
login, historie en downloads; draai niet twee servers tegen dezelfde SQLite-map.
Ongewenste herstelde sessies kunnen via wachtwoordherstel worden ingetrokken.

Voor `serve` zijn een bestaande private S3-bucket en SDK-credentials nodig. Er
worden geen bucket, opslagaccounts of policies automatisch aangemaakt. Configuratie:

| Variabele | Standaard / betekenis |
| --- | --- |
| `OPDS_DATABASE` | `review.db`; schrijfbare SQLite-locatie |
| `OPDS_S3_BUCKET` | Verplicht; bestaande private bucket |
| `OPDS_S3_ENDPOINT` | Optioneel; normale AWS-endpointkeuze indien leeg, anders HTTP(S)-origin zonder credentials/pad/query |
| `OPDS_S3_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Normale SDK-providerketen; tijdelijke credentials worden ondersteund |
| `OPDS_HOST`, `OPDS_PORT` | `127.0.0.1`, `8080` |
| `OPDS_THREADS`, `OPDS_MAX_WAITERS` | `16`, `8`; minstens vier threads buiten polls |

```sh
python -m opds_collaboration serve
```

Dit is één proces. Gebruik geen workerprocessen met onafhankelijke loginlimieten
voor een openbare installatie zonder aanvullende centrale limiter. Forwarded-
headers worden niet vertrouwd: achter een proxy delen clients het proxy-IP-budget.
Controleer de TCP-/TLS- en opslagrechten vóór externe bereikbaarheid.

## Docker met bestaande S3-opslag

De image draait als UID/GID `10001`, gebruikt `/data/review.db` en bewaart geen
credentials in de image. Compose publiceert alleen op host-loopback en gebruikt
een persistent volume, een read-only rootfilesystem en een begrensde tijdelijke
map. S3 wordt bewust extern geconfigureerd: dit pakket levert nog geen gebundelde,
gekwalificeerde objectstore-installatie. Een endpoint op `localhost` vanuit de
container verwijst naar die container; gebruik de bereikbare DNS-naam van de S3-dienst.

```sh
cp .env.example .env
# Vul in .env de private bucket, endpoint, regio en beperkte SDK-credentials in.
# Beperk toegang tot dit bestand; het wordt door Git en Docker-build uitgesloten.
docker compose build
docker compose run --rm review create-user Alice
docker compose up -d
docker compose exec review python -m opds_collaboration list-users
```

De reverse proxy verzorgt HTTPS voor externe clients. HTTP naar een objectstore is
alleen bedoeld binnen een door de beheerder vertrouwd netwerk. Geef de dienst
uitsluitend de benodigde PUT/GET/GetObjectVersion-rechten op de reviewprefix;
objectverwijdering en bucketbeheer zijn niet nodig. Bij een bind mount moet de
beheerder de datamap schrijfbaar maken voor UID/GID 10001; verander hiervoor geen
bestaande gebruikersdocumentmappen. Sla een backup op onder `/data` en kopieer hem
vervolgens naar de beheerde backupbestemming.

CI bouwt de image lokaal en test twee HTTP-clients, persistentie na herstart,
accountbeheer en backup als niet-root. De CI-test publiceert geen image en gebruikt
geen externe S3-service; echte objectstore- en PDF-roundtripkwalificatie blijven open.

## Testen

Vanuit `collaboration-server`:

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
node tests/review-compatibility.mjs
```

De unittest-opdracht test 51 scenario's met echte tijdelijke databases: meerdere
schrijvers, herhaalde verzoeken, herstart, paginering, rechten, verlopen sessies,
rollback bij een geïnjecteerde databasefout en ongeldige snapshots. Twee echte
HTTP-clients testen live updates, conflicten, reconnect, rechtenintrekking en
sessieverloop tijdens een poll. WSGI-validatie en grensgevallen testen JSON,
verzoeklengte, loginlimieten en pollcapaciteit. Opslagtests toetsen migratie,
herhaalde/gelijktijdige uploads, races met annotaties/toegangsintrekking en
mislukte S3-/SQL-acties. SDK-contracttests gebruiken
[Botocore Stubber](https://docs.aws.amazon.com/botocore/latest/reference/stubber.html)
met expliciete nepcredentials; echte S3/MinIO-kwalificatie is nog niet uitgevoerd.
De Node-opdracht
maakt via Python een echte reviewhistorie en speelt deze met de productiecode
van de app af, inclusief dubbele replay na herverbinden en verwijderen/herstellen.
`PYTHON` kan desgewenst een ander Python-executable aanwijzen. De bestaande
Python-CI-matrix voert beide controles op Linux, Windows en macOS uit.

## Vervolg in dezelfde concept-PR

1. S3-adapter tegen een echte objectstore kwalificeren, inclusief checksums,
   conditional writes, versies en ongekoppelde objecten; gezamenlijke hersteltest,
   totale requestdeadlines, quota en productiebelasting kwalificeren.
2. Tauri-adapter met reconnect, zichtbare conflicten en import/export via het
   bestaande PDF-/XFDF-model; twee echte clients testen op één document.
3. Installerbouw en integratietests. Pas daarna is #1067 gereed voor oplevering.

Databasebestanden en sessietokens horen niet in Git of logregels. Het expliciete `serve`-commando start de listener. Alleen beheercommando's en
verzoeken van aangemelde clients veranderen de reviewdatabase/opslag; er wordt
geen bestaande gebruikersdocumentmap geïmporteerd.
