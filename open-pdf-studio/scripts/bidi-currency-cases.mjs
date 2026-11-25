export const currencyCases = [
  { name: 'shekel', visual: 'דבלב ₪ 100 ריחמה', expected: 'המחיר 100 ₪ בלבד', before: 'המחיר ₪ 100 בלבד', dir: 'rtl' },
  { name: 'euro', visual: '€ 50 ريعس', expected: 'سعير 50 €', before: 'سعير € 50', dir: 'rtl' },
  { name: 'per-mille', visual: '5‰ לש רועיש', expected: 'שיעור של 5‰', before: 'שיעור של 5‰', dir: 'rtl' },
  { name: 'LTR', visual: 'abc 100 EUR', expected: 'abc 100 EUR', before: 'abc 100 EUR', dir: 'ltr' },
];
