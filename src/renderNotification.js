const path = require('path');

function createRenderNotifier({ Notification, getWindow, icon, beep, onWarning }) {
  const notifications = new Set();
  return (result, soundEnabled) => {
    if (!result.success) return;
    const window = getWindow();
    if (soundEnabled) {
      if (window && !window.isDestroyed()) window.webContents.send('render-chime');
      else beep();
    }
    if (window && !window.isDestroyed() && !window.isFocused()) {
      window.flashFrame(true);
      window.once('focus', () => { if (!window.isDestroyed()) window.flashFrame(false); });
    }
    if (!Notification.isSupported()) return;
    const seconds = Math.round(result.elapsedSeconds);
    const minutes = Math.floor(seconds / 60);
    const duration = minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
    const exportedFiles = result.mp3Path
      ? `${path.basename(result.outputPath)} + ${path.basename(result.mp3Path)}`
      : path.basename(result.outputPath);
    const notification = new Notification({
      title: 'Audiobook exports complete',
      body: `${exportedFiles}\nFinished in ${duration}. Click to return to the app.`,
      icon,
      // The app plays its own chime. Keep the toast silent to avoid a second
      // system sound and ensure the sound preference also silences the toast.
      silent: true
    });
    notifications.add(notification);
    notification.once('close', () => notifications.delete(notification));
    notification.once('failed', (_, error) => {
      notifications.delete(notification);
      onWarning(`Desktop notification could not be shown: ${error}`);
    });
    notification.once('click', () => {
      const currentWindow = getWindow();
      if (currentWindow && !currentWindow.isDestroyed()) {
        if (currentWindow.isMinimized()) currentWindow.restore();
        currentWindow.show();
        currentWindow.focus();
      }
    });
    notification.show();
  };
}

module.exports = { createRenderNotifier };
