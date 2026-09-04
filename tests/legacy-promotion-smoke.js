const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { imageToDataURL } = require('../src/logoProcessor');
const { renderVideoLegacy } = require('../src/videoEncoder');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `${path.basename(command)} failed`);
  return result.stdout;
}

async function runTest() {
  const projectRoot = path.resolve(__dirname, '..');
  const root = path.join(os.tmpdir(), `vexona-legacy-promo-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  const frameWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: true, webSecurity: false }
  });

  try {
    await frameWindow.loadFile(path.join(projectRoot, 'frame-window', 'index.html'));
    const fixturePath = path.join(projectRoot, 'logo-audiobook-generator.png');
    const coverDataURL = await imageToDataURL(fixturePath);
    const audioPath = path.join(root, 'audio.mp3');
    const outputPath = path.join(root, 'legacy-promotion.mp4');
    run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6',
      '-c:a', 'libmp3lame', '-b:a', '128k', '-y', audioPath
    ]);

    const execute = expression => frameWindow.webContents.executeJavaScript(expression);
    let openingFramesRendered = 0;
    await renderVideoLegacy({
      coverDataURL,
      bgDataURL: coverDataURL,
      wavPath: audioPath,
      outputPath,
      chapters: [{ startTime: 0, endTime: 6, number: 1, title: 'Legacy Promotion Test', isNumbered: true }],
      blurAmount: 20,
      bgOpacity: 0.65,
      accentColor: [211, 193, 166],
      transitionStyle: 'cut',
      codec: 'h264',
      fastAudioCopy: true,
      openingTitlesEnabled: true,
      openingTitles: { title: 'Legacy Opening Test' },
      printPromoEnabled: true,
      printPromoStart: 1,
      printPromoDuration: 2
    }, {
      onProgress: () => {},
      onLog: () => {},
      renderFrame: params => execute(`(async()=>{await window.renderFrame(${JSON.stringify(params)});return document.getElementById('mainCanvas').toDataURL('image/png')})()`),
      renderOpeningFrameToFile: (params, targetPath) => {
        openingFramesRendered++;
        return execute(`window.renderOpeningFrameToFile(${JSON.stringify(params)}, ${JSON.stringify(targetPath)})`);
      },
      renderPromotionOverlayToFile: (params, targetPath) => execute(
        `window.renderPromotionOverlayToFile(${JSON.stringify(params)}, ${JSON.stringify(targetPath)})`
      ),
      isCancelled: () => false
    });

    const metadata = JSON.parse(run(ffprobePath, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,time_base', '-of', 'json', outputPath
    ]));
    const duration = Number(metadata.format.duration);
    if (Math.abs(duration - 6) > 0.1) throw new Error(`Legacy promotion output duration was ${duration}s`);
    const video = metadata.streams.find(stream => stream.codec_type === 'video');
    if (!video || video.time_base !== '1/3000') {
      throw new Error(`Legacy output expected decoder-safe 1/3000 video time base, got ${video?.time_base || 'none'}`);
    }
    if (openingFramesRendered !== 90) {
      throw new Error(`Legacy opening titles expected 90 rendered frames, got ${openingFramesRendered}`);
    }

    const beforePath = path.join(root, 'before.png');
    const duringPath = path.join(root, 'during.png');
    run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', outputPath, '-frames:v', '1', '-y', beforePath]);
    run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '2', '-i', outputPath, '-frames:v', '1', '-y', duringPath]);
    const before = await sharp(beforePath).raw().toBuffer();
    const during = await sharp(duringPath).raw().toBuffer();
    let changedBytes = 0;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs(before[i] - during[i]) > 10) changedBytes++;
    }
    if (changedBytes < 10000) throw new Error('Compatibility promotion overlay was not visible during its scheduled interval.');

    console.log(`Legacy promotion smoke test passed: ${duration.toFixed(3)}s, ${changedBytes} changed bytes`);
  } finally {
    if (!frameWindow.isDestroyed()) frameWindow.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

app.whenReady()
  .then(runTest)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
