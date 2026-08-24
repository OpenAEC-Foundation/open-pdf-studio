// Hoeveelheden — koppelt de pure label-hook van categories.js aan i18next.
// Los gehouden van categories.js zodat die module (en de unit-tests) vrij
// blijft van UI-/bundler-afhankelijkheden.
//
// De resolver leest bewust de reactieve `language()`-signal: labels worden
// daardoor binnen een Solid-memo/render opnieuw berekend zodra de gebruiker
// van taal wisselt.
import i18next from '../i18n/config.js';
import { language } from '../i18n/useTranslation.js';
import { setQuantityLabelResolver } from './categories.js';

setQuantityLabelResolver((key, fallback) => {
  language();
  return i18next.t(key, { ns: 'properties', defaultValue: fallback });
});

export { };
