const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.resolve(__dirname, '../scripts/generate-approved-icons.py')], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
