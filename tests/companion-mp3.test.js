const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const {
  MP3_BITRATE_KBPS,
  companionMp3Path,
  encodeCompanionMp3
} = require('../src/companionMp3');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

test('uses the video basename without ever overwriting the selected source audio', () => {
  const videoPath = path.join('C:', 'exports', 'Brazil.mp4');
  assert.equal(companionMp3Path(videoPath), path.join('C:', 'exports', 'Brazil.mp3'));
  assert.equal(
    companionMp3Path(videoPath, path.join('C:', 'exports', 'Brazil.mp3')),
    path.join('C:', 'exports', `Brazil-${MP3_BITRATE_KBPS}kbps.mp3`)
  );
});

test('encodes a valid 128 kbps MP3 from the original audiobook source', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-mp3-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceAudioPath = path.join(root, 'source-audio.m4a');
  const videoOutputPath = path.join(root, 'finished-video.mp4');
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.2',
    '-c:a', 'aac', '-b:a', '192k', '-y', sourceAudioPath
  ]);

  const progress = [];
  const outputPath = await encodeCompanionMp3({
    sourceAudioPath,
    videoOutputPath,
    durationSeconds: 2.2,
    onProgress: percent => progress.push(percent)
  });

  assert.equal(outputPath, path.join(root, 'finished-video.mp3'));
  assert.ok(fs.statSync(outputPath).size > 1000);
  assert.equal(progress.at(-1), 100);
  const metadata = JSON.parse(run(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,bit_rate',
    '-of', 'json', outputPath
  ]));
  const audio = metadata.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(audio.codec_name, 'mp3');
  assert.ok(Number(audio.bit_rate) >= 127000 && Number(audio.bit_rate) <= 129000,
    `Expected a 128 kbps audio stream, got ${audio.bit_rate}`);
  assert.ok(Math.abs(Number(metadata.format.duration) - 2.2) < 0.15);
  const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
  run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-f', 'null', nullOutput]);
});

test('honors cancellation before encoding and leaves no partial export', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-mp3-cancel-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceAudioPath = path.join(root, 'source.wav');
  const videoOutputPath = path.join(root, 'cancelled.mp4');
  await assert.rejects(
    encodeCompanionMp3({ sourceAudioPath, videoOutputPath, isCancelled: () => true }),
    /RENDER_CANCELLED/
  );
  assert.deepEqual(fs.readdirSync(root), []);
});
