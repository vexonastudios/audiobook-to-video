const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { imageToDataURL, processLogo } = require('../src/logoProcessor');

async function run() {
  const projectRoot = path.resolve(__dirname, '..');
  const fixturePath = path.join(projectRoot, 'logo-audiobook-generator.png');
  const outputDir = path.join(os.tmpdir(), `vexona-frame-smoke-${process.pid}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const chapterOnePath = path.join(outputDir, 'chapter-one.png');
  const chapterTwoPath = path.join(outputDir, 'chapter-two.png');
  const transitionPaths = ['fade', 'dissolve', 'flare', 'zoom'].map(style => ({
    style,
    path: path.join(outputDir, `transition-${style}.png`)
  }));
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false
    }
  });

  try {
    await window.loadFile(path.join(projectRoot, 'frame-window', 'index.html'));
    const coverDataURL = await imageToDataURL(fixturePath);
    const logoDataURL = await processLogo(fixturePath, [211, 193, 166]);
    const baseParams = {
      coverDataURL,
      bgDataURL: coverDataURL,
      blurAmount: 30,
      bgOpacity: 0.65,
      bgOffsetY: 0,
      accentColor: [211, 193, 166],
      logoDataURL,
      coverBorderWidth: 0,
      titleFontSize: 54
    };

    await window.webContents.executeJavaScript(
      `window.setRenderBaseParams(${JSON.stringify(baseParams)})`
    );
    await window.webContents.executeJavaScript(
      `window.renderFrameToFile(${JSON.stringify({
        chapter: { number: 1, title: 'Renderer Smoke Test', isNumbered: true }
      })}, ${JSON.stringify(chapterOnePath)})`
    );
    await window.webContents.executeJavaScript(
      `window.renderFrameToFile(${JSON.stringify({
        chapter: { number: 2, title: 'Timestamped Timeline', isNumbered: true }
      })}, ${JSON.stringify(chapterTwoPath)})`
    );
    for (const transition of transitionPaths) {
      await window.webContents.executeJavaScript(
        `window.renderTransitionFrameToFile(${JSON.stringify({
          fromPath: chapterOnePath,
          toPath: chapterTwoPath,
          transitionStyle: transition.style,
          alpha: 0.35
        })}, ${JSON.stringify(transition.path)})`
      );
    }

    for (const outputPath of [chapterOnePath, chapterTwoPath, ...transitionPaths.map(item => item.path)]) {
      const metadata = await sharp(outputPath).metadata();
      if (metadata.width !== 1920 || metadata.height !== 1080) {
        throw new Error(`${path.basename(outputPath)} was ${metadata.width}x${metadata.height}, expected 1920x1080`);
      }
    }

    if (fs.readFileSync(chapterOnePath).equals(fs.readFileSync(chapterTwoPath))) {
      throw new Error('Distinct chapter parameters produced identical PNG files.');
    }

    console.log(`Frame renderer smoke test passed: ${outputDir}`);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
