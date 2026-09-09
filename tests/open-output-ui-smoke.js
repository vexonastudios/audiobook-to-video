const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

async function runTest() {
  const projectRoot = path.resolve(__dirname, '..');
  const completedPath = path.join(projectRoot, 'completed-render.mp4');
  const promotionArtworkPath = path.join(projectRoot, 'book-mockup.png');
  const authorPhotoPath = path.join(projectRoot, 'author-photo.jpg');
  let openedPath = null;
  let savedProject = null;

  ipcMain.handle('get-gpu-name', () => 'Smoke Test GPU');
  ipcMain.handle('get-render-info', () => ({ settings: { completionSound: true }, lastRender: null, estimatedSeconds: null }));
  ipcMain.handle('pick-print-promo-image', () => promotionArtworkPath);
  ipcMain.handle('pick-author-photo', () => authorPhotoPath);
  ipcMain.handle('image-to-dataurl', () => 'data:image/png;base64,cHJvbW90aW9uLWFydHdvcms=');
  ipcMain.handle('open-output-file', (event, filePath) => {
    openedPath = filePath;
    return { success: true };
  });
  ipcMain.handle('save-project-file', (_, content) => { savedProject = JSON.parse(content); return true; });

  const window = new BrowserWindow({
    width: 1400,
    height: 860,
    show: false,
    webPreferences: {
      preload: path.join(projectRoot, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  try {
    await window.loadFile(path.join(projectRoot, 'renderer', 'index.html'));
    await window.webContents.executeJavaScript('localStorage.clear()');
    await window.webContents.executeJavaScript('restoreSession()');
    async function checkTransition(expected) {
      const actual = await window.webContents.executeJavaScript(`({
        style: state.transitionStyle,
        selected: document.getElementById('transition-select').value,
        disabled: document.getElementById('transition-dur-slider').disabled
      })`);
      if (actual.style !== expected || actual.selected !== expected || actual.disabled !== (expected === 'cut')) {
        throw new Error(`Wrong transition default/restoration: ${JSON.stringify(actual)}`);
      }
    }
    await checkTransition('cut');
    const glowState = await window.webContents.executeJavaScript(`(async () => {
      const slider = document.getElementById('cover-backlight-slider');
      const defaultValue = state.coverBacklight;
      slider.value = 72;
      slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change'));
      const preview = buildRenderParams({ title: 'Test' }).coverBacklight;
      const saved = JSON.parse(localStorage.getItem('audiobook-video-gen-session')).coverBacklight;
      await restoreSession();
      const restored = state.coverBacklight;
      document.getElementById('btn-save-project').click();
      return { defaultValue, saved, restored, preview, slider: slider.value };
    })()`);
    if (glowState.defaultValue !== 0.45 || glowState.saved !== 0.72 || glowState.restored !== 0.72
      || glowState.preview !== 0.72 || glowState.slider !== '72') {
      throw new Error('Cover backlight control did not persist and reach preview: ' + JSON.stringify(glowState));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    if (savedProject?.coverBacklight !== 0.72) throw new Error('Saved project lost cover backlight');
    await window.webContents.executeJavaScript(`(async () => {
      localStorage.setItem('audiobook-video-gen-session', JSON.stringify({coverBacklight: 0}));
      await restoreSession();
      if (state.coverBacklight !== 0) throw new Error('Backlight off was not restored');
      localStorage.setItem('audiobook-video-gen-session', '{}');
      await restoreSession();
      if (state.coverBacklight !== 0.45) throw new Error('Old project did not use default backlight');
    })()`);
    await window.webContents.executeJavaScript(`document.getElementById('btn-print-promo-image').click()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    let promotionState = await window.webContents.executeJavaScript(`(() => {
      const saved = JSON.parse(localStorage.getItem('audiobook-video-gen-session'));
      return { path: state.printPromoImagePath, hasData: !!state.printPromoImageDataURL,
        savedPath: saved.printPromoImagePath,
        label: document.getElementById('fp-print-promo-image-text').textContent,
        clearVisible: getComputedStyle(document.getElementById('btn-print-promo-image-clear')).display !== 'none' };
    })()`);
    if (promotionState.path !== promotionArtworkPath || !promotionState.hasData
      || promotionState.savedPath !== promotionArtworkPath || promotionState.label !== 'book-mockup.png'
      || !promotionState.clearVisible) {
      throw new Error(`Promotion artwork picker did not persist its selection: ${JSON.stringify(promotionState)}`);
    }
    await window.webContents.executeJavaScript(`document.getElementById('btn-print-promo-image-clear').click()`);
    promotionState = await window.webContents.executeJavaScript(`({
      path: state.printPromoImagePath,
      savedPath: JSON.parse(localStorage.getItem('audiobook-video-gen-session')).printPromoImagePath,
      label: document.getElementById('fp-print-promo-image-text').textContent
    })`);
    if (promotionState.path !== null || promotionState.savedPath !== null || promotionState.label !== 'Using book cover') {
      throw new Error(`Promotion artwork did not return to its cover fallback: ${JSON.stringify(promotionState)}`);
    }
    await window.webContents.executeJavaScript(`(async () => {
      localStorage.setItem('audiobook-video-gen-session', JSON.stringify({ printPromoImagePath: ${JSON.stringify(promotionArtworkPath)} }));
      await restoreSession();
    })()`);
    promotionState = await window.webContents.executeJavaScript(`({ path: state.printPromoImagePath, hasData: !!state.printPromoImageDataURL })`);
    if (promotionState.path !== promotionArtworkPath || !promotionState.hasData) {
      throw new Error(`Saved promotion artwork was not restored: ${JSON.stringify(promotionState)}`);
    }
    await window.webContents.executeJavaScript(`document.getElementById('btn-author-photo').click()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    let authorPhotoState = await window.webContents.executeJavaScript(`(() => {
      const saved = JSON.parse(localStorage.getItem('audiobook-video-gen-session'));
      return { path: state.authorPhotoPath, hasData: !!state.authorPhotoDataURL,
        savedPath: saved.authorPhotoPath,
        label: document.getElementById('fp-author-photo-text').textContent,
        clearVisible: getComputedStyle(document.getElementById('btn-author-photo-clear')).display !== 'none',
        cropVisible: getComputedStyle(document.getElementById('author-photo-crop-controls')).display !== 'none',
        positionX: state.authorPhotoPositionX, positionY: state.authorPhotoPositionY, zoom: state.authorPhotoZoom };
    })()`);
    if (authorPhotoState.path !== authorPhotoPath || !authorPhotoState.hasData
      || authorPhotoState.savedPath !== authorPhotoPath || authorPhotoState.label !== 'author-photo.jpg'
      || !authorPhotoState.clearVisible || !authorPhotoState.cropVisible
      || authorPhotoState.positionX !== 50 || authorPhotoState.positionY !== 35 || authorPhotoState.zoom !== 1) {
      throw new Error(`Author photo picker did not persist its selection: ${JSON.stringify(authorPhotoState)}`);
    }
    await window.webContents.executeJavaScript(`(() => {
      const x = document.getElementById('author-photo-position-x');
      const y = document.getElementById('author-photo-position-y');
      const zoom = document.getElementById('author-photo-zoom');
      x.value = 18; y.value = 72; zoom.value = 165;
      x.dispatchEvent(new Event('input')); y.dispatchEvent(new Event('input')); zoom.dispatchEvent(new Event('input'));
    })()`);
    authorPhotoState = await window.webContents.executeJavaScript(`(() => {
      const saved = JSON.parse(localStorage.getItem('audiobook-video-gen-session'));
      return { positionX: state.authorPhotoPositionX, positionY: state.authorPhotoPositionY, zoom: state.authorPhotoZoom,
        savedX: saved.authorPhotoPositionX, savedY: saved.authorPhotoPositionY, savedZoom: saved.authorPhotoZoom,
        xValue: document.getElementById('author-photo-position-x').value,
        yValue: document.getElementById('author-photo-position-y').value,
        zoomValue: document.getElementById('author-photo-zoom').value };
    })()`);
    if (authorPhotoState.positionX !== 18 || authorPhotoState.positionY !== 72 || authorPhotoState.zoom !== 1.65
      || authorPhotoState.savedX !== 18 || authorPhotoState.savedY !== 72 || authorPhotoState.savedZoom !== 1.65
      || authorPhotoState.xValue !== '18' || authorPhotoState.yValue !== '72' || authorPhotoState.zoomValue !== '165') {
      throw new Error(`Author photo crop controls did not persist: ${JSON.stringify(authorPhotoState)}`);
    }
    await window.webContents.executeJavaScript(`document.getElementById('btn-author-photo-clear').click()`);
    authorPhotoState = await window.webContents.executeJavaScript(`({
      path: state.authorPhotoPath,
      savedPath: JSON.parse(localStorage.getItem('audiobook-video-gen-session')).authorPhotoPath,
      label: document.getElementById('fp-author-photo-text').textContent,
      cropVisible: getComputedStyle(document.getElementById('author-photo-crop-controls')).display !== 'none',
      positionX: state.authorPhotoPositionX, positionY: state.authorPhotoPositionY, zoom: state.authorPhotoZoom
    })`);
    if (authorPhotoState.path !== null || authorPhotoState.savedPath !== null || authorPhotoState.label !== 'No author photo'
      || authorPhotoState.cropVisible || authorPhotoState.positionX !== 50 || authorPhotoState.positionY !== 35
      || authorPhotoState.zoom !== 1) {
      throw new Error(`Author photo did not return to its text-only fallback: ${JSON.stringify(authorPhotoState)}`);
    }
    await window.webContents.executeJavaScript(`(async () => {
      localStorage.setItem('audiobook-video-gen-session', JSON.stringify({
        authorPhotoPath: ${JSON.stringify(authorPhotoPath)}, authorPhotoPositionX: 22,
        authorPhotoPositionY: 64, authorPhotoZoom: 1.4
      }));
      await restoreSession();
    })()`);
    authorPhotoState = await window.webContents.executeJavaScript(`({
      path: state.authorPhotoPath, hasData: !!state.authorPhotoDataURL,
      positionX: state.authorPhotoPositionX, positionY: state.authorPhotoPositionY, zoom: state.authorPhotoZoom,
      cropVisible: getComputedStyle(document.getElementById('author-photo-crop-controls')).display !== 'none'
    })`);
    if (authorPhotoState.path !== authorPhotoPath || !authorPhotoState.hasData || !authorPhotoState.cropVisible
      || authorPhotoState.positionX !== 22 || authorPhotoState.positionY !== 64 || authorPhotoState.zoom !== 1.4) {
      throw new Error(`Saved author photo was not restored: ${JSON.stringify(authorPhotoState)}`);
    }
    await window.webContents.executeJavaScript(`(async () => {
      localStorage.setItem('audiobook-video-gen-session', JSON.stringify({ transitionStyle: 'fade', transitionDuration: 1.1 }));
      await restoreSession();
    })()`);
    await checkTransition('fade');
    await window.webContents.executeJavaScript(`(async () => {
      localStorage.setItem('audiobook-video-gen-session', '{}');
      await restoreSession();
    })()`);
    await checkTransition('cut');
    await window.webContents.executeJavaScript(`
      state.transitionStyle = 'fade';
      window.confirm = () => true;
      document.getElementById('btn-new-project').click();
    `);
    await checkTransition('cut');
    window.webContents.send('render-complete', { success: true, outputPath: completedPath });
    await new Promise(resolve => setTimeout(resolve, 100));

    const buttonState = await window.webContents.executeJavaScript(`(() => {
      const button = document.getElementById('btn-open-output');
      return { display: getComputedStyle(button).display, text: button.textContent.trim() };
    })()`);
    if (buttonState.display === 'none' || buttonState.text !== 'Open Video') {
      throw new Error(`Open Video button was not visible after completion: ${JSON.stringify(buttonState)}`);
    }

    await window.webContents.executeJavaScript(`document.getElementById('btn-open-output').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (openedPath !== completedPath) {
      throw new Error(`Open Video requested ${openedPath || 'nothing'}, expected ${completedPath}`);
    }

    console.log('Open video, transition defaults, promotion artwork, and author-photo UI smoke test passed.');
  } finally {
    if (!window.isDestroyed()) window.destroy();
    ipcMain.removeHandler('get-gpu-name');
    ipcMain.removeHandler('get-render-info');
    ipcMain.removeHandler('pick-print-promo-image');
    ipcMain.removeHandler('pick-author-photo');
    ipcMain.removeHandler('image-to-dataurl');
    ipcMain.removeHandler('open-output-file');
    ipcMain.removeHandler('save-project-file');
  }
}

app.whenReady()
  .then(runTest)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
