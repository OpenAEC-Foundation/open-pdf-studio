// Who started an approval-routing request, for the audit trail and for the
// confirmations that the dialog asks of a person.

/** Actor recorded in audit events for a request origin. */
export function actorFor(origin) {
  if (origin === 'mcp') return 'MCP';
  if (origin === 'plugin') return 'Extension';
  return 'Local operator';
}

/**
 * Automation clients confirm explicitly what the dialog confirms with a
 * checkbox: creating a receipt or recording a decision (#651) states a
 * decision on behalf of a recipient.
 */
export function checkAutomationRequest(request, origin) {
  if ((origin === 'mcp' || origin === 'plugin') && ['createReceipt', 'decision'].includes(request?.action) && request.confirmed !== true) {
    throw new Error('CONFIRMATION_REQUIRED');
  }
}
