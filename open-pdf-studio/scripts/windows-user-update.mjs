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

// GitHub stores a release asset under its file name with spaces turned into dots.
const assetName = name => name.replace(/ /g, '.');

export async function userUpdateManifest(directory, repository, tag, version) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || tag !== `v${version}`) {
    throw new Error('Release repository/tag does not match the app version');
  }
  // The user build leaves the same artifact names as the system build: the
  // updater ZIP (`_x64-setup.nsis.zip`) and the signature of the installer
  // itself (`_x64-setup.exe.sig`). The installer may already carry its user name.
  const names = await readdir(directory);
  const zips = names.filter(name => name.endsWith('_x64-setup.nsis.zip'));
  if (zips.length !== 1) throw new Error('Expected exactly one signed Windows x64 updater ZIP');
  const zip = zips[0];
  const stem = zip.replace(/_x64-setup\.nsis\.zip$/, '');
  const read = async name => {
    const text = (await readFile(path.join(directory, name), 'utf8')).trim();
    if (!text) throw new Error(`Missing updater signature in ${name}`);
    return text;
  };
  const zipSignature = await read(`${zip}.sig`);
  const exeSignature = await read(`${stem}_x64-setup.exe.sig`);
  const userZip = `${stem}_x64_user-setup.nsis.zip`;
  const userExe = `${stem}_x64_user-setup.exe`;
  if (!names.includes(userExe) && !names.includes(`${stem}_x64-setup.exe`)) {
    throw new Error('Missing the Windows user installer');
  }
  // Copy the original bytes and signatures: repacking would invalidate them.
  await copyFile(path.join(directory, zip), path.join(directory, userZip));
  await copyFile(path.join(directory, `${zip}.sig`), path.join(directory, `${userZip}.sig`));
  await copyFile(path.join(directory, `${stem}_x64-setup.exe.sig`), path.join(directory, `${userExe}.sig`));
  const url = name => `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName(name))}`;
  const manifest = { version, notes: '', pub_date: new Date().toISOString(), platforms: {
    'windows-x86_64': { signature: zipSignature, url: url(userZip) },
    'windows-x86_64-nsis': { signature: exeSignature, url: url(userExe) },
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
