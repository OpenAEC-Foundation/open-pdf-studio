// Aparte, ondertekende updatefeed voor Windows-gebruikersinstallaties (#1051).
import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function userInstallConfig(config) {
  const next = structuredClone(config);
  next.bundle.windows.nsis.installMode = 'currentUser';
  // Never fall back to latest.json: that feed contains the elevated installer.
  next.plugins.updater.endpoints = next.plugins.updater.endpoints.map(endpoint => {
    const url = new URL(endpoint);
    if (!url.pathname.endsWith('/latest.json')) throw new Error('Expected a latest.json updater endpoint');
    url.pathname = url.pathname.replace(/latest\.json$/, 'latest-user.json');
    return url.href;
  });
  return next;
}

export async function userUpdateManifest(directory, repository, tag, version) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || tag !== `v${version}`) {
    throw new Error('Release repository/tag does not match the app version');
  }
  const files = (await readdir(directory)).filter(name => name.endsWith('_x64-setup.exe.zip'));
  if (files.length !== 1) throw new Error('Expected exactly one signed Windows x64 updater ZIP');
  const source = files[0];
  const signature = (await readFile(path.join(directory, `${source}.sig`), 'utf8')).trim();
  if (!signature) throw new Error('Missing updater signature');
  const name = source.replace(/_x64-setup\.exe\.zip$/, '_x64_user-setup.exe.zip');
  // Copy the original bytes and signature: repacking would invalidate the signature.
  await copyFile(path.join(directory, source), path.join(directory, name));
  await copyFile(path.join(directory, `${source}.sig`), path.join(directory, `${name}.sig`));
  const asset = { signature, url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}` };
  const manifest = { version, notes: '', pub_date: new Date().toISOString(), platforms: {
    'windows-x86_64': asset,
    'windows-x86_64-nsis': asset,
  } };
  await writeFile(path.join(directory, 'latest-user.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, target, repository, tag] = process.argv.slice(2);
  if (command === 'configure') {
    const config = userInstallConfig(JSON.parse(await readFile(target, 'utf8')));
    await writeFile(target, JSON.stringify(config, null, 2) + '\n');
  } else if (command === 'manifest') {
    const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    if (config.bundle.windows.nsis.installMode !== 'currentUser') {
      throw new Error('Refusing to publish a system build in the user update feed');
    }
    await userUpdateManifest(target, repository, tag, config.version);
  } else {
    throw new Error('Usage: windows-user-update.mjs configure <config> | manifest <bundle-directory> <owner/repo> <vVERSION>');
  }
}
