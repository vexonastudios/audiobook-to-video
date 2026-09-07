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

  // Transparent PNGs already contain a clean coverage mask. For logos on an
  // opaque white background, infer coverage from luminance and normalize it to
  // the darkest commonly occurring ink value. This preserves the faint edge
  // pixels that make curves and fine type look antialiased after downscaling.
  let transparentPixelCount = 0;
  const brightnessHistogram = new Uint32Array(256);
  let visiblePixelCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 250) transparentPixelCount++;
    if (a > 0) {
      const brightness = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      brightnessHistogram[brightness]++;
      visiblePixelCount++;
    }
  }

  // Ignore isolated partially transparent pixels in otherwise opaque images;
  // they are not evidence of an intentionally transparent logo background.
  const hasTransparency = transparentPixelCount > width * height * 0.005;

  const darkPixelTarget = Math.max(1, Math.round(visiblePixelCount * 0.005));
  let darkPixelCount = 0;
  let inkBrightness = 0;
  for (; inkBrightness < 255; inkBrightness++) {
    darkPixelCount += brightnessHistogram[inkBrightness];
    if (darkPixelCount >= darkPixelTarget) break;
  }
  const luminanceRange = Math.max(32, 255 - inkBrightness);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    const coverage = hasTransparency
      ? 1
      : Math.max(0, Math.min(1, (255 - brightness) / luminanceRange));

    // Keep every antialiased edge pixel the same tint. Blending edge RGB toward
    // white creates pale halos and makes detailed logos look noisy/pixelated.
    out[i] = tr;
    out[i + 1] = tg;
    out[i + 2] = tb;
    out[i + 3] = Math.round(a * coverage);
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

/**
 * Removes transparent outer padding from a cover image once at import time.
 * Opaque JPEGs and rectangular PNG covers are returned byte-for-byte so this
 * cannot accidentally crop a cover whose artwork intentionally reaches its
 * canvas edges.
 */
async function prepareCoverImage(filePath) {
  const metadata = await sharp(filePath).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;
  const unchanged = async () => ({
    dataURL: await imageToDataURL(filePath),
    wasTrimmed: false,
    originalWidth,
    originalHeight,
    width: originalWidth,
    height: originalHeight
  });

  if (!metadata.hasAlpha || !originalWidth || !originalHeight) return unchanged();

  try {
    const { data, info } = await sharp(filePath)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
      .png()
      .toBuffer({ resolveWithObject: true });
    const wasTrimmed = info.width < originalWidth || info.height < originalHeight;
    if (!wasTrimmed) return unchanged();

    return {
      dataURL: `data:image/png;base64,${data.toString('base64')}`,
      wasTrimmed: true,
      originalWidth,
      originalHeight,
      width: info.width,
      height: info.height
    };
  } catch (_) {
    // A fully transparent or unusual image should still load normally and let
    // the existing renderer provide its standard preview/error behavior.
    return unchanged();
  }
}

module.exports = { processLogo, imageToDataURL, prepareCoverImage };
