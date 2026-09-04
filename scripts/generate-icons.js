const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'assets', 'icon-source.png');
const pngPath = path.join(projectRoot, 'assets', 'icon.png');
const icoPath = path.join(projectRoot, 'assets', 'icon.ico');

// Include native frames for common Windows taskbar sizes at 100-300% scaling.
const windowsSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function createIco(pngFrames, sizes) {
  const directorySize = 6 + (16 * pngFrames.length);
  const header = Buffer.alloc(directorySize);

  header.writeUInt16LE(0, 0); // Reserved.
  header.writeUInt16LE(1, 2); // ICO image type.
  header.writeUInt16LE(pngFrames.length, 4);

  let imageOffset = directorySize;
  pngFrames.forEach((frame, index) => {
    const size = sizes[index];
    const entryOffset = 6 + (index * 16);

    header.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2); // No palette.
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(frame.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);

    imageOffset += frame.length;
  });

  return Buffer.concat([header, ...pngFrames]);
}

async function generateIcons() {
  const source = fs.readFileSync(sourcePath);

  await sharp(source)
    .resize(1024, 1024)
    .png({ compressionLevel: 9 })
    .toFile(pngPath);

  const pngFrames = await Promise.all(windowsSizes.map((size) => (
    sharp(source)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer()
  )));

  fs.writeFileSync(icoPath, createIco(pngFrames, windowsSizes));
  console.log(`Generated icon.png (1024px) and icon.ico (${windowsSizes.join(', ')}px)`);
}

generateIcons().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
