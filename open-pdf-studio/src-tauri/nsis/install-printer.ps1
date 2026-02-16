$ErrorActionPreference = 'Stop'
$printerName = 'Open PDF Studio'

# Remove existing printer if present (ignore errors)
try { Remove-Printer -Name $printerName -ErrorAction SilentlyContinue } catch {}

# Create the printer using the built-in PDF driver and PORTPROMPT: port
Add-Printer -Name $printerName -DriverName 'Microsoft Print to PDF' -PortName 'PORTPROMPT:'
