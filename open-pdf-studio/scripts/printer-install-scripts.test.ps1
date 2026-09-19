# Tests the printer scripts of the installer (src-tauri/nsis/install-printer.ps1
# and uninstall-printer.ps1) against a SIMULATED print server.
#
# Nothing here touches real printers, ports or paper sizes: every printer
# cmdlet and the paper size layer are replaced by functions that work on a
# table in memory. The test refuses to run anything when one of those
# replacements is not in place.
#
# Run through scripts/printer-install-scripts.test.mjs (npm run test:unit), or
# directly:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\printer-install-scripts.test.ps1

$ErrorActionPreference = 'Stop'
$nsisDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'src-tauri\nsis'

# The script without its last line (the call that does the work): only
# variables and function definitions are left, so loading it changes nothing.
function Get-Definitions([string]$File, [string]$FinalCall) {
    $text = [IO.File]::ReadAllText((Join-Path $nsisDir $File)) -replace "`r`n", "`n"
    $at = $text.LastIndexOf("`n$FinalCall")
    if ($at -lt 0) { throw "'$FinalCall' not found at the end of $File" }
    $rest = $text.Substring($at + 1).Trim()
    if ($rest -notmatch "^$([regex]::Escape($FinalCall))[^`n]*$") { throw "$File does more than '$FinalCall' after its definitions" }
    return $text.Substring(0, $at)
}

. ([scriptblock]::Create((Get-Definitions 'install-printer.ps1' 'Install-OpdsPrinter ')))
. ([scriptblock]::Create((Get-Definitions 'uninstall-printer.ps1' 'Uninstall-OpdsPrinter')))

# ---- the simulated print server -------------------------------------------

$script:Server = $null

function New-Server($Printers) {
    $script:Server = @{
        Printers = @{}
        Ports    = New-Object System.Collections.ArrayList
        Calls    = New-Object System.Collections.ArrayList
    }
    [void]$Server.Ports.Add('PORTPROMPT:')
    foreach ($p in $Printers) {
        $Server.Printers[$p.Name] = $p
        if (-not $Server.Ports.Contains($p.PortName)) { [void]$Server.Ports.Add($p.PortName) }
    }
}

function Get-Printer { # SIMULATED
    param([string]$Name, $ErrorAction)
    if ($Server.Printers.ContainsKey($Name)) { return [pscustomobject]$Server.Printers[$Name] }
}
function Add-Printer { # SIMULATED
    param([string]$Name, [string]$DriverName, [string]$PortName)
    if ($Server.Printers.ContainsKey($Name)) { throw "printer '$Name' exists" }
    if (-not $Server.Ports.Contains($PortName)) { throw "port '$PortName' does not exist" }
    $Server.Printers[$Name] = @{ Name = $Name; DriverName = $DriverName; PortName = $PortName }
    [void]$Server.Calls.Add("Add-Printer $Name")
}
function Remove-Printer { # SIMULATED
    param([string]$Name)
    if (-not $Server.Printers.ContainsKey($Name)) { throw "printer '$Name' does not exist" }
    $Server.Printers.Remove($Name)
    [void]$Server.Calls.Add("Remove-Printer $Name")
}
function Get-PrinterPort { # SIMULATED
    param([string]$Name, $ErrorAction)
    foreach ($port in @($Server.Ports)) {
        if ((-not $Name) -or ($port -eq $Name)) { [pscustomobject]@{ Name = $port } }
    }
}
function Add-PrinterPort { # SIMULATED
    param([string]$Name)
    if ($Server.Ports.Contains($Name)) { throw "port '$Name' exists" }
    [void]$Server.Ports.Add($Name)
    [void]$Server.Calls.Add("Add-PrinterPort $Name")
}
function Remove-PrinterPort { # SIMULATED
    param([string]$Name, $ErrorAction)
    foreach ($p in $Server.Printers.Values) { if ($p.PortName -eq $Name) { throw "port '$Name' is in use" } }
    $Server.Ports.Remove($Name)
    [void]$Server.Calls.Add("Remove-PrinterPort $Name")
}
function Set-PrintConfiguration { # SIMULATED
    param([string]$PrinterName, $PaperSize, $ErrorAction)
    [void]$Server.Calls.Add("Set-PrintConfiguration $PrinterName $PaperSize")
}
function Initialize-OpdsSpooler { # SIMULATED
}
function Add-OpdsForms([string]$Printer) { # SIMULATED
    [void]$Server.Calls.Add("Add-OpdsForms $Printer")
    return 0
}
function Remove-OpdsForms([string]$Printer) { # SIMULATED
    [void]$Server.Calls.Add("Remove-OpdsForms '$Printer'")
    return 0
}

# Safety: every command that could reach the real print server must be one of
# the functions above.
foreach ($name in 'Get-Printer', 'Add-Printer', 'Remove-Printer', 'Get-PrinterPort', 'Add-PrinterPort',
                  'Remove-PrinterPort', 'Set-PrintConfiguration', 'Initialize-OpdsSpooler', 'Add-OpdsForms', 'Remove-OpdsForms') {
    $command = Get-Command $name
    if (($command.CommandType -ne 'Function') -or ($command.Definition -notmatch '# SIMULATED')) {
        Write-Host "ABORT: '$name' is not simulated; nothing was run."
        exit 3
    }
}
function Write-Host { # keeps the scripts quiet
}

# ---- helpers ----------------------------------------------------------------

$Ours = 'Microsoft Print To PDF'   # as Windows spells it; the scripts compare without case
$Spool = 'C:\Users\someone\AppData\Local\OpenPDFPrinter\spool\latest.pdf'
function Printer($Name, $Port, $Driver = $Ours) { return @{ Name = $Name; DriverName = $Driver; PortName = $Port } }

$script:Failures = 0
$script:Checks = 0
function Check([string]$What, $Actual, $Expected) {
    $script:Checks++
    $a = ($Actual | Out-String).Trim()
    $e = ($Expected | Out-String).Trim()
    if ($a -ne $e) {
        $script:Failures++
        Microsoft.PowerShell.Utility\Write-Host "FAIL $What`n   expected: $e`n   actual  : $a"
    }
}
function Ports($Name) { if ($Server.Printers.ContainsKey($Name)) { $Server.Printers[$Name].PortName } else { '(none)' } }
function Names { ($Server.Printers.Keys | Sort-Object) -join ', ' }
function Calls { $Server.Calls -join ' | ' }

# ---- installer, user ticked "install the virtual printer" -------------------

New-Server @()
Install-OpdsPrinter 'PORTPROMPT:' $false $false
Check 'install, no printer: printers' (Names) 'Open PDF Printer'
Check 'install, no printer: port' (Ports 'Open PDF Printer') 'PORTPROMPT:'
Check 'install, no printer: calls' (Calls) 'Add-Printer Open PDF Printer | Set-PrintConfiguration Open PDF Printer A4 | Add-OpdsForms Open PDF Printer'

New-Server @((Printer 'Open PDF Studio' 'PORTPROMPT:'))
Install-OpdsPrinter 'PORTPROMPT:' $false $false
Check 'install, legacy only: printers' (Names) 'Open PDF Printer'
Check 'install, legacy only: calls' (Calls) 'Add-Printer Open PDF Printer | Set-PrintConfiguration Open PDF Printer A4 | Remove-Printer Open PDF Studio | Add-OpdsForms Open PDF Printer'

New-Server @((Printer 'Open PDF Printer' $Spool))
Install-OpdsPrinter 'PORTPROMPT:' $false $false
Check 'install, new on the capture port: printers' (Names) 'Open PDF Printer'
Check 'install, new on the capture port: port untouched' (Ports 'Open PDF Printer') $Spool
Check 'install, new on the capture port: calls' (Calls) 'Add-OpdsForms Open PDF Printer'

New-Server @((Printer 'Open PDF Printer' $Spool), (Printer 'Open PDF Studio' 'PORTPROMPT:'))
Install-OpdsPrinter 'PORTPROMPT:' $false $false
Check 'install, both: printers' (Names) 'Open PDF Printer'
Check 'install, both: port untouched' (Ports 'Open PDF Printer') $Spool
Check 'install, both: calls' (Calls) 'Remove-Printer Open PDF Studio | Add-OpdsForms Open PDF Printer'

New-Server @((Printer 'Open PDF Studio' 'USB001' 'Some Laser Driver'))
Install-OpdsPrinter 'PORTPROMPT:' $false $false
Check 'install, a printer of the user named like the legacy one: printers' (Names) 'Open PDF Printer, Open PDF Studio'
Check 'install, a printer of the user named like the legacy one: untouched' (Ports 'Open PDF Studio') 'USB001'

New-Server @((Printer 'Open PDF Printer' 'USB001' 'Some Laser Driver'), (Printer 'Open PDF Studio' 'PORTPROMPT:'))
Install-OpdsPrinter 'PORTPROMPT:' $false $false
Check 'install, a printer of the user named like the new one: printers' (Names) 'Open PDF Printer, Open PDF Studio'
Check 'install, a printer of the user named like the new one: calls' (Calls) 'Add-OpdsForms Open PDF Studio'

# ---- installer, silent update ('upgrade') ------------------------------------

New-Server @()
Install-OpdsPrinter 'PORTPROMPT:' $false $true
Check 'update, no printer: nothing installed' (Names) ''
Check 'update, no printer: calls' (Calls) ''

New-Server @((Printer 'Open PDF Studio' 'PORTPROMPT:'))
Install-OpdsPrinter 'PORTPROMPT:' $false $true
Check 'update, legacy only: printers' (Names) 'Open PDF Printer'
Check 'update, legacy only: port' (Ports 'Open PDF Printer') 'PORTPROMPT:'

New-Server @((Printer 'Open PDF Printer' $Spool))
Install-OpdsPrinter 'PORTPROMPT:' $false $true
Check 'update, new on the capture port: port untouched' (Ports 'Open PDF Printer') $Spool
Check 'update, new on the capture port: calls' (Calls) 'Add-OpdsForms Open PDF Printer'

New-Server @((Printer 'Open PDF Printer' $Spool), (Printer 'Open PDF Studio' 'PORTPROMPT:'))
Install-OpdsPrinter 'PORTPROMPT:' $false $true
Check 'update, both: printers' (Names) 'Open PDF Printer'
Check 'update, both: port untouched' (Ports 'Open PDF Printer') $Spool

New-Server @((Printer 'Open PDF Studio' 'USB001' 'Some Laser Driver'))
Install-OpdsPrinter 'PORTPROMPT:' $false $true
Check 'update, only a printer of the user: calls' (Calls) ''

# ---- the app: the user asks for the printer on the capture port -------------

New-Server @()
Install-OpdsPrinter $Spool $true $false
Check 'app, no printer: port' (Ports 'Open PDF Printer') $Spool
Check 'app, no printer: calls' (Calls) "Add-PrinterPort $Spool | Add-Printer Open PDF Printer | Set-PrintConfiguration Open PDF Printer A4 | Add-OpdsForms Open PDF Printer"

New-Server @((Printer 'Open PDF Printer' 'PORTPROMPT:'), (Printer 'Open PDF Studio' 'PORTPROMPT:'))
Install-OpdsPrinter $Spool $true $false
Check 'app, both on the dialog port: printers' (Names) 'Open PDF Printer'
Check 'app, both on the dialog port: port' (Ports 'Open PDF Printer') $Spool

New-Server @((Printer 'Open PDF Printer' 'USB001' 'Some Laser Driver'))
$thrown = ''
try { Install-OpdsPrinter $Spool $true $false } catch { $thrown = $_.Exception.Message }
Check 'app, a printer of the user named like the new one: refused' ($thrown -like '*another driver*') $true
Check 'app, a printer of the user named like the new one: untouched' (Ports 'Open PDF Printer') 'USB001'
Check 'app, a printer of the user named like the new one: calls' (Calls) ''

# ---- uninstall -----------------------------------------------------------------

New-Server @((Printer 'Open PDF Printer' $Spool), (Printer 'Open PDF Studio' 'PORTPROMPT:'))
Uninstall-OpdsPrinter
Check 'uninstall, both: printers' (Names) ''
Check 'uninstall, both: calls' (Calls) "Remove-OpdsForms 'Open PDF Printer' | Remove-Printer Open PDF Printer | Remove-Printer Open PDF Studio | Remove-PrinterPort $Spool"
Check 'uninstall, both: the dialog port of Windows stays' ($Server.Ports -join ', ') 'PORTPROMPT:'

New-Server @((Printer 'Open PDF Printer' 'PORTPROMPT:'), (Printer 'Open PDF Studio' 'USB001' 'Some Laser Driver'))
Uninstall-OpdsPrinter
Check 'uninstall, a printer of the user named like the legacy one: printers' (Names) 'Open PDF Studio'

New-Server @((Printer 'Open PDF Studio' 'PORTPROMPT:'))
Uninstall-OpdsPrinter
Check 'uninstall, legacy only: printers' (Names) ''
Check 'uninstall, legacy only: calls' (Calls) "Remove-OpdsForms 'Open PDF Studio' | Remove-Printer Open PDF Studio"

New-Server @()
Uninstall-OpdsPrinter
Check 'uninstall, no printer: paper sizes through the print server' (Calls) "Remove-OpdsForms ''"

Microsoft.PowerShell.Utility\Write-Host "$script:Checks checks, $script:Failures failed"
if ($script:Failures -gt 0) { exit 1 }
exit 0
