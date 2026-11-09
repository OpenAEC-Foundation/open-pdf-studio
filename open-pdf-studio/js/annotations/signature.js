import { openDialog } from '../bridge.js';

// `page`: de aangeklikte pagina; de handtekening komt daar, niet op de
// huidige pagina (in de weergave met twee pagina's de linker, #1006).
export function showSignatureDialog(x, y, page) {
  openDialog('signature', { x, y, page });
}

// No-op init (kept for backward compatibility during transition)
export function initSignatureDialog() {}
