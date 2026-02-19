export default function GeneralTab(props) {
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>Theme</h3>
        <div class="pref-row">
          <label>Application Theme</label>
          <select style="width:120px;" value={p.theme[0]()} onChange={e => p.theme[1](e.target.value)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="blue">Blue</option>
            <option value="highContrast">High Contrast</option>
          </select>
        </div>
      </div>
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
    </>
  );
}
