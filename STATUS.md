# Open PDF Studio — Status

**Datum**: 2026-02-28
**Branch**: Jochem
**Laatste PR**: #148 (gemerged) — snap engine, calibration dialog, i18n updates

## Wat is er vandaag gedaan

### Gemerged naar main (PR #148)
- Snap engine verbeteringen + nieuwe `pdf-snap-extractor.js`
- Calibration dialog compleet vernieuwd met visuele reference line picker
- i18n updates voor 30+ talen (measurement, calibration, preferences strings)
- Preferences tabs uitgebreid (Annotations, Behavior, Markup)
- Context menu, ribbon, dependency updates

### Op Jochem branch (NIET gemerged, uncommitted)
- **Element Detection heuristieken (Level 2)** — verbeterde PDF element detector:
  - Graphics state tracker (lineWidth, colors, dash patterns uit operator list)
  - Stroke width filtering (histogram-based wall threshold)
  - Hatching pattern detectie en uitsluiting
  - Dimension line detectie en uitsluiting
  - Verbeterde room detection (min dimensions, betere labels, CAD fill color)
  - UI: filtered stats weergave in panel
  - Rendering: room overlay met originele CAD fill color

## Uncommitted bestanden op Jochem
```
 M  rendering.js          (element detection overlay + room fill colors)
 M  LeftPanel.jsx          (elements tab toevoeging)
 M  leftPanelIcons.js      (elements icon)
 M  panels.css             (element detection panel CSS)
??  ElementDetectionPanel.jsx
??  elementDetectionStore.js
??  pdf-element-detector.js
??  element-detection.js
```

## Notities
- Element detection werkt maar is "nog niet overtuigend" — resultaten moeten beter
- Jochem is apart project gestart voor eigen AI model (gerelateerd aan element detection)
- PRs voortaan NIET mergen zonder review door collega
