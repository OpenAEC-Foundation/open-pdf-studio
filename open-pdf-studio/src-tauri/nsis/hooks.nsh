!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var VPrinterCheckbox
Var VPrinterState

; Virtual Printer options page - Create
Function VPrinterPageCreate
  ; Skip in passive/update mode
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Additional Options" "Configure additional features for ${PRODUCTNAME}."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Select additional options for ${PRODUCTNAME}:"
  Pop $0

  ${NSD_CreateCheckBox} 10u 35u 100% 12u "Install as virtual printer (print to PDF from any application)"
  Pop $VPrinterCheckbox
  ${NSD_SetState} $VPrinterCheckbox ${BST_CHECKED}

  ${NSD_CreateLabel} 25u 52u 100% 36u "Adds 'Open PDF Studio' to your Windows printers list.$\nWhen you print from any application and select this printer,$\na Save As dialog will appear to save the document as PDF."
  Pop $0

  nsDialogs::Show
FunctionEnd

; Virtual Printer options page - Leave
Function VPrinterPageLeave
  ${NSD_GetState} $VPrinterCheckbox $VPrinterState
FunctionEnd

; Install virtual printer after files are installed (if checkbox was checked)
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Virtual printer state: $VPrinterState (expected: ${BST_CHECKED})"
  ${If} $VPrinterState == ${BST_CHECKED}
    DetailPrint "Installing Open PDF Studio virtual printer..."
    ; First remove any existing printer with the same name
    nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Remove-Printer -Name 'Open PDF Studio' -ErrorAction SilentlyContinue$\""
    Pop $0
    ; Now add the printer
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

; Remove virtual printer during uninstall
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Open PDF Studio virtual printer..."
  nsExec::ExecToLog "powershell -ExecutionPolicy Bypass -NoProfile -Command $\"Remove-Printer -Name 'Open PDF Studio' -ErrorAction Stop$\""
  Pop $0
  ${If} $0 == 0
    DetailPrint "Virtual printer removed successfully."
  ${Else}
    DetailPrint "Virtual printer was not found or already removed."
  ${EndIf}
!macroend
