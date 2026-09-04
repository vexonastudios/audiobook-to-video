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
  const promotionPath = path.join(outputDir, 'print-promotion.png');
  const promotionOverlayPath = path.join(outputDir, 'print-promotion-overlay.png');
  const openingTitlePath = path.join(outputDir, 'opening-title.png');
  const openingSeriesPath = path.join(outputDir, 'opening-series.png');
  const openingAuthorPath = path.join(outputDir, 'opening-author.png');
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
    const openingCards = [
      { type: 'title', label: 'A SCROLL READER ORIGINAL PRESENTATION', primary: 'A Remarkable Story', secondary: 'The Complete Account' },
      { type: 'series', label: 'BOOK 2 IN THE SERIES', primary: 'The Heritage Library', secondary: '' },
      { type: 'author', label: 'WRITTEN BY', primary: 'Helen S. Dyer', secondary: '' },
      { type: 'published', label: 'ORIGINALLY PUBLISHED', primary: '1910', secondary: '' },
      { type: 'site', label: 'DISCOVER MORE AT', primary: 'scrollreader.com', secondary: '' }
    ];
    for (const [targetPath, time] of [[openingTitlePath, 1], [openingSeriesPath, 4], [openingAuthorPath, 7]]) {
      await window.webContents.executeJavaScript(
        `window.renderOpeningFrameToFile(${JSON.stringify({
          chapter: { number: null, title: 'Introduction', isNumbered: false },
          openingSequenceFrame: { cards: openingCards, time, duration: 15 }
        })}, ${JSON.stringify(targetPath)})`
      );
    }
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
    await window.webContents.executeJavaScript(
      `window.renderPromotionFrameToFile(${JSON.stringify({
        basePath: chapterOnePath,
        visibility: 1
      })}, ${JSON.stringify(promotionPath)})`
    );
    await window.webContents.executeJavaScript(
      `window.renderPromotionOverlayToFile({}, ${JSON.stringify(promotionOverlayPath)})`
    );

    for (const outputPath of [
      chapterOnePath,
      chapterTwoPath,
      openingTitlePath,
      openingSeriesPath,
      openingAuthorPath,
      promotionPath,
      promotionOverlayPath,
      ...transitionPaths.map(item => item.path)
    ]) {
      const metadata = await sharp(outputPath).metadata();
      if (metadata.width !== 1920 || metadata.height !== 1080) {
        throw new Error(`${path.basename(outputPath)} was ${metadata.width}x${metadata.height}, expected 1920x1080`);
      }
    }

    if (fs.readFileSync(chapterOnePath).equals(fs.readFileSync(chapterTwoPath))) {
      throw new Error('Distinct chapter parameters produced identical PNG files.');
    }
    if (fs.readFileSync(chapterOnePath).equals(fs.readFileSync(promotionPath))) {
      throw new Error('Print promotion frame did not differ from its base chapter frame.');
    }
    if (fs.readFileSync(openingTitlePath).equals(fs.readFileSync(openingAuthorPath))) {
      throw new Error('Distinct opening title cards produced identical PNG files.');
    }
    if (fs.readFileSync(openingTitlePath).equals(fs.readFileSync(openingSeriesPath))) {
      throw new Error('Series card did not differ from the title card.');
    }
    if (fs.readFileSync(openingTitlePath).equals(fs.readFileSync(chapterOnePath))) {
      throw new Error('Opening title card did not differ from a chapter frame.');
    }
    const overlayMetadata = await sharp(promotionOverlayPath).metadata();
    if (!overlayMetadata.hasAlpha) throw new Error('Print promotion overlay did not preserve transparency.');
    const overlayStats = await sharp(promotionOverlayPath).stats();
    if (!overlayStats.channels[3] || overlayStats.channels[3].max === 0) {
      throw new Error('Print promotion overlay was fully transparent.');
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
