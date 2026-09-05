const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { imageToDataURL, processLogo } = require('../src/logoProcessor');
const { buildOpeningTitleCards } = require('../src/openingTitles');

async function run() {
  const projectRoot = path.resolve(__dirname, '..');
  const fixturePath = path.join(projectRoot, 'logo-audiobook-generator.png');
  const outputDir = path.join(os.tmpdir(), `vexona-frame-smoke-${process.pid}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const chapterOnePath = path.join(outputDir, 'chapter-one.png');
  const chapterTwoPath = path.join(outputDir, 'chapter-two.png');
  const promotionPath = path.join(outputDir, 'print-promotion.png');
  const promotionOverlayPath = path.join(outputDir, 'print-promotion-overlay.png');
  const openingBlankPath = path.join(outputDir, 'opening-blank.png');
  const openingTitlePath = path.join(outputDir, 'opening-title.png');
  const openingTitleOnlyPath = path.join(outputDir, 'opening-title-only.png');
  const openingSubtitleFadePath = path.join(outputDir, 'opening-subtitle-fade.png');
  const openingSeriesPath = path.join(outputDir, 'opening-series.png');
  const openingAuthorPath = path.join(outputDir, 'opening-author.png');
  const openingPublishedPath = path.join(outputDir, 'opening-published.png');
  const openingSitePath = path.join(outputDir, 'opening-site.png');
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
    const coverDataURL = await imageToDataURL(process.env.OPENING_PREVIEW_COVER || fixturePath);
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
    const openingCards = buildOpeningTitleCards({
      presentationLabel: 'SCROLL READER PRESENTS',
      title: 'Into the Darkness of Brazil with the Bible',
      subtitle: 'The Remarkable Missionary Adventures of Frederick C. Glass',
      seriesName: 'The Heritage Library', bookNumber: '2', author: 'Frederick C. Glass',
      originallyPublished: '1923', site: 'scrollreader.com'
    });
    await window.webContents.executeJavaScript(
      `window.renderOpeningFrameToFile(${JSON.stringify({
        chapter: { number: null, title: 'Introduction', isNumbered: false },
        openingBlank: true
      })}, ${JSON.stringify(openingBlankPath)})`
    );
    for (const [targetPath, time] of [[openingTitleOnlyPath, 1], [openingSubtitleFadePath, 2.3],
      [openingTitlePath, 6], [openingSeriesPath, 9], [openingAuthorPath, 12],
      [openingPublishedPath, 15], [openingSitePath, 18]]) {
      await window.webContents.executeJavaScript(
        `window.renderOpeningFrameToFile(${JSON.stringify({
          chapter: { number: null, title: 'Introduction', isNumbered: false },
          openingSequenceFrame: { cards: openingCards, time, duration: 20 }
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
      openingBlankPath,
      openingTitlePath,
      openingTitleOnlyPath,
      openingSubtitleFadePath,
      openingSeriesPath,
      openingAuthorPath,
      openingPublishedPath,
      openingSitePath,
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
    const titleRegion = { left: 780, top: 315, width: 1080, height: 405 };
    const fullTitlePixels = await sharp(openingTitlePath).extract(titleRegion).raw().toBuffer();
    for (const imagePath of [openingTitleOnlyPath, openingSubtitleFadePath]) {
      const pixels = await sharp(imagePath).extract(titleRegion).raw().toBuffer();
      if (!pixels.equals(fullTitlePixels)) throw new Error('Title moved or faded during subtitle reveal.');
    }
    if (fs.readFileSync(openingTitleOnlyPath).equals(fs.readFileSync(openingTitlePath))) {
      throw new Error('Subtitle did not appear in the later title state.');
    }
    // Tracked typography must produce the same pixels regardless of the
    // caller's alignment; this catches the false gaps around narrow glyphs.
    const typography = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      ctx.font = '500 34px "EB Garamond"';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      drawTracked(ctx, 'AUDIOBOOK PRESENTATION', 600, 100, 3.5);
      const left = canvas.toDataURL();
      ctx.clearRect(0, 0, 1200, 200);
      ctx.textAlign = 'center';
      drawTracked(ctx, 'AUDIOBOOK PRESENTATION', 600, 100, 3.5);
      return { matches: left === canvas.toDataURL(), alignment: ctx.textAlign };
    })()`);
    if (!typography.matches || typography.alignment !== 'center') {
      throw new Error('Tracked text inherited per-letter center alignment or changed the caller state.');
    }

    // Inspect the draw calls as well as the exported bitmap: old saved projects
    // and direct previews may still supply a lowercase site card.
    const siteTypography = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920; canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      const calls = [];
      const original = ctx.fillText.bind(ctx);
      ctx.fillText = (text, x, y) => {
        const metrics = ctx.measureText(text);
        calls.push({ text, x, y, font: ctx.font, tracking: ctx.letterSpacing,
          left: x - metrics.actualBoundingBoxLeft, right: x + metrics.actualBoundingBoxRight });
        original(text, x, y);
      };
      drawOpeningTitleCard(ctx, { type: 'site', label: 'DISCOVER MORE AT', primary: 'scrollreader.com', secondary: '' }, {});
      const site = calls.find(call => call.y === 383);
      return { text: site.text, font: site.font, tracking: site.tracking,
        center: (site.left + site.right) / 2, width: site.right - site.left };
    })()`);
    if (siteTypography.text !== 'SCROLLREADER.COM' || parseFloat(siteTypography.tracking) < 2
      || !siteTypography.font.includes('38px') || Math.abs(siteTypography.center - 880) > 0.01 || siteTypography.width > 560.01) {
      throw new Error('Website typography was not uppercase, evenly tracked, centered, and fitted: ' + JSON.stringify(siteTypography));
    }
    const labels = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      const calls = [];
      const original = ctx.fillText.bind(ctx);
      ctx.fillText = (text, x, y) => {
        original(text, x, y);
        const spacedWidth = ctx.measureText(text).width;
        const tracking = ctx.letterSpacing;
        ctx.save(); ctx.letterSpacing = '0px';
        const plainWidth = ctx.measureText(text).width;
        ctx.restore();
        calls.push({ text, tracking, kerning: ctx.fontKerning, font: ctx.font, spacedWidth, plainWidth });
      };
      for (const label of ['WRITTEN BY', 'ORIGINALLY PUBLISHED']) drawTrackedToFit(ctx, label, 500, 100, 640);
      return calls;
    })()`);
    // Electron 29 can return an empty letterSpacing getter after save/restore,
    // even though its text metrics correctly include the configured spacing.
    if (labels.length !== 2 || labels[0].text !== 'WRITTEN BY' || labels[1].text !== 'ORIGINALLY PUBLISHED'
      || labels.some(label => label.kerning !== 'normal'
        || Math.abs(label.spacedWidth - label.plainWidth - Array.from(label.text).length * 1.5) > 0.05)) {
      throw new Error('Labels should be shaped as whole phrases with natural kerning and subtle spacing: ' + JSON.stringify(labels));
    }
    if (fs.readFileSync(openingTitlePath).equals(fs.readFileSync(chapterOnePath))) {
      throw new Error('Opening title card did not differ from a chapter frame.');
    }
    if (fs.readFileSync(openingBlankPath).equals(fs.readFileSync(chapterOnePath))) {
      throw new Error('Blank opening frame unexpectedly contained chapter text.');
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
