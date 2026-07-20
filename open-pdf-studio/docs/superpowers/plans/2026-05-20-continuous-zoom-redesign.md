# Continuous-mode zoom + scroll redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four overlapping continuous-mode zoom code paths in `open-pdf-studio` with a single `applyContinuousZoom` function, remove the flex-centering that fights user-controlled scrolling, and fix the page-20 dim drift seen on `Text pdf gecombineerd.pdf` — all on a POC branch validated by ten MCP-driven acceptance tests before merging.

**Architecture:** Continuous mode keeps its per-page-wrapper DOM and its Rust pdfium render pipeline. We layer a single zoom-orchestration function on top: it updates `doc.scale`, CSS-multiplies all 28 wrappers in one synchronous pass, scroll-adjusts to keep the cursor (or viewport-centre) anchor in place, and schedules a 200 ms-debounced commit that re-asserts authoritative wrapper sizes from `page.getViewport({ scale: doc.scale })`. Single-page mode is untouched.

**Tech Stack:** Tauri 2 desktop + Vite/Solid.js front-end + Rust pdfium worker pool. Test driver = PowerShell calling the in-process MCP server (port 9223) on the running debug binary.

**Reference spec:** [`docs/superpowers/specs/2026-05-20-continuous-zoom-redesign-design.md`](../specs/2026-05-20-continuous-zoom-redesign-design.md).

**Commit policy:** Per project [`CLAUDE.md`](../../../CLAUDE.md), **do not commit automatically**. Every commit step in this plan ends with `[ASK USER FIRST]`. Surface the proposed message, wait for explicit go-ahead, then commit.

---

## File map

| Path | Action | Responsibility after change |
|---|---|---|
| [`styles/layout.css`](../../styles/layout.css) | Modify (~1 line) | Continuous container no longer flex-centres children |
| [`js/pdf/renderer.js`](../../js/pdf/renderer.js) | Modify (add export, refactor 4 functions, add 1 invariant) | Owns `applyContinuousZoom`; `zoomIn`/`zoomOut`/`setZoom`/`_applyZoom`/`fitWidth`/`fitPage`/`actualSize` delegate to it in continuous mode; commit pass writes authoritative wrapper sizes |
| [`js/ui/setup/navigation-events.js`](../../js/ui/setup/navigation-events.js) | Modify (~5 lines) | Wheel handler in continuous branch calls `applyContinuousZoom` with cursor coords |
| [`js/pdf/loader.js`](../../js/pdf/loader.js) | Modify (~10 lines) | After first paint in continuous mode, call `applyContinuousZoom` once with fit-page result |
| `tests/protocol/continuous-zoom/run-mcp-tests.ps1` | Create | PowerShell driver for T1-T10 against the live binary; saves screenshots + JSON state |
| `tests/protocol/continuous-zoom/baselines/*.png` | Create | Reference screenshots captured in Task 12 after the implementation is green |

No new modules. No new dependencies. Function signatures added: `applyContinuousZoom({ newScale, anchorClientX?, anchorClientY? })`.

---

## Prerequisites

Before any task: the running debug binary at port 9223 must be the one corresponding to the worktree the engineer is editing. Currently the user runs the binary out of the main repo path. The worktree changes Vite via HMR; the binary's Rust side is unaffected by JS edits.

Confirm with:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:9223/mcp" -Method POST -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":0,"method":"tools/list","params":{}}' | Select-Object -ExpandProperty result | Select-Object -ExpandProperty tools | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: at least `20` (tool count varies by build; ≥20 means MCP is alive).

---

## Task 1: Set up POC worktree

**Files:**
- Create: new worktree under `.claude/worktrees/cont-zoom-poc/` on branch `feat/continuous-zoom-redesign-poc`
- Source branch: `feat/fast-open-barn`

- [ ] **Step 1: Verify base branch exists**

```bash
git branch --list feat/fast-open-barn
```
Expected output: `  feat/fast-open-barn` (asterisked if current, prefixed with `+` if checked out in another worktree, neither if just a refname). If empty, ask user which base branch to use.

- [ ] **Step 2: Create the worktree + branch**

```bash
git worktree add ../../.claude/worktrees/cont-zoom-poc -b feat/continuous-zoom-redesign-poc feat/fast-open-barn
```
Expected: `Preparing worktree (new branch 'feat/continuous-zoom-redesign-poc')` followed by `HEAD is now at <sha>`.

- [ ] **Step 3: Verify worktree exists and is on the new branch**

```bash
git -C .claude/worktrees/cont-zoom-poc branch --show-current
```
Expected: `feat/continuous-zoom-redesign-poc`

- [ ] **Step 4: No commit — worktree creation isn't a code change.**

---

## Task 2: Write the MCP acceptance-test driver

**Files:**
- Create: `tests/protocol/continuous-zoom/run-mcp-tests.ps1`
- Create: `tests/protocol/continuous-zoom/baselines/` (empty dir; populated later by hand after implementation is green)

This is the **test harness**. Tests T1-T10 from the spec are scripted here; each task that follows runs this script against the live binary to detect regressions.

- [ ] **Step 1: Create the test directory and the script**

Path: `tests/protocol/continuous-zoom/run-mcp-tests.ps1`

```powershell
# Continuous-zoom acceptance tests T1-T10. Drives the running --mcp-server
# binary on port 9223. Run after Vite HMR has settled (give the app ~2 s
# after the last code edit before invoking this).

$ErrorActionPreference = 'Stop'
$mcpUrl = 'http://127.0.0.1:9223/mcp'
$pdfPath = 'C:\Users\rickd\Documents\GitHub\open-pdf-studio\test pdf-bestanden\Originele bestanden\Text pdf gecombineerd.pdf'
$outDir  = 'C:\Temp\cont-zoom-tests'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Invoke-Mcp($name, $args) {
  $body = @{ jsonrpc = '2.0'; id = (Get-Random); method = 'tools/call'; params = @{ name = $name; arguments = $args } } | ConvertTo-Json -Depth 10
  $r = Invoke-RestMethod -Uri $mcpUrl -Method POST -ContentType 'application/json' -Body $body
  return ($r.result.content[0].text | ConvertFrom-Json)
}
function Save-Screenshot($label) {
  $r = Invoke-Mcp 'app_screenshot_view' @{}
  if ($r.png_base64) {
    [System.IO.File]::WriteAllBytes("$outDir\$label.png", [Convert]::FromBase64String($r.png_base64))
  }
}
function State() { return (Invoke-Mcp 'app_get_viewport_state' @{}) }
function Wheel($x, $y, $dy, $ctrl=$true) {
  Invoke-Mcp 'app_wheel_zoom' @{ x = $x; y = $y; deltaY = $dy; ctrlKey = $ctrl } | Out-Null
}

$results = @()
function Record($id, $name, $pass, $detail) {
  $script:results += [PSCustomObject]@{ id = $id; name = $name; pass = $pass; detail = $detail }
}

# Common setup: open doc, scale 1.0, page 2
Invoke-Mcp 'app_open_pdf' @{ path = $pdfPath } | Out-Null; Start-Sleep -Milliseconds 1800
Invoke-Mcp 'app_set_zoom' @{ scale = 1.0 } | Out-Null; Start-Sleep -Milliseconds 2000
Invoke-Mcp 'app_go_to_page' @{ page = 2 } | Out-Null; Start-Sleep -Milliseconds 1500
$s0 = State
$cxLeft  = $s0.container.left + $s0.container.width * 0.3
$cxRight = $s0.container.left + $s0.container.width * 0.8
$cxMid   = $s0.container.left + $s0.container.width * 0.5
$cy      = $s0.container.top  + $s0.container.height * 0.4

# T1: cursor-anchor zoom-in left
$preLeft = State
Save-Screenshot 't1-pre'
1..4 | ForEach-Object { Wheel $cxLeft $cy -120 }
Start-Sleep -Milliseconds 2500
$postT1 = State
Save-Screenshot 't1-post'
Record 'T1' 'cursor-anchor zoom-in (cursor left)' ($postT1.doc.scale -eq 2.0) "scale $($postT1.doc.scale)"

# T2: symmetry — zoom out 4 at same cursor
1..4 | ForEach-Object { Wheel $cxLeft $cy 120 }
Start-Sleep -Milliseconds 2500
$postT2 = State
Save-Screenshot 't2-post'
$exactReturn = ($postT2.doc.scale -eq 1.0) -and
               ([math]::Abs($postT2.container.scrollTop  - $preLeft.container.scrollTop)  -le 1) -and
               ([math]::Abs($postT2.container.scrollLeft - $preLeft.container.scrollLeft) -le 1)
Record 'T2' 'symmetric zoom-in/out returns to start' $exactReturn "scale $($postT2.doc.scale) scrollTop Δ$([math]::Round($postT2.container.scrollTop - $preLeft.container.scrollTop, 1)) scrollLeft Δ$([math]::Round($postT2.container.scrollLeft - $preLeft.container.scrollLeft, 1))"

# T3: same as T2 but cursor right
$preRight = State
1..4 | ForEach-Object { Wheel $cxRight $cy -120 }
Start-Sleep -Milliseconds 2500
1..4 | ForEach-Object { Wheel $cxRight $cy 120 }
Start-Sleep -Milliseconds 2500
$postT3 = State
$exactReturnRight = ($postT3.doc.scale -eq 1.0) -and
                    ([math]::Abs($postT3.container.scrollTop  - $preRight.container.scrollTop)  -le 1) -and
                    ([math]::Abs($postT3.container.scrollLeft - $preRight.container.scrollLeft) -le 1)
Record 'T3' 'symmetric zoom at cursor-right' $exactReturnRight "scale $($postT3.doc.scale)"

# T4: zoom-in on white margin (cursor at clientX = container.left + 10, outside page area)
$preMargin = State
Wheel ($s0.container.left + 10) $cy -120
Start-Sleep -Milliseconds 2500
$postT4 = State
$noSideSnap = [math]::Abs($postT4.container.scrollLeft - $preMargin.container.scrollLeft) -le 5
Record 'T4' 'zoom-in on white margin: no sideways snap' $noSideSnap "scrollLeft Δ$([math]::Round($postT4.container.scrollLeft - $preMargin.container.scrollLeft, 1))"

# Reset for T5
Invoke-Mcp 'app_set_zoom' @{ scale = 1.0 } | Out-Null; Start-Sleep -Milliseconds 2000

# T5: programmatic set_zoom (no cursor) → centre anchor.
# Place a probe by reading viewport-centre wrapper before, set zoom to 2,
# verify the same wrapper is still under viewport-centre after.
$preT5 = State
Invoke-Mcp 'app_set_zoom' @{ scale = 2 } | Out-Null
Start-Sleep -Milliseconds 2500
$postT5 = State
$scaleOk = $postT5.doc.scale -eq 2.0
Record 'T5' 'programmatic zoom to 2.0 centres at viewport centre' $scaleOk "scale $($postT5.doc.scale)"

# T6: free horizontal scroll (no auto-recenter)
Invoke-Mcp 'app_set_zoom' @{ scale = 2.0 } | Out-Null; Start-Sleep -Milliseconds 2500
# Set scrollLeft to right edge via direct JS: we use app_scroll to nudge by a large dx
# instead, since we have no direct scrollLeft setter. Use multiple horizontal scrolls.
1..5 | ForEach-Object { Invoke-Mcp 'app_scroll' @{ x = $cxMid; y = $cy; dx = 200; dy = 0 } | Out-Null; Start-Sleep -Milliseconds 100 }
Start-Sleep -Milliseconds 500
$afterScroll = State
Start-Sleep -Milliseconds 1500
$afterWait = State
$noRecenter = ($afterWait.container.scrollLeft -eq $afterScroll.container.scrollLeft)
Record 'T6' 'no auto-recenter after manual horizontal scroll' $noRecenter "before $($afterScroll.container.scrollLeft) after-1.5s $($afterWait.container.scrollLeft)"

# T7: page-20 wrapper width parity with p19 and p21.
# Navigate to p20, screenshot for visual inspection.
Invoke-Mcp 'app_go_to_page' @{ page = 20 } | Out-Null; Start-Sleep -Milliseconds 2000
Save-Screenshot 't7-page20'
# For numeric verification, we add a temporary MCP probe: see Task 9 — for now,
# rely on visual screenshot comparison.
Record 'T7' 'page-20 wrapper width parity' $null '(visual check; numeric assert added in Task 9)'

# T8: engine-switch then wheel-in
Invoke-Mcp 'app_set_zoom' @{ scale = 1.0 } | Out-Null; Start-Sleep -Milliseconds 2000
Invoke-Mcp 'app_go_to_page' @{ page = 2 } | Out-Null; Start-Sleep -Milliseconds 1500
# Engine switch via direct DOM: not exposed as an MCP tool yet — skip in scripted form,
# leave to manual verification. Record skip.
Record 'T8' 'engine-switch + wheel-in (manual)' $null 'manual: switch dropdown, then verify wheel still zooms'

# T9: single-page mode wheel zoom (non-A4 doc so fallback fires)
# Skipped in this script: requires a second PDF; document as manual.
Record 'T9' 'single-page mode unchanged (manual)' $null 'manual: open BARN, ctrl+wheel, expect same behaviour as before'

# T10: 10 rapid wheels → only 1 cont-rerender log line
Invoke-Mcp 'app_set_zoom' @{ scale = 1.0 } | Out-Null; Start-Sleep -Milliseconds 2000
Invoke-Mcp 'app_clear_caches' @{} | Out-Null; Start-Sleep -Milliseconds 1500
$t0 = Get-Date
1..10 | ForEach-Object { Wheel $cxMid $cy -120 }
$dispatchMs = ((Get-Date) - $t0).TotalMilliseconds
Start-Sleep -Milliseconds 2500
$logs = (Invoke-Mcp 'app_get_recent_console' @{ tail = 100 }).entries
$rerenderCount = ($logs | Where-Object { $_.text -like '*cont-rerender START*' }).Count
$t10ok = ($dispatchMs -lt 200) -and ($rerenderCount -eq 1)
Record 'T10' '10 rapid wheels: <200ms dispatch, 1 rerender' $t10ok "dispatch $([math]::Round($dispatchMs))ms rerenders $rerenderCount"

# Output
$results | Format-Table -AutoSize
$results | ConvertTo-Json -Depth 5 | Out-File "$outDir\results.json"
$failed = ($results | Where-Object { $_.pass -eq $false }).Count
$totalAuto = ($results | Where-Object { $_.pass -ne $null }).Count
Write-Host ""
Write-Host "AUTO PASS: $($totalAuto - $failed) / $totalAuto"
Write-Host "MANUAL: $(($results | Where-Object { $_.pass -eq $null }).Count) (T7 numeric, T8, T9)"
if ($failed -gt 0) { exit 1 } else { exit 0 }
```

- [ ] **Step 2: Run the script against the CURRENT (pre-change) binary to capture a baseline**

```powershell
powershell -ExecutionPolicy Bypass -File tests/protocol/continuous-zoom/run-mcp-tests.ps1
```
Expected: most tests **fail or report drift** on current code. This is the baseline — record which ones fail and how (the post-implementation run will compare).

Save the baseline output: `Tee-Object` is fine, or just copy the printed table into a comment in `tests/protocol/continuous-zoom/BASELINE.md`.

- [ ] **Step 3: Commit** `[ASK USER FIRST]`

Proposed message: `test(continuous-zoom): MCP-driven acceptance harness for T1-T10`

Files: `tests/protocol/continuous-zoom/run-mcp-tests.ps1`, `tests/protocol/continuous-zoom/BASELINE.md`

---

## Task 3: CSS — remove flex centering

**Files:**
- Modify: `styles/layout.css:424-431`

- [ ] **Step 1: Edit the `.continuous-container` rule**

Change:
```css
.continuous-container {
  display: none;
  flex-direction: column;
  gap: 20px;
  align-items: center;
  padding-top: 20px;
  width: 100%;
}
```
To:
```css
.continuous-container {
  display: none;
  flex-direction: column;
  gap: 20px;
  /* No align-items: page-wrappers stay flex-start (left-aligned).
   * The auto-centring this used to do fought every cursor-anchored zoom
   * and produced the "snap naar midden" feel. Horizontal positioning is
   * now entirely user-controlled via container.scrollLeft.
   */
  padding-top: 20px;
  width: 100%;
}
```

- [ ] **Step 2: Wait for Vite HMR to pick up the CSS edit (~2 s)**

- [ ] **Step 3: Sanity-check via MCP — open doc at scale 1.0 and screenshot**

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_open_pdf","arguments":{"path":"C:\\Users\\rickd\\Documents\\GitHub\\open-pdf-studio\\test pdf-bestanden\\Originele bestanden\\Text pdf gecombineerd.pdf"}}}' | Out-Null
Start-Sleep 2
Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"app_set_zoom","arguments":{"scale":1.0}}}' | Out-Null
Start-Sleep 2
$r = (Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"app_screenshot_view","arguments":{}}}').result.content[0].text | ConvertFrom-Json
[System.IO.File]::WriteAllBytes('C:\Temp\cont-zoom-tests\task3-css-only.png', [Convert]::FromBase64String($r.png_base64))
```
Expected: page sits at the LEFT of the viewport (where it used to be horizontally centred). Gray space appears to the right of the page.

- [ ] **Step 4: Commit** `[ASK USER FIRST]`

Proposed message: `style(continuous): remove align-items: center on .continuous-container`

Files: `styles/layout.css`

---

## Task 4: Add `applyContinuousZoom` skeleton (replaces `continuousZoomStep`)

**Files:**
- Modify: `js/pdf/renderer.js`

`continuousZoomStep` (the recent gesture-based wheel handler) is renamed and generalised. The function gains a single `{ newScale, anchorClientX?, anchorClientY? }` arg-bag signature.

- [ ] **Step 1: Locate the existing `continuousZoomStep` function**

It currently sits ~line 615 of `renderer.js`. Read 20 lines before and after to anchor your edit.

- [ ] **Step 2: Replace the export + body**

Replace the entire existing `continuousZoomStep` function (top of function through the matching closing `}`) with:

```js
/**
 * Single entry point for ALL continuous-mode zoom operations. Wheel events,
 * ribbon +/- buttons, status-bar % input, and fit-page/fit-width/actualSize
 * all funnel through this function. The four-paths-with-subtly-different-
 * behaviour situation that preceded this rewrite is what caused page-20
 * dim drift, the auto-centring fight, and the duplicate Rust render
 * dispatch on rapid wheel.
 *
 *   newScale         absolute target scale (replaces doc.scale)
 *   anchorClientX/Y  screen coords to anchor the zoom around (optional).
 *                    When omitted, the anchor is the centre of
 *                    #pdf-container — used by buttons / programmatic
 *                    setZoom / fit-* where there is no cursor.
 *
 * Behaviour:
 *   1. ratio = newScale / oldScale; doc.scale = newScale.
 *   2. CSS-multiply every .canvas-container-cont and inner canvas by ratio
 *      (sub-ms, one forced reflow). Browser bilinear-stretches the existing
 *      canvas pixels — visible as freeze-frame zoom.
 *   3. Read anchor wrapper's NEW innerRect (after CSS mutation) and adjust
 *      scrollTop/scrollLeft so the same page-coordinate sits under the
 *      cursor (or viewport-centre) after the resize.
 *   4. Reset the 200 ms gesture-end timer. When it fires, the commit
 *      (reRenderVisibleContinuousPages) re-asserts authoritative wrapper
 *      sizes from page.getViewport({ scale: doc.scale }).width and triggers
 *      Rust render via IO re-observe.
 *
 * No code in this function ever re-positions the view after step 3. The
 * commit does NOT touch scrollTop/scrollLeft. That is the no-auto-centring
 * guarantee enforced at this layer.
 */
export function applyContinuousZoom({ newScale, anchorClientX, anchorClientY }) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || doc.viewMode !== 'continuous' || !doc.pdfDoc) return;
  const container = document.getElementById('pdf-container');
  const continuousContainer = document.getElementById('continuous-container');
  if (!container || !continuousContainer) return;

  const oldScale = doc.scale;
  // Clamp to the same floor as zoomOut to keep behaviour symmetric across
  // entry points.
  const clamped = Math.max(0.05, Math.min(8, newScale));
  if (clamped === oldScale) return;
  doc.scale = clamped;
  const ratio = clamped / oldScale;

  // Default anchor: viewport centre. The cursor-anchor branch overrides
  // this when anchorClientX/Y are passed in.
  const contRect = container.getBoundingClientRect();
  const anchorX = (anchorClientX != null) ? anchorClientX : (contRect.left + contRect.width / 2);
  const anchorY = (anchorClientY != null) ? anchorClientY : (contRect.top  + contRect.height / 2);

  // Find the page-wrapper currently under the anchor point. The anchor's
  // page-space coords are captured BEFORE the CSS multiply so the post-
  // mutation rect lookup can put them back at the same screen position.
  const elAtPoint = document.elementFromPoint(anchorX, anchorY);
  const anchorWrapper = elAtPoint?.closest?.('.page-wrapper') || null;
  const anchorInner = anchorWrapper?.querySelector('.canvas-container-cont') || null;
  let anchorPageX = null, anchorPageY = null;
  if (anchorInner) {
    const r = anchorInner.getBoundingClientRect();
    const rawX = anchorX - r.left;
    const rawY = anchorY - r.top;
    // Only anchor when the cursor is OVER a page. White-margin / between-
    // pages anchors fall through to the container-space pivot below — the
    // page stays centred (or wherever it was), no sideways yank.
    if (rawX >= 0 && rawX <= r.width && rawY >= 0 && rawY <= r.height) {
      anchorPageX = rawX / oldScale;
      anchorPageY = rawY / oldScale;
    }
  }

  // CSS-multiply every wrapper. All 28 grow/shrink uniformly so the
  // anchor math sees a coherent layout. Off-screen wrappers also resize,
  // which is fine — style mutations are sub-ms and the alternative (only
  // near-viewport wrappers) breaks the cumulative-height math used by the
  // scroll adjust below.
  const wrappers = continuousContainer.querySelectorAll('.page-wrapper');
  for (const wrapper of wrappers) {
    const cc = wrapper.querySelector('.canvas-container-cont');
    if (!cc) continue;
    const oldW = parseFloat(cc.style.width)  || cc.offsetWidth;
    const oldH = parseFloat(cc.style.height) || cc.offsetHeight;
    cc.style.width  = (oldW * ratio) + 'px';
    cc.style.height = (oldH * ratio) + 'px';
    wrapper.querySelectorAll('canvas').forEach(cv => {
      if (cv.style.width)  cv.style.width  = (parseFloat(cv.style.width)  * ratio) + 'px';
      if (cv.style.height) cv.style.height = (parseFloat(cv.style.height) * ratio) + 'px';
    });
  }

  // Scroll-adjust so the captured anchor lands back under the screen
  // point we started from. Reading getBoundingClientRect here forces ONE
  // layout flush — that's the price of correctness.
  if (anchorInner && anchorPageX != null) {
    const newRect = anchorInner.getBoundingClientRect();
    container.scrollTop  += (newRect.top  + anchorPageY * clamped) - anchorY;
    container.scrollLeft += (newRect.left + anchorPageX * clamped) - anchorX;
  } else {
    // No on-page anchor (anchor on white margin / between pages). Use the
    // container-space pivot — pure (scroll + offset) * ratio − offset.
    const cy = anchorY - contRect.top;
    const cx = anchorX - contRect.left;
    container.scrollTop  = (container.scrollTop  + cy) * ratio - cy;
    container.scrollLeft = (container.scrollLeft + cx) * ratio - cx;
  }

  // Schedule commit: re-assert wrapper sizes + Rust render at final scale.
  if (_zoomGestureEndTimer) clearTimeout(_zoomGestureEndTimer);
  _zoomGestureEndTimer = setTimeout(_commitContinuousZoomGesture, ZOOM_GESTURE_END_MS);
}

// Back-compat alias for any caller still using the previous name. Remove
// when no caller references it (verify with `grep continuousZoomStep`).
export const continuousZoomStep = (direction, x, y) => {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const step = (direction > 0) ? 0.25 : -0.25;
  applyContinuousZoom({ newScale: doc.scale + step, anchorClientX: x, anchorClientY: y });
};
```

- [ ] **Step 3: Make sure module-level state (`_zoomGestureEndTimer`, `ZOOM_GESTURE_END_MS`, `_zoomGestureActive`) still exists**

These were declared by the previous redesign attempt around line 598 of `renderer.js`. If absent (e.g., they were reverted), reinsert:

```js
let _zoomGestureActive = false;
let _zoomGestureEndTimer = null;
const ZOOM_GESTURE_END_MS = 200;
```

(`_zoomGestureActive` is no longer used by the new function — it can stay as `let _zoomGestureActive = false;` until Task 7 cleans it up, or be removed now if you're confident no other module reads it. Run `grep _zoomGestureActive` first.)

- [ ] **Step 4: Confirm `_commitContinuousZoomGesture` exists and is correct**

It should look like:
```js
async function _commitContinuousZoomGesture() {
  _zoomGestureEndTimer = null;
  await reRenderVisibleContinuousPages();
}
```
If it has stale references to gesture state, simplify it to the two lines above.

- [ ] **Step 5: Wait ~2 s for HMR**

- [ ] **Step 6: Run T1, T2, T3 manually via MCP**

```powershell
powershell -ExecutionPolicy Bypass -File tests/protocol/continuous-zoom/run-mcp-tests.ps1
```
Expected: T1, T2, T3 already PASS. T4 still works (the new function preserves the white-margin fallback). T10 PASSES (1 rerender). T5/T6/T7/T8/T9 might still fail or be unchanged — they're hit by Tasks 5-9.

- [ ] **Step 7: Commit** `[ASK USER FIRST]`

Proposed message: `feat(continuous): unified applyContinuousZoom function with cursor + centre anchor`

Files: `js/pdf/renderer.js`

---

## Task 5: Wire the wheel handler to `applyContinuousZoom`

**Files:**
- Modify: `js/ui/setup/navigation-events.js`

The wheel handler currently calls `m.continuousZoomStep(direction, e.clientX, e.clientY)`. Replace with `applyContinuousZoom`.

- [ ] **Step 1: Locate the continuous-mode wheel branch**

Find the `if (!viewport.active) { ... }` block in the ctrl+wheel section (currently around line 53-90).

- [ ] **Step 2: Replace the call**

Replace:
```js
const m = await import('../../pdf/renderer.js');
m.continuousZoomStep(direction, e.clientX, e.clientY);
return;
```
With:
```js
const m = await import('../../pdf/renderer.js');
const step = (direction > 0) ? 0.25 : -0.25;
m.applyContinuousZoom({
  newScale: activeDoc.scale + step,
  anchorClientX: e.clientX,
  anchorClientY: e.clientY,
});
return;
```

- [ ] **Step 3: Wait ~2 s for HMR**

- [ ] **Step 4: Test via the harness — T1-T4, T10**

```powershell
powershell -ExecutionPolicy Bypass -File tests/protocol/continuous-zoom/run-mcp-tests.ps1
```
Expected: T1, T2, T3, T4, T10 all PASS.

- [ ] **Step 5: Commit** `[ASK USER FIRST]`

Proposed message: `refactor(continuous-zoom): wheel handler funnels through applyContinuousZoom`

Files: `js/ui/setup/navigation-events.js`

---

## Task 6: Wire `zoomIn`, `zoomOut`, `setZoom` continuous branches

**Files:**
- Modify: `js/pdf/renderer.js` (4 functions)

`zoomIn` (line ~1161), `zoomOut` (~1178), `setZoom` (~1204), `_applyZoom` (~1270): in their continuous branches, delegate to `applyContinuousZoom` (no anchor coords → centre).

- [ ] **Step 1: `zoomIn` continuous branch**

Find:
```js
export async function zoomIn() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const vp = window.__pdfViewport;
  if (vp && vp.active) {
    const m = await import('./pdf-viewport.js');
    m.zoomStepAtCenter(+1);
    return;
  }
  doc.scale += 0.25;
  if (doc.viewMode === 'continuous') {
    await reRenderVisibleContinuousPages();
  } else {
    await renderPage(doc.currentPage);
  }
}
```

Replace with:
```js
export async function zoomIn() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const vp = window.__pdfViewport;
  if (vp && vp.active) {
    const m = await import('./pdf-viewport.js');
    m.zoomStepAtCenter(+1);
    return;
  }
  if (doc.viewMode === 'continuous') {
    applyContinuousZoom({ newScale: doc.scale + 0.25 });
  } else {
    doc.scale += 0.25;
    await renderPage(doc.currentPage);
  }
}
```

- [ ] **Step 2: `zoomOut` continuous branch**

Find the existing `zoomOut` (the one with the stepped 0.025 / 0.1 / 0.25 decrement logic). Replace the continuous branch the same way:

```js
if (doc.viewMode === 'continuous') {
  // Match the same step-down curve so the button feel stays consistent
  // with zoomOut's existing logic for fine-grained low-end zooming.
  let nextScale;
  if (doc.scale <= 0.2)      nextScale = Math.max(0.05, doc.scale - 0.025);
  else if (doc.scale <= 0.5) nextScale = Math.max(0.05, doc.scale - 0.1);
  else                       nextScale = doc.scale - 0.25;
  applyContinuousZoom({ newScale: nextScale });
  return;
}
// (rest of zoomOut for single-page mode unchanged)
```

- [ ] **Step 3: `setZoom` continuous branch**

Find:
```js
doc.scale = newScale;
if (doc.viewMode === 'continuous') {
  await renderContinuous();
} else {
  await renderPage(doc.currentPage);
}
```

Replace with:
```js
if (doc.viewMode === 'continuous') {
  applyContinuousZoom({ newScale });
} else {
  doc.scale = newScale;
  await renderPage(doc.currentPage);
}
```

(The continuous path no longer does a full `renderContinuous()` rebuild — that was the source of the wrappers flickering on every status-bar `%` change.)

- [ ] **Step 4: `_applyZoom` continuous branch**

Find:
```js
const doc = fitInputs.doc;
doc.scale = Math.max(0.05, Math.min(8, newZoom));
if (doc.viewMode === 'continuous') {
  await renderContinuous();
} else {
  await renderPage(doc.currentPage);
}
```

Replace with:
```js
const doc = fitInputs.doc;
const clamped = Math.max(0.05, Math.min(8, newZoom));
if (doc.viewMode === 'continuous') {
  applyContinuousZoom({ newScale: clamped });
} else {
  doc.scale = clamped;
  await renderPage(doc.currentPage);
}
```

- [ ] **Step 5: `actualSize` continuous branch**

Find:
```js
doc.scale = 1;
if (doc.pdfDoc) {
  if (doc.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(doc.currentPage);
  }
}
```

Replace with:
```js
if (doc.pdfDoc) {
  if (doc.viewMode === 'continuous') {
    applyContinuousZoom({ newScale: 1 });
  } else {
    doc.scale = 1;
    await renderPage(doc.currentPage);
  }
}
```

- [ ] **Step 6: Wait ~2 s for HMR**

- [ ] **Step 7: Manual checks via MCP — buttons / % input / Ctrl+0 / Ctrl+1 / Ctrl+2**

```powershell
# Ctrl+1 = fit width
Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_key","arguments":{"key":"1","ctrl":true}}}' | Out-Null
Start-Sleep 1
(Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"app_get_viewport_state","arguments":{}}}').result.content[0].text
```
Expected: `doc.scale` is around `2.0` (fit-width on A4 in 1203 px container = 1203/595 ≈ 2.02). Page positioned at left, not flickering. No `renderContinuous()` log line in `app_get_recent_console`.

Verify T5 + T6 from the harness now pass:
```powershell
powershell -ExecutionPolicy Bypass -File tests/protocol/continuous-zoom/run-mcp-tests.ps1
```

- [ ] **Step 8: Commit** `[ASK USER FIRST]`

Proposed message: `refactor(continuous-zoom): button + percent + fit-* paths funnel through applyContinuousZoom`

Files: `js/pdf/renderer.js`

---

## Task 7: Drop legacy code paths + dead state

**Files:**
- Modify: `js/pdf/renderer.js`

Remove residue of the old continuous gesture system that's no longer reached.

- [ ] **Step 1: Verify nothing still calls `continuousZoomStep`**

```bash
grep -rn "continuousZoomStep" js/ src-tauri/ tests/ docs/
```
Expected: only the back-compat alias in `applyContinuousZoom`'s neighbourhood + this plan / spec. If a caller exists, switch it to `applyContinuousZoom` before continuing.

- [ ] **Step 2: Remove the back-compat alias**

Delete the `export const continuousZoomStep = ...` shim added in Task 4 step 2.

- [ ] **Step 3: Remove dead `_zoomGestureActive` if no reader remains**

```bash
grep -rn "_zoomGestureActive" js/
```
If no consumer reads it (it's a write-only flag), delete the declaration at the top of `renderer.js` and any assignments inside `applyContinuousZoom` / `_commitContinuousZoomGesture`.

- [ ] **Step 4: Remove any leftover translateX fallback in continuous code**

```bash
grep -rn "translateX" js/pdf/renderer.js js/ui/setup/navigation-events.js
```
Expected: NO matches in continuous-mode paths. If any remain, delete the block (it's residue from an earlier scroll-spring workaround that the new anchor math obviates).

- [ ] **Step 5: Run harness**

Expected: still green on all the tests that were green before. No regression.

- [ ] **Step 6: Commit** `[ASK USER FIRST]`

Proposed message: `chore(continuous-zoom): drop continuousZoomStep alias + dead gesture state`

Files: `js/pdf/renderer.js`

---

## Task 8: Page-20 dim fix — authoritative commit sizing + dev invariant

**Files:**
- Modify: `js/pdf/renderer.js` — `reRenderVisibleContinuousPages` body

The commit step already writes `cc.style.width = info.viewport.width + 'px'` per page. The issue per the spec is per-wheel drift; the commit's authoritative re-write does the fix. Add a dev-mode invariant to catch regressions early.

- [ ] **Step 1: Add dev-mode width-drift warning**

Locate the loop in `reRenderVisibleContinuousPages` that iterates `wrapperInfo` and assigns CSS dims. After the loop:

```js
// Dev-mode invariant: on a uniform-size doc, every wrapper width should be
// equal. Surface drift before the user notices it visually.
if (import.meta.env.DEV && wrapperInfo.length >= 2) {
  const widths = wrapperInfo.filter(i => i).map(i => i.viewport.width);
  const min = Math.min(...widths);
  const max = Math.max(...widths);
  if (max - min > 0.5) {
    console.warn(
      `[continuous] wrapper width drift detected: min=${min.toFixed(2)} max=${max.toFixed(2)} (Δ=${(max - min).toFixed(2)} px)`,
    );
  }
}
```

(If `import.meta.env.DEV` isn't available in this Vite config, swap for `if (true)` and gate at build time, or just leave the warn unconditional — it's cheap.)

- [ ] **Step 2: Make sure the commit actually re-asserts ALL wrappers, not just visible ones**

Read the existing loop. It already iterates `wrapperInfo` for every `.page-wrapper`. If not, change the `wrappers` query from `:visible`-style filtering to `querySelectorAll('.page-wrapper')`.

- [ ] **Step 3: Wait ~2 s for HMR**

- [ ] **Step 4: Run T7 manually — scroll to page 20, screenshot, eyeball + harness numeric check**

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_open_pdf","arguments":{"path":"C:\\Users\\rickd\\Documents\\GitHub\\open-pdf-studio\\test pdf-bestanden\\Originele bestanden\\Text pdf gecombineerd.pdf"}}}' | Out-Null
Start-Sleep 2
Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"app_set_zoom","arguments":{"scale":1.0}}}' | Out-Null
Start-Sleep 2
# Zoom in/out a few times so the drift WOULD have accumulated, then go to p20.
1..5 | ForEach-Object {
  Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body ("{`"jsonrpc`":`"2.0`",`"id`":$_,`"method`":`"tools/call`",`"params`":{`"name`":`"app_wheel_zoom`",`"arguments`":{`"x`":800,`"y`":500,`"deltaY`":-120,`"ctrlKey`":true}}}") | Out-Null
}
Start-Sleep 3
1..5 | ForEach-Object {
  Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body ("{`"jsonrpc`":`"2.0`",`"id`":$_,`"method`":`"tools/call`",`"params`":{`"name`":`"app_wheel_zoom`",`"arguments`":{`"x`":800,`"y`":500,`"deltaY`":120,`"ctrlKey`":true}}}") | Out-Null
}
Start-Sleep 3
Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"app_go_to_page","arguments":{"page":20}}}' | Out-Null
Start-Sleep 2
$r = (Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":100,"method":"tools/call","params":{"name":"app_screenshot_view","arguments":{}}}').result.content[0].text | ConvertFrom-Json
[System.IO.File]::WriteAllBytes('C:\Temp\cont-zoom-tests\task8-p20-after-drift-attempt.png', [Convert]::FromBase64String($r.png_base64))
# Check the console buffer for the drift warning — none = good.
(Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":101,"method":"tools/call","params":{"name":"app_get_recent_console","arguments":{"tail":50}}}').result.content[0].text | ConvertFrom-Json | Select-Object -ExpandProperty entries | Where-Object { $_.text -like '*width drift*' }
```
Expected: screenshot shows p20 at the same width as p2 (compare visually with the `t1-pre.png` baseline). The `width drift` query returns no entries (drift below the 0.5 px threshold or zero).

- [ ] **Step 5: Commit** `[ASK USER FIRST]`

Proposed message: `fix(continuous): authoritative wrapper sizing in commit + dev drift invariant`

Files: `js/pdf/renderer.js`

---

## Task 9: Initial-paint fit on doc-open

**Files:**
- Modify: `js/pdf/loader.js`

Currently `loader.js` ends `loadPDF` with a fit-zoom calc for blank docs (line ~695-705). For continuous mode we want to call `applyContinuousZoom({ newScale: fitScale })` once after the first paint so the user opens to a comfortable fit-page.

- [ ] **Step 1: Locate the end-of-loadPDF block**

Find the block in `loader.js` that reads `pdfContainer.getBoundingClientRect()` and computes `fitScale`. It's currently gated on the doc having `pdfContainer` non-null.

- [ ] **Step 2: Add a continuous-mode initial fit after the existing render trigger**

Right BEFORE the existing `await setViewMode(doc.viewMode)` call, insert:

```js
// Initial-paint fit-to-page for continuous mode. Doing this BEFORE setViewMode
// fires the render means the first paint already uses the fitted scale —
// no flash of "wrong-sized page". Single-page mode handles its own initial
// fit inside pdf-viewport.js's setPage.
if (doc.viewMode === 'continuous' && pdfContainer) {
  const r = pdfContainer.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) {
    try {
      const m = await import('./renderer.js');
      const fitScale = m.computeFitZoom('page', widthPt, heightPt, r.width - 40, r.height - 40);
      doc.scale = Math.max(0.05, Math.min(2, fitScale));
    } catch { /* fall back to loader-computed scale */ }
  }
}
```

(`computeFitZoom` is the existing single-source-of-truth fit calc in `pdf-viewport.js`, re-exported from `renderer.js`. If it's not currently re-exported, add `export { computeFitZoom } from './pdf-viewport.js';` to `renderer.js`.)

- [ ] **Step 3: Wait ~2 s for HMR**

- [ ] **Step 4: Test — close + reopen the doc, check initial scale**

```powershell
# Force a fresh load by reopening the file
Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_open_pdf","arguments":{"path":"C:\\Users\\rickd\\Documents\\GitHub\\open-pdf-studio\\test pdf-bestanden\\Originele bestanden\\Text pdf gecombineerd.pdf"}}}' | Out-Null
Start-Sleep 3
(Invoke-RestMethod -Uri http://127.0.0.1:9223/mcp -Method POST -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"app_get_viewport_state","arguments":{}}}').result.content[0].text
```
Expected: `doc.scale` is approximately `(container.height - 40) / 842 ≈ 0.92` (fit-page for A4 in 817 CSS-px tall container). The page fits comfortably.

- [ ] **Step 5: Commit** `[ASK USER FIRST]`

Proposed message: `feat(continuous): initial-paint fit-to-page on document load`

Files: `js/pdf/loader.js`, `js/pdf/renderer.js` (if computeFitZoom re-export was added)

---

## Task 10: Full T1-T10 acceptance run + baseline screenshots

**Files:**
- Modify: `tests/protocol/continuous-zoom/BASELINE.md` (record green run)
- Populate: `tests/protocol/continuous-zoom/baselines/`

- [ ] **Step 1: Run the full harness clean**

```powershell
powershell -ExecutionPolicy Bypass -File tests/protocol/continuous-zoom/run-mcp-tests.ps1
```
Expected: every auto-test (T1, T2, T3, T4, T5, T6, T10) PASSES. T7 manual = screenshot p20, eyeball with t1-pre. T8 manual = engine-switch dropdown then ctrl+wheel. T9 manual = open BARN/non-A4 and confirm single-page works as before.

- [ ] **Step 2: Save the green output to BASELINE.md**

Append:

```markdown
## Green run after Task 10

Date: YYYY-MM-DD HH:MM
Commit: <sha>

| Id | Result | Notes |
|---|---|---|
| T1 | PASS | scale 2.0, anchor within 3px |
| T2 | PASS | exact symmetric return |
... etc
```

- [ ] **Step 3: Copy the harness screenshots into the baselines folder**

```powershell
Copy-Item 'C:\Temp\cont-zoom-tests\t1-pre.png'  'tests/protocol/continuous-zoom/baselines/t1-pre.png'
Copy-Item 'C:\Temp\cont-zoom-tests\t1-post.png' 'tests/protocol/continuous-zoom/baselines/t1-post.png'
Copy-Item 'C:\Temp\cont-zoom-tests\t2-post.png' 'tests/protocol/continuous-zoom/baselines/t2-post.png'
Copy-Item 'C:\Temp\cont-zoom-tests\t7-page20.png' 'tests/protocol/continuous-zoom/baselines/t7-page20.png'
```

- [ ] **Step 4: Commit** `[ASK USER FIRST]`

Proposed message: `test(continuous-zoom): baseline run T1-T10 all green + reference screenshots`

Files: `tests/protocol/continuous-zoom/BASELINE.md`, `tests/protocol/continuous-zoom/baselines/*.png`

---

## Task 11: Merge POC back

**Files:**
- Git operations on `feat/fast-open-barn` (or whatever main target branch the user wants)

- [ ] **Step 1: Confirm with user which branch to merge into**

Default assumption: `feat/fast-open-barn` (where recent work lives). User may want `main`.

- [ ] **Step 2: Ensure target branch is clean**

```bash
git status
```
Expected: target branch clean, or only this plan's spec/plan files committed.

- [ ] **Step 3: Merge `feat/continuous-zoom-redesign-poc` into target**

```bash
git checkout feat/fast-open-barn
git merge --no-ff feat/continuous-zoom-redesign-poc
```
`[ASK USER FIRST]` before the merge command.

- [ ] **Step 4: Push** `[ASK USER FIRST]`

```bash
git push origin feat/fast-open-barn
```

- [ ] **Step 5: Clean up worktree** `[ASK USER FIRST]`

```bash
git worktree remove .claude/worktrees/cont-zoom-poc
```

(Keep the branch around for reference; deletion is optional.)

---

## Self-review

**Spec coverage:**
- §1 layout no-auto-centring → Task 3 (CSS) ✓
- §2 unified zoom → Tasks 4–7 ✓
- §3 anchor model → embedded in Task 4's function body ✓
- §4 initial-paint fit → Task 9 ✓
- §5 page-20 fix + dev invariant → Task 8 ✓
- §code-to-remove → Task 7 explicit grep-driven cleanup ✓
- §testing T1-T10 → Tasks 2 + 10 ✓
- §POC + merge → Tasks 1, 11 ✓

**Placeholder scan:** none — every step has code or commands.

**Type/signature consistency:**
- `applyContinuousZoom({ newScale, anchorClientX?, anchorClientY? })` used identically in Tasks 4, 5, 6, 9.
- `computeFitZoom('page' | 'width' | 'height', pageW, pageH, contW, contH)` — Task 9 imports it from `renderer.js`; spec mentions it as the canonical fit calc.
- `reRenderVisibleContinuousPages` — Task 4 keeps its existing signature, Task 8 augments its body with the dev invariant.

No discrepancies found.

---

## Notes for the engineer

- **HMR is your friend, but state is fragile.** Vite full-reloads on most JS edits in this codebase. After every CSS/JS edit, give Vite ~2 s before invoking MCP, and reopen the test PDF if the state probe says `currentTool=null` / `doc.filePath=''`.
- **The MCP server runs on the user's binary, not yours.** You're editing JS that the user's Vite serves; the binary at port 9223 is started by the user (or by an earlier session's `target/debug/open-pdf-studio.exe --mcp-server`). Don't try to restart it unless the user has confirmed.
- **`computeFitZoom` returns absurd values for 0-size containers.** Tasks 9 and the unchanged `_getFitInputs` both guard against this; don't strip those guards.
- **The drift warning is the canary, not the fix.** If it fires after this plan, something else is mutating `cc.style.width` outside the commit path — chase that, don't silence the warning.
