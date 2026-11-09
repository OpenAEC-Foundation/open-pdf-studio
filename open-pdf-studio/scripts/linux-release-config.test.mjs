import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('Linux keeps WebKit threads off realtime scheduling before GTK starts (#924)', async () => {
  const main = await readFile(new URL('src-tauri/src/main.rs', appRoot), 'utf8');
  const rtprio = main.indexOf('linux_runtime::disable_realtime_threads();');
  const gtk = main.indexOf('app_lib::run(');
  assert.notEqual(rtprio, -1);
  assert.ok(rtprio < gtk);
  assert.ok(rtprio < main.indexOf('openaec_omgeving::bereid_proces_voor();'));

  const runtime = await readFile(new URL('src-tauri/src/linux_runtime.rs', appRoot), 'utf8');
  assert.match(runtime, /libc::setrlimit\(libc::RLIMIT_RTPRIO, &limiet\)/);
  assert.match(runtime, /rlim_cur: 0, rlim_max: 0/);
  assert.match(runtime, /OPDS_ALLOW_REALTIME/);

  const installatie = await readFile(new URL('docs/install-linux.md', repoRoot), 'utf8');
  assert.ok(installatie.includes('OPDS_ALLOW_REALTIME=1'), 'docs/install-linux.md documents the opt-out');
  assert.ok(installatie.includes('prlimit --rtprio=0'), 'docs/install-linux.md names the equivalent launcher setting');
  const readme = await readFile(new URL('README.md', repoRoot), 'utf8');
  assert.ok(readme.includes('docs/install-linux.md'), 'README links the Linux install page');
});

test('Linux turns off 2D canvas acceleration in every WebView, with an opt-out (#924)', async () => {
  const runtime = await readFile(new URL('src-tauri/src/linux_runtime.rs', appRoot), 'utf8');
  // De WebKitGTK-eigenschap (2.46+) op naam, met de bestaanscontrole ervoor:
  // set_property op een onbekende eigenschap breekt het proces af.
  assert.match(runtime, /const CANVAS_VERSNELLING: &str = "enable-2d-canvas-acceleration";/);
  const zoek = runtime.indexOf('find_property(CANVAS_VERSNELLING)');
  const zet = runtime.indexOf('set_property(CANVAS_VERSNELLING, false)');
  assert.notEqual(zoek, -1, 'the property is looked up first');
  assert.notEqual(zet, -1, 'the property is set to false');
  assert.ok(zoek < zet, 'look up before set');
  assert.match(runtime, /spec\.value_type\(\) != bool::static_type\(\)/);
  assert.match(runtime, /ParamFlags::WRITABLE/);
  assert.match(runtime, /env::var_os\("OPDS_CANVAS_GPU"\)/);
  assert.match(runtime, /\.on_webview_ready\(\|webview\| zet_canvas_versnelling_uit\(&webview\)\)/);
  assert.match(runtime, /#\[cfg\(target_os = "linux"\)\]\r?\npub fn zet_canvas_versnelling_uit</);
  assert.match(runtime, /#\[cfg\(target_os = "linux"\)\]\r?\npub fn webview_plugin</);

  const lib = await readFile(new URL('src-tauri/src/lib.rs', appRoot), 'utf8');
  assert.match(
    lib,
    /#\[cfg\(target_os = "linux"\)\]\s*\{\s*builder = builder\.plugin\(linux_runtime::webview_plugin\(\)\);/,
    'the plugin is registered for every window on Linux',
  );
  const cargo = await readFile(new URL('src-tauri/Cargo.toml', appRoot), 'utf8');
  const linuxDeps = cargo.slice(cargo.indexOf(`[target.'cfg(target_os = "linux")'.dependencies]`));
  assert.match(linuxDeps.slice(0, linuxDeps.indexOf('\n[', 1)), /^webkit2gtk = "2"\r?$/m);

  const installatie = await readFile(new URL('docs/install-linux.md', repoRoot), 'utf8');
  assert.ok(installatie.includes('OPDS_CANVAS_GPU=1'), 'docs/install-linux.md documents the opt-out');
  assert.ok(installatie.includes('enable-2d-canvas-acceleration'), 'docs/install-linux.md names the setting');
  assert.ok(installatie.includes('WEBKIT_DISABLE_DMABUF_RENDERER=1'), 'the stronger fallback stays documented');
});

// Losse OpenPGP-handtekeningen voor de Linux-pakketten (#842).
const OPENAEC_FINGERPRINT = '13F6D414ADEE4ED4CD09AC60601D86C93C504D29';

function jobBlock(workflow, name) {
  const begin = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(begin, -1, `job ${name} exists`);
  const rest = workflow.slice(begin + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function stepBlock(job, name) {
  const begin = job.indexOf(`- name: ${name}`);
  assert.notEqual(begin, -1, `step "${name}" exists`);
  const rest = job.slice(begin);
  const next = rest.slice(1).search(/\n      - (name|uses):/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

// Op een Windows-CI-runner kan "bash" een andere shell zijn dan Git Bash; de
// gpg-tests draaien daar niet (lokaal onder Git Bash wel).
function hasCommand(command) {
  if (process.platform === 'win32' && process.env.CI) return false;
  return spawnSync('bash', ['-c', `command -v ${command}`], { encoding: 'utf8' }).status === 0;
}

async function readWorkflow(name) {
  return (await readFile(new URL(`.github/workflows/${name}`, repoRoot), 'utf8')).replaceAll('\r\n', '\n');
}

test('the release signs the Linux packages with the OpenAEC OpenPGP key after they are uploaded (#842)', async () => {
  const workflow = await readWorkflow('release.yml');
  const job = jobBlock(workflow, 'sign-linux');

  // Na de build-job (de .deb en de AppImage staan dan op het concept), vóór publish-release.
  assert.match(job, /\n    needs: \[create-release, build\]\n/);
  assert.match(jobBlock(workflow, 'publish-release'), /needs: \[create-release, build, sign-linux\]/);
  assert.match(job, /permissions:\n      contents: write/);

  // Bestaande organisatiegeheimen en -variabele; de verwachte vingerafdruk staat vast in de workflow.
  assert.match(job, /OPENAEC_GPG_PRIVATE_KEY: \$\{\{ secrets\.OPENAEC_GPG_PRIVATE_KEY \}\}/);
  assert.match(job, /OPENAEC_GPG_PASSPHRASE: \$\{\{ secrets\.OPENAEC_GPG_PASSPHRASE \}\}/);
  assert.match(job, /OPENAEC_GPG_FINGERPRINT: \$\{\{ vars\.OPENAEC_GPG_FINGERPRINT \}\}/);
  assert.ok(job.includes(`OPENAEC_GPG_EXPECTED_FINGERPRINT: ${OPENAEC_FINGERPRINT}`));

  // Eerst wachten op de geüploade snap van snap.yml, dan tekenen, uploaden en verifiëren.
  const wait = stepBlock(job, 'Wait for the snap on the draft release');
  assert.match(wait, /select\(\.state == "uploaded"\)/);
  assert.match(wait, /grep -q '\\\.snap\$'/);
  assert.match(wait, /if: env\.HAS_OPENPGP_KEY == 'true'/);
  const sign = stepBlock(job, 'Sign, upload and verify the Linux assets (OpenPGP)');
  assert.match(sign, /bash scripts\/sign-linux-release\.sh release "\$VERSION" \.\.\/docs\/keys\/openaec-signing-public-key\.asc/);
  assert.ok(job.indexOf('Wait for the snap') < job.indexOf('Sign, upload and verify'));

  // Deze job raakt latest.json en de updater-.sig-bestanden niet aan.
  assert.doesNotMatch(job.replace(/^\s*#.*$/gm, ''), /latest\.json|\.sig\b|tauri-action/);

  // De eindcontrole meldt een overgeslagen of onvolledige ondertekening.
  const report = stepBlock(jobBlock(workflow, 'publish-release'), 'Report the Linux OpenPGP signatures');
  assert.match(report, /needs\.sign-linux\.outputs\.status/);
  assert.match(report, /needs\.sign-linux\.outputs\.missing/);
  assert.match(report, /NOT signed/);
  assert.match(report, /GITHUB_STEP_SUMMARY/);

  const script = await readFile(new URL('scripts/sign-linux-release.sh', appRoot), 'utf8');
  assert.ok(script.includes(`OPENAEC_RELEASE_KEY_FINGERPRINT=${OPENAEC_FINGERPRINT}`));
  for (const pattern of ["'*.deb'", "'*.AppImage'", "'*.AppImage.tar.gz'", "'*.snap'"]) {
    assert.ok(script.includes(`--pattern ${pattern}`), `downloads ${pattern}`);
  }
  assert.match(script, /--armor --detach-sign --output "\$1\.asc" "\$1"/);
  assert.match(script, /gh release upload "\$target" "\$assets"\/\*\.asc "\$assets\/SHA256SUMS"[\s\S]*?--clobber/);
  assert.match(script, /gpgv --keyring/);
});

test('snap.yml signs the Linux assets again when its snap arrives after the signing job (#842)', async () => {
  const workflow = await readWorkflow('snap.yml');
  const upload = workflow.indexOf('- name: Upload snap to GitHub release');
  const resign = workflow.indexOf('- name: Sign the Linux assets again (OpenPGP)');
  assert.notEqual(upload, -1);
  assert.ok(resign > upload, 'signing comes after the snap upload');
  const step = workflow.slice(resign, workflow.indexOf('- name: Publish to Snap Store'));
  assert.match(step, /grep -qx 'SHA256SUMS'/);
  assert.match(step, /workflow_dispatch/);
  assert.match(step, /sign-linux-release\.sh release "\$VERSION"/);
  assert.match(step, /secrets\.OPENAEC_GPG_PRIVATE_KEY/);
  assert.ok(step.includes(`OPENAEC_GPG_EXPECTED_FINGERPRINT: ${OPENAEC_FINGERPRINT}`));
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
});

test('the repository ships the public OpenAEC release key and documents the check (#842)', async () => {
  const key = await readFile(new URL('docs/keys/openaec-signing-public-key.asc', repoRoot), 'utf8');
  assert.match(key, /^-----BEGIN PGP PUBLIC KEY BLOCK-----/);
  assert.doesNotMatch(key, /PRIVATE KEY/);
  for (const doc of ['docs/install-linux.md', 'README.md', 'README.nl.md']) {
    const text = await readFile(new URL(doc, repoRoot), 'utf8');
    assert.ok(text.includes(OPENAEC_FINGERPRINT), `${doc} names the fingerprint`);
    assert.ok(text.includes('gpg --verify'), `${doc} shows gpg --verify`);
  }
});

test('the committed public key has the OpenAEC release fingerprint (#842)', { skip: !hasCommand('gpg') }, () => {
  const key = fileURLToPath(new URL('docs/keys/openaec-signing-public-key.asc', repoRoot));
  const result = spawnSync('bash', [
    '-c',
    'h=$(mktemp -d) && GNUPGHOME="$h" gpg --batch --with-colons --show-keys "$1"; s=$?; rm -rf "$h"; exit $s',
    '_',
    key,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const primary = result.stdout.split('\n').find((line) => line.startsWith('fpr:'));
  assert.equal(primary.split(':')[9], OPENAEC_FINGERPRINT);
  assert.doesNotMatch(result.stdout, /^sec:/m);
});

// Wegwerpsleutel en testbestanden in een korte mktemp-map (gpg-agent-sockets
// breken op lange paden), alles in één bash-proces.
const SIGN_FIXTURE = String.raw`
set -euo pipefail
script=$1
root=$(mktemp -d)
trap 'GNUPGHOME="$root/key" gpgconf --kill gpg-agent >/dev/null 2>&1 || true; rm -rf "$root"' EXIT
mkdir "$root/key" "$root/assets"
chmod 700 "$root/key" 2>/dev/null || true
export GNUPGHOME="$root/key"
gpg --batch --pinentry-mode loopback --passphrase fixture-only --quick-gen-key 'Fixture <fixture@example.invalid>' ed25519 cert never 2>/dev/null
fpr=$(gpg --batch --with-colons --list-keys | awk -F: '$1 == "fpr" { print $10; exit }')
gpg --batch --pinentry-mode loopback --passphrase fixture-only --quick-add-key "$fpr" ed25519 sign never 2>/dev/null
gpg --batch --armor --export "$fpr" > "$root/pub.asc"
gpg --batch --pinentry-mode loopback --passphrase fixture-only --armor --export-secret-subkeys "$fpr" > "$root/sec.asc"
gpgconf --kill gpg-agent >/dev/null 2>&1 || true
unset GNUPGHOME
a="$root/assets"
printf deb > "$a/Open.PDF.Studio_1.0.0_amd64.deb"
printf appimage > "$a/Open.PDF.Studio_1.0.0_amd64.AppImage"
printf updater > "$a/Open.PDF.Studio_1.0.0_amd64.AppImage.tar.gz"
printf minisign > "$a/Open.PDF.Studio_1.0.0_amd64.AppImage.sig"
printf snap > "$a/open-pdf-studio_1.0.0_amd64.snap"
secret=$(cat "$root/sec.asc")

echo "== skip"
env -u OPENAEC_GPG_PRIVATE_KEY bash "$script" sign "$a" "$root/pub.asc"
test ! -e "$a/SHA256SUMS"

echo "== wrong key"
if OPENAEC_GPG_PRIVATE_KEY=$secret OPENAEC_GPG_PASSPHRASE=fixture-only bash "$script" sign "$a" "$root/pub.asc"; then exit 10; fi
test ! -e "$a/SHA256SUMS"

echo "== organisation variable mismatch"
if OPENAEC_GPG_PRIVATE_KEY=$secret OPENAEC_GPG_PASSPHRASE=fixture-only OPENAEC_GPG_EXPECTED_FINGERPRINT=$fpr OPENAEC_GPG_FINGERPRINT=0000 bash "$script" sign "$a" "$root/pub.asc"; then exit 11; fi

echo "== sign"
export OPENAEC_GPG_EXPECTED_FINGERPRINT=$fpr
OPENAEC_GPG_PRIVATE_KEY=$secret OPENAEC_GPG_PASSPHRASE=fixture-only OPENAEC_GPG_FINGERPRINT=$fpr bash "$script" sign "$a" "$root/pub.asc"
for f in Open.PDF.Studio_1.0.0_amd64.deb Open.PDF.Studio_1.0.0_amd64.AppImage open-pdf-studio_1.0.0_amd64.snap SHA256SUMS; do
  head -1 "$a/$f.asc" | grep -qx -- '-----BEGIN PGP SIGNATURE-----'
done
test ! -e "$a/Open.PDF.Studio_1.0.0_amd64.AppImage.tar.gz.asc"
test "$(cat "$a/Open.PDF.Studio_1.0.0_amd64.AppImage.sig")" = minisign
echo "== sums"
cat "$a/SHA256SUMS"
echo "== tampered"
printf x >> "$a/open-pdf-studio_1.0.0_amd64.snap"
if bash "$script" verify "$a" "$root/pub.asc"; then exit 12; fi
echo "== done"
`;

test('sign-linux-release.sh signs, verifies, refuses a wrong key and skips without the secret (#842)', {
  // Het script draait in de workflows op Ubuntu (GNU sha256sum); macOS mist die.
  skip: process.platform === 'darwin' || !hasCommand('gpg') || !hasCommand('gpgv') || !hasCommand('sha256sum'),
}, () => {
  const script = fileURLToPath(new URL('scripts/sign-linux-release.sh', appRoot));
  const result = spawnSync('bash', ['-c', SIGN_FIXTURE, '_', script], { encoding: 'utf8' });
  const log = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, log);
  assert.match(result.stdout, /::notice::OPENAEC_GPG_PRIVATE_KEY is not available/);
  assert.match(result.stdout, /status=skipped/);
  assert.match(log, /imported secret key has primary fingerprint '[0-9A-F]{40}', expected 13F6D414ADEE4ED4CD09AC60601D86C93C504D29/);
  assert.match(log, /OPENAEC_GPG_FINGERPRINT \(0000\) differs/);
  assert.match(result.stdout, /status=signed/);
  assert.match(result.stdout, /missing=\n/);
  const sums = result.stdout.split('== sums\n')[1].split('== tampered')[0].trim().split('\n')
    .map((line) => line.split('  ')[1]);
  assert.deepEqual(sums, [
    'Open.PDF.Studio_1.0.0_amd64.AppImage',
    'Open.PDF.Studio_1.0.0_amd64.AppImage.tar.gz',
    'Open.PDF.Studio_1.0.0_amd64.deb',
    'open-pdf-studio_1.0.0_amd64.snap',
  ]);
  assert.match(log, /BAD signature/);
  assert.match(result.stdout, /== done/);
});
