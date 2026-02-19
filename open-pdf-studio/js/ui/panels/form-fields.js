import { getActiveDocument } from '../../core/state.js';
import { setGroups, setCountText, setEmptyMessage } from '../../solid/stores/panels/formFieldsStore.js';

function getFieldTypeLabel(type) {
  const labels = {
    text: 'Text Field',
    checkbox: 'Checkbox',
    radiobutton: 'Radio Button',
    combobox: 'Combo Box',
    listbox: 'List Box',
    button: 'Push Button',
    signature: 'Signature'
  };
  return labels[type] || type || 'Unknown';
}

export async function updateFormFieldsList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    setGroups([]);
    setCountText('0 fields');
    setEmptyMessage('No document open');
    return;
  }

  setEmptyMessage('Loading...');

  try {
    const pdfDoc = activeDoc.pdfDoc;

    if (typeof pdfDoc.getFieldObjects !== 'function') {
      setGroups([]);
      setCountText('0 fields');
      setEmptyMessage('No form fields in this document');
      return;
    }

    const fields = await pdfDoc.getFieldObjects();

    if (!fields || Object.keys(fields).length === 0) {
      setGroups([]);
      setCountText('0 fields');
      setEmptyMessage('No form fields in this document');
      return;
    }

    let totalCount = 0;

    const fieldsByPage = new Map();
    const fieldsNoPage = [];

    for (const [fieldName, fieldArray] of Object.entries(fields)) {
      for (const field of fieldArray) {
        if (field.type === 'signature') continue;
        totalCount++;
        const pageNum = field.page !== undefined && field.page !== null ? field.page + 1 : null;
        if (pageNum !== null) {
          if (!fieldsByPage.has(pageNum)) {
            fieldsByPage.set(pageNum, []);
          }
          fieldsByPage.get(pageNum).push({ fieldName, field });
        } else {
          fieldsNoPage.push({ fieldName, field });
        }
      }
    }

    if (totalCount === 0) {
      setGroups([]);
      setCountText('0 fields');
      setEmptyMessage('No form fields in this document');
      return;
    }

    const sortedPages = [...fieldsByPage.keys()].sort((a, b) => a - b);
    const groupsArray = [];

    for (const pageNum of sortedPages) {
      const pageFields = fieldsByPage.get(pageNum);
      groupsArray.push({
        pageLabel: `Page ${pageNum}`,
        fields: pageFields.map(({ fieldName, field }) => ({
          fieldName,
          type: field.type,
          typeLabel: getFieldTypeLabel(field.type),
          value: field.value,
          page: pageNum
        }))
      });
    }

    if (fieldsNoPage.length > 0) {
      groupsArray.push({
        pageLabel: 'Document Level',
        fields: fieldsNoPage.map(({ fieldName, field }) => ({
          fieldName,
          type: field.type,
          typeLabel: getFieldTypeLabel(field.type),
          value: field.value,
          page: null
        }))
      });
    }

    setEmptyMessage(null);
    setGroups(groupsArray);
    setCountText(`${totalCount} field${totalCount !== 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('Failed to load form fields:', e);
    setGroups([]);
    setCountText('0 fields');
    setEmptyMessage('Could not load form fields');
  }
}
