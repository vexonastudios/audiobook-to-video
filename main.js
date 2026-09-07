const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { RenderHistory } = require('./src/renderHistory');
const { RenderJob } = require('./src/renderJob');
const { createRenderNotifier } = require('./src/renderNotification');

if (process.platform === 'win32') app.setAppUserModelId('com.vexonastudios.videogenerator');

// Use the multi-resolution ICO for Windows window/taskbar rendering. Other
// platforms use the high-resolution PNG generated from the same SVG source.
const appIconPath = path.join(
  __dirname,
  'assets',
  process.platform === 'win32' ? 'icon.ico' : 'icon.png'
);

// Hardware acceleration is ENABLED intentionally — the GPU accelerates
// the hidden frame-window canvas renderer (the slowest step of the pipeline).
let mainWindow = null;
let frameWindow = null;
let frameWindowReady = null;

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
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required'
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
    width: 1920,
    height: 1080,
    show: false,
    icon: appIconPath,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false   // Allow loading local file:// paths for images
    }
  });

  frameWindowReady = new Promise((resolve, reject) => {
    frameWindow.webContents.once('did-finish-load', resolve);
    frameWindow.webContents.once('did-fail-load', (_, code, description) => {
      reject(new Error(`Frame renderer failed to load (${code}): ${description}`));
    });
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
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info.version);
  }
});
autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater.', err);
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', progressObj.percent);
  }
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info.version);
  }
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
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

ipcMain.handle('pick-print-promo-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Print Promotion Artwork',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
    properties: ['openFile']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('pick-author-photo', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Author Photo',
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

ipcMain.handle('prepare-cover-image', async (event, filePath) => {
  try {
    const { prepareCoverImage } = require('./src/logoProcessor');
    return await prepareCoverImage(filePath);
  } catch (e) {
    console.error('prepare-cover-image error:', e);
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

ipcMain.handle('open-output-file', async (event, filePath) => {
  if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.mp4') {
    return { success: false, error: 'The completed video path is invalid.' };
  }
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'The completed video could not be found.' };
  }

  const error = await shell.openPath(filePath);
  return error ? { success: false, error } : { success: true };
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

let renderHistory = null;
let renderJob = null;

function sendRenderEvent(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function getRenderHistory() {
  if (!renderHistory) renderHistory = new RenderHistory(path.join(app.getPath('userData'), 'render-history.json'));
  return renderHistory;
}

const notifyRenderComplete = createRenderNotifier({
  Notification,
  getWindow: () => mainWindow,
  icon: appIconPath,
  beep: () => shell.beep(),
  onWarning: message => sendRenderEvent('render-log', `⚠ ${message}`)
});

ipcMain.handle('get-render-info', (_, params) => getRenderHistory().info(params || {}));
ipcMain.handle('set-completion-sound', (_, enabled) => getRenderHistory().setSound(enabled));
ipcMain.handle('preview-render-chime', () => sendRenderEvent('render-chime'));
ipcMain.handle('render-chime-fallback', () => shell.beep());
ipcMain.handle('cancel-render', () => renderJob?.cancel());

ipcMain.handle('start-render', async (event, params) => {
  const { renderVideo } = require('./src/videoEncoder');
  if (!renderJob) renderJob = new RenderJob({
    history: getRenderHistory(), send: sendRenderEvent, notify: notifyRenderComplete
  });
  return renderJob.run({
    ...params,
    appVersion: app.getVersion(),
    audioCacheDir: path.join(app.getPath('userData'), 'audio-cache')
  }, renderVideo, {
    renderFrame: renderFrameInWindow,
    prepareFrameRenderer,
    renderFrameToFile,
    renderOpeningFrameToFile,
    renderTransitionFrameToFile,
    renderPromotionFrameToFile,
    renderPromotionOverlayToFile
  });
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
  await ensureFrameWindowReady();

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

async function ensureFrameWindowReady() {
  if (!frameWindow || frameWindow.isDestroyed()) createFrameWindow();
  await frameWindowReady;
}

async function prepareFrameRenderer(params) {
  await ensureFrameWindowReady();
  return frameWindow.webContents.executeJavaScript(
    `window.setRenderBaseParams(${JSON.stringify(params)})`
  );
}

async function renderFrameToFile(params, outputPath) {
  await ensureFrameWindowReady();
  return frameWindow.webContents.executeJavaScript(
    `window.renderFrameToFile(${JSON.stringify(params)}, ${JSON.stringify(outputPath)})`
  );
}

async function renderOpeningFrameToFile(params, outputPath) {
  await ensureFrameWindowReady();
  return frameWindow.webContents.executeJavaScript(
    `window.renderOpeningFrameToFile(${JSON.stringify(params)}, ${JSON.stringify(outputPath)})`
  );
}

async function renderTransitionFrameToFile(params, outputPath) {
  await ensureFrameWindowReady();
  return frameWindow.webContents.executeJavaScript(
    `window.renderTransitionFrameToFile(${JSON.stringify(params)}, ${JSON.stringify(outputPath)})`
  );
}

async function renderPromotionFrameToFile(params, outputPath) {
  await ensureFrameWindowReady();
  return frameWindow.webContents.executeJavaScript(
    `window.renderPromotionFrameToFile(${JSON.stringify(params)}, ${JSON.stringify(outputPath)})`
  );
}

async function renderPromotionOverlayToFile(params, outputPath) {
  await ensureFrameWindowReady();
  return frameWindow.webContents.executeJavaScript(
    `window.renderPromotionOverlayToFile(${JSON.stringify(params)}, ${JSON.stringify(outputPath)})`
  );
}
