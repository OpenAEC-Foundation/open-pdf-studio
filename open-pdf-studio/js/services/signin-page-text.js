// Teksten voor de afsluitpagina die de browser laat zien na de OAuth-redirect.
//
// Die pagina wordt door Rust geserveerd (accounts.rs, loopback op 53682) en had
// de tekst hardcoded in het Nederlands staan — ook bij een Engelse UI. Rust kan
// niet bij i18next, dus geven we de vertaalde strings mee als argument.
import i18next from '../i18n/config.js';

export function signInPageText() {
  const t = (k) => i18next.t(k, { ns: 'common' });
  return {
    okTitle: t('account.callbackOkTitle'),
    okBody: t('account.callbackOkBody'),
    cancelledTitle: t('account.callbackCancelledTitle'),
    cancelledBody: t('account.callbackCancelledBody'),
  };
}
