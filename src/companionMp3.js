const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let ffmpegPath = require('ffmpeg-static');
ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

const MP3_BITRATE_KBPS = 128;

function samePath(left, right) {
  if (!left || !right) return false;
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

/**
 * Keep the video, MP3, and chapter marker names together. If the natural MP3
 * name would overwrite the selected source audio, add the bitrate suffix.
 */
function companionMp3Path(videoPath, sourceAudioPath = null) {
  const parsed = path.parse(videoPath);
  const naturalPath = path.join(parsed.dir, `${parsed.name}.mp3`);
  if (!samePath(naturalPath, videoPath) && !samePath(naturalPath, sourceAudioPath)) {
    return naturalPath;
  }
  return path.join(parsed.dir, `${parsed.name}-${MP3_BITRATE_KBPS}kbps.mp3`);
}

function parseProgress(buffer, durationSeconds, onProgress) {
  if (!onProgress || !(durationSeconds > 0)) return;
  for (const match of buffer.matchAll(/out_time_(?:ms|us)=(\d+)/g)) {
    const encodedSeconds = Number(match[1]) / 1000000;
    onProgress(Math.min(100, encodedSeconds / durationSeconds * 100));
  }
}

function runEncoder(args, { durationSeconds, isCancelled, onProgress }) {
  return new Promise((resolve, reject) => {
    if (isCancelled?.()) {
      reject(new Error('RENDER_CANCELLED'));
      return;
    }

    const processHandle = spawn(ffmpegPath, args);
    let stderr = '';
    let progressBuffer = '';
    let cancelRequested = false;
    let settled = false;

    processHandle.stdout.on('data', chunk => {
      const lines = (progressBuffer + chunk.toString()).split(/\r?\n/);
      progressBuffer = lines.pop() || '';
      parseProgress(lines.join('\n'), durationSeconds, onProgress);
    });
    processHandle.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-64000);
    });

    const cancelPoller = isCancelled ? setInterval(() => {
      if (!cancelRequested && isCancelled()) {
        cancelRequested = true;
        processHandle.kill();
      }
    }, 200) : null;

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      if (cancelPoller) clearInterval(cancelPoller);
      if (cancelRequested) reject(new Error('RENDER_CANCELLED'));
      else if (error) reject(error);
      else resolve();
    };

    processHandle.on('close', code => {
      if (code === 0) finish();
      else finish(new Error(`FFmpeg MP3 encoding failed (code ${code}):\n${stderr.slice(-3000)}`));
    });
    processHandle.on('error', finish);
  });
}

/**
 * Encode from the original audiobook source instead of transcoding the final
 * video's AAC track. A temporary file preserves an older successful MP3 if
 * encoding is cancelled or fails.
 */
async function encodeCompanionMp3({
  sourceAudioPath,
  videoOutputPath,
  durationSeconds = 0,
  isCancelled = null,
  onProgress = null
}) {
  const outputPath = companionMp3Path(videoOutputPath, sourceAudioPath);
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath, '.mp3')}.${process.pid}.${Date.now()}.partial.mp3`
  );

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', sourceAudioPath,
    '-map', '0:a:0', '-vn',
    '-c:a', 'libmp3lame', '-b:a', `${MP3_BITRATE_KBPS}k`,
    '-id3v2_version', '3',
    '-progress', 'pipe:1', '-nostats',
    '-y', temporaryPath
  ];

  try {
    await runEncoder(args, { durationSeconds, isCancelled, onProgress });
    if (isCancelled?.()) throw new Error('RENDER_CANCELLED');
    if (!fs.statSync(temporaryPath).size) throw new Error('FFmpeg created an empty MP3 file.');
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    fs.renameSync(temporaryPath, outputPath);
    onProgress?.(100);
    return outputPath;
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch (_) {}
  }
}

module.exports = { MP3_BITRATE_KBPS, companionMp3Path, encodeCompanionMp3 };
