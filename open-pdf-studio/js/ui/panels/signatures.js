import { getActiveDocument } from '../../core/state.js';
import { setItems, setCountText, setEmptyMessage } from '../../solid/stores/panels/signaturesStore.js';

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
      const fields = await pdfDoc.getFieldObjects();
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
    setCountText('0 signatures');
    setEmptyMessage('No document open');
    return;
  }

  setEmptyMessage('Loading...');

  try {
    const sigs = await getSignatureFields(activeDoc.pdfDoc);

    if (sigs.length === 0) {
      setItems([]);
      setCountText('0 signatures');
      setEmptyMessage('No digital signatures in this document');
      return;
    }

    setEmptyMessage(null);
    setItems(sigs.map(sig => {
      const status = sig.verified === true ? 'valid' : sig.verified === false ? 'invalid' : 'unknown';
      return {
        fieldName: sig.fieldName,
        name: sig.name || 'Unknown Signer',
        reason: sig.reason,
        location: sig.location,
        date: sig.date ? formatSignatureDate(sig.date) : null,
        contactInfo: sig.contactInfo,
        status,
        statusText: status === 'valid' ? 'Signature is valid' : status === 'invalid' ? 'Signature is invalid' : 'Verification not available',
        page: sig.page
      };
    }));
    setCountText(`${sigs.length} signature${sigs.length !== 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('Failed to load signatures:', e);
    setItems([]);
    setCountText('0 signatures');
    setEmptyMessage('Could not load signatures');
  }
}
