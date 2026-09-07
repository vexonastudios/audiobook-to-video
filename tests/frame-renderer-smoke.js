const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { imageToDataURL, prepareCoverImage, processLogo } = require('../src/logoProcessor');
const { buildOpeningTitleCards } = require('../src/openingTitles');

async function run() {
  const projectRoot = path.resolve(__dirname, '..');
  const fixturePath = path.join(projectRoot, 'logo-audiobook-generator.png');
  const outputDir = path.join(os.tmpdir(), `vexona-frame-smoke-${process.pid}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const chapterOnePath = path.join(outputDir, 'chapter-one.png');
  const chapterTwoPath = path.join(outputDir, 'chapter-two.png');
  const trimmedCoverFramePath = path.join(outputDir, 'trimmed-cover-frame.png');
  const transparentPaddedCoverPath = path.join(outputDir, 'transparent-padded-cover.png');
  const opaqueCoverPath = path.join(outputDir, 'opaque-cover.png');
  const promotionPath = path.join(outputDir, 'print-promotion.png');
  const promotionFallbackPath = path.join(outputDir, 'print-promotion-cover-fallback.png');
  const promotionOverlayPath = path.join(outputDir, 'print-promotion-overlay.png');
  const promotionArtworkPath = path.join(outputDir, 'print-promotion-artwork.png');
  const openingBlankPath = path.join(outputDir, 'opening-blank.png');
  const openingTitlePath = path.join(outputDir, 'opening-title.png');
  const openingTitleOnlyPath = path.join(outputDir, 'opening-title-only.png');
  const openingSubtitleFadePath = path.join(outputDir, 'opening-subtitle-fade.png');
  const openingSeriesPath = path.join(outputDir, 'opening-series.png');
  const openingAuthorPath = path.join(outputDir, 'opening-author.png');
  const openingAuthorNoPhotoPath = path.join(outputDir, 'opening-author-no-photo.png');
  const openingAuthorCropTopLeftPath = path.join(outputDir, 'opening-author-crop-top-left.png');
  const openingAuthorCropBottomRightPath = path.join(outputDir, 'opening-author-crop-bottom-right.png');
  const authorPhotoPath = path.join(outputDir, 'author-photo.png');
  const authorCropPhotoPath = path.join(outputDir, 'author-crop-photo.png');
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
    await sharp({
      create: { width: 900, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{
      input: Buffer.from('<svg width="300" height="700"><rect width="300" height="700" fill="#00f5d4"/></svg>'),
      left: 300,
      top: 100
    }]).png().toFile(transparentPaddedCoverPath);
    const preparedTransparentCover = await prepareCoverImage(transparentPaddedCoverPath);
    const preparedTransparentMetadata = await sharp(Buffer.from(preparedTransparentCover.dataURL.split(',')[1], 'base64')).metadata();
    if (!preparedTransparentCover.wasTrimmed || preparedTransparentMetadata.width !== 300
      || preparedTransparentMetadata.height !== 700) {
      throw new Error(`Transparent cover padding was not removed: ${JSON.stringify(preparedTransparentCover)}`);
    }
    await sharp({
      create: { width: 400, height: 600, channels: 4, background: { r: 40, g: 60, b: 80, alpha: 1 } }
    }).png().toFile(opaqueCoverPath);
    const preparedOpaqueCover = await prepareCoverImage(opaqueCoverPath);
    if (preparedOpaqueCover.wasTrimmed || preparedOpaqueCover.width !== 400 || preparedOpaqueCover.height !== 600) {
      throw new Error('An ordinary opaque cover was cropped unexpectedly.');
    }
    const coverDataURL = await imageToDataURL(process.env.OPENING_PREVIEW_COVER || fixturePath);
    await sharp({
      create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite([{
      input: Buffer.from('<svg width="180" height="280"><rect width="180" height="280" rx="18" fill="#f414d2"/></svg>'),
      left: 60,
      top: 10
    }]).png().toFile(promotionArtworkPath);
    const printPromoImageDataURL = await imageToDataURL(promotionArtworkPath);
    await sharp({
      create: { width: 240, height: 360, channels: 3, background: { r: 20, g: 230, b: 70 } }
    }).png().toFile(authorPhotoPath);
    const authorPhotoDataURL = await imageToDataURL(authorPhotoPath);
    await sharp(Buffer.from(`<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#f02020"/>
      <rect x="200" width="200" height="200" fill="#20f020"/>
      <rect y="200" width="200" height="200" fill="#2020f0"/>
      <rect x="200" y="200" width="200" height="200" fill="#f0e020"/>
    </svg>`)).png().toFile(authorCropPhotoPath);
    const authorCropPhotoDataURL = await imageToDataURL(authorCropPhotoPath);
    const logoDataURL = await processLogo(fixturePath, [211, 193, 166]);
    const baseParams = {
      coverDataURL,
      bgDataURL: coverDataURL,
      blurAmount: 30,
      bgOpacity: 0.65,
      bgOffsetY: 0,
      accentColor: [211, 193, 166],
      logoDataURL,
      authorPhotoDataURL,
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
    await window.webContents.executeJavaScript(
      `window.setRenderBaseParams(${JSON.stringify({
        ...baseParams,
        coverDataURL: preparedTransparentCover.dataURL,
        bgDataURL: preparedTransparentCover.dataURL
      })})`
    );
    await window.webContents.executeJavaScript(
      `window.renderFrameToFile(${JSON.stringify({
        chapter: { number: 1, title: 'Auto-cropped Cover', isNumbered: true }
      })}, ${JSON.stringify(trimmedCoverFramePath)})`
    );
    await window.webContents.executeJavaScript(
      `window.setRenderBaseParams(${JSON.stringify(baseParams)})`
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
    await window.webContents.executeJavaScript(
      `window.renderOpeningFrameToFile(${JSON.stringify({
        chapter: { number: null, title: 'Introduction', isNumbered: false },
        openingPreviewCard: openingCards.find(card => card.type === 'author'),
        authorPhotoDataURL: null
      })}, ${JSON.stringify(openingAuthorNoPhotoPath)})`
    );
    for (const crop of [
      { path: openingAuthorCropTopLeftPath, positionX: 0, positionY: 0 },
      { path: openingAuthorCropBottomRightPath, positionX: 100, positionY: 100 }
    ]) {
      await window.webContents.executeJavaScript(
        `window.renderOpeningFrameToFile(${JSON.stringify({
          chapter: { number: null, title: 'Introduction', isNumbered: false },
          openingPreviewCard: openingCards.find(card => card.type === 'author'),
          authorPhotoDataURL: authorCropPhotoDataURL,
          authorPhotoPositionX: crop.positionX,
          authorPhotoPositionY: crop.positionY,
          authorPhotoZoom: 2
        })}, ${JSON.stringify(crop.path)})`
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
      })}, ${JSON.stringify(promotionFallbackPath)})`
    );
    await window.webContents.executeJavaScript(
      `window.setRenderBaseParams(${JSON.stringify({ ...baseParams, printPromoImageDataURL })})`
    );
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
      trimmedCoverFramePath,
      openingBlankPath,
      openingTitlePath,
      openingTitleOnlyPath,
      openingSubtitleFadePath,
      openingSeriesPath,
      openingAuthorPath,
      openingAuthorNoPhotoPath,
      openingAuthorCropTopLeftPath,
      openingAuthorCropBottomRightPath,
      openingPublishedPath,
      openingSitePath,
      promotionPath,
      promotionFallbackPath,
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
    const trimmedCoverPixel = await sharp(trimmedCoverFramePath)
      .extract({ left: 402, top: 70, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    if (trimmedCoverPixel[0] > 40 || trimmedCoverPixel[1] < 220 || trimmedCoverPixel[2] < 180) {
      throw new Error(`Visible cover artwork did not fill the cover stage after trimming: ${Array.from(trimmedCoverPixel)}`);
    }
    if (fs.readFileSync(chapterOnePath).equals(fs.readFileSync(promotionPath))) {
      throw new Error('Print promotion frame did not differ from its base chapter frame.');
    }
    if (fs.readFileSync(chapterOnePath).equals(fs.readFileSync(promotionFallbackPath))) {
      throw new Error('Print promotion cover fallback did not differ from its base chapter frame.');
    }
    if (fs.readFileSync(promotionPath).equals(fs.readFileSync(promotionFallbackPath))) {
      throw new Error('Custom print-promotion artwork did not replace the main cover.');
    }
    const promotionPixel = await sharp(promotionPath)
      .extract({ left: 897, top: 937, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    if (promotionPixel[0] < 225 || promotionPixel[1] > 45 || promotionPixel[2] < 190) {
      throw new Error(`Custom print-promotion PNG was not used: ${Array.from(promotionPixel)}`);
    }
    if (fs.readFileSync(openingTitlePath).equals(fs.readFileSync(openingAuthorPath))) {
      throw new Error('Distinct opening title cards produced identical PNG files.');
    }
    if (fs.readFileSync(openingAuthorPath).equals(fs.readFileSync(openingAuthorNoPhotoPath))) {
      throw new Error('Author photo did not change the author opening card.');
    }
    const authorPhotoPixel = await sharp(openingAuthorPath)
      .extract({ left: 1320, top: 473, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    if (authorPhotoPixel[0] > 60 || authorPhotoPixel[1] < 200 || authorPhotoPixel[2] > 100) {
      throw new Error(`Circular author photo was not rendered above the author name: ${Array.from(authorPhotoPixel)}`);
    }
    const cropTopLeftPixel = await sharp(openingAuthorCropTopLeftPath)
      .extract({ left: 1320, top: 473, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    const cropBottomRightPixel = await sharp(openingAuthorCropBottomRightPath)
      .extract({ left: 1320, top: 473, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    if (cropTopLeftPixel[0] < 220 || cropTopLeftPixel[1] > 70 || cropTopLeftPixel[2] > 70) {
      throw new Error(`Top-left author crop did not move to the requested focus: ${Array.from(cropTopLeftPixel)}`);
    }
    if (cropBottomRightPixel[0] < 220 || cropBottomRightPixel[1] < 200 || cropBottomRightPixel[2] > 70) {
      throw new Error(`Bottom-right author crop did not move to the requested focus: ${Array.from(cropBottomRightPixel)}`);
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
