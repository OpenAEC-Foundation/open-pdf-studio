const sharp = require('sharp');
const fs = require('fs');

async function createIcon() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngFiles = [];

  console.log('Converting SVG to PNG at multiple sizes...');

  // Convert SVG to PNG at different sizes
  for (const size of sizes) {
    const filename = `icon-${size}.png`;
    await sharp('icon.svg')
      .resize(size, size)
      .png()
      .toFile(filename);
    pngFiles.push(filename);
    console.log(`  Created ${filename}`);
  }

  // Also save the 256x256 PNG for electron-builder
  await sharp('icon.svg')
    .resize(256, 256)
    .png()
    .toFile('icon.png');
  console.log('Saved icon.png (256x256)');

  // Convert to ICO using png-to-ico
  console.log('Converting to ICO...');
  const pngToIco = require('png-to-ico').default;
  const icoBuffer = await pngToIco(pngFiles);
  fs.writeFileSync('icon.ico', icoBuffer);
  console.log('Saved icon.ico');

  // Cleanup temporary PNG files
  for (const file of pngFiles) {
    if (file !== 'icon.png') {
      fs.unlinkSync(file);
    }
  }
  // Keep icon-256.png as icon.png already exists

  console.log('\nIcon created successfully!');
}

createIcon().catch(err => {
  console.error('Error creating icon:', err);
  process.exit(1);
});
