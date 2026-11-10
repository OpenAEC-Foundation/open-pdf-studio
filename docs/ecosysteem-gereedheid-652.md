# Ecosysteem-gereedheid (#652): stand van zaken

Controle van elke rij en elk vinkje uit issue #652 tegen de code op `main`
(`add5fd243`, 9 november 2026), de workflows in `.github/workflows/` en de
assets van de laatste stabiele release **v2026.45.0** (6 november 2026,
gelezen met `gh release view`, niets gedownload of geïnstalleerd).

Statussen: **DONE** = aanwezig en met bewijs; **PARTIAL** = aanwezig, maar een
deel van de acceptatie uit het issue ontbreekt; **OPEN** = niet aanwezig.
"Geverifieerd" betekent hier: in CI gecontroleerd of in de code aangetoond,
niet handmatig op een schone machine getest, tenzij dat er staat.

## 1. Capaciteitenmatrix (vinkje 1)

Deze tabel is de productspecifieke matrix waar het issue om vraagt.

| Runtime / levering | Architectuur | Kanaal | Asset of bron in v2026.45.0 | Opmerking |
|---|---|---|---|---|
| Windows, installer voor alle gebruikers | x86_64 | stabiel + nightly | `Open.PDF.Studio_2026.45.0_x64-setup.exe` (+ `.nsis.zip` en `.sig` voor de updater) | Authenticode via Azure Trusted Signing |
| Windows, installer per gebruiker | x86_64 | stabiel | `…_x64_user-setup.exe` | idem |
| Windows, draagbaar | x86_64 | stabiel | `…_x64_portable.zip` + `.sha256` | `docs/portable-windows.md` |
| Windows, winget | x86_64 | stabiel | `open-pdf-studio-winget-manifests-2026.45.0.zip` | indienen bij winget is een losse stap |
| Windows on ARM | arm64 | geen | alleen `windows-arm64.yml` (handmatig, experimenteel) | niet in de releasematrix |
| macOS | universal (arm64 + x86_64), macOS 10.15+ | stabiel + nightly | `…_universal.dmg`, `Open.PDF.Studio_universal.app.tar.gz` (+ `.sig`) | Developer ID + notarisatie |
| Linux `.deb` | x86_64 | stabiel + nightly | `…_amd64.deb` (+ `.sig`) | |
| Linux AppImage | x86_64 | stabiel + nightly | `…_amd64.AppImage`, `.AppImage.tar.gz` (+ `.sig`) | ook basis van OpenAEC Linux |
| Linux snap | x86_64 | stabiel (Snap Store) | `open-pdf-studio_2026.45.0_amd64.snap` | `snap.yml` |
| Linux Flatpak | x86_64 | geen | `flatpak/` (manifest) | job `flatpak` faalde in de run van v2026.45.0; niet op Flathub (`docs/flathub.md`) |
| Linux Nix / AUR | x86_64 | bron | `flake.nix`, `packaging/aur` | |
| Android | arm64 | stabiel | `open-pdf-studio-release.apk` | nieuwe sleutel per release (#601) |
| Web (zelf hosten) | n.v.t. | stabiel | `open-pdf-studio-web-2026.45.0.tar.gz` + `.sha256` | zonder desktopfuncties |
| MCP-bundel Claude Desktop | n.v.t. | stabiel | `open-pdf-studio.mcpb` | stdio-brug naar de app |
| Python-bibliotheek | py3, elk OS | stabiel (release-asset) | `open_pdf_studio-2026.45.0-py3-none-any.whl`, `.tar.gz` | nog niet op PyPI |
| Rust-renderer `open-pdf-render` | elk Rust-doel | bron (crate in de workspace) | `open-pdf-render/Cargo.toml` (MIT) | niet gepubliceerd op crates.io |

Niet van toepassing: een losse servervariant (de app is een desktopproduct;
de "server" is de app zelf met MCP, zie vinkje 5) en .NET-assemblies (geen .NET in
het product).

## 2. De rijen uit "Current evidence"

| Gebied | Status | Bewijs | Wat nog nodig is |
|---|---|---|---|
| Windows | PARTIAL | Assets hierboven; `release.yml` ondertekent met Azure Trusted Signing en controleert elke handtekening met `Get-AuthenticodeSignature` (regels ±515–590); job `build (windows-latest, windows-system/user)` geslaagd in run 42226863516 | Installatie op een schone VM vastleggen voor één release (vinkje 2) |
| macOS | PARTIAL | `…_universal.dmg`; notarisatie met App Store Connect-API-sleutel en `spctl`/`stapler validate` in `release.yml` (±440–500); job geslaagd | Installatie op een schone Mac vastleggen; Sonoma-test (#361) |
| Linux | PARTIAL | `.deb`, AppImage, snap; rooktests `scripts/linux-appimage-smoke.sh` en `scripts/openaec-linux-smoke.test.sh` in `ci.yml` | Schone-VM-resultaat; Flatpak-job repareren; OpenPGP-handtekeningen pas vanaf de volgende release (vinkje 9) |
| Productbibliotheek / SDK | PARTIAL | Python-bibliotheek `python/` met `docs/python-library.md` (release-assets); `open-pdf-render` crate (MIT) | Bibliotheekgrens, versie- en compatibiliteitsbeleid en een extern voorbeeld per bibliotheek; PyPI-publicatie (vinkje 3) |
| Losse product-DLL | OPEN | Alleen interne cdylibs: `open-pdf-studio/src-tauri` (Tauri-app), `open-pdf-thumbnails` (Verkenner-miniaturen); geen publieke C-ABI | Besluit of een DLL nodig is; zo ja exports, ABI, buffer- en foutconventies (vinkje 4) |
| Eigen API | PARTIAL | De MCP-server van de app is de API: HTTP JSON-RPC op `127.0.0.1:9223/mcp` (`src-tauri/src/mcp_server.rs`), 94 publieke tools in `mcp-stdio/tools.json`; beheerde modus met bearer-geheim (`docs/managed-deployments.md`) | Een gepubliceerd interfacecontract met versiebeleid en een reproduceerbare rooktest tegen een draaiende app (vinkje 5) |
| Product-MCP-server | PARTIAL | `mcp-stdio/README.md`, `mcp-stdio/server.mjs --probe`, `mcp-stdio/brug.test.mjs`; MCP-annotaties per tool (`mcp_tool_meta.rs`) | Verificatie met een externe client vastleggen (transport, tools, rechten, mutatie en undo) (vinkje 6) |
| Claude Desktop / Code | PARTIAL | Instructies in `mcp-stdio/README.md`, `open-pdf-studio.mcpb` per release (job `mcpb`), `mcpb/manifest.json` met test | Verbinding vastleggen; indienen bij de extensiebibliotheek (`mcpb/INDIENEN.md`) doet de Foundation (vinkje 7) |
| Interactieve Claude-app / connector | OPEN | Geen MCP App of remote connector; alleen de lokale bundel | Besluit of een connector (remote MCP) gewenst is; dat vraagt een gehoste API (vinkjes 7 en 10) |
| UI / stijlbron | PARTIAL | Eigen CSS in `open-pdf-studio/styles/` met thema's (`themes.css`, `data-theme`, licht/donker/systeem in `js/core/preferences.js`); Windows-stijl volgens `CLAUDE.md` | Geen afhankelijkheid van de pakketten of tokens van de OpenAEC Style Repo; relatie en plan vastleggen (vinkje 8) |
| AWS-gereedheid | OPEN | Niets voor AWS. Het dichtstbij: OpenAEC Linux, de app als AppImage in een container per gebruiker (`docs/openaec-linux.md`), met beheerde modus en MCP met geheim | Runtimekeuze, headless build, deploymentdefinitie, IAM, health/logging en een rooktest in AWS (vinkje 10) |
| Release-ondertekening | PARTIAL | Updater: minisign-`.sig` per bundel, publieke sleutel in `tauri.conf.json` (`plugins.updater.pubkey`); Windows en macOS zie boven; Linux OpenPGP-job `sign-linux` staat op `main` (commit c526c8d85) maar nog niet in v2026.45.0, dus die release heeft geen `.asc` en geen `SHA256SUMS` | Eerste release met `sign-linux` controleren; handtekeningen per release met commando en resultaat vastleggen (vinkje 9) |

## 3. Vinkjes uit "Required work"

| # | Vinkje | Status | Bewijs | Wat nog nodig is |
|---|---|---|---|---|
| 1 | Capaciteitenmatrix | DONE | §1 van dit document | Bij elke release bijwerken |
| 2 | Artefacten op schone machines, één release | OPEN | Alleen CI-controles en rooktests; `docs/release-testprotocol.md` §5 beschrijft installer-verificatie | Per platform een schone-VM-run voor één release met datum, versie en uitkomst |
| 3 | Bibliotheekgrens, ingangen, versiebeleid, licentie, extern voorbeeld | PARTIAL | Python: `docs/python-library.md` (ontwerp, API, tests, release; licentie LGPL-3.0-or-later in `python/pyproject.toml`); renderer: `open-pdf-render` MIT, eigen tests en voorbeelden in `open-pdf-render/examples` | Versie- en compatibiliteitsbeleid uitschrijven (de Python-versie volgt de appversie); een voorbeeld buiten de repo; PyPI (maintainerstap in `docs/python-library.md` §4) |
| 4 | Native bibliotheek (DLL/.so) met ABI | OPEN | Zie rij "Losse product-DLL" | Eerst het besluit; de Python-bibliotheek en MCP dekken nu het programmatische gebruik |
| 5 | Headless product-API of afgebakende scope | PARTIAL | API = MCP over HTTP; headless testinstantie met `OPDS_HEADLESS=1` (`src-tauri/src/headless.rs`), `--mcp-server`/`--mcp-port` (`src-tauri/src/main.rs`), beheerde modus; foutgedrag: JSON-RPC-fouten, HTTP 403 voor een niet-lokale client of zonder geldig geheim | Contract (tools.json als schema + versiebeleid), authenticatie- en foutgedrag in één document, reproduceerbare rooktest (bijvoorbeeld `python -m unittest` tegen een headless app in CI). `--help` noemt `--mcp-server`, `--mcp-port` en `--new-instance` nog niet |
| 6 | MCP-server met externe client verifiëren | PARTIAL | `--probe` van de brug; Python-tests tegen een nep-MCP-server (`python/tests/fake_mcp_server.py`); rig-gebruik in `docs/release-testprotocol.md` | Een vastgelegde run met een externe client: transport, tools/resources, rechten (publiek profiel vs. ontwikkelprofiel), mutatie en undo |
| 7 | Claude Desktop/Code-verbinding; bundel los van connector | PARTIAL | Bundel: `open-pdf-studio.mcpb` per release; Code: `claude mcp add` of een eigen `.mcp.json` (`mcp-stdio/README.md`); connector: geen | Verbinding vastleggen; de connector apart volgen (vinkje 10) |
| 8 | UI en relatie met de Style Repo | PARTIAL | Eigen thema's en componenten; geen pakketten of tokens van de Style Repo | Vastleggen welke tokens/componenten overeenkomen, en een besluit over adoptie (volledige adoptie, geen hybride) |
| 9 | Ondertekening op echte release-artefacten | PARTIAL | Windows: Authenticode + RFC 3161-tijdstempel (`timestamp.acs.microsoft.com`) en controle in CI; macOS: Developer ID, notarisatie, `spctl`, `stapler validate` in CI; updater: minisign-sleutel in `tauri.conf.json`; Linux OpenPGP: sleutel `docs/keys/openaec-signing-public-key.asc`, vingerafdruk `13F6D414ADEE4ED4CD09AC60601D86C93C504D29`, job vanaf de volgende release | Per release vastleggen: ondertekenaar, sleutel, commando (`Get-AuthenticodeSignature`, `spctl -a -vv`, `gpg --verify`, `minisign -V`) en uitkomst, buiten CI herhaald |
| 10 | AWS-gereedheid | OPEN | Geen | Zie rij "AWS-gereedheid"; hangt af van vinkje 5 (een API die zonder desktop draait) |
| 11 | Versiebewijs per eis | PARTIAL | Dit document noemt commit en release | Bij afvinken per vinkje de release en het bewijs koppelen |

## 4. In deze ronde opgelost

- De capaciteitenmatrix (§1) staat er nu.
- `README.md` en `README.nl.md`: de rij "Other" noemde winget en de
  Python-bibliotheek als "vanaf de volgende release", terwijl v2026.45.0 ze al
  heeft; de alinea over ondertekening zegt nu dat de OpenPGP-handtekeningen
  van de Linux-pakketten pas vanaf de eerste release na 2026.45.0 komen.
- `mcp-stdio/README.md` zei dat er een `.mcp.json` in de repo staat; die is
  er niet. Nu staat er hoe je de brug registreert (`claude mcp add` of een
  eigen `.mcp.json`), en het voorbeeldpad voor Claude Desktop is geen pad van
  één gebruiker meer.

## 5. Bewust niet in deze ronde

- `--help` uitbreiden met de MCP- en instantievlaggen: een Rust-wijziging in
  `src-tauri/src/lib.rs` die een `cargo check` van de app-crate vraagt; klein,
  maar apart te doen.
- Schone-VM-tests, een externe MCP-run en handtekeningcontrole buiten CI: die
  vragen installaties en downloads, buiten de werkwijze van deze ronde.
- DLL, connector en AWS: elk een eigen epic met een besluit vooraf.
