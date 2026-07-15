/**
 * Version Bump Script
 * Updates version in all required files at once.
 *
 * Usage: node scripts/bump-version.js <version>
 * Example: node scripts/bump-version.js 1.9.0
 */

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/bump-version.js <version>');
  console.error('Example: node scripts/bump-version.js 1.9.0');
  process.exit(1);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version format: "${version}". Expected: X.Y.Z (e.g., 1.9.0)`);
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

const files = [
  {
    path: path.join(root, 'package.json'),
    update: (content) => {
      return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
    }
  },
  {
    path: path.join(root, 'package-lock.json'),
    update: (content) => {
      const lock = JSON.parse(content);
      lock.version = version;
      if (lock.packages && lock.packages['']) lock.packages[''].version = version;
      return `${JSON.stringify(lock, null, 2)}\n`;
    }
  },
  {
    path: path.join(root, 'src-tauri', 'tauri.conf.json'),
    update: (content) => {
      return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
    }
  },
  {
    path: path.join(root, 'src-tauri', 'Cargo.toml'),
    update: (content) => {
      return content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
    }
  },
  {
    path: path.join(repoRoot, 'Cargo.lock'),
    update: (content) => {
      return content.replace(
        /(name = "open-pdf-studio"\r?\nversion = ")[^"]+("\r?\n)/,
        `$1${version}$2`
      );
    }
  },
  {
    path: path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    update: (content) => {
      return content.replace(/default:\s*'v[^']*'/, `default: 'v${version}'`);
    }
  }
];

let updated = 0;
for (const file of files) {
  try {
    const content = fs.readFileSync(file.path, 'utf-8');
    const newContent = file.update(content);
    if (content !== newContent) {
      fs.writeFileSync(file.path, newContent, 'utf-8');
      console.log(`  Updated: ${path.relative(repoRoot, file.path)}`);
      updated++;
    } else {
      console.log(`  Already ${version}: ${path.relative(repoRoot, file.path)}`);
    }
  } catch (e) {
    console.error(`  FAILED: ${path.relative(repoRoot, file.path)} - ${e.message}`);
  }
}

console.log(`\nVersion bumped to ${version} (${updated} files updated)`);
