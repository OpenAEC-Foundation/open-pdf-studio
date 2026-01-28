/**
 * Build script - copies web assets to dist folder for Tauri bundling
 */

const fs = require('fs');
const path = require('path');

const SOURCE = __dirname;
const DIST = path.join(__dirname, 'dist');

// Files and folders to copy
const ASSETS = [
  'index.html',
  'styles.css',
  'js',
  'pdfjs',
  'icons'
];

// Node modules to include (for ES module imports)
const NODE_MODULES_TO_COPY = [
  'pdf-lib'
];

// Clean and create dist folder
function cleanDist() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
}

// Track renamed files to avoid overwriting ESM versions with UMD versions
const renamedFiles = new Set();

// Copy file or directory recursively
// Renames .mjs and .esm.js to .js for Tauri compatibility
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src);
    // Sort to process .esm.js files AFTER their .js counterparts
    // This way ESM version will overwrite UMD version
    entries.sort((a, b) => {
      const aIsEsm = a.includes('.esm.');
      const bIsEsm = b.includes('.esm.');
      if (aIsEsm && !bIsEsm) return 1;  // ESM files last
      if (!aIsEsm && bIsEsm) return -1;
      return a.localeCompare(b);
    });
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    // Rename .esm.js to .js for Tauri MIME type compatibility
    if (dest.endsWith('.esm.js')) {
      dest = dest.replace(/\.esm\.js$/, '.js');
      renamedFiles.add(dest);
    }
    // Rename .mjs to .js for Tauri MIME type compatibility
    else if (dest.endsWith('.mjs')) {
      dest = dest.replace(/\.mjs$/, '.js');
      renamedFiles.add(dest);
    }
    // Skip if this file would overwrite an ESM version we already renamed
    else if (renamedFiles.has(dest)) {
      console.log(`    Skipping ${path.basename(src)} (ESM version preferred)`);
      return;
    }
    // Also rename .mjs.map to .js.map
    if (dest.endsWith('.mjs.map')) {
      dest = dest.replace(/\.mjs\.map$/, '.js.map');
    }
    fs.copyFileSync(src, dest);
  }
}

// Update imports in JS files to use .js instead of .mjs/.esm.js
function fixImports(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      fixImports(fullPath);
    } else if (entry.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let updated = content;
      // Replace .esm.js imports with .js
      updated = updated.replace(/\.esm\.js(['"])/g, '.js$1');
      // Replace .mjs imports with .js
      updated = updated.replace(/\.mjs(['"])/g, '.js$1');
      if (content !== updated) {
        fs.writeFileSync(fullPath, updated);
        console.log(`    Fixed imports in ${path.relative(DIST, fullPath)}`);
      }
    }
  }
}

// Update import paths from node_modules to libs
function fixNodeModulesPaths(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      fixNodeModulesPaths(fullPath);
    } else if (entry.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      // Replace node_modules paths with libs paths (preserve quote style)
      let updated = content.replace(/'\.\.\/\.\.\/node_modules\//g, "'../../libs/");
      updated = updated.replace(/"\.\.\/\.\.\/node_modules\//g, '"../../libs/');
      if (content !== updated) {
        fs.writeFileSync(fullPath, updated);
        console.log(`    Fixed node_modules path in ${path.relative(DIST, fullPath)}`);
      }
    }
  }
}

// Update index.html to use .js instead of .mjs
function fixIndexHtml() {
  const indexPath = path.join(DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    let content = fs.readFileSync(indexPath, 'utf8');
    const updated = content.replace(/\.mjs(['"])/g, '.js$1');
    if (content !== updated) {
      fs.writeFileSync(indexPath, updated);
      console.log('  Fixed .mjs references in index.html');
    }
  }
}

// Main build
console.log('Building web assets to dist/...');
cleanDist();

for (const asset of ASSETS) {
  const src = path.join(SOURCE, asset);
  const dest = path.join(DIST, asset);

  if (fs.existsSync(src)) {
    console.log(`  Copying ${asset}...`);
    copyRecursive(src, dest);
  } else {
    console.warn(`  Warning: ${asset} not found, skipping`);
  }
}

// Copy required node_modules to libs folder (Tauri doesn't allow node_modules in dist)
console.log('  Copying node_modules dependencies to libs...');
const libsDest = path.join(DIST, 'libs');
fs.mkdirSync(libsDest, { recursive: true });

for (const mod of NODE_MODULES_TO_COPY) {
  const src = path.join(SOURCE, 'node_modules', mod);
  const dest = path.join(libsDest, mod);

  if (fs.existsSync(src)) {
    console.log(`    Copying ${mod}...`);
    copyRecursive(src, dest);
  } else {
    console.warn(`    Warning: node_modules/${mod} not found, skipping`);
  }
}

// Fix .mjs imports in copied files
console.log('  Fixing .mjs imports...');
fixImports(path.join(DIST, 'js'));
fixImports(path.join(DIST, 'pdfjs'));
fixImports(libsDest);

// Fix node_modules paths to libs paths
console.log('  Fixing node_modules paths to libs...');
fixNodeModulesPaths(path.join(DIST, 'js'));

fixIndexHtml();

console.log('Build complete!');
