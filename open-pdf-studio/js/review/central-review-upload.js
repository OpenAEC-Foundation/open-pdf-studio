// User-selected source files are read only. No automatic document creation or
// retry: an uncertain server response can already have committed the upload.
export async function uploadCentralPdf(client, document, io, valid) {
  const check = () => { if (!valid()) throw new Error('STALE'); };
  check();
  const path = await io.choose(); check();
  if (path === null) return false;
  if (typeof path !== 'string' || !path) throw new Error('INVALID_PDF');
  const info = await io.stat(path); check();
  if (!info?.isFile || !Number.isSafeInteger(info.size) || info.size < 5 || info.size > 32 * 1024 * 1024) throw new Error('INVALID_PDF');
  const bytes = await io.read(path); check();
  // A file can change after stat; the client also checks header and byte limit.
  if (!(bytes instanceof Uint8Array) || bytes.length !== info.size) throw new Error('INVALID_PDF');
  await client.upload(document, bytes); check();
  return true;
}
