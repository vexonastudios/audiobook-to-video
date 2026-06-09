const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (e, version) => callback(version)),

  // File dialogs
  pickCover: () => ipcRenderer.invoke('pick-cover'),
  pickBackground: () => ipcRenderer.invoke('pick-background'),
  pickWav: () => ipcRenderer.invoke('pick-wav'),
  pickLogo: () => ipcRenderer.invoke('pick-logo'),
  pickIntroClip: () => ipcRenderer.invoke('pick-intro-clip'),
  pickOutput: (name) => ipcRenderer.invoke('pick-output', name),
  pickChaptersFile: () => ipcRenderer.invoke('pick-chapters-file'),

  // Project persistence
  saveProjectFile: (data) => ipcRenderer.invoke('save-project-file', data),
  loadProjectFile: () => ipcRenderer.invoke('load-project-file'),
  pickSrtFile: () => ipcRenderer.invoke('pick-srt-file'),
  cancelRender: () => ipcRenderer.invoke('cancel-render'),
  writeTextFile: (opts) => ipcRenderer.invoke('write-text-file', opts),

  // Image utilities
  imageToDataURL: (filePath) => ipcRenderer.invoke('image-to-dataurl', filePath),
  extractColor: (imagePath) => ipcRenderer.invoke('extract-color', imagePath),
  processLogo: (opts) => ipcRenderer.invoke('process-logo', opts),

  // Audio / Video
  getAudioDuration: (wavPath) => ipcRenderer.invoke('get-audio-duration', wavPath),
  getVideoDuration: (videoPath) => ipcRenderer.invoke('get-video-duration', videoPath),

  // GPU info
  getGpuName: () => ipcRenderer.invoke('get-gpu-name'),

  // Rendering
  renderPreview: (params) => ipcRenderer.invoke('render-preview', params),
  startRender: (params) => ipcRenderer.invoke('start-render', params),

  // Events from main process
  onRenderProgress: (cb) => ipcRenderer.on('render-progress', (_, data) => cb(data)),
  onRenderLog: (cb) => ipcRenderer.on('render-log', (_, msg) => cb(msg)),
  onRenderComplete: (cb) => ipcRenderer.on('render-complete', (_, result) => cb(result)),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
