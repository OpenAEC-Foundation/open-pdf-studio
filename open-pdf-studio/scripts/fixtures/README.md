# PDF-kwalificatiefixtures

Deze fixtures en hun generatoren zijn oorspronkelijk voor dit project gemaakt
en vallen onder de repositorylicentie (LGPL-3.0, zie LICENSE.md). Er is geen
PDF-inhoud of fontbestand van derden overgenomen. De drukwerkfixture verwijst
naar de standaardfont Helvetica en bevat een door LittleCMS gegenereerd
sRGB-profiel; dit is geen persprofiel of bewijs van PDF/X-conformiteit.

| Bestand | SHA-256 |
| --- | --- |
| `decoder-omissions/unsupported-xobject.pdf` | `a001cd9db787d11ad08fcfca14d5a75dd526707c04652f36ab09091ec120bce8` |
| `print-flattening/corpus.pdf` | `99b534c39cce6a225278425c3ede213a64e5bc461301f8e3b8adf41f3056c8dc` |

De generatoren staan bij de fixtures. Het decoderbestand is deterministisch;
LittleCMS kan een aanmaakdatum in het ICC-profiel zetten, waardoor regeneratie
van de drukwerkfixture een andere hash kan opleveren. Werk in dat geval de hash
bij na het opnieuw uitvoeren van de kwalificatie.

De proeven staan in `scripts/check-decoder-omissions*` en
`scripts/check-print-flattening*`. Dit zijn expliciete backendkwalificaties,
geen browseronafhankelijke unit-tests. Ze schrijven uitvoer alleen naar de
opgegeven tijdelijke paden. Zie `docs/pdf-runtime/` in de repositoryroot voor
uitkomsten en beperkingen.
