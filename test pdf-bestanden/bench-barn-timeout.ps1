# BARN timeout verification: monitor binary + open BARN.pdf, expect 30s
# timeout per worker render, recovery kicks in, MCP stays alive.
$ErrorActionPreference = 'Continue'
$mcpUrl = 'http://127.0.0.1:9223/mcp'
$barn = 'C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf'

function Invoke-Mcp($name, $mcpArgs, $timeout=120) {
  $body = @{ jsonrpc='2.0'; id=(Get-Random); method='tools/call'; params=@{ name=$name; arguments=$mcpArgs } } | ConvertTo-Json -Depth 10
  try {
    $r = Invoke-RestMethod -Uri $mcpUrl -Method POST -ContentType 'application/json' -Body $body -TimeoutSec $timeout
    return ($r.result.content[0].text | ConvertFrom-Json)
  } catch {
    return @{ ok=$false; error=$_.Exception.Message }
  }
}

function Ping-Mcp {
  try {
    Invoke-RestMethod -Uri $mcpUrl -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' -TimeoutSec 5 | Out-Null
    return $true
  } catch { return $false }
}

Write-Host "═════════════════════════════════════════════════════════"
Write-Host "BARN timeout verification — t=0"
Write-Host "═════════════════════════════════════════════════════════"
$t0 = Get-Date

# Background memory monitor (poll every 2 s, write to log)
$memLog = "C:\Temp\barn-mem.log"
"" | Out-File $memLog -Encoding UTF8
$memJob = Start-Job -ScriptBlock {
  param($logPath)
  while ($true) {
    $proc = Get-CimInstance Win32_Process -Filter "Name='open-pdf-studio.exe'" -ErrorAction SilentlyContinue
    $workers = (Get-Process -Name 'pdfium-worker' -ErrorAction SilentlyContinue | Measure-Object).Count
    $ts = (Get-Date -Format 'HH:mm:ss')
    if ($proc) {
      $mem = [math]::Round($proc.WorkingSetSize / 1MB, 1)
      "[$ts] open-pdf-studio mem=${mem}MB workers=$workers" | Out-File $logPath -Append -Encoding UTF8
    } else {
      "[$ts] open-pdf-studio NOT RUNNING workers=$workers" | Out-File $logPath -Append -Encoding UTF8
    }
    Start-Sleep -Seconds 2
  }
} -ArgumentList $memLog

Write-Host "Memory monitor started (job $($memJob.Id))"
Write-Host "  Polling: open-pdf-studio mem + pdfium-worker count every 2s"
Write-Host "  Log: $memLog"

# Open BARN
Write-Host "`n[t=$(([math]::Round(((Get-Date) - $t0).TotalSeconds))) s] Opening BARN.pdf..."
$openResult = Invoke-Mcp 'app_open_pdf' @{ path = $barn } 90

$openMs = ((Get-Date) - $t0).TotalMilliseconds
Write-Host "[t=$([math]::Round($openMs/1000,1))s] app_open_pdf returned"
Write-Host "  ok = $($openResult.ok)"
if ($openResult.error) { Write-Host "  error = $($openResult.error)" }
if ($openResult.page_count) { Write-Host "  pages = $($openResult.page_count)" }

# Probe MCP after open call
Write-Host "`n[Verification probes]"
Start-Sleep -Seconds 2
Write-Host "  MCP alive 2s after open? $(Ping-Mcp)"

Start-Sleep -Seconds 15
Write-Host "  MCP alive 17s after open? $(Ping-Mcp)"

Start-Sleep -Seconds 20
Write-Host "  MCP alive 37s after open? $(Ping-Mcp)"

# Try to get console logs
$console = Invoke-Mcp 'app_get_recent_console' @{ tail = 100 }
if ($console.entries) {
  Write-Host "`n[Console (latest 20)]"
  $console.entries | Select-Object -Last 20 | ForEach-Object {
    Write-Host "  $([int]$_.deltaMs)ms [$($_.level)] $($_.text)"
  }
} else {
  Write-Host "`n[Console] no entries / failed: $($console.error)"
}

Write-Host "`n[Memory monitor log]"
Get-Content $memLog | Select-Object -Last 30

Stop-Job $memJob -ErrorAction SilentlyContinue
Remove-Job $memJob -ErrorAction SilentlyContinue
Write-Host "`n═════════════════════════════════════════════════════════"
Write-Host "Done. Total wall time: $([math]::Round(((Get-Date) - $t0).TotalSeconds,1))s"
