# Commentaarvenster sluiten bij verwijderen (#1116)

Een geopend commentaarvenster stond in een apart register. Het verwijderen
van de annotatie liet die verwijzing bestaan, waardoor het venster zichtbaar
bleef en nog naar de verwijderde annotatie kon schrijven.

De popuphost volgt nu de annotaties van het actieve document en verwijdert
vensters waarvan het oorspronkelijke annotatieobject niet meer bestaat. Dit
geldt ook voor opnieuw uitvoeren en voor vervanging van annotatieobjecten.
De opruiming maakt geen extra wijzigingsstap: de verwijderstap bevat de actuele
tekst al, zodat ongedaan maken die tekst terugzet. Andere vensters blijven open.

Controle: `node --test js/solid/stores/stickyNotePopupStore.test.mjs` en
`node scripts/test-comment-popup-browser.mjs` vanuit de appmap. De browsertest
gebruikt een gegenereerde PDF, de Delete-toets, de echte contextmenuactie en
ongedaan maken/opnieuw. De browsercontrole draait ook in Linux-CI.

De geïnstalleerde Tauri-app op Windows/macOS moet nog worden gekwalificeerd.
