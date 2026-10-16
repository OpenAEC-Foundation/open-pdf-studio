# MCP-tekstvervanging: weergave na opslaan

De live screenshot van de synthetische tekstproef (`/tmp/opds-mcp-text-hdMHEL/native-view.png`) toonde een wit vlak achter `Bienvenue` op een lichtblauwe pagina. Een render van de daadwerkelijk opgeslagen `translated.pdf` naast de bron liet zien dat het opgeslagen bestand **geen** wit vlak bevat: de achtergrond, rand en afbeelding zijn behouden. De fout zat in de nog niet ververste appweergave.

Bij een geslaagde tekstsave naar een expliciet nieuw pad sloeg `savePDF` de bestaande `reloadFromBytes`-verversing over. De PDF bevatte al de nieuwe tekst, terwijl de PDF.js- en PDFium-weergavecaches nog de oude bron hadden en het canvas een wit afdekvlak voor de pending tekstedit tekende.

De saver ververst nu ook na een expliciet doelpad de documentbytes en bindt de verse render-werkkopie aan dat doelpad. De teksteditrecords worden na geslaagde verversing verwijderd. Regressietests controleren zowel een rechtstreeks opgegeven pad (MCP) als de Save As-route, inclusief de bestemming van latere saves. De gerichte opslagtest slaagt; de native debugapp en het `.deb`-pakket zijn na de codewijziging opnieuw gebouwd.

Op 8 oktober is de herbouwde app op poort 9323 gestart. De MCP-liveproef heeft de tekst opnieuw vervangen, naar een nieuw bestand opgeslagen en de live weergave opgehaald. In de screenshot staat `Bienvenue` direct op de blauwe achtergrond zonder wit vlak. De proef controleert nu automatisch dat in het tekstgebied geen witte afdekpixels achterblijven (`whiteCoverPixels: 0`). Ook de tekstextractie en de aantallen vectorpaden en afbeeldingen bleven correct.
