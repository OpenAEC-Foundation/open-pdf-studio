{
  description = "Open PDF Studio: free, open-source PDF editor and annotator (packaged from the released Linux AppImage)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      # De release levert alleen een amd64-AppImage, dus alleen x86_64-linux.
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      # Versie en hash van de gepubliceerde AppImage. Na elke release bijwerken
      # met: node open-pdf-studio/scripts/nix-flake-bijwerken.mjs
      # Dit pakket bouwt bewust NIET uit de broncode: de AppImage inpakken
      # vraagt geen cargo- of npm-hashes die bij elke release mee moeten.
      version = "2026.41.0";
      hash = "sha256-gMzkirby0evKExD7nQhK1a1cWQH9seU2hvYoJUf4BXw=";

      open-pdf-studio = pkgs.appimageTools.wrapType2 {
        pname = "open-pdf-studio";
        inherit version;

        src = pkgs.fetchurl {
          url = "https://github.com/OpenAEC-Foundation/open-pdf-studio/releases/download/v${version}/Open.PDF.Studio_${version}_amd64.AppImage";
          inherit hash;
        };

        # Startmenu-item en pictogrammen uit de repository zelf (dezelfde als
        # de flatpak), zodat ze niet afhangen van de indeling binnen de AppImage.
        extraInstallCommands = ''
          install -Dm644 ${./flatpak/org.openaec.OpenPdfStudio.desktop} \
            $out/share/applications/org.openaec.OpenPdfStudio.desktop
          install -Dm644 ${./open-pdf-studio/src-tauri/icons/icon-new.svg} \
            $out/share/icons/hicolor/scalable/apps/org.openaec.OpenPdfStudio.svg
          install -Dm644 ${./open-pdf-studio/src-tauri/icons/512x512.png} \
            $out/share/icons/hicolor/512x512/apps/org.openaec.OpenPdfStudio.png
          install -Dm644 ${./open-pdf-studio/src-tauri/icons/256x256.png} \
            $out/share/icons/hicolor/256x256/apps/org.openaec.OpenPdfStudio.png
          install -Dm644 ${./open-pdf-studio/src-tauri/icons/128x128.png} \
            $out/share/icons/hicolor/128x128/apps/org.openaec.OpenPdfStudio.png
          install -Dm644 ${./open-pdf-studio/src-tauri/icons/64x64.png} \
            $out/share/icons/hicolor/64x64/apps/org.openaec.OpenPdfStudio.png
          install -Dm644 ${./open-pdf-studio/src-tauri/icons/32x32.png} \
            $out/share/icons/hicolor/32x32/apps/org.openaec.OpenPdfStudio.png
        '';

        meta = {
          description = "Free, open-source PDF editor and annotator";
          homepage = "https://github.com/OpenAEC-Foundation/open-pdf-studio";
          license = pkgs.lib.licenses.lgpl3Plus;
          mainProgram = "open-pdf-studio";
          platforms = [ "x86_64-linux" ];
          sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
        };
      };
    in
    {
      packages.${system} = {
        inherit open-pdf-studio;
        default = open-pdf-studio;
      };

      apps.${system}.default = {
        type = "app";
        program = "${open-pdf-studio}/bin/open-pdf-studio";
      };
    };
}
