// Execute the release workflow's actual signing shell with disposable tool doubles.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const signingTest = process.platform === 'win32' ? test.skip : test;

const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
const step = workflow.split('      - name: Sign APK\n')[1]?.split('\n      - name:')[0];
assert.ok(step, 'Sign APK step exists');
const shell = step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');

function runSigning(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'opds-signing-'));
  try {
    const apkDir = join(root, 'src-tauri/gen/android');
    const bin = join(root, 'bin');
    const sdk = join(root, 'sdk');
    const tools = join(sdk, 'build-tools/35.0.0');
    for (const dir of [apkDir, bin, tools]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(apkDir, 'app-unsigned.apk'), 'fixture');
    const executable = (path, body) => writeFileSync(path, '#!/bin/bash\nset -eu\n' + body, { mode: 0o700 });
    executable(join(bin, 'keytool'), 'echo keytool >> "$TRACE"\ntouch "$RUNNER_TEMP/open-pdf-studio-release.keystore"\n');
    executable(join(tools, 'zipalign'), 'echo zipalign >> "$TRACE"\ncp "${@: -2:1}" "${@: -1}"\n');
    executable(join(tools, 'apksigner'), `echo "$1" >> "$TRACE"
if [ "$1" = sign ]; then
  [ "$(cat "$RUNNER_TEMP/open-pdf-studio-release.keystore")" = fixture-keystore ]
  [ "$KS_PASS" = fixture-store-password ]
  [ "$KEY_PASS" = "$EXPECTED_KEY_PASSWORD" ]
  [[ " $* " == *" --ks-key-alias $EXPECTED_ALIAS "* ]]
  [[ " $* " == *" --ks-pass env:KS_PASS "* ]]
  [[ " $* " == *" --key-pass env:KEY_PASS "* ]]
  [[ "$*" != *fixture-store-password* ]]
  [ "\${FAIL_SIGN:-0}" != 1 ]
  while [ "$1" != --out ]; do shift; done
  cp "$3" "$2"
else
  [ "\${FAIL_VERIFY:-0}" != 1 ]
fi
`);
    const output = join(root, 'output');
    const trace = join(root, 'trace');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', shell], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { PATH: bin + ':/usr/bin:/bin', RUNNER_TEMP: root, ANDROID_HOME: sdk, GITHUB_OUTPUT: output,
        TRACE: trace, ANDROID_KEYSTORE_BASE64: Buffer.from('fixture-keystore').toString('base64'),
        ANDROID_KEYSTORE_PASSWORD: 'fixture-store-password', ANDROID_KEY_ALIAS: '', ANDROID_KEY_PASSWORD: '',
        EXPECTED_ALIAS: 'open-pdf-studio', EXPECTED_KEY_PASSWORD: 'fixture-store-password', ...overrides },
    });
    assert.ifError(result.error);
    return { ...result, trace: existsSync(trace) ? readFileSync(trace, 'utf8') : '',
      output: existsSync(output) ? readFileSync(output, 'utf8') : '',
      keyLeft: existsSync(join(root, 'open-pdf-studio-release.keystore')) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const [name, env] of Object.entries({
  'missing key': { ANDROID_KEYSTORE_BASE64: '' },
  'missing password': { ANDROID_KEYSTORE_PASSWORD: '' },
  'invalid base64': { ANDROID_KEYSTORE_BASE64: '!invalid!' },
})) {
  signingTest(`release signing rejects ${name} before signing or publishing an APK`, () => {
    const r = runSigning(env);
    assert.notEqual(r.status, 0);
    assert.equal(r.trace, '', r.stdout + r.stderr);
    assert.equal(r.output, '');
    assert.equal(r.keyLeft, false);
  });
}

signingTest('fixed key keeps default alias/password and reports only a verified APK', () => {
  const r = runSigning();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.trace, 'zipalign\nsign\nverify\n');
  assert.match(r.output, /^signed_apk=.*open-pdf-studio-release.apk\n$/);
  assert.equal(r.keyLeft, false);
});

signingTest('explicit key alias/password and wrapped base64 remain supported', () => {
  const r = runSigning({ ANDROID_KEY_ALIAS: 'openaec', EXPECTED_ALIAS: 'openaec',
    ANDROID_KEY_PASSWORD: 'fixture-key-password', EXPECTED_KEY_PASSWORD: 'fixture-key-password',
    ANDROID_KEYSTORE_BASE64: '\r\n ' + Buffer.from('fixture-keystore').toString('base64') + '\n' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.keyLeft, false);
});

for (const flag of ['FAIL_SIGN', 'FAIL_VERIFY']) {
  signingTest(`${flag} prevents a successful output and cleans the temporary key`, () => {
    const r = runSigning({ [flag]: '1' });
    assert.notEqual(r.status, 0);
    assert.equal(r.output, '');
    assert.equal(r.keyLeft, false);
  });
}
