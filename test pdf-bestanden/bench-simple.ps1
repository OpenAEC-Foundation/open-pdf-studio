$ErrorActionPreference = 'Continue'
$mcpUrl = 'http://127.0.0.1:9223/mcp'
$outDir = 'C:\Temp\pdf-bench-final'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Invoke-Mcp($name, $mcpArgs) {
  $body = @{ jsonrpc='2.0'; id=(Get-Random); method='tools/call'; params=@{ name=$name; arguments=$mcpArgs } } | ConvertTo-Json -Depth 10
  try {
    $r = Invoke-RestMethod -Uri $mcpUrl -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 60
    return ($r.result.content[0].text | ConvertFrom-Json)
  } catch {
    return @{ ok=$false; error=$_.Exception.Message }
  }
}

# Wait for MCP
while ($true) {
  try { Invoke-RestMethod -Uri $mcpUrl -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' -TimeoutSec 5 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
}
Start-Sleep -Seconds 4   # wait for WebView UI to settle

$pdfs = @(
  @{ name='Tekst.pdf';                                              expect='5 pages small text' },
  @{ name='Technische tekening.pdf';                                expect='4 pages vector drawings' },
  @{ name='rapport-constructie.pdf';                                expect='construction report' },
  @{ name='Text pdf gecombineerd.pdf';                              expect='28 A4 text pages' },
  @{ name='Combinatie Raster, vector, tekening images.pdf';         expect='mixed raster+vector' },
  @{ name='2885 Demo project.pdf';                                  expect='37MB demo' },
  @{ name='Zware vector PDF.pdf';                                   expect='heavy vector' },
  @{ name='3131-CLT-Set.pdf';                                       expect='CLT set' },
  @{ name='20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf'; expect='BARN — large construction' },
  @{ name='NKE2D2_opm_aw.pdf';                                      expect='NKE2D2' },
  @{ name='NKD1a_opm_aw.pdf';                                       expect='NKD1a — user reported stuck here' }
)

$results = @()
foreach ($entry in $pdfs) {
  $pdf = $entry.name
  $expect = $entry.expect
  $path = "C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\$pdf"
  if (-not (Test-Path $path)) { continue }
  $size = (Get-Item $path).Length / 1MB

  Invoke-Mcp 'app_clear_caches' @{} | Out-Null
  Start-Sleep -Milliseconds 600

  Write-Host ("=" * 70)
  Write-Host "OPEN: $pdf ($([math]::Round($size,1)) MB)"
  Write-Host "      $expect"

  $t0 = Get-Date
  $openResult = Invoke-Mcp 'app_open_pdf' @{ path = $path }
  $openMs = ((Get-Date) - $t0).TotalMilliseconds
  $crashed = $false
  if (-not $openResult -or -not $openResult.ok) {
    $crashed = $true
    Write-Host "  !!  open returned not-ok: $($openResult.error)"
  }

  Start-Sleep -Milliseconds 4500
  $state = Invoke-Mcp 'app_get_viewport_state' @{}
  $console = Invoke-Mcp 'app_get_recent_console' @{ tail = 200 }

  # Parse classification + render path
  $classifyLine = ($console.entries | Where-Object { $_.text -match 'analyze_page_type_batch.*pages.*vector=' } | Select-Object -First 1).text
  $cls = if ($classifyLine -match 'vector=(\d+), tile=(\d+)') { @{ vector=[int]$matches[1]; tile=[int]$matches[2] } } else { @{ vector=0; tile=0 } }

  # Screenshot
  $shotName = ($pdf -replace '[^a-zA-Z0-9]', '_') -replace '__+', '_'
  $shot = Invoke-Mcp 'app_screenshot_view' @{}
  if ($shot.png_base64) {
    [System.IO.File]::WriteAllBytes("$outDir\$shotName.png", [Convert]::FromBase64String($shot.png_base64))
  }

  $row = [PSCustomObject]@{
    pdf = $pdf
    sizeMB = [math]::Round($size, 1)
    openMs = [math]::Round($openMs)
    pages = $openResult.page_count
    vectorPages = $cls.vector
    tilePages = $cls.tile
    viewMode = if ($state.doc) { $state.doc.viewMode } else { 'crash?' }
    initialScale = if ($state.doc -and $state.doc.scale) { [math]::Round($state.doc.scale, 3) } else { $null }
    engine = $state.engine
    crashed = $crashed
  }
  $results += $row

  Write-Host "  Open total:  $([math]::Round($openMs)) ms"
  Write-Host "  Pages:       $($openResult.page_count) (vector=$($cls.vector) tile=$($cls.tile))"
  Write-Host "  ViewMode:    $($row.viewMode) (verwacht: single)"
  Write-Host "  Engine:      $($state.engine)"
  Write-Host "  doc.scale:   $($row.initialScale)"
  Write-Host ""
}

Write-Host ""
Write-Host "============================================================"
Write-Host "FINAL TABLE"
Write-Host "============================================================"
$results | Format-Table -AutoSize
$results | ConvertTo-Json -Depth 5 | Out-File "$outDir\results.json"
Write-Host ""
Write-Host "Screenshots: $outDir"
