$ErrorActionPreference = 'SilentlyContinue'
$printerName = 'Open PDF Studio'

# Remove the printer if it exists
$printer = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if ($printer) {
    Remove-Printer -Name $printerName
}

# Clean up any leftover local port from older installations
Get-PrinterPort | Where-Object { $_.Name -like '*OpenPDFStudio*print-capture*' } | Remove-PrinterPort
