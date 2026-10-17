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
; Page 1: File Association
; ============================================================
Function FileAssocPageCreate
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    StrCpy $AssocPDFState ${BST_CHECKED}
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "File Association" "Configure how ${PRODUCTNAME} opens PDF files."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckBox} 10u 10u 100% 12u "Register ${PRODUCTNAME} as a PDF app"
  Pop $AssocPDFCheckbox
  ${NSD_SetState} $AssocPDFCheckbox ${BST_CHECKED}

  ; Windows does not let installers set the default PDF app (the user's
  ; choice is protected); registration only makes the app available.
  ; Promise exactly what happens so the checkbox doesn't over-claim.
  ${NSD_CreateLabel} 25u 27u 100% 36u "Adds ${PRODUCTNAME} to the apps Windows offers for PDF files.$\nTo make it the default: right-click any PDF > Open with >$\nChoose another app > ${PRODUCTNAME} > Always."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function FileAssocPageLeave
  ${NSD_GetState} $AssocPDFCheckbox $AssocPDFState
FunctionEnd

; ============================================================
; Page 2: Virtual Printer (skip if not running as admin)
; ============================================================
Function VPrinterPageCreate
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    Abort
  ${EndIf}

  ; Skip this page if the installer does not have admin privileges
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "Admin"
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Virtual Printer" "Install a virtual printer for ${PRODUCTNAME}."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckBox} 10u 10u 100% 12u "Install as virtual printer (print to PDF from any application)"
  Pop $VPrinterCheckbox
  ${NSD_SetState} $VPrinterCheckbox ${BST_CHECKED}

  ${NSD_CreateLabel} 25u 27u 100% 68u "Adds 'Open PDF Printer' to your Windows printers list. When you print$\nfrom any application and select this printer, the document is saved$\nas PDF.$\nAlso adds the paper sizes A3L, A2L and A1L (one A4 width longer than$\nA3, A2 and A1), and A1 and A0 where missing, to Windows, for printers$\nthat accept user-defined paper sizes.$\nA printer of an earlier version named 'Open PDF Studio' is replaced;$\nan existing 'Open PDF Printer' is kept as it is."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function VPrinterPageLeave
  ${NSD_GetState} $VPrinterCheckbox $VPrinterState
FunctionEnd

; ============================================================
; Page 3: Desktop Shortcut
; ============================================================
Function DesktopShortcutPageCreate
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    StrCpy $DesktopShortcutState ${BST_CHECKED}
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Desktop Shortcut" "Create a shortcut on your desktop."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckBox} 10u 10u 100% 12u "Create a desktop shortcut for ${PRODUCTNAME}"
  Pop $DesktopShortcutCheckbox
  ${NSD_SetState} $DesktopShortcutCheckbox ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutState
FunctionEnd

; ============================================================
; Post-install: apply file association, shortcut, and virtual printer
; ============================================================
!macro NSIS_HOOK_POSTINSTALL

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
