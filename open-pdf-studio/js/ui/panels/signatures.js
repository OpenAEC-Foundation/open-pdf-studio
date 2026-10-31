import { pdfjsRecord } from '../../pdf/pdfjs-record.js';
import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { setSignatureItems as setItems, setSignatureCountText as setCountText, setSignatureEmptyMessage as setEmptyMessage } from '../../bridge.js';
import { ernst, balkRegelDelen, formatTijd } from '../../pdf/handtekeningen/weergave.js';

/**
 * Regels voor het paneel uit de verificatie in Rust (doc.handtekeningen, zie
 * pdf/handtekeningen/verificatie.js): dezelfde status als de balk boven de
 * pagina. `paginas` koppelt een veldnaam aan het paginanummer uit pdf.js.
 */
export function regelsUitVerificatie(lijst, paginas, t, taal) {
  const v = (sleutel, opties) => t(`dialogs:signatureVerification.${sleutel}`, opties);
  return lijst.map((h) => {
    const e = ernst(h);
    const status = e === 'goed' ? 'valid' : e === 'fout' ? 'invalid' : 'unknown';
    const { status: statusText } = balkRegelDelen(h, { v, t: (k, o) => t(`dialogs:${k}`, o), taal });
    // "Geldige handtekening, certificaat niet vertrouwd": de inhoud klopt.
    const intactNietVertrouwd = h?.status?.code === 'onbekend-certificaat' && h?.integriteit?.uitkomst === 'intact';
    return {
      fieldName: h.veldnaam || '',
      name: h.ondertekenaar || h.opgegevenNaam || (h.soort === 'leeg-veld' ? (h.veldnaam || '') : t('leftPanel.unknownSigner')),
      reason: h.reden || null,
      location: h.plaats || null,
      date: formatTijd(h.tijdUnix, taal),
      contactInfo: h.contact || null,
      status,
      statusText,
      detailText: intactNietVertrouwd ? v('intactNotTrusted') : null,
      page: (h.veldnaam && paginas.get(h.veldnaam)) || null,
      info: h,
    };
  });
}

// Format a date from a PDF date string
function formatSignatureDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  try {
    // PDF dates: D:YYYYMMDDHHmmSS or standard ISO
    let cleaned = dateStr;
    if (cleaned.startsWith('D:')) {
      cleaned = cleaned.substring(2);
      const y = cleaned.substring(0, 4);
      const m = cleaned.substring(4, 6);
      const d = cleaned.substring(6, 8);
      const h = cleaned.substring(8, 10) || '00';
      const min = cleaned.substring(10, 12) || '00';
      const s = cleaned.substring(12, 14) || '00';
      return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`).toLocaleString();
    }
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

// Extract signature field info from PDF form fields
async function getSignatureFields(pdfDoc) {
  const signatures = [];

  try {
    // Try getFieldObjects (pdf.js >= 2.10)
    if (typeof pdfDoc.getFieldObjects === 'function') {
      const fields = pdfjsRecord(await pdfDoc.getFieldObjects());
      if (fields) {
        for (const [fieldName, fieldArray] of Object.entries(fields)) {
          for (const field of fieldArray) {
            if (field.type === 'signature') {
              signatures.push({
                fieldName,
                name: field.value?.Name || field.value?.name || fieldName,
                reason: field.value?.Reason || field.value?.reason || null,
                location: field.value?.Location || field.value?.location || null,
                date: field.value?.M || field.value?.date || null,
                contactInfo: field.value?.ContactInfo || field.value?.contactInfo || null,
                verified: null // pdf.js does not verify signatures
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('getFieldObjects failed:', e);
  }

  // Also scan annotations on each page for Sig type widgets
  try {
    const numPages = pdfDoc.numPages;
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const annots = await page.getAnnotations();
      for (const annot of annots) {
        if (annot.fieldType === 'Sig' && annot.fieldValue) {
          // Avoid duplicates
          const val = annot.fieldValue;
          const alreadyAdded = signatures.some(s => s.fieldName === annot.fieldName);
          if (!alreadyAdded) {
            signatures.push({
              fieldName: annot.fieldName || 'Signature',
              name: val.Name || val.name || annot.fieldName || 'Unknown Signer',
              reason: val.Reason || val.reason || null,
              location: val.Location || val.location || null,
              date: val.M || val.date || null,
              contactInfo: val.ContactInfo || val.contactInfo || null,
              verified: null,
              page: i
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('Annotation scan for signatures failed:', e);
  }

  return signatures;
}

// Load and display digital signatures from the active PDF
export async function updateSignaturesList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    setItems([]);
    setCountText(i18next.t('leftPanel.signaturesCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    const sigs = await getSignatureFields(activeDoc.pdfDoc);
    // Gecontroleerd door Rust: echte status per handtekening in plaats van "onbekend".
    const verificatie = activeDoc.handtekeningToestand === 'klaar' && Array.isArray(activeDoc.handtekeningen)
      ? activeDoc.handtekeningen : null;
    if (verificatie && verificatie.length) {
      const paginas = new Map(sigs.filter((s) => s.page).map((s) => [s.fieldName, s.page]));
      setEmptyMessage(null);
      setItems(regelsUitVerificatie(verificatie, paginas, (k, o) => i18next.t(k, o), i18next.language));
      setCountText(i18next.t('leftPanel.signaturesCount', { count: verificatie.length }));
      return;
    }

    if (sigs.length === 0) {
      setItems([]);
      setCountText(i18next.t('leftPanel.signaturesCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noSignatures'));
      return;
    }

    setEmptyMessage(null);
    setItems(sigs.map(sig => {
      const status = sig.verified === true ? 'valid' : sig.verified === false ? 'invalid' : 'unknown';
      return {
        fieldName: sig.fieldName,
        name: sig.name || i18next.t('leftPanel.unknownSigner'),
        reason: sig.reason,
        location: sig.location,
        date: sig.date ? formatSignatureDate(sig.date) : null,
        contactInfo: sig.contactInfo,
        status,
        statusText: status === 'valid' ? i18next.t('leftPanel.signatureValid') : status === 'invalid' ? i18next.t('leftPanel.signatureInvalid') : i18next.t('leftPanel.signatureUnknown'),
        page: sig.page
      };
    }));
    setCountText(i18next.t('leftPanel.signaturesCount', { count: sigs.length }));
  } catch (e) {
    console.warn('Failed to load signatures:', e);
    setItems([]);
    setCountText(i18next.t('leftPanel.signaturesCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.couldNotLoadSignatures'));
  }
}
