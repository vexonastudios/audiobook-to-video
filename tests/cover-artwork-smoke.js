const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { prepareCoverImage } = require('../src/logoProcessor');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-artwork-smoke-'));
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080,
    webPreferences: { nodeIntegration: true, contextIsolation: false } });
  const execute = script => window.webContents.executeJavaScript(script);
  try {
    await window.loadFile(path.resolve(__dirname, '../frame-window/index.html'));
    const mockup = await sharp(Buffer.from(`<svg width="400" height="600" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="250" cy="580" rx="130" ry="15" fill="black" opacity="0.15"/>
      <path d="M40 40 L340 10 L340 510 L40 590 Z" fill="#242019"/>
    </svg>`)).png().toBuffer();
    const source = `data:image/png;base64,${mockup.toString('base64')}`;
    const checks = await execute(`(async () => {
      const image = await loadImage(${JSON.stringify(source)});
      const pixel = (art, x, y) => Array.from(art.canvas.getContext('2d').getImageData(
        x + art.padding, y + art.padding, 1, 1).data);
      const plain = createCoverArtwork(image, 400, 600, 0, [255,180,80]);
      const thin = createCoverArtwork(image, 400, 600, 2, [255,180,80]);
      const thick = createCoverArtwork(image, 400, 600, 8, [255,180,80]);
      const repeated = createCoverArtwork(image, 400, 600, 8, [255,180,80]);
      const flat = document.createElement('canvas'); flat.width = 80; flat.height = 100;
      flat.getContext('2d').fillRect(0, 0, 80, 100);
      const flatBorder = createCoverArtwork(flat, 80, 100, 4, [255,180,80]);
      // A rasterized, almost-vertical edge used to produce visible one-pixel
      // jumps in the gold border. Its outer edge should now move continuously.
      const stepped = document.createElement('canvas'); stepped.width = 400; stepped.height = 600;
      const stepCtx = stepped.getContext('2d');
      for (let y = 10; y < 590; y++) stepCtx.fillRect(40, y, 300 - Math.floor(y / 80), 1);
      const smooth = createCoverArtwork(stepped, 400, 600, 3, [255,180,80]);
      const scan = smooth.canvas.getContext('2d').getImageData(0, 0, smooth.canvas.width, smooth.canvas.height);
      const edgePositions = [];
      for (let y = 50; y < 550; y++) {
        for (let x = 360; x > 300; x--) {
          const alpha = scan.data[((y + smooth.padding) * scan.width + x + smooth.padding) * 4 + 3];
          if (alpha) { edgePositions.push(x + alpha / 255); break; }
        }
      }
      const jumps = edgePositions.slice(1).map((value, index) => Math.abs(value - edgePositions[index]));
      const hollow = document.createElement('canvas'); hollow.width = 100; hollow.height = 100;
      const hollowCtx = hollow.getContext('2d'); hollowCtx.fillRect(5, 5, 90, 90);
      hollowCtx.clearRect(35, 35, 30, 30); // Interior hole.
      hollowCtx.clearRect(65, 5, 30, 20); // Concave notch.
      const hollowBorder = createCoverArtwork(hollow, 100, 100, 3, [255,180,80]);
      return {
        straight: pixel(thick, 34, 300), diagonal: pixel(thick, 190, 554),
        thinOutside: pixel(thin, 34, 300), plainOutside: pixel(plain, 39, 300),
        transparentCorner: pixel(thick, 340, 580), shadow: pixel(thick, 250, 580),
        interior: pixel(thick, 100, 300), original: pixel(plain, 100, 300),
        flatBorder: pixel(flatBorder, 40, -3), cached: thick === repeated,
        smoothEdgePositions: new Set(edgePositions).size, largestEdgeJump: Math.max(...jumps),
        largestJumpSample: edgePositions.slice(jumps.indexOf(Math.max(...jumps)), jumps.indexOf(Math.max(...jumps)) + 3),
        hole: pixel(hollowBorder, 50, 50), notch: pixel(hollowBorder, 85, 10),
        holeBorder: pixel(hollowBorder, 36, 50)
      };
    })()`);
    assert.deepEqual(checks.straight, [255,180,80,255]);
    assert.deepEqual(checks.diagonal, [255,180,80,255]);
    assert.equal(checks.thinOutside[3], 0);
    assert.equal(checks.plainOutside[3], 0);
    assert.ok(checks.transparentCorner[3] < 50, 'Border must not follow the transparent bounding rectangle');
    assert.equal(checks.shadow[0], 0, 'Faint baked-in shadows must not turn into a colored border');
    assert.deepEqual(checks.interior, checks.original);
    assert.deepEqual(checks.flatBorder, [255,180,80,255]);
    assert.equal(checks.cached, true);
    assert.ok(checks.smoothEdgePositions > 100, 'Slanted outlines must retain subpixel positions');
    assert.ok(checks.largestEdgeJump < 0.2, 'Slanted outline must not make whole-pixel jumps: ' + JSON.stringify(checks));
    assert.equal(checks.hole[3], 0, 'Contour tracing must preserve transparent holes');
    assert.equal(checks.notch[3], 0, 'Contour tracing must preserve concave edges');
    assert.deepEqual(checks.holeBorder, [255,180,80,255]);

    const params = { coverDataURL: source, bgDataURL: source, blurAmount: 30, bgOpacity: 0.63,
      coverBorderWidth: 2, accentColor: [249,179,88], chapter: { title: 'Reminiscences', number: 1, isNumbered: true } };
    const offPath = path.join(root, 'backlight-off.png');
    const onPath = path.join(root, 'backlight-on.png');
    await execute(`window.setRenderBaseParams(${JSON.stringify(params)})`);
    await execute(`window.renderFrameToFile({coverBacklight:0}, ${JSON.stringify(offPath)})`);
    await execute(`window.renderFrameToFile({coverBacklight:0.45}, ${JSON.stringify(onPath)})`);
    const preview = await execute(`(async () => {
      await window.renderFrame(${JSON.stringify({ ...params, coverBacklight: 0.45 })});
      return document.getElementById('mainCanvas').toDataURL();
    })()`);
    const previewPixels = await sharp(Buffer.from(preview.split(',')[1], 'base64')).raw().toBuffer();
    assert.deepEqual(previewPixels, await sharp(onPath).raw().toBuffer(), 'Preview and file render must match');
    const pixelAt = (file, left, top) => sharp(file).extract({left, top, width:1, height:1}).removeAlpha().raw().toBuffer();
    const dark = await pixelAt(offPath, 75, 1000), light = await pixelAt(onPath, 75, 1000);
    assert.ok(light[0] > dark[0] + 20, 'Lower-left background should be visibly brighter');
    assert.deepEqual(await pixelAt(offPath, 350, 400), await pixelAt(onPath, 350, 400), 'Glow must stay behind cover');
    assert.deepEqual(await pixelAt(offPath, 1500, 550), await pixelAt(onPath, 1500, 550), 'Glow must stay away from text');

    if (process.env.COVER_STYLE_PREVIEW) {
      const prepared = await prepareCoverImage(process.env.COVER_STYLE_PREVIEW);
      await execute(`window.setRenderBaseParams(${JSON.stringify({ ...params, coverDataURL: prepared.dataURL,
        bgDataURL: prepared.dataURL, blurAmount: 74, bgOffsetY: 100 })})`);
      for (const [name, coverBacklight] of [['brazil-backlight-off', 0], ['brazil-backlight-on', 0.45]]) {
        await execute(`window.renderFrameToFile({coverBacklight:${coverBacklight}}, ${JSON.stringify(path.join(root, name + '.png'))})`);
      }
    }
    console.log(`Cover styling passed: shaped border, width, cache, shadow handling, glow placement, preview/export parity. ${root}`);
  } finally {
    window.destroy();
  }
}
app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
