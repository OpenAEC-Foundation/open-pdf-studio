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

test('the .deb/AppImage desktop file accepts files, so "Open with" lists the app (#748)', async () => {
  const base = await readJson('src-tauri/tauri.conf.json');
  const linux = await readJson('src-tauri/tauri.linux.conf.json');
  const template = linux.bundle.linux?.deb?.desktopTemplate ?? base.bundle.linux?.deb?.desktopTemplate;
  assert.ok(template, 'bundle.linux.deb.desktopTemplate is set (the AppImage reuses it)');
  const desktop = await readFile(new URL(`src-tauri/${template}`, appRoot), 'utf8');
  // Without a field code GNOME/Cinnamon do not offer the app for files.
  assert.match(desktop, /^Exec=\{\{exec\}\} %U$/m);
  // The MimeType list must end with ';' (Tauri joins the types without one).
  assert.match(desktop, /^MimeType=\{\{mime_type\}\};$/m);
  assert.match(desktop, /^Icon=\{\{icon\}\}$/m);
});

function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.deepEqual([...bytes.subarray(0, 8)], signature, 'PNG signature');
  assert.equal(bytes.toString('latin1', 12, 16), 'IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

function desktopEntry(text) {
  const entry = {};
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.trim().match(/^([A-Za-z]+)=(.*)$/);
    if (match) entry[match[1]] = match[2];
  }
  return entry;
}

test('the bundle lists a complete square RGBA icon set for Linux (#774)', async () => {
  const base = await readJson('src-tauri/tauri.conf.json');
  const icons = base.bundle.icon;
  const expected = {
    'icons/icon.png': 512,
    'icons/32x32.png': 32,
    'icons/64x64.png': 64,
    'icons/128x128.png': 128,
    'icons/128x128@2x.png': 256,
    'icons/256x256.png': 256,
    'icons/512x512.png': 512,
  };
  for (const name of [...Object.keys(expected), 'icons/icon.icns', 'icons/icon.ico']) {
    assert.ok(icons.includes(name), `bundle.icon lists ${name}`);
  }
  // Tauri takes the first PNG in the list as the default window icon on Linux.
  assert.equal(icons.find((icon) => icon.endsWith('.png')), 'icons/icon.png');

  for (const [name, size] of Object.entries(expected)) {
    const png = pngSize(await readFile(new URL(`src-tauri/${name}`, appRoot)));
    assert.equal(png.width, size, `${name} width`);
    assert.equal(png.height, size, `${name} height`);
    assert.equal(png.bitDepth, 8, `${name} is 8 bits per channel`);
    assert.equal(png.colorType, 6, `${name} is RGBA`);
  }
});

test('desktop entries use the installed icon name and the window class (#774)', async () => {
  // Windows checkouts use CRLF; the checks below work per line.
  const leesLf = async (url) => (await readFile(url, 'utf8')).replace(/\r\n/g, '\n');
  const base = await readJson('src-tauri/tauri.conf.json');
  const cargo = await leesLf(new URL('src-tauri/Cargo.toml', appRoot));
  const binary = base.mainBinaryName ?? cargo.match(/^name\s*=\s*"([^"]+)"/m)[1];
  assert.equal(binary, 'open-pdf-studio');
  // Without enableGTKAppId GTK takes the binary name as WM_CLASS and Wayland
  // app_id; that is what the .deb/AppImage desktop file (<binary>.desktop) and
  // StartupWMClass below match.
  assert.notEqual(base.app?.enableGTKAppId, true);

  const flatpakId = 'org.openaec.OpenPdfStudio';
  assert.equal(flatpakId.toLowerCase(), base.identifier.toLowerCase());
  const manifest = await leesLf(new URL(`flatpak/${flatpakId}.yml`, repoRoot));
  assert.match(manifest, new RegExp(`^app-id: ${flatpakId.replace(/\./g, '\\.')}$`, 'm'));
  const flatpak = desktopEntry(
    await leesLf(new URL(`flatpak/${flatpakId}.desktop`, repoRoot)),
  );
  assert.equal(flatpak.Icon, flatpakId);
  assert.equal(flatpak.StartupWMClass, binary);

  const flake = await leesLf(new URL('flake.nix', repoRoot));
  // The scalable icon (icon-new.svg, the same design as the PNGs) stays.
  for (const [naam, tekst] of [['flatpak', manifest], ['flake', flake]]) {
    assert.match(tekst, /icons\/icon-new\.svg[^\n]*\n?[^\n]*hicolor\/scalable\/apps\/org\.openaec\.OpenPdfStudio\.svg/,
      `${naam} installs the scalable icon`);
  }
  for (const size of ['32x32', '64x64', '128x128', '256x256', '512x512']) {
    const target = `hicolor/${size}/apps/${flatpakId}.png`;
    assert.ok(
      manifest.includes(`src-tauri/icons/${size}.png \${FLATPAK_DEST}/share/icons/${target}`),
      `flatpak installs ${target}`,
    );
    assert.ok(flake.includes(`src-tauri/icons/${size}.png}`), `flake installs ${size}`);
    assert.ok(flake.includes(`/share/icons/${target}`), `flake installs ${target}`);
  }

  const snapcraft = await leesLf(new URL('snap/snapcraft.yaml', repoRoot));
  const snapDesktop = snapcraft.match(/cat > [^\n]*open-pdf-studio\.desktop << 'EOF'\n([\s\S]*?)\n\s*EOF/);
  assert.ok(snapDesktop, 'snapcraft.yaml writes the desktop entry');
  const snapEntries = [
    desktopEntry(snapDesktop[1]),
    desktopEntry(await leesLf(new URL('snap/gui/open-pdf-studio.desktop', repoRoot))),
  ];
  for (const entry of snapEntries) {
    // The .deb inside the snap puts its icons at hicolor/<size>/apps/<binary>.png;
    // directories such as 256x256@2 are not part of the icon theme.
    assert.equal(entry.Icon, `\${SNAP}/usr/share/icons/hicolor/512x512/apps/${binary}.png`);
    assert.equal(entry.StartupWMClass, binary);
  }
});

test('CI and release start the extracted AppImage in OpenAEC Linux conditions (#863)', async () => {
  for (const name of ['ci.yml', 'release.yml']) {
    const workflow = (await readFile(new URL(`.github/workflows/${name}`, repoRoot), 'utf8')).replace(/\r\n/g, '\n');
    assert.ok(workflow.includes('Verify AppImage in OpenAEC Linux conditions (Linux)'), `${name} runs the OpenAEC Linux smoke`);
    assert.match(workflow, /bash \/input\/openaec-linux-smoke\.sh \/tmp\/open-pdf-studio\.AppImage \d+ \/output/, name);
    for (const pkg of ['labwc', 'grim', 'libgl1-mesa-dri', 'libgbm1']) {
      assert.ok(workflow.includes(pkg), `${name} installs ${pkg}`);
    }
    // No GPU in the container: the step must not pass /dev/dri through.
    assert.doesNotMatch(workflow, /--device[= ]\/dev\/dri/, `${name} keeps the GPU out`);
    assert.ok(workflow.includes('name: openaec-linux-smoke'), `${name} uploads the screenshots`);
  }
  const release = await readFile(new URL('.github/workflows/release.yml', repoRoot), 'utf8');
  assert.match(release, /Add memory at rest to the release notes \(Linux\)/);
  const ci = await readFile(new URL('.github/workflows/ci.yml', repoRoot), 'utf8');
  assert.match(ci, /bash scripts\/openaec-linux-smoke\.test\.sh/);

  const smoke = (await readFile(new URL('scripts/openaec-linux-smoke.sh', appRoot), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(smoke, /--appimage-extract/);
  assert.match(smoke, /squashfs-root\/AppRun/);
  assert.match(smoke, /WLR_BACKENDS=headless/);
  assert.match(smoke, /WLR_RENDERER=pixman/);
  assert.match(smoke, /OPENAEC_BEHEERD=1/);
  assert.match(smoke, /kill -TERM "\$app_pid"/);
  assert.doesNotMatch(smoke, /APPIMAGE_EXTRACT_AND_RUN/, 'really extracted, not extract-and-run');
});

test('the OpenAEC environment is prepared in main before Tauri starts (#863)', async () => {
  const main = await readFile(new URL('src-tauri/src/main.rs', appRoot), 'utf8');
  const voorbereiding = main.indexOf('openaec_omgeving::bereid_proces_voor();');
  const beeldscherm = main.indexOf('openaec_omgeving::stop_zonder_beeldscherm(&args);');
  const tauri = main.indexOf('app_lib::run(');
  assert.notEqual(voorbereiding, -1);
  assert.notEqual(beeldscherm, -1);
  assert.ok(voorbereiding < tauri && beeldscherm < tauri);

  const cargo = await readFile(new URL('src-tauri/Cargo.toml', appRoot), 'utf8');
  assert.match(cargo, /^tokio = .*"signal"/m, 'tokio signal for the SIGTERM handler');
  const lib = await readFile(new URL('src-tauri/src/lib.rs', appRoot), 'utf8');
  assert.match(lib, /openaec_omgeving::installeer_sigterm\(app\.handle\(\)\.clone\(\)\)/);
  assert.match(lib, /mcp_server::start_beheerd\(/);

  const docs = await readFile(new URL('docs/openaec-linux.md', repoRoot), 'utf8');
  for (const variable of ['OPENAEC_BEHEERD', 'OPENAEC_MAP', 'OPENAEC_MCP_POORT', 'OPENAEC_MCP_GEHEIM', 'WEBKIT_DISABLE_DMABUF_RENDERER']) {
    assert.ok(docs.includes(variable), `docs/openaec-linux.md documents ${variable}`);
  }
});
