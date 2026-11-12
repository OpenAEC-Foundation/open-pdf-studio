# Windows-gebruikersinstallatie bijwerken (#1051)

## Oorzaak en wijziging

De releasejob bouwde een NSIS-installer met `currentUser`, maar nam de gewone `latest.json`-updatefeed mee. Die feed verwijst naar de systeeminstaller, die administratorrechten vraagt. De gebruikersinstaller werd als losse EXE geüpload, zonder eigen ondertekende updatefeed.

De configuratiestap in release en nightly stelt nu zowel `currentUser` als `latest-user.json` in. De stabiele releasejob uploadt de bijbehorende updater-ZIP en minisign-handtekening onder een aparte gebruikersnaam, plus `latest-user.json`. De ZIP wordt bytegetrouw gekopieerd; opnieuw inpakken zou de handtekening ongeldig maken. Ontbrekende handtekeningen, meerdere kandidaat-ZIP's of een afwijkende releaseversie laten de stap falen. De feed verwijst uitsluitend naar het gebruikerspakket. De systeemfeed en de ingebouwde handtekeningcontrole blijven intact.

De OpenAEC Installer herkent gebruikers- en systeeminstallaties al via zijn registerdetectie en assetselectie (`nsisUser`, dependencyrev 2b66f84). Die route blijft behouden; ook de terugval daarvan naar de eigen updater gebruikt de configuratie van de app.

## Testbewijs

- Regressie op de oorspronkelijke workflow: configuratie/publicatie van de gebruikersfeed ontbreekt, test faalt.
- 12 gerichte tests geslaagd: configuratie, CLI, feedgeneratie, exact behoud van ZIP/signaturebytes, ontbrekende signature, afwijkende versie, dubbelzinnige ZIP-selectie en bestaande installerhandoff.
- 59 versie-, runtime-, release-, Linux- en imageconfiguratiecontroles geslaagd.
- TypeScript-controle en Vite-productiebuild geslaagd.
- De nieuwe regressietests draaien in CI op Windows, Linux en macOS.

Een echte Windows-update van versie A naar B als niet-administrator is nog niet uitgevoerd. De installerworkflow moet de getekende gebruikers-ZIP en feed opleveren en die update moet op Windows worden geverifieerd voordat deze PR uit concept gaat. Geen release gepubliceerd.

## Invoering

Reeds geïnstalleerde oude versies blijven hun ingebouwde `latest.json` gebruiken. Deze code kan hun updateconfiguratie niet achteraf veranderen. Gebruikers daarvan moeten eenmalig een nieuwe `_x64_user-setup.exe` met deze fix installeren; volgende updates gebruiken de gebruikersfeed. Wisselen van systeeminstallatie naar gebruikersinstallatie is geen onderdeel van deze fix. Nightly blijft op de stabiele releasefeed gericht.

Tauri-documentatie over ondertekende updates en statische feeds: https://v2.tauri.app/plugin/updater/.
