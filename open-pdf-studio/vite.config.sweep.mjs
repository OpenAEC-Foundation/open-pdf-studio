// TIJDELIJK — alleen voor de regressie-sweeps.
// Identiek aan vite.config.js maar met HMR uit: tijdens een lange sweep
// veroorzaakt elke HMR-update een volledige herlaad van de app, en die
// herlaad breekt de app ("Cannot redefine property: shiftKeyPressed"),
// waardoor de sweep halverwege afbreekt en pagina's vals als leeg meet.
// Dit bestand hoort NIET gecommit te worden.
import base from './vite.config.js';

export default {
  ...base,
  server: {
    ...(base.server || {}),
    hmr: false,
    watch: { ignored: ['**/*'] },
  },
};
