!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var AssocPDFCheckbox
Var AssocPDFState
Var DesktopShortcutCheckbox
Var DesktopShortcutState
Var VPrinterCheckbox
Var VPrinterState

; ============================================================
; Virtual printer "Open PDF Printer"
;
; The work is done by two PowerShell scripts that the installer carries:
; install-printer.ps1 and uninstall-printer.ps1, next to this file. Both are
; GENERATED from src-tauri/src/print_formulieren.rs (the same source the app
; uses for its own Install / Remove buttons); do not edit them by hand.
;
; - install: adds "Open PDF Printer" when it is not there yet. An existing
;   one is left exactly as it is: it may be on the silent capture port that
;   the app sets per user, and an upgrade must never put it back on the Save
;   As port. Then removes the printer of older versions, "Open PDF Studio",
;   and adds the extra paper sizes (A3L, A2L, A1L; A1 and A0 where missing) to
;   the Windows print server. Printers whose driver accepts user-defined
;   paper sizes then offer them; the built-in PDF driver has a fixed list.
; - the new printer goes on PORTPROMPT: (Save As dialog). The silent capture
;   port is a file in the profile of one user, while this installer runs
;   elevated (possibly as another account) and installs for all users; the
;   app switches to the capture port per user, without elevation.
; - only printers that use the "Microsoft Print to PDF" driver are ever
;   touched, so a printer of the user's own with the same name is safe.
; ============================================================

; Where this file and the two scripts are. Taken here, while this file is
; being read: inside a macro the current file is the installer script.
!define OPDS_HOOKS_DIR "${__FILEDIR__}"

; PowerShell by full path, never through the search path (this installer
; runs elevated from a downloads folder). The 64-bit one when this 32-bit
; installer runs on 64-bit Windows.
!macro OPDS_POWERSHELL_PATH _OUT
  StrCpy ${_OUT} "$WINDIR\sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${IfNot} ${FileExists} "${_OUT}"
    StrCpy ${_OUT} "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend

; Runs one of the printer scripts from the plugins folder (removed again
; when the installer exits). _ARGS: extra arguments for the script, or "".
; Leaves the exit code in $0: 0 = done, anything else = failed.
!macro OPDS_RUN_PRINTER_SCRIPT _FILE _ARGS
  InitPluginsDir
  File "/oname=$PLUGINSDIR\${_FILE}" "${OPDS_HOOKS_DIR}\${_FILE}"
  !insertmacro OPDS_POWERSHELL_PATH $1
  nsExec::ExecToLog '"$1" -NoProfile -NonInteractive -InputFormat None -ExecutionPolicy Bypass -File "$PLUGINSDIR\${_FILE}" ${_ARGS}'
  Pop $0
  Delete "$PLUGINSDIR\${_FILE}"
!macroend

; ============================================================
; File Explorer thumbnails (#605)
;
; open-pdf-thumbnails.dll is a shell thumbnail handler. The app registers it
; per user (HKCU) when the user turns it on in Preferences; the installer never
; turns it on. Constants: same values as open-pdf-thumbnails/src/registratie.rs.
;
; - install/update: File Explorer may have the DLL loaded (in its thumbnail
;   surrogate process), so it cannot be overwritten. A loaded DLL can still be
;   renamed: the old one is moved aside and removed on a later run.
; - uninstall: undo this user's registration when it points into this install
;   folder, putting back a handler of another program that it replaced. An
;   update or a reinstall keeps it (same path).
; ============================================================
!define OPDS_THUMB_DLL "open-pdf-thumbnails.dll"
!define OPDS_THUMB_CLSID "{CB423985-4932-4B94-8BD3-C515D63CB768}"
!define OPDS_THUMB_CLSID_KEY "Software\Classes\CLSID\${OPDS_THUMB_CLSID}"
!define OPDS_THUMB_SHELLEX_KEY "Software\Classes\.pdf\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}"
!define OPDS_THUMB_PREVIOUS "PreviousPdfThumbnailHandler"

; Moves the handler DLL out of the way when it cannot be deleted (in use).
; Leaves the new name in $R8, or "" when nothing had to be moved.
!macro OPDS_THUMB_MOVE_ASIDE
  StrCpy $R8 ""
  Delete "$INSTDIR\${OPDS_THUMB_DLL}.old*"
  ${If} ${FileExists} "$INSTDIR\${OPDS_THUMB_DLL}"
    ClearErrors
    Delete "$INSTDIR\${OPDS_THUMB_DLL}"
    ${If} ${Errors}
      System::Call 'kernel32::GetTickCount() i .R9'
      ClearErrors
      Rename "$INSTDIR\${OPDS_THUMB_DLL}" "$INSTDIR\${OPDS_THUMB_DLL}.old$R9"
      ${If} ${Errors}
        DetailPrint "File Explorer thumbnail handler is in use and could not be moved."
      ${Else}
        StrCpy $R8 "$INSTDIR\${OPDS_THUMB_DLL}.old$R9"
        DetailPrint "File Explorer thumbnail handler was in use; moved aside."
      ${EndIf}
    ${EndIf}
    ClearErrors
  ${EndIf}
!macroend

; Deletes an HKCU key only when it has no subkeys and no values.
!macro OPDS_DELETE_HKCU_KEY_IF_EMPTY _KEY
  EnumRegKey $R4 HKCU "${_KEY}" 0
  EnumRegValue $R5 HKCU "${_KEY}" 0
  ${If} $R4 == ""
  ${AndIf} $R5 == ""
    DeleteRegKey HKCU "${_KEY}"
  ${EndIf}
  ClearErrors
!macroend

; Turns the thumbnails off for the current user when the registration points
; at this install folder: the same steps as zet_uit in registratie.rs.
; The 64-bit registry view: this installer is a 32-bit process, and for it
; HKCU\Software\Classes\CLSID is redirected to Wow6432Node, where the
; 64-bit app's registration is not.
!macro OPDS_THUMB_UNREGISTER
  SetRegView 64
  ReadRegStr $R1 HKCU "${OPDS_THUMB_CLSID_KEY}\InprocServer32" ""
  ${If} $R1 == "$INSTDIR\${OPDS_THUMB_DLL}"
    ReadRegStr $R2 HKCU "${OPDS_THUMB_SHELLEX_KEY}" ""
    ${If} $R2 == "${OPDS_THUMB_CLSID}"
      ReadRegStr $R3 HKCU "${OPDS_THUMB_CLSID_KEY}" "${OPDS_THUMB_PREVIOUS}"
      ${If} $R3 != ""
        WriteRegStr HKCU "${OPDS_THUMB_SHELLEX_KEY}" "" "$R3"
      ${Else}
        DeleteRegKey HKCU "${OPDS_THUMB_SHELLEX_KEY}"
        !insertmacro OPDS_DELETE_HKCU_KEY_IF_EMPTY "Software\Classes\.pdf\ShellEx"
        !insertmacro OPDS_DELETE_HKCU_KEY_IF_EMPTY "Software\Classes\.pdf"
      ${EndIf}
    ${EndIf}
    DeleteRegKey HKCU "${OPDS_THUMB_CLSID_KEY}"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
    DetailPrint "File Explorer thumbnails turned off."
  ${EndIf}
  SetRegView lastused
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OPDS_THUMB_MOVE_ASIDE
!macroend

; ============================================================
; File Explorer right-click (#945): "Combine into one PDF" on PDFs, "Convert
; to PDF" and "Convert and combine into one PDF" on images and CAD drawings.
; The app side: src-tauri/src/verkenner_acties.rs and js/core/shell-acties.js.
;
; Classic shell verbs under SystemFileAssociations, so they work next to any
; default PDF app; on Windows 11 they are under "Show more options". SHCTX is
; HKLM for the per-machine installer and HKCU for the per-user installer
; (SetContext in installer.nsi), so each variant writes and removes in its
; own hive. Written on every install (also silent and update runs, and when
; the user does not make the app the default PDF viewer) and removed on
; uninstall; an update writes them again in POSTINSTALL.
;
; Explorer starts the command once per selected file (MultiSelectModel is
; not set, so the verbs show for up to 15 files); the running app collects
; the files of one selection. "Convert and combine" uses the same verb key as
; "Combine", so a mixed selection of images and PDFs shows it.
;
; The one list below drives both writing and removing, so the two cannot
; drift apart (checked by js/core/shell-acties-installer.test.mjs).
; ============================================================
!define OPDS_SHELL_SFA "Software\Classes\SystemFileAssociations"

!macro OPDS_SHELL_VERB_WRITE _EXT _KEY _LABEL _FLAG
  WriteRegStr SHCTX "${OPDS_SHELL_SFA}\${_EXT}\shell\${_KEY}" "" "${_LABEL}"
  WriteRegStr SHCTX "${OPDS_SHELL_SFA}\${_EXT}\shell\${_KEY}" "MUIVerb" "${_LABEL}"
  WriteRegStr SHCTX "${OPDS_SHELL_SFA}\${_EXT}\shell\${_KEY}" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${OPDS_SHELL_SFA}\${_EXT}\shell\${_KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" ${_FLAG} $\"%1$\""
!macroend

; Deletes a key in SHCTX only when it has no subkeys and no values.
!macro OPDS_DELETE_SHCTX_KEY_IF_EMPTY _KEY
  EnumRegKey $R4 SHCTX "${_KEY}" 0
  EnumRegValue $R5 SHCTX "${_KEY}" 0
  ${If} $R4 == ""
  ${AndIf} $R5 == ""
    DeleteRegKey SHCTX "${_KEY}"
  ${EndIf}
  ClearErrors
!macroend

; Removes the verb, then the "shell" and extension keys when that left them
; empty (they may hold entries of Windows or other programs).
!macro OPDS_SHELL_VERB_REMOVE _EXT _KEY _LABEL _FLAG
  DeleteRegKey SHCTX "${OPDS_SHELL_SFA}\${_EXT}\shell\${_KEY}"
  !insertmacro OPDS_DELETE_SHCTX_KEY_IF_EMPTY "${OPDS_SHELL_SFA}\${_EXT}\shell"
  !insertmacro OPDS_DELETE_SHCTX_KEY_IF_EMPTY "${OPDS_SHELL_SFA}\${_EXT}"
!macroend

; _OP: WRITE or REMOVE.
!macro OPDS_SHELL_VERBS _OP
  !insertmacro OPDS_SHELL_VERB_${_OP} ".pdf" "OpenPDFStudio.Combine" "$(opdsVerbCombine)" "--combine"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".jpg" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".jpeg" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".png" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".bmp" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".gif" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".webp" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".dwg" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".dxf" "OpenPDFStudio.ConvertToPdf" "$(opdsVerbConvert)" "--convert-to-pdf"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".jpg" "OpenPDFStudio.Combine" "$(opdsVerbConvertCombine)" "--convert-combine"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".jpeg" "OpenPDFStudio.Combine" "$(opdsVerbConvertCombine)" "--convert-combine"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".png" "OpenPDFStudio.Combine" "$(opdsVerbConvertCombine)" "--convert-combine"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".bmp" "OpenPDFStudio.Combine" "$(opdsVerbConvertCombine)" "--convert-combine"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".gif" "OpenPDFStudio.Combine" "$(opdsVerbConvertCombine)" "--convert-combine"
  !insertmacro OPDS_SHELL_VERB_${_OP} ".webp" "OpenPDFStudio.Combine" "$(opdsVerbConvertCombine)" "--convert-combine"
!macroend

; The check boxes for the PDF association, the printer and the desktop
; shortcut are on the options page (OptionsPageCreate in ui.nsh). Passive
; and update runs skip that page; it then sets the association and the
; desktop shortcut to on, as the separate pages used to. Silent runs (/S)
; run no page functions at all, so the states stay empty there.

; ============================================================
; Post-install: apply file association, shortcut, and virtual printer
; ============================================================
!macro NSIS_HOOK_POSTINSTALL

  ; --- File Explorer right-click: Combine / Convert to PDF (#945) ---
  DetailPrint "Adding Combine / Convert to PDF to the File Explorer menu..."
  !insertmacro OPDS_SHELL_VERBS WRITE
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'

  ; --- PDF file association ---
  ${If} $AssocPDFState == ${BST_CHECKED}
    DetailPrint "Setting ${PRODUCTNAME} as default PDF application..."
    WriteRegStr SHCTX "Software\Classes\OpenPDFStudio.pdf" "" "PDF Document"
    WriteRegStr SHCTX "Software\Classes\OpenPDFStudio.pdf\DefaultIcon" "" "$INSTDIR\file-icon.ico,0"
    WriteRegStr SHCTX "Software\Classes\OpenPDFStudio.pdf\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    WriteRegStr SHCTX "Software\Classes\.pdf" "" "OpenPDFStudio.pdf"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
    DetailPrint "PDF file association set."
  ${Else}
    DetailPrint "PDF file association skipped by user."
  ${EndIf}

  ; --- Desktop shortcut ---
  ${If} $DesktopShortcutState == ${BST_CHECKED}
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    DetailPrint "Desktop shortcut created."
  ${Else}
    DetailPrint "Desktop shortcut skipped by user."
  ${EndIf}

  ; --- Virtual printer (only if running as admin) ---
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "Admin"
    DetailPrint "Virtual printer skipped (no admin privileges)."
  ${ElseIf} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    ; Silent update: the page with the checkbox was never shown. Bring a
    ; printer that is already there up to date, never install a new one.
    DetailPrint "Updating the 'Open PDF Printer' virtual printer, if installed..."
    !insertmacro OPDS_RUN_PRINTER_SCRIPT "install-printer.ps1" "upgrade"
    ${If} $0 == 0
      DetailPrint "Virtual printer is up to date."
    ${Else}
      DetailPrint "Virtual printer update failed (exit code: $0)."
    ${EndIf}
  ${ElseIf} $VPrinterState == ${BST_CHECKED}
    DetailPrint "Installing the 'Open PDF Printer' virtual printer..."
    !insertmacro OPDS_RUN_PRINTER_SCRIPT "install-printer.ps1" ""
    ${If} $0 == 0
      DetailPrint "Virtual printer installed successfully."
    ${Else}
      DetailPrint "Virtual printer installation failed (exit code: $0)."
    ${EndIf}
  ${Else}
    DetailPrint "Virtual printer installation skipped by user."
  ${EndIf}

!macroend

; ============================================================
; Remove virtual printer and clean up file association during uninstall
; ============================================================
!macro NSIS_HOOK_PREUNINSTALL

  ReadRegStr $R0 SHCTX "Software\Classes\.pdf" ""
  ${If} $R0 == "OpenPDFStudio.pdf"
    DeleteRegValue SHCTX "Software\Classes\.pdf" ""
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\OpenPDFStudio.pdf"
  ; File Explorer right-click: Combine / Convert to PDF (#945)
  !insertmacro OPDS_SHELL_VERBS REMOVE
  Delete "$INSTDIR\file-icon.ico"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'

  ; An installer that uninstalls the previous version only to make room for
  ; another one passes /KEEPPRINTER (installer.nsi, PageLeaveReinstall), and an
  ; update passes /UPDATE: the printer then stays, on the port it has. It
  ; goes only when the user really uninstalls the app.
  ClearErrors
  ${GetOptions} $CMDLINE "/KEEPPRINTER" $R0
  ${IfNot} ${Errors}
  ${OrIf} $UpdateMode = 1
    DetailPrint "Keeping the virtual printer (another version is being installed)."
  ${Else}
    UserInfo::GetAccountType
    Pop $0
    ${If} $0 == "Admin"
      DetailPrint "Removing the 'Open PDF Printer' virtual printer..."
      !insertmacro OPDS_RUN_PRINTER_SCRIPT "uninstall-printer.ps1" ""
      ${If} $0 == 0
        DetailPrint "Virtual printer removed."
      ${Else}
        DetailPrint "Virtual printer could not be removed completely (exit code: $0)."
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ClearErrors

  ; --- File Explorer thumbnails (#605) ---
  ClearErrors
  ${GetOptions} $CMDLINE "/KEEPPRINTER" $R1
  ${IfNot} ${Errors}
  ${OrIf} $UpdateMode = 1
    DetailPrint "Keeping the File Explorer thumbnail setting (another version is being installed)."
  ${Else}
    !insertmacro OPDS_THUMB_UNREGISTER
    !insertmacro OPDS_THUMB_MOVE_ASIDE
    ${If} $R8 != ""
      Delete /REBOOTOK "$R8"
    ${EndIf}
  ${EndIf}
  ClearErrors

!macroend
