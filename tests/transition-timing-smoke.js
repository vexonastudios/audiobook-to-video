const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('@ffprobe-installer/ffprobe').path;
const { renderVideo } = require('../src/renderPipeline');
const { renderVideoLegacy } = require('../src/videoEncoder');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vexona-transition-timing-'));
  try {
    const colors = [[220, 20, 20], [20, 180, 20], [20, 20, 220], [220, 180, 20], [200, 20, 180], [20, 180, 180]];
    const starts = [0, 0.2, 0.4, 2.017, 4.023, 6.01];
    const chapters = starts.map((startTime, i) => ({
      startTime, endTime: starts[i + 1] ?? 8, title: String(i)
    }));
    const fixtures = new Map();
    async function fixture(color) {
      const key = color.join('-');
      if (!fixtures.has(key)) {
        const file = path.join(root, `${key}.png`);
        await sharp({ create: { width: 1920, height: 1080, channels: 3,
          background: { r: color[0], g: color[1], b: color[2] } } }).png().toFile(file);
        fixtures.set(key, { file, dataURL: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` });
      }
      return fixtures.get(key);
    }
    const chapterFiles = await Promise.all(colors.map(fixture));
    const fileColors = new Map();
    const audioPath = path.join(root, 'audio.m4a');
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=8', '-c:a', 'aac', '-y', audioPath]);

    for (const [name, render] of [['optimized', renderVideo], ['legacy', renderVideoLegacy]]) {
      const outputPath = path.join(root, `${name}.mp4`);
      await render({
        wavPath: audioPath, outputPath, chapters, transitionStyle: 'fade', transitionDuration: 1.1,
        printPromoEnabled: false, audioCacheDir: path.join(root, 'cache')
      }, {
        // Keep this regression safe alongside a user's active GPU render.
        encodeParallelism: 1,
        onLog: () => {}, onProgress: () => {}, prepareFrameRenderer: async () => {},
        renderFrameToFile: async ({ chapter }, target) => {
          const index = Number(chapter.title);
          fs.copyFileSync(chapterFiles[index].file, target);
          fileColors.set(target, colors[index]);
        },
        renderTransitionFrameToFile: async ({ fromPath, toPath, alpha }, target) => {
          const color = alpha < 0.5 ? fileColors.get(fromPath) : fileColors.get(toPath);
          const visible = Math.abs(1 - 2 * alpha);
          fs.copyFileSync((await fixture(color.map(c => Math.round(c * visible)))).file, target);
        },
        renderFrame: async ({ chapter, fadeAlpha = 1 }) =>
          (await fixture(colors[Number(chapter.title)].map(c => Math.round(c * fadeAlpha)))).dataURL
      });
      const meta = JSON.parse(run(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=nb_read_frames,duration', '-of', 'json', outputPath])).streams[0];
      assert.equal(Number(meta.nb_read_frames), 240, `${name}: duration drift`);
      assert.ok(Math.abs(Number(meta.duration) - 8) < 1 / 30, `${name}: video duration`);

      const checks = [
        ...starts.slice(1).map(time => ({ time: Math.round(time * 30) / 30, color: [0, 0, 0] })),
        { time: 0, color: colors[0] }, { time: 1.2, color: colors[2] },
        { time: 3, color: colors[3] }, { time: 5, color: colors[4] }, { time: 7.5, color: colors[5] }
      ];
      for (const { time, color } of checks) {
        const screenshot = path.join(root, 'sample.png');
        run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', outputPath, '-frames:v', '1', '-y', screenshot]);
        const pixel = await sharp(screenshot).extract({ left: 960, top: 540, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
        assert.ok(color.every((c, i) => Math.abs(c - pixel[i]) <= 10),
          `${name}: at ${time}s expected ${color}, got ${Array.from(pixel)}`);
      }
      console.log(`${name}: fade midpoints match all ${starts.length - 1} chapter markers; 240 frames, no drift.`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
