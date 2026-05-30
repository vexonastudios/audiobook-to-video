const sharp = require('sharp');
const fs = require('fs');

/**
 * Processes the Vexona Studios logo PNG:
 * 1. Removes white background (makes white → transparent)
 * 2. Tints all remaining pixels to the accent color
 * Returns a base64 data URL of the processed PNG.
 */
async function processLogo(logoPath, accentColor) {
  const [tr, tg, tb] = accentColor;

  // Load logo raw RGBA data
  const { data, info } = await sharp(logoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

    if (a === 0) {
      // Keep fully transparent pixels transparent
      out[i] = tr;
      out[i + 1] = tg;
      out[i + 2] = tb;
      out[i + 3] = 0;
      continue;
    }

    // Perceived brightness (ignore alpha)
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

    // Threshold: pixels brighter than 230 are considered "white background"
    if (brightness > 230 && a > 200) {
      // White → fully transparent
      out[i] = tr;
      out[i + 1] = tg;
      out[i + 2] = tb;
      out[i + 3] = 0;
    } else {
      // Logo pixel: map darkness to alpha, tint with accent color
      // darkness ranges 0 (white) to 1 (black)
      const darkness = Math.max(0, (230 - brightness) / 230);
      let newAlpha = Math.min(255, Math.round(darkness * 255 * 1.4)); // slight boost

      // Scale the new alpha by the original alpha to preserve existing transparency
      newAlpha = Math.round(newAlpha * (a / 255));

      // Tint: blend accent color with white based on darkness
      const blend = darkness;
      out[i] = Math.round(tr * blend + 255 * (1 - blend));
      out[i + 1] = Math.round(tg * blend + 255 * (1 - blend));
      out[i + 2] = Math.round(tb * blend + 255 * (1 - blend));
      out[i + 3] = newAlpha;
    }
  }

  // Convert back to PNG
  const resultBuffer = await sharp(out, {
    raw: { width, height, channels: 4 }
  })
    .png()
    .toBuffer();

  return `data:image/png;base64,${resultBuffer.toString('base64')}`;
}

/**
 * Reads any image file and returns it as a data URL.
 */
async function imageToDataURL(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = filePath.split('.').pop().toLowerCase();
  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif'
  };
  const mime = mimeMap[ext] || 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

module.exports = { processLogo, imageToDataURL };
