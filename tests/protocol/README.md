# Test Protocol — MCP-driven release scenarios

End-to-end test scenarios for Open PDF Studio that drive the **live Tauri
app** via the in-process MCP server (port 9223). Each scenario is a JSON
file: setup → steps → assertions, with optional screenshot capture.

The goal is to catch the kind of bugs that escape unit tests because they
only manifest in the actual render/layout/event pipeline (zoom anchor
math, view-mode auto-fallback, tool dispatcher wiring, etc.).

---

## How to run

1. Start the Tauri binary with the MCP server enabled:

   ```powershell
   cd open-pdf-studio
   npm run dev                                                 # vite on 3041
   # in a second terminal:
   .\src-tauri\target\debug\open-pdf-studio.exe --mcp-server --mcp-port 9223
   ```

2. Run the protocol from the repo root:

   ```bash
   node tests/protocol/runner.mjs              # all scenarios
   node tests/protocol/runner.mjs 02-zoom      # only scenarios whose
                                               # filename contains 02-zoom
   ```

3. Inspect results: `tests/protocol/results/<timestamp>/<scenario>/`
   contains `report.json` (assertions + probes) and any screenshots.

`runner.mjs` exits 0 on full pass, 1 on assertion failure, 2 on bad input,
3 if the MCP server isn't reachable. CI-friendly.

---

## Scenario JSON schema

```json
{
  "name": "short-id",
  "description": "what this validates and why",
  "setup": {
    "pdfPath": "test pdf-bestanden/...pdf",
    "scale": 1.0,
    "page": 2
  },
  "steps":      [ { "action": "...", "...": "..." } ],
  "assertions": [ { "type": "...",   "...": "..." } ]
}
```

`setup` is sugar for `open_pdf` + `set_zoom` + `go_to_page` at the front of
the step list. Omit fields you don't want to set.

### Step actions

| action          | required fields                              | what it does                                |
|-----------------|----------------------------------------------|---------------------------------------------|
| `open_pdf`      | `path` (abs or repo-relative)                | open a PDF                                  |
| `set_zoom`      | `scale`                                      | set zoom to a fraction (1.0 = 100 %)        |
| `go_to_page`    | `page`                                       | navigate to a 1-based page number           |
| `wheel_zoom`    | `x`, `y`, optional `deltaY`, `ctrlKey`       | synthetic wheel event                       |
| `mouse_click`   | `x`, `y`, optional `button`                  | click at viewport coords                    |
| `mouse_drag`    | `x1`, `y1`, `x2`, `y2`, optional `steps`     | press → move → release                      |
| `key`           | `key`, optional `ctrl/shift/alt`             | dispatch a KeyboardEvent                    |
| `set_tool`      | `tool`                                       | switch via `app_set_tool` (Rust rebuild req)|
| `wait`          | `ms`                                         | sleep                                       |
| `probe`         | `store` (label)                              | snapshot viewport state into `probes[store]`|
| `screenshot`    | `label`, optional `width`                    | save PNG to scenario output dir             |

### Assertion types

| type                       | fields                                                       |
|----------------------------|--------------------------------------------------------------|
| `stateEquals`              | `probe`, `field` (dotted), `value`                           |
| `stateInRange`             | `probe`, `field`, `min`, `max`                               |
| `stateEqualField`          | `preProbe`, `postProbe`, `field`, `tolerance`                |
| `stateChanged`             | `preProbe`, `postProbe`, `field`                             |
| `annotationCountDelta`     | `preProbe`, `postProbe`, `delta`                             |

All assertion types accept an optional `label` for human-readable output.

`field` uses dotted access on the `app_get_viewport_state` JSON, e.g.
`container.scrollLeft`, `doc.viewMode`, `viewport.zoom`, `annotationCount`,
`currentTool`.

---

## Adding a scenario

1. Drop a JSON file under `scenarios/` named `<NN>-short-id.json` — the
   prefix orders execution.
2. Encode the smallest reproduction of the bug or feature you want to
   gate on. Prefer one assertion target per scenario; if you're tempted
   to add five orthogonal assertions, split into five scenarios.
3. Run it once: `node tests/protocol/runner.mjs <substring>`. The
   first run is your baseline — the second run shouldn't regress.

### From the action recorder

The app has a built-in recorder (F4 in-app, or `app_record_start/stop/get`
via MCP). A recorded session is a list of input events with timestamps and
viewport snapshots, which maps directly onto the scenario `steps[]` schema.
Use this when reproducing a bug you triggered by hand: record once, paste
the events into a new scenario, trim, add assertions.

---

## What lives where

```
tests/protocol/
├── README.md            (this file)
├── runner.mjs           (Node runner — fetch + JSON RPC against MCP)
├── scenarios/           (one JSON per test case, committed)
└── results/             (per-run artifacts, gitignored)
    └── <ISO timestamp>/
        └── <scenario-name>/
            ├── report.json
            └── *.png
```

`results/` is intentionally not committed — it's regenerated on each run.
Add it to `.gitignore` if not already present.

---

## Roadmap

Scenarios to add as we approach the next release:

- `04-mixed-size-fallback` — open NKD1a, assert auto-fallback to single
- `05-zoom-anchor-on-page` — anchor accuracy when cursor IS over the page
  (`|errorPx| < 3` via `app_zoom_anchor_test`)
- `06-render-engine-auto` — open A4 → assert `engine` starts with `Raster`
- `07-g-move-shortcut` — select annotation, press G, mousemove,
  Enter — assert position delta on commit
- `08-pdfa-readonly` — open a PDF/A doc, assert annotation tools are gated
- `09-tool-coverage-via-set-tool` — once the binary has `app_set_tool`,
  iterate every tool name and verify it activates
- `10-save-roundtrip` — annotate, save, reopen, assert annotations
  persisted with same coordinates

Visual-regression (pixel-diff against baselines) is intentionally NOT in
the MVP runner — false positives from anti-aliasing and rendering noise
would drown out real regressions. Add it later as a separate `compare`
assertion type that uses `pixelmatch` with a per-region tolerance.
