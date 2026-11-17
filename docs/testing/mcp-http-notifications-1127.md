# HTTP MCP-notificaties (#1127)

Een strikte MCP-client verbreekt de initialisatie doordat de HTTP-handler op
`notifications/initialized` antwoordt met HTTP 200 en een JSON-RPC-resultaat
met `id: null`. De stdio-brug verbergt dit probleem doordat die antwoorden op
notificaties weglaat.

De handler retourneert na de bestaande dispatch HTTP 202 zonder inhoud wanneer
de `id`-eigenschap ontbreekt. Dit geldt ook voor onbekende notificatiemethoden.
Een expliciete `id`, inclusief `0`, een lege string of `null`, behoudt het bestaande
JSON-antwoord. De annulering van extensieopdrachten blijft vóór deze keuze staan;
de toegangscontrole blijft vóór de dispatch staan.

Dit volgt de [MCP Streamable HTTP-specificatie](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#sending-messages-to-the-server).
Deze wijziging voegt geen SSE, sessiebeheer of nieuwe protocolversie toe.

## Regressietests

```sh
cargo +1.99.1 test --locked -p open-pdf-studio --lib mcp_server::http_notification_tests
```

De tests starten de echte Axum-handler op een vrije loopbackpoort en controleren:

- `initialize` → lege 202 voor `notifications/initialized` → werkende `tools/list`;
- initialisatie, annulering, voortgang en onbekende notificaties zonder antwoordbody;
- resultaten en fouten met expliciete request-ID's;
- geweigerde Host/Origin en ongeldige bearer-authenticatie, plus geldige beheerderstoegang;
- ontbrekende/ongeldige methoden en ongeldige JSON worden geen geaccepteerde notificatie.

De CI voert deze tests uit na de Linux-appbuild. De tests gebruiken geen vensters,
gebruikersbestanden of echte extensieopdrachten. Een echte Windows-installatie en
een sessie met Codex CLI blijven aanvullende integratiecontroles.
