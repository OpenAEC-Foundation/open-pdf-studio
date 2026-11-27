/** Report an invalid edit once, so acknowledging it cannot trap focus.
 * The value is retained; changing it makes validation eligible again.
 */
export function bindBlurValidation(input, validate, report, canValidate = () => true) {
  let reportedValue;
  input.addEventListener('input', () => {
    reportedValue = undefined;
    input.removeAttribute('aria-invalid');
  });
  input.addEventListener('blur', () => {
    if (input.disabled || !input.isConnected || !canValidate()) return;
    const value = input.value;
    if (value === reportedValue) return;
    const error = validate(value);
    if (!error) { input.removeAttribute('aria-invalid'); return; }
    reportedValue = value;
    input.setAttribute('aria-invalid', 'true');
    report(error, input);
  });
}
