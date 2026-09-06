const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

async function runTest() {
  const projectRoot = path.resolve(__dirname, '..');
  const completedPath = path.join(projectRoot, 'completed-render.mp4');
  const promotionArtworkPath = path.join(projectRoot, 'book-mockup.png');
  let openedPath = null;

  ipcMain.handle('get-gpu-name', () => 'Smoke Test GPU');
  ipcMain.handle('get-render-info', () => ({ settings: { completionSound: true }, lastRender: null, estimatedSeconds: null }));
  ipcMain.handle('pick-print-promo-image', () => promotionArtworkPath);
  ipcMain.handle('image-to-dataurl', () => 'data:image/png;base64,cHJvbW90aW9uLWFydHdvcms=');
  ipcMain.handle('open-output-file', (event, filePath) => {
    openedPath = filePath;
    return { success: true };
  });

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

    console.log('Open video, transition defaults, and promotion-artwork UI smoke test passed.');
  } finally {
    if (!window.isDestroyed()) window.destroy();
    ipcMain.removeHandler('get-gpu-name');
    ipcMain.removeHandler('get-render-info');
    ipcMain.removeHandler('pick-print-promo-image');
    ipcMain.removeHandler('image-to-dataurl');
    ipcMain.removeHandler('open-output-file');
  }
}

app.whenReady()
  .then(runTest)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
