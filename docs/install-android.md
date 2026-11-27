# Android installeren en bijwerken

Deze handleiding beschrijft de overgang tussen Android-installaties met verschillende ondertekeningssleutels. De migratie op een Android-testinstallatie is **nog niet geverifieerd**. Bewaar de bestaande installatie zolang je belangrijke gegevens niet buiten de app hebt kunnen opslaan en controleren.

## Welke versie gebruikt welke sleutel?

Historische APKs gebruikten verschillende sleutels. Het [onderzoek bij #601](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/601#issuecomment-6505926062) meldt verschillende certificaten voor v2026.44.0, v2026.44.1 en v2026.44.2.

De [releasevermelding voor v2026.48.28](https://github.com/OpenAEC-Foundation/open-pdf-studio/releases/tag/v2026.48.28), met overgangsbericht van 25 november 2026, meldt een permanente sleutel en deze certificaatvingerafdruk (SHA-256):

```text
260f1ce47cb7f6313481d8e57c5e02702b1c5d0196d05b584f56acbed7430bbe
```

Dit is de gepubliceerde melding, geen onafhankelijke controle van de APK. De eerste release die deze sleutel daadwerkelijk gebruikt en de compatibiliteit van afzonderlijke oude/nieuwe APK-paren moeten nog worden vastgesteld. Leid die grens niet alleen af uit een versienummer of de datum van het bericht. De vaste sleutel is bedoeld voor toekomstige compatibele updates; dit betekent niet dat iedere toekomstige update opnieuw verwijderen vereist.

## Behoud documenten voordat je de installatie vervangt

1. Je kunt de bestaande app voorlopig blijven gebruiken. Een overgang naar een andere sleutel verplicht je niet direct bij te werken.
2. Sla alle belangrijke PDFs, inclusief de gewenste annotaties en formulierwijzigingen, op als afzonderlijke kopieën **buiten app-specifieke opslag**. Kies een locatie die je onafhankelijk van de app kunt openen, bijvoorbeeld een door jou gekozen documentenmap of een computer. Controleer de werkelijke locatie; een recent-bestandenlijst is geen back-up.
3. Bewaar ook benodigde app-gegevens en instellingen voor zover de app daarvoor exportmogelijkheden biedt. Deze handleiding belooft geen volledige export of automatisch herstel van app-gegevens. Kun je benodigde gegevens niet exporteren, behoud dan de installatie.
4. Open de kopieën vanuit de externe locatie in een andere PDF-lezer of op een ander apparaat. Controleer de pagina's, annotaties en ingevulde velden. Alleen een succesvolle opslagmelding is onvoldoende bewijs.
5. **Stop als opslaan, exporteren of opnieuw openen niet lukt.** Het afzonderlijke [Android-opslagrapport #1260](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/1260) moet tijdens kwalificatie zichtbaar blijven. Verwijderen is geen oplossing voor een mislukte export. Bewaar de installatie en leg de gebruikte app-versie en het opslagprobleem vast.
6. Probeer een compatibele APK als gewone handmatige update te installeren zonder de bestaande app te verwijderen. Een weigering door Android bewijst op zichzelf geen sleutelverschil; laat de APK-identiteit en foutmelding controleren.
7. Alleen wanneer een sleutelverschil is bevestigd en opnieuw installeren onvermijdelijk is, mag verwijderen onderdeel van de overgang zijn, **nadat alle benodigde externe kopieën zijn gecontroleerd**. Verwijderen wist app-specifieke gegevens en instellingen. Installeer daarna de bedoelde APK en open de gecontroleerde externe kopieën. Controleer opnieuw of de benodigde inhoud aanwezig is.

Een permanente ondertekeningssleutel voegt geen automatische updater toe. Android-updates blijven handmatige APK-installaties. Een gelijke sleutel alleen garandeert niet dat ieder APK-paar door Android als update wordt geaccepteerd.

## Openstaande kwalificatie

Voer deze controle uitsluitend uit met wegwerpdocumenten op een afzonderlijke testinstallatie. Geen bestaande gebruikersinstallatie verwijderen om deze handleiding te testen.

| Controle | Vast te leggen bewijs | Huidige status |
| --- | --- | --- |
| Overgangsgrens | Oude en nieuwe versies, APK-bestandshashes, pakket-ID en versiecode | Niet onafhankelijk gecontroleerd |
| Certificaten | APK-verificatie en SHA-256 van beide ondertekeningscertificaten; vergelijking met de releasevermelding | Niet onafhankelijk gecontroleerd |
| Normale update | Resultaat zonder verwijderen voor een compatibel APK-paar | Niet uitgevoerd |
| Export | Exacte externe opslaglocatie, test-PDF met annotaties/formuliervelden, resultaat in onafhankelijke lezer | Niet uitgevoerd |
| Herinstallatie | Bevestigde incompatibele combinatie, gecontroleerde kopieën vooraf, opnieuw openen achteraf en verlies van instellingen | Niet uitgevoerd |
| Opslagprobleem | Versie en uitkomst van #1260; stoppen bij exportfouten | Niet uitgevoerd |

Bij deze documentatiewijziging zijn README en releasevermelding vergeleken. Er is geen APK-certificaat onafhankelijk geverifieerd en geen Android-apparaatmigratie uitgevoerd; behoud van gegevens is dus niet als getest aangemerkt. Voeg het bewijs toe voordat de overgangsgrens of migratie als geverifieerd wordt gepubliceerd. Technisch sleutelbeheer blijft bij [#601](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/601); deze handleiding volgt [#1282](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/1282).
