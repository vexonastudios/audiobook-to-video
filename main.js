const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Hardware acceleration is ENABLED intentionally — the GPU accelerates
// the hidden frame-window canvas renderer (the slowest step of the pipeline).
let mainWindow = null;
let frameWindow = null;

// ─────────────────────────────────────────────
// Window Creation
// ─────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d0d0f',
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (frameWindow) frameWindow.close();
  });
}

function createFrameWindow() {
  frameWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false   // Allow loading local file:// paths for images
    }
  });

  frameWindow.loadFile(path.join(__dirname, 'frame-window', 'index.html'));
}

// ─────────────────────────────────────────────
// Auto-Updater
// ─────────────────────────────────────────────

autoUpdater.on('update-available', (info) => {
  console.log('Update available.', info);
});
autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded.', info);
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'A new version of Audiobook to Video has been downloaded. Restart the application to apply the update.',
    buttons: ['Restart', 'Later']
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});
autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater.', err);
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return !!result.downloadPromise;
  } catch (e) {
    return false;
  }
});

// App lifecycle
app.whenReady().then(() => {
  createMainWindow();
  createFrameWindow();

  // Check for updates (only runs in packaged app)
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.error('Auto-updater error on startup:', e);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────
// IPC: Window Controls
// ─────────────────────────────────────────────

ipcMain.handle('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.restore();
  else mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow && mainWindow.close());

// ─────────────────────────────────────────────
// IPC: File Dialogs
// ─────────────────────────────────────────────

ipcMain.handle('pick-cover', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Book Cover Image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('pick-background', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Background Image (optional)',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('pick-wav', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Audiobook WAV File',
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'aac', 'm4a', 'm4b', 'flac'] }],
    properties: ['openFile']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('pick-logo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Logo PNG',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
    properties: ['openFile']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('pick-intro-clip', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Video Intro Clip',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv'] }],
    properties: ['openFile']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('pick-output', async (event, suggestedName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Video As',
    defaultPath: suggestedName || 'audiobook-video.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });
  return result.filePath || null;
});

ipcMain.handle('pick-chapters-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Chapter Markers',
    filters: [
      { name: 'Text / JSON', extensions: ['txt', 'json'] }
    ],
    properties: ['openFile']
  });
  if (!result.filePaths[0]) return null;
  return fs.readFileSync(result.filePaths[0], 'utf8');
});

ipcMain.handle('save-project-file', async (event, dataStr) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Audiobook Project',
    defaultPath: 'audiobook-project.vexona',
    filters: [{ name: 'Vexona Project', extensions: ['vexona', 'bodee', 'json'] }]
  });
  if (result.filePath) {
    fs.writeFileSync(result.filePath, dataStr, 'utf8');
    return true;
  }
  return false;
});

ipcMain.handle('load-project-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Audiobook Project',
    filters: [{ name: 'Vexona Project', extensions: ['vexona', 'bodee', 'json'] }],
    properties: ['openFile']
  });
  if (result.filePaths[0]) {
    return fs.readFileSync(result.filePaths[0], 'utf8');
  }
  return null;
});

ipcMain.handle('pick-srt-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import SRT Subtitle File',
    filters: [{ name: 'Subtitle Files', extensions: ['srt', 'txt'] }],
    properties: ['openFile']
  });
  if (result.filePaths[0]) {
    return fs.readFileSync(result.filePaths[0], 'utf8');
  }
  return null;
});

// ─────────────────────────────────────────────
// IPC: Image → Data URL
// ─────────────────────────────────────────────

ipcMain.handle('image-to-dataurl', async (event, filePath) => {
  try {
    const { imageToDataURL } = require('./src/logoProcessor');
    return await imageToDataURL(filePath);
  } catch (e) {
    console.error('image-to-dataurl error:', e);
    return null;
  }
});

// ─────────────────────────────────────────────
// IPC: Color Extraction
// ─────────────────────────────────────────────

ipcMain.handle('extract-color', async (event, imagePath) => {
  try {
    const { extractDominantColor } = require('./src/colorExtractor');
    return await extractDominantColor(imagePath);
  } catch (e) {
    console.error('extract-color error:', e);
    return [201, 169, 110];
  }
});

// ─────────────────────────────────────────────
// IPC: Logo Processing
// ─────────────────────────────────────────────

ipcMain.handle('process-logo', async (event, { logoPath, accentColor }) => {
  try {
    const { processLogo } = require('./src/logoProcessor');
    return await processLogo(logoPath, accentColor);
  } catch (e) {
    console.error('process-logo error:', e);
    const { imageToDataURL } = require('./src/logoProcessor');
    return await imageToDataURL(logoPath);
  }
});

// ─────────────────────────────────────────────
// IPC: Write Text File
// ─────────────────────────────────────────────

ipcMain.handle('write-text-file', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (e) {
    console.error('write-text-file error:', e);
    return false;
  }
});

// ─────────────────────────────────────────────
// IPC: Audio Duration
// ─────────────────────────────────────────────

ipcMain.handle('get-audio-duration', async (event, wavPath) => {
  try {
    const { getAudioDuration } = require('./src/videoEncoder');
    return await getAudioDuration(wavPath);
  } catch (e) {
    throw new Error(e.message);
  }
});

ipcMain.handle('get-video-duration', async (event, videoPath) => {
  try {
    const { getVideoDuration } = require('./src/videoEncoder');
    return await getVideoDuration(videoPath);
  } catch (e) {
    throw new Error(e.message);
  }
});

// ─────────────────────────────────────────────
// IPC: Frame Rendering (Preview)
// ─────────────────────────────────────────────

ipcMain.handle('render-preview', async (event, params) => {
  try {
    return await renderFrameInWindow(params);
  } catch (e) {
    console.error('render-preview error:', e);
    return null;
  }
});

// ─────────────────────────────────────────────
// IPC: Full Video Render
// ─────────────────────────────────────────────

let renderCancelled = false;

ipcMain.handle('cancel-render', () => {
  renderCancelled = true;
});

ipcMain.handle('start-render', async (event, params) => {
  const { renderVideo } = require('./src/videoEncoder');
  renderCancelled = false;

  try {
    await renderVideo(params, {
      onProgress: (data) => {
        if (mainWindow) mainWindow.webContents.send('render-progress', data);
      },
      onLog: (msg) => {
        if (mainWindow) mainWindow.webContents.send('render-log', msg);
      },
      renderFrame: renderFrameInWindow,
      isCancelled: () => renderCancelled
    });
    if (mainWindow) mainWindow.webContents.send('render-complete', { success: true });
  } catch (e) {
    const cancelled = renderCancelled || e.message === 'RENDER_CANCELLED';
    renderCancelled = false;
    console.error('Render pipeline error:', e);
    if (mainWindow) mainWindow.webContents.send('render-complete', {
      success: false,
      cancelled,
      error: cancelled ? null : e.message
    });
  }
});

// ─────────────────────────────────────────────
// IPC: GPU Info
// ─────────────────────────────────────────────

ipcMain.handle('get-gpu-name', async () => {
  try {
    const info = await app.getGPUInfo('basic');
    const devices = info.gpuDevice || [];
    const primary = devices.find(d => !d.excluded) || devices[0];

    if (primary) {
      // deviceString is the most human-readable name (e.g. "Quadro P3000")
      if (primary.deviceString) return primary.deviceString;
      if (primary.driverVendor) return primary.driverVendor;
    }

    // auxAttributes.glRenderer is reliably populated on most systems
    // e.g. "NVIDIA Quadro P3000/PCIe/SSE2" — trim after "/"
    const glRenderer = info.auxAttributes && info.auxAttributes.glRenderer;
    if (glRenderer && glRenderer !== 'Google SwiftShader') {
      return glRenderer.split('/')[0].trim();
    }

    return 'GPU';
  } catch (e) {
    console.error('get-gpu-name error:', e);
    return 'GPU';
  }
});

// ─────────────────────────────────────────────
// Frame Renderer Utility
// ─────────────────────────────────────────────

async function renderFrameInWindow(params) {
  if (!frameWindow || frameWindow.isDestroyed()) {
    createFrameWindow();
    // Wait for it to be ready
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Execute renderFrame in the hidden window and capture as data URL
  const dataURL = await frameWindow.webContents.executeJavaScript(`
    (async () => {
      try {
        await window.renderFrame(${JSON.stringify(params)});
        return document.getElementById('mainCanvas').toDataURL('image/png');
      } catch(err) {
        console.error('[FrameWindow] renderFrame error:', err.message);
        return null;
      }
    })()
  `);

  return dataURL;
}
