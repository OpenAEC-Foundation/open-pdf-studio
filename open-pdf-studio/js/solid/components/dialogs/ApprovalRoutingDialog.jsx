// Goedkeuringsroutes (#651): aanvraag voorbereiden, het exacte uitgaande
// verzoek bekijken en pas dan versturen, en per ontvanger de status en de
// geschiedenis volgen. Een verplaatsbaar venster in Windows-stijl (Dialog).
//
// Drie tabbladen:
//  - Voorbereiden : providers expliciet inschakelen, ontvangers met rol,
//                   volgorde, vervaldatum, bericht en velden. Verstuurt niets.
//  - Status       : per aanvraag de documentversie (SHA-256), de ontvangers
//                   met hun status, het uitgaande verzoek met voorvertoning,
//                   Versturen (het enige pad naar de provider), beslissingen en
//                   teruggekomen kopieën vastleggen, annuleren, vervangen,
//                   auditpakket exporteren en de geschiedenis.
//  - Ontvangst    : de ontvanger van een pakket (lokale bestandsoverdracht)
//                   maakt een ontvangstbewijs.
import { createSignal, createMemo, For, Show, onMount, untrack } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { approvalState, approvalRequest, approvalDocument, approvalPackage, renderApprovalPreview, makeReceipt, verifyRequest } from '../../../approval-routing/service.js';
import { decisionsFor, requestRef, ROLES } from '../../../approval-routing/model.js';

const newRecipient = () => ({ id: crypto.randomUUID(), name: '', email: '', role: 'approve' });
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : '—');

export default function ApprovalRoutingDialog() {
  const { t } = useTranslation('dialogs');
  const [tab, setTab] = createSignal('prepare');
  const [data, setData] = createSignal({ providers: {}, requests: [] });
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  // Voorbereiden
  const [title, setTitle] = createSignal('');
  const [revision, setRevision] = createSignal('');
  const [mode, setMode] = createSignal('sequential');
  const [expiry, setExpiry] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [provider, setProvider] = createSignal('mail-v1');
  const [recipients, setRecipients] = createSignal([newRecipient()]);
  const [fields, setFields] = createSignal([]);
  // Status
  const [id, setId] = createSignal('');
  const [outgoing, setOutgoing] = createSignal(null);
  const [reviewed, setReviewed] = createSignal(false);
  const [page, setPage] = createSignal('1');
  const [replacement, setReplacement] = createSignal('');
  const [decisionFor, setDecisionFor] = createSignal('');
  const [decision, setDecision] = createSignal('');
  const [decisionComment, setDecisionComment] = createSignal('');
  const [returned, setReturned] = createSignal(null);
  const [returnedMatch, setReturnedMatch] = createSignal(null);
  const [confirmReference, setConfirmReference] = createSignal(false);
  // Ontvangst (ontvanger van een pakket)
  const [received, setReceived] = createSignal(null);
  const [receivedBytes, setReceivedBytes] = createSignal(null);
  const [recipient, setRecipient] = createSignal('');
  const [receiptDecision, setReceiptDecision] = createSignal('approved');
  const [comment, setComment] = createSignal('');
  const [receiptConfirmed, setReceiptConfirmed] = createSignal(false);
  let previewCanvas, receiptCanvas, copyInput;

  const current = createMemo(() => data().requests.find((r) => r.record.id === id()));
  const recipientOf = (rid) => current()?.record.config.recipients.find((r) => r.id === rid);
  const openForDecision = createMemo(() => (current()?.state.recipients || []).filter((r) => r.status === 'pending'));
  const isOpen = () => ['draft', 'submitted', 'in_progress'].includes(current()?.state.status);

  async function refresh() { setData(await approvalState()); }
  async function act(fn) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(t(`approvalRouting.errors.${e.message}`, { defaultValue: e.message }));
    } finally {
      setBusy(false);
    }
  }
  onMount(() => act(async () => {}));

  function selectRequest(value) {
    setId(value);
    setOutgoing(null);
    setReviewed(false);
    setPage('1');
    setDecisionFor('');
    setReturned(null);
    setReturnedMatch(null);
    if (previewCanvas) previewCanvas.width = 0;
  }
  const download = (bytes, name, type) => {
    const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const updateRecipient = (index, key, value) => setRecipients((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  const updateField = (index, key, value) => setFields((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  const roleOf = (rid) => recipients().find((r) => r.id === rid)?.role;

  async function previewOutgoing() {
    const result = await approvalRequest({ action: 'preview', id: id() });
    setOutgoing({ ...result.outgoing, available: result.available, containsApprovalData: result.containsApprovalData });
    setReviewed(false);
    if (result.available) {
      const bytes = await approvalDocument(id());
      await untrack(() => renderApprovalPreview(current().record, bytes, leesGetal(page()), previewCanvas, { attachmentHash: result.outgoing.attachment.hash }));
    }
  }

  function eventDetail(record, event) {
    const p = event.payload || {};
    if (event.kind === 'receipt') {
      const r = record.config.recipients.find((x) => x.id === p.receipt.recipientId);
      const ev = p.receipt.evidence;
      const how = ev?.kind === 'copy' ? t(`approvalRouting.match.${ev.copy.match}`) : ev?.kind ? t(`approvalRouting.evidence.${ev.kind}`) : '';
      const note = p.receipt.comment ? ` · “${p.receipt.comment}”` : '';
      return { who: r ? `${r.name} <${r.email}>` : '—', what: `${t(`approvalRouting.states.${p.receipt.decision}`)}${how ? ` · ${how}` : ''}${note}`, hash: ev?.copy?.hash || p.receipt.documentHash };
    }
    if (event.kind === 'dispatch') {
      const who = p.recipients.map((x) => record.config.recipients.find((r) => r.id === x)?.email || x).join(', ');
      return { who: event.actor, what: `${t(`approvalRouting.providers.${p.provider}`)} → ${who}`, hash: p.attachmentHash };
    }
    if (event.kind === 'supersede') {
      const what = p.reason === 'document-changed'
        ? t('approvalRouting.supersededByChange')
        : `${t('approvalRouting.replacement')}: ${data().requests.find((r) => r.record.id === p.replacementId)?.record.config.title || p.replacementId}`;
      return { who: event.actor, what, hash: record.config.source.hash };
    }
    return { who: event.actor, what: '', hash: record.config.source.hash };
  }

  const providerToggle = (p) => <label>
    <input
      type="checkbox"
      checked={data().providers?.[p] === true}
      disabled={busy()}
      onChange={(e) => act(() => approvalRequest({ action: 'configure', adapter: p, enabled: e.target.checked }))}
    />
    {t(`approvalRouting.providerConfigure.${p}`)}
  </label>;

  return <Dialog
    title={t('approvalRouting.title')}
    onClose={() => closeDialog('approval-routing')}
    overlayClass="crop-margins-overlay"
    dialogClass="crop-margins-dialog approval-routing-dialog"
    headerClass="crop-margins-header"
    bodyClass="crop-margins-content"
    footerClass="crop-margins-footer"
    footer={<button class="pref-btn" onClick={() => closeDialog('approval-routing')}>{t('approvalRouting.close')}</button>}
  >
    <div class="approval-tabs" role="tablist">
      <For each={['prepare', 'status', 'receive']}>
        {(name) => <button role="tab" aria-selected={tab() === name} classList={{ active: tab() === name }} onClick={() => setTab(name)}>
          {t(`approvalRouting.tabs.${name}`)}
        </button>}
      </For>
    </div>
    <p class="approval-note">{t('approvalRouting.distinctionTypes')}</p>

    <Show when={tab() === 'prepare'}>
      <p>{t('approvalRouting.intro')}</p>
      <fieldset class="approval-group">
        <legend>{t('approvalRouting.providersTitle')}</legend>
        {providerToggle('mail-v1')}
        {providerToggle('local-file-v1')}
      </fieldset>
      <div class="approval-row">
        <label>{t('approvalRouting.name')}<input type="text" value={title()} onInput={(e) => setTitle(e.target.value)} /></label>
        <label>{t('approvalRouting.revision')}<input type="text" value={revision()} onInput={(e) => setRevision(e.target.value)} /></label>
      </div>
      <div class="approval-row">
        <label>
          {t('approvalRouting.provider')}
          <select value={provider()} onChange={(e) => setProvider(e.target.value)}>
            <option value="mail-v1">{t('approvalRouting.providers.mail-v1')}</option>
            <option value="local-file-v1">{t('approvalRouting.providers.local-file-v1')}</option>
          </select>
        </label>
        <label>
          {t('approvalRouting.mode')}
          <select value={mode()} onChange={(e) => setMode(e.target.value)}>
            <option value="sequential">{t('approvalRouting.sequential')}</option>
            <option value="parallel">{t('approvalRouting.parallel')}</option>
          </select>
        </label>
        <label>{t('approvalRouting.expiry')}<input type="date" value={expiry()} onInput={(e) => setExpiry(e.target.value)} /></label>
      </div>
      <label class="approval-block">
        {t('approvalRouting.message')}
        <textarea rows="3" maxLength="5000" value={message()} onInput={(e) => setMessage(e.target.value)} />
      </label>
      <h3>{t('approvalRouting.recipientsTitle')}</h3>
      <For each={recipients()}>
        {(r, index) => <div class="approval-recipient">
          <span class="approval-order">{index() + 1}.</span>
          <input aria-label={t('approvalRouting.recipientName')} type="text" placeholder={t('approvalRouting.recipientName')} value={r.name} onChange={(e) => updateRecipient(index(), 'name', e.target.value)} />
          <input aria-label={t('approvalRouting.email')} type="email" placeholder={t('approvalRouting.email')} value={r.email} onChange={(e) => updateRecipient(index(), 'email', e.target.value)} />
          <select aria-label={t('approvalRouting.role')} value={r.role} onChange={(e) => {
            updateRecipient(index(), 'role', e.target.value);
            // Handtekening- en parafeervakken horen alleen bij een ondertekenaar.
            if (e.target.value !== 'sign') setFields((rows) => rows.map((f) => (f.recipientId === r.id ? { ...f, kind: 'review' } : f)));
          }}>
            <For each={ROLES}>{(role) => <option value={role}>{t(`approvalRouting.roles.${role}`)}</option>}</For>
          </select>
          <button class="pref-btn" disabled={recipients().length === 1} onClick={() => {
            setRecipients((rows) => rows.filter((x) => x.id !== r.id));
            setFields((rows) => rows.filter((f) => f.recipientId !== r.id));
          }}>{t('approvalRouting.remove')}</button>
        </div>}
      </For>
      <div class="approval-row">
        <button class="pref-btn" disabled={recipients().length >= 50} onClick={() => setRecipients((rows) => [...rows, newRecipient()])}>{t('approvalRouting.addRecipient')}</button>
      </div>
      <p>{t('approvalRouting.fieldsHelp2')}</p>
      <For each={fields()}>
        {(f, index) => <div class="approval-field">
          <select value={f.recipientId} onChange={(e) => {
            updateField(index(), 'recipientId', e.target.value);
            if (roleOf(e.target.value) !== 'sign') updateField(index(), 'kind', 'review');
          }}>
            <For each={recipients()}>{(r) => <option value={r.id}>{r.name || r.email || '—'}</option>}</For>
          </select>
          <select aria-label={t('approvalRouting.fieldKind')} value={f.kind} onChange={(e) => updateField(index(), 'kind', e.target.value)}>
            <option value="review">{t('approvalRouting.kinds.review')}</option>
            <option value="signature" disabled={roleOf(f.recipientId) !== 'sign'}>{t('approvalRouting.kinds.signature')}</option>
            <option value="initials" disabled={roleOf(f.recipientId) !== 'sign'}>{t('approvalRouting.kinds.initials')}</option>
          </select>
          <input type="text" aria-label={t('approvalRouting.fieldLabel')} value={f.label} onChange={(e) => updateField(index(), 'label', e.target.value)} />
          <For each={['page', 'x', 'y', 'width', 'height']}>
            {(key) => <label>
              {t(`approvalRouting.${key}`)}
              <input type="text" inputmode="decimal" data-getal="decimaal" value={f[key]} onChange={(e) => updateField(index(), key, leesGetal(e.target.value))} />
            </label>}
          </For>
          <button class="pref-btn" onClick={() => setFields((rows) => rows.filter((x) => x.id !== f.id))}>{t('approvalRouting.remove')}</button>
        </div>}
      </For>
      <div class="approval-row">
        <button class="pref-btn" onClick={() => setFields((rows) => [...rows, {
          id: crypto.randomUUID(), recipientId: recipients()[0].id, kind: 'review', label: t('approvalRouting.fieldLabel'), page: 1, x: 20, y: 20, width: 100, height: 40,
        }])}>{t('approvalRouting.addField')}</button>
        <button class="pref-btn" disabled={busy() || data().providers?.[provider()] !== true} onClick={() => act(async () => {
          const result = await approvalRequest({
            action: 'draft', provider: provider(), title: title(), revision: revision(), mode: mode(), message: message(),
            expiresAt: expiry() ? new Date(expiry() + 'T23:59:59').toISOString() : null,
            recipients: recipients(), fields: fields(),
          });
          await refresh();
          selectRequest(result.record.id);
          setNotice(result.containsApprovalData ? t('approvalRouting.containsApprovalData') : t('approvalRouting.prepared'));
          setTab('status');
        })}>{t('approvalRouting.prepare')}</button>
      </div>
      <Show when={data().providers?.[provider()] !== true}><p class="approval-warning">{t('approvalRouting.enableProviderFirst')}</p></Show>
    </Show>

    <Show when={tab() === 'status'}>
      <div class="approval-row">
        <label>
          {t('approvalRouting.requests')}
          <select value={id()} onChange={(e) => selectRequest(e.target.value)}>
            <option value="">—</option>
            <For each={data().requests}>
              {(r) => <option value={r.record.id} selected={r.record.id === id()}>{r.record.config.title} · {requestRef(r.record.id)} · {t(`approvalRouting.states.${r.state.status}`)}</option>}
            </For>
          </select>
        </label>
        <button class="pref-btn" disabled={busy()} onClick={() => act(async () => {})}>{t('approvalRouting.refresh')}</button>
      </div>
      <Show when={!data().requests.length}><p>{t('approvalRouting.noRequests')}</p></Show>
      <Show when={notice()}><p class="approval-note">{notice()}</p></Show>
      <Show when={current()?.state.integrity}>
        <table class="approval-table">
          <tbody>
            <tr><th>{t('approvalRouting.documentVersion')}</th><td>{current().record.config.source.name}{current().record.config.source.revision ? ` · ${current().record.config.source.revision}` : ''} · {t('approvalRouting.mail.pages', { count: current().record.config.source.pages })}{current().record.config.source.size ? ` · ${current().record.config.source.size} B` : ''}</td></tr>
            <tr><th>SHA-256</th><td class="approval-hash">{current().record.config.source.hash}</td></tr>
            <tr><th>{t('approvalRouting.mail.reference')}</th><td>{requestRef(current().record.id)} · {t(`approvalRouting.${current().record.config.mode}`)}{current().record.config.expiresAt ? ` · ${t('approvalRouting.mail.due')} ${current().record.config.expiresAt.slice(0, 10)}` : ''}</td></tr>
            <tr><th>{t('approvalRouting.provider')}</th><td>{t(`approvalRouting.providers.${current().record.adapter}`)} · {t(`approvalRouting.delivery.${current().state.delivery}`)}</td></tr>
            <tr><th>{t('approvalRouting.status')}</th><td>{t(`approvalRouting.states.${current().state.status}`)} · {t(`approvalRouting.where.${current().where}`)}</td></tr>
          </tbody>
        </table>
        <h3>{t('approvalRouting.recipientsTitle')}</h3>
        <table class="approval-table">
          <thead><tr><th>#</th><th>{t('approvalRouting.recipientName')}</th><th>{t('approvalRouting.role')}</th><th>{t('approvalRouting.status')}</th><th>{t('approvalRouting.dispatched')}</th><th>{t('approvalRouting.decidedAt')}</th></tr></thead>
          <tbody>
            <For each={current().state.recipients}>
              {(r, index) => <tr classList={{ 'approval-turn': r.turn }}>
                <td>{index() + 1}{r.turn ? ' ▶' : ''}</td>
                <td>{recipientOf(r.id)?.name} &lt;{recipientOf(r.id)?.email}&gt;</td>
                <td>{t(`approvalRouting.roles.${r.role}`)}</td>
                <td>{t(`approvalRouting.states.${r.status}`)}</td>
                <td>{r.dispatchedAt || '—'}</td>
                <td>{r.at || '—'}</td>
              </tr>}
            </For>
          </tbody>
        </table>

        <Show when={isOpen() && current().state.recipients.some((r) => r.turn)}>
          <h3>{t('approvalRouting.outgoing')}</h3>
          <div class="approval-row">
            <label>{t('approvalRouting.page')}<input type="text" inputmode="decimal" data-getal="decimaal" value={page()} onInput={(e) => setPage(e.target.value)} /></label>
            <button class="pref-btn" disabled={busy()} onClick={() => act(previewOutgoing)}>{t('approvalRouting.previewOutgoing')}</button>
          </div>
          <Show when={outgoing()}>
            <table class="approval-table approval-outgoing">
              <tbody>
                <tr><th>{t('approvalRouting.to')}</th><td>{outgoing().recipients.map((r) => `${r.name} <${r.email}> (${t(`approvalRouting.roles.${r.role || 'approve'}`)})`).join('; ')}</td></tr>
                <tr><th>{t('approvalRouting.subject')}</th><td>{outgoing().subject}</td></tr>
                <tr><th>{t('approvalRouting.body')}</th><td><pre>{outgoing().body}</pre></td></tr>
                <tr><th>{t('approvalRouting.attachment')}</th><td>{outgoing().packageName ? `${outgoing().packageName} → ` : ''}{outgoing().attachment.name} · {outgoing().attachment.size ?? '?'} B · SHA-256 <span class="approval-hash">{outgoing().attachment.hash}</span>{outgoing().attachment.from === 'copy' ? ` · ${t('approvalRouting.attachmentFromCopy')}` : ''}</td></tr>
              </tbody>
            </table>
            <Show when={outgoing().containsApprovalData}><p class="approval-warning">{t('approvalRouting.containsApprovalData')}</p></Show>
            <Show when={!outgoing().available}><p class="approval-warning">{t('approvalRouting.sourceUnavailable')}</p></Show>
            <canvas ref={previewCanvas} />
            <label>
              <input type="checkbox" checked={reviewed()} disabled={!outgoing().available} onChange={(e) => setReviewed(e.target.checked)} />
              {t('approvalRouting.reviewedOutgoing')}
            </label>
            <div class="approval-row">
              <button class="pref-btn" disabled={busy() || !reviewed() || !outgoing().available || data().providers?.[current().record.adapter] !== true} onClick={() => act(async () => {
                const adapter = current().record.adapter;
                await approvalRequest({ action: 'submit', id: id(), confirmedHash: outgoing().attachment.hash });
                setOutgoing(null);
                setReviewed(false);
                setNotice(t(`approvalRouting.submitted.${adapter}`));
              })}>{t(`approvalRouting.submitVia.${current().record.adapter}`)}</button>
            </div>
            <Show when={data().providers?.[current().record.adapter] !== true}><p class="approval-warning">{t('approvalRouting.enableProviderFirst')}</p></Show>
          </Show>
        </Show>

        <Show when={current().record.version === 2 && ['submitted', 'in_progress'].includes(current().state.status)}>
          <h3>{t('approvalRouting.decisionTitle')}</h3>
          <p>{t('approvalRouting.decisionHelp')}</p>
          <div class="approval-row">
            <select aria-label={t('approvalRouting.recipientName')} value={decisionFor()} onChange={(e) => {
              setDecisionFor(e.target.value);
              setDecision(e.target.value ? decisionsFor(recipientOf(e.target.value)?.role)[0] : '');
            }}>
              <option value="">—</option>
              <For each={openForDecision()}>{(r) => <option value={r.id} disabled={!r.turn}>{recipientOf(r.id)?.name} · {t(`approvalRouting.roles.${r.role}`)}</option>}</For>
            </select>
            <select aria-label={t('approvalRouting.decision')} value={decision()} disabled={!decisionFor()} onChange={(e) => setDecision(e.target.value)}>
              <For each={decisionFor() ? decisionsFor(recipientOf(decisionFor())?.role) : []}>{(d) => <option value={d}>{t(`approvalRouting.states.${d}`)}</option>}</For>
            </select>
          </div>
          <textarea aria-label={t('approvalRouting.comment')} placeholder={t('approvalRouting.comment')} maxLength="2000" value={decisionComment()} onInput={(e) => setDecisionComment(e.target.value)} />
          <label>
            {t('approvalRouting.returnedCopy')}
            <input ref={copyInput} type="file" accept=".pdf" disabled={busy()} onChange={(e) => {
              const file = e.target.files[0];
              setReturned(null);
              setReturnedMatch(null);
              setConfirmReference(false);
              if (file) act(async () => {
                if (file.size > 100 * 1024 * 1024) throw Error('SIZE_LIMIT');
                const bytes = new Uint8Array(await file.arrayBuffer());
                const { matches } = await approvalRequest({ action: 'match', bytes, name: file.name });
                setReturned({ bytes, name: file.name });
                setReturnedMatch(matches.find((m) => m.id === id())?.match || 'none');
              });
            }} />
          </label>
          <Show when={returnedMatch()}>
            <p classList={{ 'approval-warning': returnedMatch() === 'reference' || returnedMatch() === 'none' }}>{t(`approvalRouting.match.${returnedMatch()}`)}</p>
          </Show>
          <Show when={returnedMatch() === 'reference'}>
            <label><input type="checkbox" checked={confirmReference()} onChange={(e) => setConfirmReference(e.target.checked)} />{t('approvalRouting.confirmReference')}</label>
          </Show>
          <div class="approval-row">
            <button class="pref-btn" disabled={busy() || !decisionFor() || !decision() || returnedMatch() === 'none' || (returnedMatch() === 'reference' && !confirmReference()) || (decision() === 'signed' && !returned())} onClick={() => act(async () => {
              const result = await approvalRequest({
                action: 'decision', id: id(), recipientId: decisionFor(), decision: decision(), comment: decisionComment(),
                copy: returned(), confirmReference: confirmReference(),
              });
              setNotice(result.attachment ? t('approvalRouting.keptAs', { name: result.attachment }) : t('approvalRouting.decisionRecorded'));
              setDecisionFor('');
              setDecision('');
              setDecisionComment('');
              setReturned(null);
              setReturnedMatch(null);
              if (copyInput) copyInput.value = '';
            })}>{t('approvalRouting.recordDecision')}</button>
          </div>
          <p class="approval-note">{t('approvalRouting.unsavedNote')}</p>
        </Show>

        <Show when={current().record.version === 1 && ['submitted', 'in_progress'].includes(current().state.status)}>
          <label>
            {t('approvalRouting.importReceipt')}
            <input type="file" accept=".json" disabled={busy()} onChange={(e) => {
              const file = e.target.files[0];
              if (file) act(async () => {
                if (file.size > 100000) throw Error('RECEIPT_LIMIT');
                await approvalRequest({ action: 'receipt', id: id(), receipt: JSON.parse(await file.text()) });
              });
            }} />
          </label>
        </Show>

        <h3>{t('approvalRouting.manage')}</h3>
        <div class="approval-row">
          <button class="pref-btn" disabled={busy() || !isOpen()} onClick={() => act(() => approvalRequest({ action: 'cancel', id: id() }))}>{t('approvalRouting.cancel')}</button>
          <label>
            {t('approvalRouting.replacement')}
            <select value={replacement()} onChange={(e) => setReplacement(e.target.value)}>
              <option value="">—</option>
              <For each={data().requests.filter((r) => r.record.id !== id())}>{(r) => <option value={r.record.id} selected={r.record.id === replacement()}>{r.record.config.title} · {requestRef(r.record.id)}</option>}</For>
            </select>
          </label>
          <button class="pref-btn" disabled={busy() || !replacement() || current().state.status === 'superseded'} onClick={() => act(() => approvalRequest({ action: 'supersede', id: id(), replacementId: replacement() }))}>{t('approvalRouting.supersede')}</button>
          <button class="pref-btn" disabled={busy()} onClick={() => act(async () => {
            const p = await approvalPackage(id());
            setNotice(p.complete ? t('approvalRouting.exported', { path: p.path }) : t('approvalRouting.exportedWithoutPdf', { path: p.path }));
          })}>{t('approvalRouting.exportAudit')}</button>
        </div>

        <h3>{t('approvalRouting.history')}</h3>
        <table class="approval-table">
          <thead><tr><th>{t('approvalRouting.when')}</th><th>{t('approvalRouting.what')}</th><th>{t('approvalRouting.who')}</th><th>{t('approvalRouting.details')}</th><th>{t('approvalRouting.documentHash')}</th></tr></thead>
          <tbody>
            <tr><td>{current().record.createdAt}</td><td>{t('approvalRouting.events.create')}</td><td>—</td><td>{current().record.config.title}</td><td class="approval-hash" title={current().record.config.source.hash}>{short(current().record.config.source.hash)}</td></tr>
            <For each={current().record.events}>
              {(event) => {
                const d = eventDetail(current().record, event);
                return <tr><td>{event.at}</td><td>{t(`approvalRouting.events.${event.kind}`)}</td><td>{d.who}</td><td>{d.what}</td><td class="approval-hash" title={d.hash}>{short(d.hash)}</td></tr>;
              }}
            </For>
          </tbody>
        </table>
        <p>{t('approvalRouting.audit')}: <span class="approval-hash">{current().state.head}</span></p>
        <p class="approval-note">{t('approvalRouting.integrity')}</p>
        <Show when={current().kept.length}>
          <h3>{t('approvalRouting.keptTitle')}</h3>
          <For each={current().kept}>{(k) => <p>{k.at} · {recipientOf(k.recipientId)?.name} · {t(`approvalRouting.states.${k.decision}`)} · {k.name} · {t(`approvalRouting.match.${k.match}`)} · <span class="approval-hash">{short(k.hash)}</span></p>}</For>
        </Show>
      </Show>
    </Show>

    <Show when={tab() === 'receive'}>
      <p>{t('approvalRouting.receiptHelp')}</p>
      <label>
        {t('approvalRouting.requestFile')}
        <input type="file" accept=".json" onChange={(e) => {
          const file = e.target.files[0];
          if (file) act(async () => {
            if (file.size > 5000000) throw Error('REQUEST_LIMIT');
            const record = JSON.parse(await file.text());
            await verifyRequest(record);
            setReceived(record);
            setRecipient('');
            setReceivedBytes(null);
            setReceiptConfirmed(false);
          });
        }} />
      </label>
      <label>
        {t('approvalRouting.pdfFile')}
        <input type="file" accept=".pdf" onChange={(e) => {
          const file = e.target.files[0];
          if (file) act(async () => {
            if (file.size > 50 * 1024 * 1024) throw Error('SIZE_LIMIT');
            setReceivedBytes(new Uint8Array(await file.arrayBuffer()));
            setReceiptConfirmed(false);
          });
        }} />
      </label>
      <Show when={received()}>
        <p>{received()?.config.title} · SHA-256: <span class="approval-hash">{received()?.config.source.hash}</span></p>
        <div class="approval-row">
          <label>{t('approvalRouting.page')}<input type="text" inputmode="decimal" data-getal="decimaal" value={page()} onInput={(e) => setPage(e.target.value)} /></label>
          <select aria-label={t('approvalRouting.claimedIdentity')} value={recipient()} onChange={(e) => { setRecipient(e.target.value); setReceiptConfirmed(false); }}>
            <option value="">—</option>
            <For each={received()?.config.recipients}>{(r) => <option value={r.id}>{r.name} · {r.email}</option>}</For>
          </select>
          <select value={receiptDecision()} onChange={(e) => setReceiptDecision(e.target.value)}>
            <option value="approved">{t('approvalRouting.states.approved')}</option>
            <option value="rejected">{t('approvalRouting.states.rejected')}</option>
          </select>
        </div>
        <textarea aria-label={t('approvalRouting.comment')} maxLength="2000" value={comment()} onInput={(e) => setComment(e.target.value)} />
        <div class="approval-row">
          <button class="pref-btn" disabled={busy() || !receivedBytes()} onClick={() => act(() => renderApprovalPreview(received(), receivedBytes(), leesGetal(page()), receiptCanvas))}>{t('approvalRouting.preview')}</button>
        </div>
        <canvas ref={receiptCanvas} />
        <label>
          <input type="checkbox" checked={receiptConfirmed()} onChange={(e) => setReceiptConfirmed(e.target.checked)} />
          {t('approvalRouting.confirmReceipt')}
        </label>
        <div class="approval-row">
          <button class="pref-btn" disabled={busy() || !recipient() || !receivedBytes() || !receiptConfirmed()} onClick={() => act(async () => {
            const receipt = await makeReceipt(received(), receivedBytes(), recipient(), receiptDecision(), comment());
            download(JSON.stringify(receipt, null, 2), 'approval-receipt.json', 'application/json');
          })}>{t('approvalRouting.makeReceipt')}</button>
        </div>
      </Show>
    </Show>
    <p role="status" class="approval-error">{error()}</p>
  </Dialog>;
}
