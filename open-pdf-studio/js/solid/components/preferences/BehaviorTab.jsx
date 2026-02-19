export default function BehaviorTab(props) {
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>Startup</h3>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.restoreLastSession[0]()} onChange={e => p.restoreLastSession[1](e.target.checked)} />
            <span>Restore last session when application starts</span>
          </label>
        </div>
      </div>

      <div class="preferences-section">
        <h3>Author</h3>
        <div class="pref-row">
          <label>Default Author Name</label>
          <input type="text" value={p.authorName[0]()} onInput={e => p.authorName[1](e.target.value)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Snapping</h3>
        <div class="pref-row">
          <label>Angle Snap (degrees)</label>
          <input type="number" min="1" max="90" value={p.angleSnapDegrees[0]()} onInput={e => p.angleSnapDegrees[1](parseInt(e.target.value) || 30)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableAngleSnap[0]()} onChange={e => p.enableAngleSnap[1](e.target.checked)} />
            <span>Enable Angle Snapping (hold Shift)</span>
          </label>
        </div>
        <div class="pref-row">
          <label>Grid Size (pixels)</label>
          <input type="number" min="5" max="100" value={p.gridSize[0]()} onInput={e => p.gridSize[1](parseInt(e.target.value) || 10)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableGridSnap[0]()} onChange={e => p.enableGridSnap[1](e.target.checked)} />
            <span>Enable Grid Snapping</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.showGrid[0]()} onChange={e => p.showGrid[1](e.target.checked)} />
            <span>Show Grid Overlay</span>
          </label>
        </div>
      </div>

      <div class="preferences-section">
        <h3>Creation</h3>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.autoSelectAfterCreate[0]()} onChange={e => p.autoSelectAfterCreate[1](e.target.checked)} />
            <span>Auto-select annotation after creation</span>
          </label>
        </div>
      </div>

      <div class="preferences-section">
        <h3>Deletion</h3>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.confirmBeforeDelete[0]()} onChange={e => p.confirmBeforeDelete[1](e.target.checked)} />
            <span>Confirm before deleting annotations</span>
          </label>
        </div>
      </div>
    </>
  );
}
