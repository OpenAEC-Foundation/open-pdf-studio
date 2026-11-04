# Ingeklapt lint openen bij tabkeuze (#960)

Een klik op een linttab wijzigde alleen het actieve tabblad. Bij een ingeklapt
lint bleef de inhoud verborgen; ook opnieuw klikken op de actieve tab hielp niet.

Expliciete tabkeuze opent nu de inhoud en bewaart de uitgeklapte voorkeur. Dit
geldt voor gewone tabbladen, contexttabbladen, extensietabbladen en hun
overloopmenu, toetsenbordbediening en de bestaande wielbediening. De knop
Bestand opent nog steeds het menu. Automatische tabwissels en tijdelijke
tabwissels voor een sneltoets veranderen de ingeklapte voorkeur niet.

## Regressiecontrole

Start een geïsoleerde Vite-server en voer uit:

```sh
node scripts/ribbon-expand-e2e.mjs http://127.0.0.1:32860
```

De test start een eigen headless Chromium-context. Hij controleert de echte
Solid-interface, zichtbare tabinhoud en voorkeuren na herladen: actieve en andere
tabbladen, herhaald klikken, Enter/spatie/pijltoets/Home/End, contexttabbladen,
extensies en het overloopmenu, wielbediening, Bestand en automatische tabwissels.
De eerste controle faalt op de ongewijzigde basis: de actieve Home-tab blijft
ingeklapt na aanklikken. De test gebruikt geen gebruikersdocumenten.

Dit is een browsercontrole van de desktopinterface; een verpakte Tauri-installer
en native WebViews zijn hiermee niet afzonderlijk gekwalificeerd.
