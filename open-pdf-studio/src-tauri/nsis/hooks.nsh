!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var AssocPDFCheckbox
Var AssocPDFState
Var DesktopShortcutCheckbox
Var DesktopShortcutState
Var VPrinterCheckbox
Var VPrinterState

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

  ${NSD_CreateLabel} 25u 27u 100% 36u "Adds 'Open PDF Studio' to your Windows printers list.$\nWhen you print from any application and select this printer,$\na Save As dialog will appear to save the document as PDF."
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
  ${ElseIf} $VPrinterState == ${BST_CHECKED}
    DetailPrint "Installing Open PDF Studio virtual printer..."
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Remove-Printer -Name 'Open PDF Studio' -ErrorAction SilentlyContinue$\""
    Pop $0
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Add-Printer -Name 'Open PDF Studio' -DriverName 'Microsoft Print to PDF' -PortName 'PORTPROMPT:'$\""
    Pop $0
    DetailPrint "Add-Printer exit code: $0"
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

  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
    DetailPrint "Removing Open PDF Studio virtual printer..."
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Remove-Printer -Name 'Open PDF Studio' -ErrorAction Stop$\""
    Pop $0
    ${If} $0 == 0
      DetailPrint "Virtual printer removed successfully."
    ${Else}
      DetailPrint "Virtual printer was not found or already removed."
    ${EndIf}
  ${EndIf}

!macroend
