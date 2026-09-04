const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { renderVideo } = require('../src/renderPipeline');
const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `${path.basename(command)} failed`);
  return result.stdout;
}

function probe(filePath) {
  return JSON.parse(run(ffprobePath, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,nb_read_frames,r_frame_rate,avg_frame_rate,time_base,duration_ts',
    '-of', 'json', filePath
  ]));
}

async function runScenario({
  name, root, stillPath, wavPath, introPath, introStyle, expectedDuration,
  transitionStyle, codec = 'h264', expectedAudioCodec = 'aac'
}) {
  const outputPath = path.join(root, `${name}.mp4`);
  await renderVideo({
    coverDataURL: 'smoke-test-fixture',
    wavPath,
    outputPath,
    chapters: [
      { startTime: 0, endTime: 3, number: 1, title: 'One', isNumbered: true },
      { startTime: 3, endTime: 6, number: 2, title: 'Two', isNumbered: true }
    ],
    blurAmount: 10,
    bgOpacity: 0.6,
    accentColor: [211, 193, 166],
    transitionStyle,
    transitionDuration: 1,
    introClipPath: introStyle ? introPath : null,
    introAudioEnabled: true,
    introStyle: introStyle || 'push',
    introFadeDuration: 1,
    codec,
    fastAudioCopy: true,
    audioCacheDir: path.join(root, 'audio-cache')
  }, {
    onProgress: () => {},
    onLog: () => {},
    prepareFrameRenderer: async () => true,
    renderFrameToFile: async (_, targetPath) => fs.copyFileSync(stillPath, targetPath),
    renderTransitionFrameToFile: async (_, targetPath) => fs.copyFileSync(stillPath, targetPath),
    renderPromotionFrameToFile: async (_, targetPath) => fs.copyFileSync(stillPath, targetPath),
    isCancelled: () => false
  });

  const metadata = probe(outputPath);
  const duration = Number(metadata.format.duration);
  const video = metadata.streams.find(stream => stream.codec_type === 'video');
  const audio = metadata.streams.find(stream => stream.codec_type === 'audio');
  if (!video || !audio) throw new Error(`${name}: expected both video and audio streams`);
  if (video.width !== 1920 || video.height !== 1080) throw new Error(`${name}: expected a 1920x1080 video`);
  if (video.time_base !== '1/3000') {
    throw new Error(`${name}: expected decoder-safe 1/3000 video time base, got ${video.time_base}`);
  }
  if (video.r_frame_rate !== '30/1' || video.avg_frame_rate !== '30/1') {
    throw new Error(`${name}: expected genuine constant 30fps video, got nominal ${video.r_frame_rate} / average ${video.avg_frame_rate}`);
  }
  const expectedVideoCodec = codec === 'h265' ? 'hevc' : 'h264';
  if (video.codec_name !== expectedVideoCodec) {
    throw new Error(`${name}: expected ${expectedVideoCodec} video, got ${video.codec_name}`);
  }
  if (audio.codec_name !== expectedAudioCodec) {
    throw new Error(`${name}: expected ${expectedAudioCodec} audio, got ${audio.codec_name}`);
  }
  if (Math.abs(duration - expectedDuration) > 0.1) {
    throw new Error(`${name}: duration ${duration}s differs from expected ${expectedDuration}s`);
  }
  const frameCount = Number(video.nb_read_frames);
  const expectedFrames = Math.round(expectedDuration * 30);
  if (Math.abs(frameCount - expectedFrames) > 2) {
    throw new Error(`${name}: expected about ${expectedFrames} actual frames, got ${frameCount}`);
  }
  run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-f', 'null', nullOutput]);
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(expectedDuration * 0.75),
    '-i', outputPath, '-frames:v', '1', '-f', 'null', nullOutput
  ]);
  return { name, duration, frames: frameCount };
}

async function main() {
  const root = path.join(os.tmpdir(), `vexona-pipeline-smoke-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    const stillPath = path.join(root, 'still.png');
    const wavPath = path.join(root, 'audio.wav');
    const mp3Path = path.join(root, 'audio.mp3');
    const introPath = path.join(root, 'intro.mp4');
    await sharp(path.resolve(__dirname, '..', 'logo-audiobook-generator.png'))
      .resize(1920, 1080, { fit: 'contain', background: '#201810' })
      .png()
      .toFile(stillPath);

    run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6',
      '-c:a', 'pcm_s16le', '-y', wavPath
    ]);
    run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=44100:duration=6',
      '-c:a', 'libmp3lame', '-b:a', '192k', '-y', mp3Path
    ]);
    run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x204080:s=1920x1080:r=30:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-y', introPath
    ]);

    const results = [];
    results.push(await runScenario({
      name: 'transition', root, stillPath, wavPath, introPath,
      introStyle: null, expectedDuration: 6, transitionStyle: 'fade'
    }));
    results.push(await runScenario({
      name: 'sequential-intro', root, stillPath, wavPath, introPath,
      introStyle: 'push', expectedDuration: 8, transitionStyle: 'cut'
    }));
    results.push(await runScenario({
      name: 'overlap-intro', root, stillPath, wavPath, introPath,
      introStyle: 'overlap', expectedDuration: 7, transitionStyle: 'cut'
    }));
    results.push(await runScenario({
      name: 'h265', root, stillPath, wavPath, introPath,
      introStyle: null, expectedDuration: 6, transitionStyle: 'cut', codec: 'h265'
    }));
    results.push(await runScenario({
      name: 'mp3-copy', root, stillPath, wavPath: mp3Path, introPath,
      introStyle: null, expectedDuration: 6, transitionStyle: 'cut', expectedAudioCodec: 'mp3'
    }));

    let cancellationObserved = false;
    try {
      await renderVideo({
        coverDataURL: 'smoke-test-fixture', wavPath,
        outputPath: path.join(root, 'cancelled.mp4'),
        chapters: [{ startTime: 0, endTime: 6, title: 'Cancelled' }],
        blurAmount: 10, bgOpacity: 0.6, accentColor: [211, 193, 166],
        transitionStyle: 'cut', audioCacheDir: path.join(root, 'audio-cache')
      }, {
        onProgress: () => {}, onLog: () => {},
        prepareFrameRenderer: async () => true,
        renderFrameToFile: async (_, targetPath) => fs.copyFileSync(stillPath, targetPath),
        renderTransitionFrameToFile: async () => {},
        renderPromotionFrameToFile: async () => {},
        isCancelled: () => true
      });
    } catch (error) {
      cancellationObserved = error.message === 'RENDER_CANCELLED';
    }
    if (!cancellationObserved) throw new Error('Render cancellation did not propagate as RENDER_CANCELLED.');

    console.log(`Render pipeline smoke tests passed: ${JSON.stringify(results)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
