const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { imagesToIco } = require('png-to-ico');

const SVG_PATH = path.join(__dirname, 'icon.svg');
const ICONS_DIR = path.join(__dirname, '..', 'open-pdf-studio', 'src-tauri', 'icons');
const PUBLIC_DIR = path.join(__dirname, '..', 'open-pdf-studio', 'public');

async function generateIcons() {
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Generate PNG at various sizes needed by Tauri
  const sizes = [
    { name: '32x32.png', size: 32 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
    { name: 'icon.png', size: 512 },
    // Windows Store icons
    { name: 'StoreLogo.png', size: 50 },
    { name: 'Square30x30Logo.png', size: 30 },
    { name: 'Square44x44Logo.png', size: 44 },
    { name: 'Square71x71Logo.png', size: 71 },
    { name: 'Square89x89Logo.png', size: 89 },
    { name: 'Square107x107Logo.png', size: 107 },
    { name: 'Square142x142Logo.png', size: 142 },
    { name: 'Square150x150Logo.png', size: 150 },
    { name: 'Square284x284Logo.png', size: 284 },
    { name: 'Square310x310Logo.png', size: 310 },
  ];

  console.log('Generating PNG icons...');
  for (const { name, size } of sizes) {
    const outputPath = path.join(ICONS_DIR, name);
    await sharp(svgBuffer, { density: 300 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath);
    console.log(`  Created ${name} (${size}x${size})`);
  }

  // Generate ICO (multi-size: 16, 32, 48, 64, 128, 256)
  console.log('Generating ICO...');
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoPngs = [];
  for (const size of icoSizes) {
    const { data, info } = await sharp(svgBuffer, { density: 300 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Convert RGBA to BGRA (ICO format expects BGRA)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      data[i] = data[i + 2];     // B
      data[i + 2] = r;            // R
    }
    icoPngs.push({ data, width: info.width, height: info.height });
  }

  const icoBuffer = imagesToIco(icoPngs);
  fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoBuffer);
  console.log('  Created icon.ico');

  // Copy to public directory
  console.log('Copying to public directory...');
  const publicIcon = path.join(ICONS_DIR, 'icon.png');
  const publicIco = path.join(ICONS_DIR, 'icon.ico');

  fs.copyFileSync(publicIcon, path.join(PUBLIC_DIR, 'icon.png'));
  fs.copyFileSync(publicIco, path.join(PUBLIC_DIR, 'icon.ico'));
  fs.copyFileSync(publicIco, path.join(PUBLIC_DIR, 'favicon.ico'));
  console.log('  Copied icon.png, icon.ico, favicon.ico to public/');

  // Generate ICNS for macOS (just create a large PNG - Tauri handles ICNS from PNG)
  // For a proper .icns we'd need a macOS tool, but Tauri's build process handles it
  const icnsPlaceholder = await sharp(svgBuffer, { density: 300 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  // Save as icon.icns (it's actually a PNG but Tauri can work with it on build)
  // For proper ICNS, the macOS CI will handle conversion
  fs.writeFileSync(path.join(ICONS_DIR, 'icon.icns'), icnsPlaceholder);
  console.log('  Created icon.icns (PNG format - Tauri build will convert on macOS)');

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
