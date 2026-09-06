const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolvePrintPromotionSchedule, buildPrintPromotionOverlayFilter } = require('../src/printPromotion');
const { renderPrintPromotionTimeline } = require('../src/renderPipeline');

test('keeps the 0:30 appearance and adds length-dependent repeats with bounded randomness', () => {
  assert.deepEqual(resolvePrintPromotionSchedule(31), []);
  assert.deepEqual(resolvePrintPromotionSchedule(35), [{ start: 30, duration: 4 }]);
  for (const length of [40, 3600, 7199, 7200]) {
    assert.deepEqual(resolvePrintPromotionSchedule(length), [{ start: 30, duration: 8 }]);
  }
  for (const length of [7201, 9000, 14400, 21600, 36000]) {
    for (let book = 0; book < 50; book++) {
      const plan = resolvePrintPromotionSchedule(length, 30, 8, `book-${book}`);
      assert.equal(plan.length, Math.ceil(length / 7200));
      assert.deepEqual(plan[0], { start: 30, duration: 8 });
      for (let i = 1; i < plan.length; i++) {
        assert.ok(Math.abs(plan[i].start - i * 7200) <= 600);
        assert.equal(plan[i].duration, 8);
        assert.ok(plan[i].start + 8 <= length - 60);
        assert.ok(plan[i].start - plan[i - 1].start >= 6000);
        assert.ok(Math.abs(plan[i].start * 30 - Math.round(plan[i].start * 30)) < 1e-7);
      }
    }
  }
  const first = resolvePrintPromotionSchedule(21600, 30, 8, 'book-a');
  assert.deepEqual(first, resolvePrintPromotionSchedule(21600, 30, 8, 'book-a'));
  assert.notDeepEqual(first, resolvePrintPromotionSchedule(21600, 30, 8, 'book-b'));
  assert.deepEqual(resolvePrintPromotionSchedule(NaN), []);
});

test('optimized repeats replace only their scheduled time and follow the current chapter', async () => {
  const total = 21600;
  const schedule = resolvePrintPromotionSchedule(total, 30, 8, 'book-a');
  const boundaries = [0, schedule[1].start + 4, schedule[2].start - 2, total];
  const entries = boundaries.slice(0, -1).map((start, i) => ({
    path: `chapter-${i}.png`, kind: 'still', duration: boundaries[i + 1] - start
  }));
  const rendered = new Map();
  const progress = [];
  const result = await renderPrintPromotionTimeline({
    entries, schedule, outputDir: 'promotion-fixtures',
    renderPromotionFrameToFile: async (params, target) => {
      assert.ok(!rendered.has(target), 'A repeat must not overwrite an earlier promotion image');
      rendered.set(target, params);
    },
    isCancelled: () => false, onLog: () => {}, onProgress: value => progress.push(value)
  });
  assert.ok(Math.abs(result.reduce((sum, entry) => sum + entry.duration, 0) - total) < 1e-6);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]));
  let cursor = 0;
  for (const entry of result) {
    assert.ok(entry.duration > 0);
    const midpoint = cursor + entry.duration / 2;
    const appearance = schedule.find(t => midpoint >= t.start && midpoint < t.start + t.duration);
    assert.equal(entry.kind === 'promotion', !!appearance);
    const chapterIndex = boundaries.findIndex((b, i) => i < entries.length && midpoint >= b && midpoint < boundaries[i + 1]);
    assert.equal(entry.kind === 'promotion' ? rendered.get(entry.path).basePath : entry.path, `chapter-${chapterIndex}.png`);
    cursor += entry.duration;
  }
  assert.ok(rendered.size > schedule.length);
  await assert.rejects(renderPrintPromotionTimeline({
    entries, schedule, isCancelled: () => true
  }), /RENDER_CANCELLED/);
});

test('Compatibility Mode shows and removes multiple faded promotions in one FFmpeg pass', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vexona-repeated-promotion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'repeated.mp4');
  const schedule = [1, 5, 9].map(start => ({ start, duration: 2 }));
  const ffmpeg = require('ffmpeg-static');
  const ffprobe = require('@ffprobe-installer/ffprobe').path;
  function run(command, args, encoding = 'utf8') {
    const result = spawnSync(command, args, { encoding, timeout: 30000 });
    assert.equal(result.status, 0, String(result.stderr));
    return result.stdout;
  }
  run(ffmpeg, ['-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=12',
    ...schedule.flatMap(() => ['-f', 'lavfi', '-i', 'color=c=magenta:s=80x60:r=30:d=2']),
    '-filter_complex', buildPrintPromotionOverlayFilter(schedule),
    '-map', '[vout]', '-frames:v', '360', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-an', '-y', output]);
  const meta = JSON.parse(run(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames,duration', '-of', 'json', output])).streams[0];
  assert.equal(Number(meta.nb_read_frames), 360);
  assert.equal(Number(meta.duration), 12);
  for (const time of [0.5, 1.3, 2, 4, 6, 8, 10, 11.5]) {
    const pixel = run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1',
      '-vf', 'crop=2:2:10:10,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], null);
    if ([2, 6, 10].includes(time)) assert.ok(pixel[0] > 220, `Missing promotion at ${time}s`);
    else if (time === 1.3) assert.ok(pixel[0] > 20 && pixel[0] < 210, 'Promotion should fade in');
    else assert.ok(pixel[0] < 20, `Promotion still visible at ${time}s`);
    assert.ok(pixel[2] > 220);
  }
});
