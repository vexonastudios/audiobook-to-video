const sharp = require('sharp');

/**
 * Extracts the most vibrant/saturated dominant color from an image.
 * Returns [r, g, b] as an array.
 */
async function extractDominantColor(imagePath) {
  try {
    // Downsample for speed
    const { data } = await sharp(imagePath)
      .resize(80, 80, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bestColor = null;
    let maxScore = -1;

    // Build a frequency map of colors (bucketed)
    const buckets = {};
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // Convert to HSL
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      const l = (max + min) / 2;
      const d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

      // Score: favor high saturation, moderate lightness (not too dark or too light)
      // Avoid very dark (<0.15) or very washed-out (<0.2 saturation)
      if (l < 0.12 || l > 0.88) continue;    // Skip very dark/very light
      if (s < 0.20) continue;                 // Skip near-grays

      // Score peaks at s=0.7, l=0.45
      const score = s * (1 - Math.abs(l - 0.45) * 1.5);

      if (score > maxScore) {
        maxScore = score;
        bestColor = { r, g, b };
      }
    }

    if (!bestColor) {
      // Fallback: just use average of brightest pixels
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let i = 0; i < data.length; i += 3) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness > 100) {
          sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
          count++;
        }
      }
      if (count > 0) {
        bestColor = { r: Math.round(sumR / count), g: Math.round(sumG / count), b: Math.round(sumB / count) };
      } else {
        bestColor = { r: 201, g: 169, b: 110 }; // warm gold fallback
      }
    }

    // Boost saturation of best color for the accent
    const boosted = boostSaturation(bestColor.r, bestColor.g, bestColor.b, 0.3);
    return [boosted.r, boosted.g, boosted.b];
  } catch (err) {
    console.error('Color extraction error:', err);
    return [201, 169, 110]; // warm gold fallback
  }
}

/**
 * Boosts saturation of an RGB color by `amount` (0–1).
 */
function boostSaturation(r, g, b, amount = 0.2) {
  // To HSL
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h, s, l = (max + min) / 2;
  const d = max - min;

  if (d === 0) {
    h = 0; s = 0;
  } else {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      default: h = ((rn - gn) / d + 4) / 6;
    }
  }

  // Boost
  s = Math.min(1, s + amount);

  // Back to RGB
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  };
}

module.exports = { extractDominantColor };
