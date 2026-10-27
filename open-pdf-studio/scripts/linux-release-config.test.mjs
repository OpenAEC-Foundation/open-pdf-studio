import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const repoRoot = new URL('../../', import.meta.url);
const appRoot = new URL('../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, appRoot), 'utf8'));
}

test('desktop runtime resources stay on their own platform', async () => {
  const base = await readJson('src-tauri/tauri.conf.json');
  const linux = await readJson('src-tauri/tauri.linux.conf.json');
  const windows = await readJson('src-tauri/tauri.windows.conf.json');

  const baseResources = base.bundle.resources;
  const linuxResources = { ...baseResources, ...linux.bundle.resources };
  const windowsResources = { ...baseResources, ...windows.bundle.resources };

  assert.equal(linuxResources['binaries/win-x64/pdfium.dll'], undefined);
  assert.equal(linuxResources['WebView2Loader.dll'], undefined);
  assert.equal(
    linuxResources['binaries/linux-x64/libpdfium.so'],
    'libpdfium.so',
  );

  assert.equal(
    windowsResources['binaries/win-x64/pdfium.dll'],
    'pdfium.dll',
  );
  assert.equal(
    windowsResources['WebView2Loader.dll'],
    'WebView2Loader.dll',
  );
  assert.equal(
    base.bundle.windows.webviewInstallMode.type,
    'embedBootstrapper',
  );
});

test('CI builds and starts the AppImage on Debian 13', async () => {
  const workflow = await readFile(
    new URL('.github/workflows/ci.yml', repoRoot),
    'utf8',
  );

  assert.match(workflow, /Fetch libpdfium\.so \(Linux\)/);
  assert.match(
    workflow,
    /tauri build -- --bundles appimage --config '\{"bundle":\{"createUpdaterArtifacts":false\}\}'/,
  );
  assert.match(workflow, /find \.\.\/target\/release\/bundle\/appimage/);
  assert.match(workflow, /appimage=\$\(realpath "\$appimage"\)/);
  assert.match(workflow, /debian:13-slim/);
  assert.match(workflow, /gvfs/);
  assert.match(workflow, /libegl1/);
  assert.match(workflow, /libgles2/);
  assert.match(workflow, /libgtk-3-0t64/);
  assert.match(workflow, /linux-appimage-smoke\.sh/);
});

test('the AppImage GIO guard runs before Tauri setup', async () => {
  const main = await readFile(new URL('src-tauri/src/main.rs', appRoot), 'utf8');
  const guard = main.indexOf('configure_appimage_gio_modules();');
  const tauri = main.indexOf('app_lib::run(');

  assert.notEqual(guard, -1);
  assert.notEqual(tauri, -1);
  assert.ok(guard < tauri);
});

test('every AppImage build excludes the same display-stack libraries (#362)', async () => {
  const expected = [
    'libwayland-client.so', 'libwayland-cursor.so', 'libwayland-egl.so', 'libwayland-server.so',
    'libxkbcommon.so', 'libxcb-randr.so', 'libxcb-render.so', 'libxcb-shm.so',
    'libXau.so', 'libXdmcp.so',
  ];
  const values = [];
  for (const name of ['ci.yml', 'release.yml', 'nightly.yml']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}`, repoRoot), 'utf8');
    const match = workflow.match(/LINUXDEPLOY_EXCLUDED_LIBRARIES: '([^']+)'/);
    assert.ok(match, `${name} sets LINUXDEPLOY_EXCLUDED_LIBRARIES`);
    values.push(match[1]);
  }
  assert.deepEqual(values[0].split(';'), expected.map((lib) => `${lib}*`));
  assert.equal(values[1], values[0], 'release.yml matches ci.yml');
  assert.equal(values[2], values[0], 'nightly.yml matches ci.yml');

  const smoke = await readFile(new URL('scripts/linux-appimage-smoke.sh', appRoot), 'utf8');
  const smokeLibs = smoke.match(/display_stack_libs=\(([^)]+)\)/);
  assert.ok(smokeLibs, 'smoke script lists the display-stack libraries');
  assert.deepEqual(smokeLibs[1].trim().split(/\s+/), expected);
});

test('CI starts the AppImage on Fedora 44', async () => {
  const workflow = await readFile(new URL('.github/workflows/ci.yml', repoRoot), 'utf8');
  assert.match(workflow, /Verify AppImage on Fedora 44/);
  assert.match(workflow, /fedora:44/);
  assert.match(workflow, /xorg-x11-server-Xvfb/);
  assert.match(workflow, /mesa-libEGL/);
  assert.match(workflow, /libwayland-server/);
});

test('every AppImage build pins the same checksum-verified linuxdeploy (#362)', async () => {
  const url = 'https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20251107-1/linuxdeploy-x86_64.AppImage';
  const sha = 'c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d';
  for (const name of ['ci.yml', 'release.yml', 'nightly.yml']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}`, repoRoot), 'utf8');
    assert.ok(workflow.includes('Provide pinned linuxdeploy (Linux)'), `${name} provides linuxdeploy`);
    assert.ok(workflow.includes(url), `${name} downloads the pinned release`);
    assert.ok(workflow.includes(sha), `${name} verifies the checksum`);
  }
});


test('Linux links Tesseract statically instead of a system soname (#620)', async () => {
  const cargo = await readFile(new URL('src-tauri/Cargo.toml', appRoot), 'utf8');
  const deps = cargo
    .split('\n')
    .filter((line) => /^tesseract-rs\s*=/.test(line));
  assert.ok(deps.length > 0, 'tesseract-rs is a dependency');
  for (const line of deps) {
    assert.doesNotMatch(line, /use-system-tesseract/, line);
    assert.match(line, /"build-tesseract"/, line);
  }
  assert.doesNotMatch(cargo, /target_os = "linux"\)'\.dependencies\]\s*\ntesseract-rs/);

  for (const name of ['ci.yml', 'release.yml', 'nightly.yml', 'snap.yml']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}`, repoRoot), 'utf8');
    assert.doesNotMatch(workflow, /libtesseract-dev|libleptonica-dev/, `${name} installs no system Tesseract`);
  }
  for (const name of ['ci.yml', 'release.yml', 'nightly.yml']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}`, repoRoot), 'utf8');
    assert.match(
      workflow,
      /bash scripts\/linux-ocr-linkage-check\.sh \.\.\/target\/release\/open-pdf-studio/,
      `${name} checks the binary's NEEDED entries`,
    );
  }

  const linux = await readJson('src-tauri/tauri.linux.conf.json');
  const base = await readJson('src-tauri/tauri.conf.json');
  const depends = [
    ...(base.bundle.linux?.deb?.depends ?? []),
    ...(linux.bundle.linux?.deb?.depends ?? []),
  ];
  assert.ok(
    !depends.some((dep) => /tesseract|leptonica|lept5/.test(dep)),
    'the .deb does not depend on a system Tesseract',
  );
});

test('the AUR reference PKGBUILD and .SRCINFO agree (#620)', async () => {
  const pkgbuild = await readFile(new URL('packaging/aur/PKGBUILD', repoRoot), 'utf8');
  const srcinfo = await readFile(new URL('packaging/aur/.SRCINFO', repoRoot), 'utf8');
  const pkgver = pkgbuild.match(/^pkgver=(.+)$/m)?.[1];
  assert.ok(pkgver, 'PKGBUILD sets pkgver');
  assert.match(srcinfo, new RegExp(`^\tpkgver = ${pkgver.replace(/\./g, '\.')}$`, 'm'));
  assert.match(srcinfo, /^\tdepends = webkit2gtk-4\.1$/m);
  assert.doesNotMatch(srcinfo, /depends = .*(tesseract|leptonica)/i);
  assert.doesNotMatch(srcinfo, /\r/, '.SRCINFO uses LF line endings');
});

// GNOME, Cinnamon and KDE only offer an app under "Open With" (and accept it
// as default PDF viewer) when its desktop entry takes a file through a field
// code. The startup code and the single-instance callback read plain paths
// from argv, so every entry uses %F and never %U (file:// URIs) (#748).
test('every Linux desktop entry passes the opened PDF to the app (#748)', async () => {
  const base = await readJson('src-tauri/tauri.conf.json');
  const debTemplate = base.bundle.linux?.deb?.desktopTemplate;
  const rpmTemplate = base.bundle.linux?.rpm?.desktopTemplate;
  assert.ok(debTemplate, '.deb (and the AppImage built from it) uses a custom desktop template');
  assert.equal(rpmTemplate, debTemplate, '.rpm uses the same desktop template');

  const snapcraft = await readFile(new URL('snap/snapcraft.yaml', repoRoot), 'utf8');
  const heredoc = snapcraft.match(/<< 'EOF'\n([\s\S]*?)\n\s*EOF/);
  assert.ok(heredoc, 'snapcraft.yaml writes a desktop entry');

  const entries = {
    [debTemplate]: await readFile(new URL(`src-tauri/${debTemplate}`, appRoot), 'utf8'),
    'snap/gui/open-pdf-studio.desktop': await readFile(new URL('snap/gui/open-pdf-studio.desktop', repoRoot), 'utf8'),
    'snap/snapcraft.yaml': heredoc[1].replace(/^ +/gm, ''),
    'flatpak/org.openaec.OpenPdfStudio.desktop': await readFile(
      new URL('flatpak/org.openaec.OpenPdfStudio.desktop', repoRoot),
      'utf8',
    ),
  };

  for (const [name, entry] of Object.entries(entries)) {
    const exec = entry.match(/^Exec=(.*)$/m);
    assert.ok(exec, `${name} has an Exec line`);
    assert.match(exec[1], / %F$/, `${name}: Exec ends with the %F field code`);
    assert.match(entry, /^MimeType=(?:[^\n]*;)?application\/pdf;/m, `${name} declares application/pdf`);
    assert.match(entry, /^Type=Application$/m, `${name} is an application entry`);
  }
});
