// Goedkeuringsroutes (#651): providers die een aanvraag de app uit brengen.
//
// Een provider zegt eerst precies wat er uitgaat (outgoing: ontvangers,
// onderwerp, tekst, bijlage met hash) zonder iets te doen; dat is de
// voorvertoning. Pas deliver() draagt het over, en alleen core.submit()
// roept deliver() aan. Beide ingebouwde providers zijn lokaal:
//
//  - mail-v1       : het standaard-mailprogramma opent een concept met de
//                    PDF als bijlage, via dezelfde weg als Delen / verzenden
//                    (pdf/delen.js, src-tauri/src/email.rs). De gebruiker
//                    verstuurt het concept zelf; de app verstuurt nooit mail.
//  - local-file-v1 : een pakket (PDF + request.json + audit) als bestand,
//                    om zelf over te dragen.
//
// Geen clouddienst, geen account. Een provider moet expliciet zijn
// ingeschakeld (service.js). Puur: de uitvoering (mail, download) komt via
// `impl` binnen, zodat dit in Node te testen is.

import { requestRef } from './model.js';

/** Bestandsnaam van de bijlage: de documentnaam met de aanvraagverwijzing. */
export function attachmentName(record) {
  const base = String(record.config.source.name || 'document.pdf').replace(/\.pdf$/i, '') || 'document';
  return `${base} [${requestRef(record.id)}].pdf`;
}

/** Wie deze verzending krijgt: wie aan de beurt is (verifyRequest().recipients[].turn). */
export function dispatchRecipients(record, state) {
  const turn = new Set((state.recipients || []).filter((r) => r.turn).map((r) => r.id));
  return record.config.recipients.filter((r) => turn.has(r.id));
}

const roleKey = (role) => `approvalRouting.roles.${role || 'approve'}`;

/**
 * Onderwerp en tekst van de mail. `t` is i18next.t van de namespace dialogs.
 * Deterministisch: dezelfde aanvraag en toestand geven dezelfde tekst.
 */
export function mailText(record, recipients, { t, attachment }) {
  const c = record.config, ref = requestRef(record.id);
  const subject = `${c.title} [${ref}]`;
  const lines = [];
  if (c.message.trim()) lines.push(c.message.trim(), '');
  lines.push(t('approvalRouting.mail.intro'), '');
  for (const r of recipients) lines.push(`- ${r.name} <${r.email}>: ${t(roleKey(r.role))}`);
  lines.push('');
  lines.push(`${t('approvalRouting.mail.document')}: ${c.source.name}${c.source.revision ? ` (${c.source.revision})` : ''}, ${t('approvalRouting.mail.pages', { count: c.source.pages })}`);
  lines.push(`${t('approvalRouting.mail.attachment')}: ${attachment.name}`);
  lines.push(`SHA-256: ${attachment.hash}`);
  if (c.expiresAt) lines.push(`${t('approvalRouting.mail.due')}: ${c.expiresAt.slice(0, 10)}`);
  lines.push(`${t('approvalRouting.mail.reference')}: ${ref}`);
  lines.push(`${t('approvalRouting.mail.routing')}: ${t(`approvalRouting.${c.mode}`)}`);
  lines.push('', t('approvalRouting.mail.howToRespond', { ref }));
  if (recipients.some((r) => r.role === 'sign')) lines.push(t('approvalRouting.mail.howToSign', { ref }));
  lines.push('', t('approvalRouting.mail.disclaimer'));
  return { subject, body: lines.join('\n') };
}

/**
 * De ingebouwde providers. `impl.sendMail({ to, subject, body, name, bytes })`
 * opent het mailconcept; `impl.deliverPackage(record, bytes, outgoing)` levert
 * het overdrachtspakket als bestand.
 */
export function createProviders(impl) {
  return {
    'mail-v1': {
      id: 'mail-v1',
      outgoing(record, state, { t, attachment }) {
        const recipients = dispatchRecipients(record, state);
        const { subject, body } = mailText(record, recipients, { t, attachment });
        return { provider: 'mail-v1', recipients, to: recipients.map((r) => r.email), subject, body, attachment };
      },
      deliver(outgoing, bytes) {
        return impl.sendMail({ to: outgoing.to, subject: outgoing.subject, body: outgoing.body, name: outgoing.attachment.name, bytes });
      },
    },
    'local-file-v1': {
      id: 'local-file-v1',
      outgoing(record, state, { t, attachment }) {
        const recipients = dispatchRecipients(record, state);
        return {
          provider: 'local-file-v1', recipients, to: recipients.map((r) => r.email),
          subject: record.config.title, body: t('approvalRouting.packageNote'), attachment,
          packageName: `approval-package [${requestRef(record.id)}].zip`,
        };
      },
      deliver(outgoing, bytes, record) {
        return impl.deliverPackage(record, bytes, outgoing);
      },
    },
  };
}
