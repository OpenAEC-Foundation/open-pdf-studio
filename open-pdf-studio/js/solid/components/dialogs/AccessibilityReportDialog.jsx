import { createSignal, For, Show, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Accessibility check (#384): missing alt text and untagged content. The
// window is movable and stays open on a click outside it (Dialog).
export default function AccessibilityReportDialog() {
  const { t } = useTranslation('dialogs');
  const [report, setReport] = createSignal(null);
  const [progress, setProgress] = createSignal('');
  const [failed, setFailed] = createSignal(false);
  const close = () => closeDialog('accessibility-report');

  const run = async () => {
    const doc = getActiveDocument();
    setReport(null);
    setFailed(false);
    if (!doc?.pdfDoc) { setFailed(true); return; }
    try {
      const { runAccessibilityCheck } = await import('../../../accessibility/accessibility-service.js');
      const r = await runAccessibilityCheck(doc, (done, total) => setProgress(t('accessibilityReport.checking', { done, total })));
      setReport(r);
    } catch (err) {
      console.warn('[accessibility] check failed:', err);
      setFailed(true);
    }
  };
  onMount(run);

  const goTo = (issue) => {
    if (issue.pageIndex == null) return;
    import('../../../pdf/renderer.js').then((m) => m.goToPage(issue.pageIndex + 1)).catch(() => {});
    if (issue.key) {
      import('../../../ui/panels/tags.js').then((m) => m.selectTag(issue.key)).catch(() => {});
    }
  };

  const describe = (issue) => t(`accessibilityReport.kind.${issue.kind}`, {
    count: issue.count ?? 0,
    role: issue.role || '',
    type: issue.annotationType || '',
  });

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-secondary" onClick={run} disabled={!report() && !failed()}>{t('accessibilityReport.recheck')}</button>
      <button class="pref-btn pref-btn-primary" onClick={close}>{t('accessibilityReport.close')}</button>
    </div>
  );

  return (
    <Dialog
      title={t('accessibilityReport.title')}
      dialogClass="accessibility-report-dialog"
      onClose={close}
      footer={footer}
    >
      <div class="accessibility-report-body">
        <Show when={failed()}>
          <p>{t('accessibilityReport.failed')}</p>
        </Show>
        <Show when={!report() && !failed()}>
          <p>{progress() || t('accessibilityReport.starting')}</p>
        </Show>
        <Show when={report()}>
          <Show when={report().issues.length} fallback={<p>{t('accessibilityReport.noIssues')}</p>}>
            <p>{t('accessibilityReport.summary', { count: report().issues.length })}</p>
            <div class="accessibility-report-list" role="list">
              <For each={report().issues}>
                {(issue) => (
                  <div
                    class={`accessibility-report-item ${issue.severity}`}
                    role="listitem"
                    onDblClick={() => goTo(issue)}
                    title={issue.pageIndex != null ? t('accessibilityReport.goTo') : ''}
                  >
                    <span class="accessibility-report-severity">{issue.severity === 'error' ? '✖' : '⚠'}</span>
                    <span class="accessibility-report-text">{describe(issue)}</span>
                    <span class="accessibility-report-page">
                      {issue.pageIndex != null ? t('accessibilityReport.page', { page: issue.pageIndex + 1 }) : ''}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}
