// Een PNG op het systeemklembord zetten (#925).
//
// Desktop (Tauri) gaat via de Rust-opdracht `write_clipboard_image_png`
// (clipboard-manager-plugin). WebKitGTK op Linux, en WKWebView op macOS,
// weigeren navigator.clipboard.write() met een afbeelding met NotAllowedError
// zodra een await (het renderen op hoge dpi) de gebruikersactivatie van de klik
// heeft verbruikt; de Rust-kant heeft die activatie niet nodig. De browser en
// mobiel houden de asynchrone Clipboard API; die is ook de terugval als de
// Rust-opdracht ontbreekt (oudere backend) of faalt.
//
// Puur: de afhankelijkheden komen als argument binnen, zodat de keuze zonder
// Tauri of DOM te testen is.

/**
 * @param {Blob} blob  PNG
 * @param {{ desktop: boolean,
 *           invoke?: (cmd: string, args?: any) => Promise<any>,
 *           clipboard?: { write: (items: any[]) => Promise<void> },
 *           ClipboardItem?: any,
 *           waarschuw?: (...a: any[]) => void }} omgeving
 * @returns {Promise<'native' | 'web'>} welke route het werd
 */
export async function kopieerPngNaarKlembord(blob, omgeving) {
  const { desktop, invoke, clipboard, ClipboardItem: Item, waarschuw = () => {} } = omgeving;
  let nativeFout = null;
  if (desktop && typeof invoke === 'function') {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await invoke('write_clipboard_image_png', bytes);
      return 'native';
    } catch (e) {
      // Tauri meldt een fout als tekst; de dialoog toont e.message.
      nativeFout = e instanceof Error ? e : new Error(String(e));
      waarschuw('[screenshot] native clipboard write failed, trying the web API:', e);
    }
  }
  if (!clipboard?.write || typeof Item !== 'function') {
    throw nativeFout || new Error('clipboard not available');
  }
  try {
    await clipboard.write([new Item({ 'image/png': blob })]);
  } catch (e) {
    // De native fout zegt meer dan de NotAllowedError van de WebView.
    throw nativeFout || e;
  }
  return 'web';
}
