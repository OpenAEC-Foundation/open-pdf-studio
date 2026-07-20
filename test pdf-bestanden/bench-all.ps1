$ErrorActionPreference = 'Continue'
$mcpUrl = 'http://127.0.0.1:9223/mcp'
$outDir = 'C:\Temp\pdf-bench'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Invoke-Mcp($name, $mcpArgs) {
  $body = @{ jsonrpc='2.0'; id=(Get-Random); method='tools/call'; params=@{ name=$name; arguments=$mcpArgs } } | ConvertTo-Json -Depth 10
  try {
    $r = Invoke-RestMethod -Uri $mcpUrl -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 90
    return ($r.result.content[0].text | ConvertFrom-Json)
  } catch {
    return @{ ok=$false; error=$_.Exception.Message }
  }
}

$pdfs = @(
  'Tekst.pdf',
  'Technische tekening.pdf',
  'rapport-constructie.pdf',
  'Text pdf gecombineerd.pdf',
  'Combinatie Raster, vector, tekening images.pdf',
  '2885 Demo project.pdf',
  'Zware vector PDF.pdf',
  '3131-CLT-Set.pdf',
  '20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf',
  'NKE2D2_opm_aw.pdf',
  'NKD1a_opm_aw.pdf'
)

$results = @()
foreach ($pdf in $pdfs) {
  $path = "C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\$pdf"
  if (-not (Test-Path $path)) { Write-Host "SKIP missing: $pdf"; continue }
  $size = (Get-Item $path).Length / 1MB

  # Clear caches between PDFs so each test is cold
  Invoke-Mcp 'app_clear_caches' @{} | Out-Null
  Start-Sleep -Milliseconds 500

  Write-Host ("=" * 70)
  Write-Host "TEST: $pdf ($([math]::Round($size,1)) MB)"
  Write-Host ("=" * 70)

  $t0 = Get-Date
  $openResult = Invoke-Mcp 'app_open_pdf' @{ path = $path }
  $openMs = ((Get-Date) - $t0).TotalMilliseconds

  # Wait for thumbnails + initial render to settle
  Start-Sleep -Milliseconds 4000

  # Collect state + console logs
  $state = Invoke-Mcp 'app_get_viewport_state' @{}
  $console = Invoke-Mcp 'app_get_recent_console' @{ tail = 200 }

  # Extract timing from console
  $perfLogs = @($console.entries | Where-Object { $_.text -match '\[PERF\]|\[Thumbnails\]|batch-prefetch' })
  $thumbBatchLog = $perfLogs | Where-Object { $_.text -match 'batch-prefetch:' } | Select-Object -First 1
  $generateThumbStart = $perfLogs | Where-Object { $_.text -match 'generateThumbnails START' } | Select-Object -First 1
  $setViewModeStart = $perfLogs | Where-Object { $_.text -match 'setViewMode START' } | Select-Object -First 1
  $setViewModeDone = $perfLogs | Where-Object { $_.text -match 'setViewMode DONE' } | Select-Object -First 1
  $loadStart = $perfLogs | Where-Object { $_.text -match 'loadPDF START' } | Select-Object -First 1

  # Screenshot
  $shotName = ($pdf -replace '[^a-zA-Z0-9]', '_') -replace '__+', '_'
  $shot = Invoke-Mcp 'app_screenshot_view' @{}
  if ($shot.png_base64) {
    [System.IO.File]::WriteAllBytes("$outDir\$shotName.png", [Convert]::FromBase64String($shot.png_base64))
  }

  $row = [PSCustomObject]@{
    pdf = $pdf
    sizeMB = [math]::Round($size, 1)
    pages = $state.doc.currentPage_total_estimate
    pageCount = if ($state.doc.scale) { 'open' } else { 'failed' }
    openMs = [math]::Round($openMs)
    setViewModeMs = if ($setViewModeStart -and $setViewModeDone) { $true } else { $null }
    thumbBatch = if ($thumbBatchLog) { $thumbBatchLog.text } else { '(no batch log)' }
    docScale = $state.doc.scale
    viewMode = $state.doc.viewMode
    engine = $state.engine
  }
  $results += $row

  # Print per-PDF perf logs
  Write-Host "  Open total: $([math]::Round($openMs)) ms"
  Write-Host "  doc.scale: $($state.doc.scale)"
  Write-Host "  viewMode:  $($state.doc.viewMode)"
  Write-Host "  engine:    $($state.engine)"
  if ($thumbBatchLog) {
    Write-Host "  Thumb-batch: $($thumbBatchLog.text)"
  } else {
    Write-Host "  Thumb-batch: NO LOG FOUND"
  }
  Write-Host ""
}

Write-Host ""
Write-Host "============================================"
Write-Host "SUMMARY"
Write-Host "============================================"
$results | Format-Table -AutoSize -Property pdf,sizeMB,openMs,docScale,viewMode,engine
$results | ConvertTo-Json -Depth 5 | Out-File "$outDir\results.json"
Write-Host ""
Write-Host "Screenshots: $outDir"
