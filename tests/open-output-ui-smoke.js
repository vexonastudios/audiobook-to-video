const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

async function runTest() {
  const projectRoot = path.resolve(__dirname, '..');
  const completedPath = path.join(projectRoot, 'completed-render.mp4');
  let openedPath = null;

  ipcMain.handle('get-gpu-name', () => 'Smoke Test GPU');
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

    console.log('Open completed video UI smoke test passed.');
  } finally {
    if (!window.isDestroyed()) window.destroy();
    ipcMain.removeHandler('get-gpu-name');
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
