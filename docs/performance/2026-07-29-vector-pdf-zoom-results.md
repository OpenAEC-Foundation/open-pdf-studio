# Vector-PDF-zoomonderzoek — 29 juli 2026

## Scope

Onderzocht op branch `codex/research-improvement-vector` met verse
app-processen en de live MCP-interface:

- `MV-03_Mechanische ventilatie, 3e verdieping ontwerp ACH van 1,5 naar 2,0.pdf`,
  pagina 1;
- `NKD1a_opm_aw.pdf`, pagina 2.

Elke geldige run gebruikt de reeks 100%, 150%, 200% en 300%, controleert de
zichtbare screenshot en meet app- en worker-RSS. Een run telt niet mee als een
zoomstap time-out, als een screenshot ontbreekt of als alle zoomscreenshots
hetzelfde beeld bevatten.

De ruwe JSON-resultaten en PNG's staan buiten de repository in:

`C:\Users\rickd\Documents\GitHub\verification-files\performance\vector-zoom-baseline`

## Nulmeting

### MV-03

Vijf verse processen:

- slechts 1 van 5 zoomreeksen volledig geldig;
- 200% liep in 4 van 5 runs langer dan 120 seconden vast;
- enige geldige zoomreeks: 12.991 ms;
- 150% mediaan: 3.004 ms;
- 200% enige geslaagde meting: 9.043 ms;
- 300% mediaan: 1.214 ms;
- worker-RSS mediaan: circa 5.159 MB;
- `app_open_pdf` mediaan: 14.738 ms.

De console liet vier gelijktijdige scene-extracties voor dezelfde pagina zien.
Alle vier overschreden hetzelfde 128 MB-commandobudget en vielen daarna terug
op vier afzonderlijke PDFium-workers. Elke worker hield ongeveer 1,29 GB vast.

### NKD1a pagina 2

Vijf verse processen, alle vijf geldig:

- zoomreeks mediaan: 5.194 ms;
- p95: 7.943 ms;
- 150% mediaan: 1.085 ms;
- 200% mediaan: 2.869 ms;
- 300% mediaan: 1.118 ms;
- worker-RSS tijdens zoom: circa 239–265 MB.

## Fase 1 — één scene-probe per pagina

Commit: `a3f619f4`

Gelijktijdige tegels delen nu de eerste scene-probe. Bij een bekende
extractiefout slaan de overige tegels dezelfde kostbare probe over.

Vijf verse openmetingen:

- vóór: 14.252 / 14.380 / 14.738 / 14.819 / 16.472 ms;
- na: 6.161 / 6.375 / 6.642 / 6.656 / 6.692 ms;
- mediaan: 14.738 → 6.642 ms, 54,9% lagere `app_open_pdf`-latency;
- scene-fallbacks per pagina: 4 → 1.

Deze callback-latency is niet hetzelfde als volledig zichtbare cold-ready-tijd.
De definitieve benchmark wacht daarom vanaf fase 2 expliciet op `[prog] klaar`.

## Fase 2 — extreme PDFium-fallback op één affinity-worker

Commit: `bad13f56`

Als een pagina boven de scene-drempel wordt afgewezen, gaan de PDFium-tegels
niet meer naar vier processen die elk de volledige extreme content-stream
parsen. Ze blijven op één affinity-worker. Gematigde pagina's, waaronder
NKD1a, behouden het bestaande parallelle `spread: true`-pad.

Vijf verse MV-03-runs na volledige cold-ready:

| Metriek | Resultaat |
|---|---:|
| Geldige zoomreeksen | 5/5 |
| Volledig zichtbare cold-ready mediaan | 14.549 ms |
| Zoomreeks mediaan | 6.075 ms |
| Zoomreeks p95 | 6.117 ms |
| 150% mediaan | 1.666 ms |
| 200% mediaan | 1.621 ms |
| 300% mediaan | 2.749 ms |
| Worker-RSS mediaan | 1.321,8 MB |

Ten opzichte van de nulmeting:

- geldige reeksen: 1/5 → 5/5;
- zoomreeks: 12.991 → 6.075 ms, 53,2% sneller dan de enige geldige
  nulmeting;
- 200%: 9.043 → 1.621 ms, 82,1% sneller, zonder time-outs;
- worker-RSS: 5.159 → 1.321,8 MB, 74,4% lager;
- volledig zichtbare cold-ready blijft rond 14,5 seconden.

## NKD1a-regressiecontrole

Met dezelfde verbeterde benchmark zijn control en fase 2 apart gemeten.
Door een prewarm-race verschuift tijd tussen `initialReadyMs` en de eerste
zoomstap. Daarom is ook het volledige interval ready+zoom vergeleken:

- control ready+zoom mediaan: 7.898 ms;
- fase 2 ready+zoom mediaan: 7.712 ms;
- verschil: 2,4% sneller binnen normale meetspreiding;
- geen time-outs of gelijke/lege screenshots;
- het NKD1a-workerpad blijft ongewijzigd en verspreid.

Conclusie: geen aantoonbare NKD1a-regressie.

## Besluit en volgende geïsoleerde hypothese

Beide wijzigingen blijven behouden: ze leveren meetbare winst op en de
regressietests blijven groen.

De eerstvolgende kandidaat is uitsluitend de 300%-prewarm van extreme
fallbackpagina's. Na het pinnen is 300% langzamer geworden, terwijl 150%,
200%, stabiliteit en geheugen sterk verbeterden. Een vervolgwijziging moet:

1. de 300%-mediaan verlagen zonder worker-RSS opnieuw te vermenigvuldigen;
2. 150%, 200% en cold-ready niet vertragen;
3. opnieuw vijf verse MV-03-runs en een NKD1a-control doorstaan;
4. worden verwijderd als die meetbare winst uitblijft.
