const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { renderVideo } = require('../src/renderPipeline');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `${path.basename(command)} failed`);
  return result.stdout;
}

function assertColor(actual, expected, timestamp) {
  const distance = Math.max(
    Math.abs(actual.r - expected.r),
    Math.abs(actual.g - expected.g),
    Math.abs(actual.b - expected.b)
  );
  if (distance > 8) {
    throw new Error(`${timestamp}s seek returned rgb(${actual.r}, ${actual.g}, ${actual.b}); expected ${JSON.stringify(expected)}`);
  }
}

async function main() {
  const root = path.join(os.tmpdir(), `vexona-timeline-seek-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  const colors = [
    { name: 'front-matter', rgb: { r: 220, g: 20, b: 20 } },
    { name: 'introduction', rgb: { r: 20, g: 180, b: 20 } },
    { name: 'chapter-1', rgb: { r: 20, g: 20, b: 220 } },
    { name: 'chapter-2', rgb: { r: 220, g: 180, b: 20 } }
  ];
  const starts = [0, 1, 4, 34];
  const totalDuration = 40;

  try {
    const framePaths = new Map();
    for (const color of colors) {
      const framePath = path.join(root, `${color.name}.png`);
      await sharp({ create: { width: 1920, height: 1080, channels: 3, background: color.rgb } })
        .png()
        .toFile(framePath);
      framePaths.set(color.name, framePath);
    }
    const promotionPath = path.join(root, 'promotion.png');
    await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 200, g: 20, b: 180 } } })
      .png()
      .toFile(promotionPath);

    const audioPath = path.join(root, 'audio.m4a');
    run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `anullsrc=r=8000:cl=mono:d=${totalDuration}`,
      '-c:a', 'aac', '-b:a', '16k', '-y', audioPath
    ]);

    const chapters = colors.map((color, index) => ({
      startTime: starts[index],
      endTime: index + 1 < starts.length ? starts[index + 1] : totalDuration,
      number: index,
      title: color.name,
      isNumbered: true
    }));
    const outputPath = path.join(root, 'timeline.mp4');
    await renderVideo({
      coverDataURL: 'seek-smoke', audioCacheDir: path.join(root, 'cache'),
      wavPath: audioPath, outputPath, chapters,
      blurAmount: 0, bgOpacity: 1, accentColor: [255, 255, 255],
      transitionStyle: 'cut', codec: 'h264', fastAudioCopy: true
    }, {
      onProgress: () => {}, onLog: () => {},
      prepareFrameRenderer: async () => true,
      renderFrameToFile: async ({ chapter }, targetPath) => {
        fs.copyFileSync(framePaths.get(chapter.title), targetPath);
      },
      renderTransitionFrameToFile: async () => {},
      renderPromotionFrameToFile: async (_, targetPath) => fs.copyFileSync(promotionPath, targetPath),
      isCancelled: () => false
    });

    const checkpoints = [
      { timestamp: 0.5, expected: colors[0].rgb },
      { timestamp: 2, expected: colors[1].rgb },
      { timestamp: 5, expected: colors[2].rgb },
      { timestamp: 19, expected: colors[2].rgb },
      { timestamp: 29, expected: colors[2].rgb },
      { timestamp: 31, expected: { r: 200, g: 20, b: 180 } },
      { timestamp: 35, expected: { r: 200, g: 20, b: 180 } },
      { timestamp: 37, expected: { r: 200, g: 20, b: 180 } },
      { timestamp: 39, expected: colors[3].rgb }
    ];
    for (const checkpoint of checkpoints) {
      const screenshotPath = path.join(root, `at-${checkpoint.timestamp}.png`);
      run(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-ss', String(checkpoint.timestamp),
        '-i', outputPath, '-frames:v', '1', '-y', screenshotPath
      ]);
      const { data } = await sharp(screenshotPath)
        .extract({ left: 960, top: 540, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      assertColor({ r: data[0], g: data[1], b: data[2] }, checkpoint.expected, checkpoint.timestamp);
    }

    const frameCount = Number(run(ffprobePath, [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', outputPath
    ]).trim());
    if (frameCount < totalDuration - 2) {
      throw new Error(`Expected periodic hold samples, but only found ${frameCount} video frames.`);
    }

    console.log(`Timeline seek smoke test passed: ${checkpoints.length} seeks, ${frameCount} frames`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
