; Texts of the pages in ui.nsh, for every language the installer is built
; with (bundle.windows.nsis.languages in tauri.conf.json). A language that is
; added there needs a block here too; makensis warns about every string that
; is missing in a language and then shows the English text.
; Saved as UTF-8 with BOM, so makensis reads the accented letters correctly.

!ifdef LANG_ENGLISH
  LangString opdsWelcomeTitle ${LANG_ENGLISH} "Welcome to ${PRODUCTNAME}"
  LangString opdsVersion ${LANG_ENGLISH} "Version ${VERSION}"
  LangString opdsDescription ${LANG_ENGLISH} "A free, open-source PDF editor for viewing, annotating, measuring and printing PDF files."
  LangString opdsWelcomeNext ${LANG_ENGLISH} "Click Next to choose where and how to install it."
  LangString opdsLicenseText ${LANG_ENGLISH} "Free software under the GNU LGPL v3.0."
  LangString opdsLicenseLink ${LANG_ENGLISH} "Read the license"

  LangString opdsOptionsTitle ${LANG_ENGLISH} "Installation options"
  LangString opdsOptionsSubtitle ${LANG_ENGLISH} "Choose where to install ${PRODUCTNAME} and what to set up."
  LangString opdsLocation ${LANG_ENGLISH} "Install location"
  LangString opdsOptions ${LANG_ENGLISH} "Options"
  LangString opdsAssoc ${LANG_ENGLISH} "Open PDF files with ${PRODUCTNAME}"
  LangString opdsAssocHint ${LANG_ENGLISH} "Adds it to Open with. Windows lets you pick the default app yourself."
  LangString opdsPrinter ${LANG_ENGLISH} "Install the ${PRODUCTNAME} PDF printer"
  LangString opdsPrinterHint ${LANG_ENGLISH} "Adds 'Open PDF Printer', to print to PDF from any app, and the paper sizes A3L, A2L and A1L (plus A1 and A0 where missing)."
  LangString opdsDesktop ${LANG_ENGLISH} "Desktop shortcut"
  LangString opdsStartMenu ${LANG_ENGLISH} "Start menu shortcut"
  LangString opdsInvalidDir ${LANG_ENGLISH} "Enter a complete folder path that starts with a drive letter, such as C:\."

  LangString opdsFinishTitle ${LANG_ENGLISH} "${PRODUCTNAME} is ready"
  LangString opdsFinishText ${LANG_ENGLISH} "${PRODUCTNAME} has been installed on this computer."
  LangString opdsFinishRun ${LANG_ENGLISH} "Launch ${PRODUCTNAME}"

  LangString opdsUnFinishTitle ${LANG_ENGLISH} "${PRODUCTNAME} has been removed"
  LangString opdsUnFinishText ${LANG_ENGLISH} "${PRODUCTNAME} has been uninstalled from this computer."

  ; File Explorer right-click (hooks.nsh, #945)
  LangString opdsVerbCombine ${LANG_ENGLISH} "Combine into one PDF (${PRODUCTNAME})"
  LangString opdsVerbConvert ${LANG_ENGLISH} "Convert to PDF (${PRODUCTNAME})"
  LangString opdsVerbConvertCombine ${LANG_ENGLISH} "Convert and combine into one PDF (${PRODUCTNAME})"
!endif

!ifdef LANG_DUTCH
  LangString opdsWelcomeTitle ${LANG_DUTCH} "Welkom bij ${PRODUCTNAME}"
  LangString opdsVersion ${LANG_DUTCH} "Versie ${VERSION}"
  LangString opdsDescription ${LANG_DUTCH} "Een gratis, open-source PDF-editor om PDF-bestanden te bekijken, te annoteren, te meten en af te drukken."
  LangString opdsWelcomeNext ${LANG_DUTCH} "Klik op Volgende om te kiezen waar en hoe het wordt geïnstalleerd."
  LangString opdsLicenseText ${LANG_DUTCH} "Vrije software onder de GNU LGPL v3.0."
  LangString opdsLicenseLink ${LANG_DUTCH} "Licentie lezen"

  LangString opdsOptionsTitle ${LANG_DUTCH} "Installatieopties"
  LangString opdsOptionsSubtitle ${LANG_DUTCH} "Kies waar ${PRODUCTNAME} komt en wat er wordt ingesteld."
  LangString opdsLocation ${LANG_DUTCH} "Installatiemap"
  LangString opdsOptions ${LANG_DUTCH} "Opties"
  LangString opdsAssoc ${LANG_DUTCH} "PDF-bestanden openen met ${PRODUCTNAME}"
  LangString opdsAssocHint ${LANG_DUTCH} "Zet het bij Openen met. De standaard-app kiest u zelf in Windows."
  LangString opdsPrinter ${LANG_DUTCH} "De PDF-printer van ${PRODUCTNAME} installeren"
  LangString opdsPrinterHint ${LANG_DUTCH} "Voegt 'Open PDF Printer' toe, om vanuit elke app naar PDF af te drukken, en de papierformaten A3L, A2L en A1L (en A1 en A0 waar die ontbreken)."
  LangString opdsDesktop ${LANG_DUTCH} "Snelkoppeling op het bureaublad"
  LangString opdsStartMenu ${LANG_DUTCH} "Snelkoppeling in het menu Start"
  LangString opdsInvalidDir ${LANG_DUTCH} "Vul een volledig mappad in dat met een stationsletter begint, zoals C:\."

  LangString opdsFinishTitle ${LANG_DUTCH} "${PRODUCTNAME} is klaar"
  LangString opdsFinishText ${LANG_DUTCH} "${PRODUCTNAME} is op deze computer geïnstalleerd."
  LangString opdsFinishRun ${LANG_DUTCH} "${PRODUCTNAME} starten"

  LangString opdsUnFinishTitle ${LANG_DUTCH} "${PRODUCTNAME} is verwijderd"
  LangString opdsUnFinishText ${LANG_DUTCH} "${PRODUCTNAME} is van deze computer verwijderd."

  ; File Explorer right-click (hooks.nsh, #945)
  LangString opdsVerbCombine ${LANG_DUTCH} "Combineren tot één PDF (${PRODUCTNAME})"
  LangString opdsVerbConvert ${LANG_DUTCH} "Omzetten naar PDF (${PRODUCTNAME})"
  LangString opdsVerbConvertCombine ${LANG_DUTCH} "Omzetten en combineren tot één PDF (${PRODUCTNAME})"
!endif
