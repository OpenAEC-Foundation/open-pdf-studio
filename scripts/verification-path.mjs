import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.OPDS_VERIFICATION_ROOT || fileURLToPath(new URL('../../verification-files/', import.meta.url));

export function verificationPath(relativePath) {
  return resolve(root, relativePath).replaceAll('\\', '/');
}
