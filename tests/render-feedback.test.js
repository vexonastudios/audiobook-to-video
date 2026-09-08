const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { RenderHistory, videoDuration } = require('../src/renderHistory');
const { RenderJob } = require('../src/renderJob');
const { createRenderNotifier } = require('../src/renderNotification');

const params = {
  wavPath: 'book.mp3', outputPath: 'Brazil.mp4', codec: 'h264',
  chapters: [{ startTime: 0, endTime: 21600 }], transitionStyle: 'cut'
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-feedback-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'render-history.json');
  const history = new RenderHistory(filePath);
  const events = [];
  const alerts = [];
  let milliseconds = 0;
  const job = new RenderJob({ history, send: (...args) => events.push(args),
    notify: (...args) => alerts.push(args), now: () => milliseconds });
  return { history, filePath, events, alerts, job, setTime: seconds => { milliseconds = seconds * 1000; } };
}

async function successfulRender(f) {
  return f.job.run(params, async (_, cb) => {
    cb.onProfile({ encoder: 'h264_nvenc' });
    f.setTime(30);
    cb.onProgress({ percent: 33 });
    f.setTime(1400);
    cb.onProgress({ percent: 60 });
    f.setTime(1600);
    cb.onProgress({ percent: 100, phase: 'done' });
    f.setTime(1680); // Cleanup remains part of the completed job's elapsed time.
    return { durationSeconds: 21600, mp3Path: 'Brazil.mp3' };
  }, {});
}

test('saves exact successful timing across restart and scales the next comparable video', async t => {
  const f = fixture(t);
  assert.equal(f.history.info(params).estimatedSeconds, null);
  const result = await successfulRender(f);
  assert.equal(result.elapsedSeconds, 1680);
  assert.equal(result.mp3Path, 'Brazil.mp3');
  assert.equal(result.record.mp3Path, 'Brazil.mp3');
  assert.equal(f.alerts.length, 1);
  assert.equal(f.alerts[0][1], true);
  assert.equal(f.events.filter(([event]) => event === 'render-complete').length, 1);
  const restarted = new RenderHistory(f.filePath);
  assert.equal(restarted.info(params).lastRender.elapsedSeconds, 1680);
  assert.equal(restarted.estimate({ ...params, chapters: [{ endTime: 10800 }] }).seconds, 840);
  assert.equal(restarted.estimate({ ...params, codec: 'h265' }), null);
  assert.equal(restarted.estimate({ ...params, forceLegacyRender: true }), null);
  assert.equal(restarted.estimate(params, 'libx264'), null);
  assert.equal(restarted.estimate({ ...params, openingTitlesEnabled: true }), null);
});

test('remaining time uses historical time checkpoints instead of treating the percent as time', async t => {
  const f = fixture(t);
  await successfulRender(f);
  f.events.length = 0;
  f.setTime(0);
  await f.job.run(params, async (_, cb) => {
    cb.onProfile({ encoder: 'h264_nvenc' });
    f.setTime(700);
    cb.onProgress({ percent: 60 });
    const timing = f.events.filter(([event]) => event === 'render-timing').at(-1)[1];
    // The last render had only 280s remaining at this checkpoint. This job
    // reached it in half the time, so predict 140s, not 40% of the total.
    assert.equal(timing.remainingSeconds, 140);
    f.setTime(840);
    return { durationSeconds: 21600 };
  }, {});
});

test('CPU fallback discards a GPU estimate and muted preference survives restart', async t => {
  const f = fixture(t);
  await successfulRender(f);
  f.history.setSound(false);
  assert.equal(new RenderHistory(f.filePath).settings.completionSound, false);
  f.setTime(0);
  await f.job.run(params, async (_, cb) => {
    cb.onProfile({ encoder: 'libx264' });
    const timing = f.events.filter(([event]) => event === 'render-timing').at(-1)[1];
    assert.equal(timing.remainingSeconds, null);
    f.setTime(3000);
    return { durationSeconds: 21600 };
  }, {});
  assert.equal(f.alerts.at(-1)[1], false);
});

test('failures and cancellations retain successful history and never alert', async t => {
  const f = fixture(t);
  await successfulRender(f);
  const persisted = fs.readFileSync(f.filePath, 'utf8');
  f.alerts.length = 0;
  const failed = await f.job.run(params, async () => { throw new Error('Encoder failed'); }, {});
  assert.equal(failed.success, false);
  assert.equal(failed.error, 'Encoder failed');
  const cancelled = await f.job.run(params, async (_, cb) => {
    f.job.cancel();
    assert.equal(cb.isCancelled(), true);
    return { durationSeconds: 21600 };
  }, {});
  assert.equal(cancelled.cancelled, true);
  assert.equal(f.alerts.length, 0);
  assert.equal(fs.readFileSync(f.filePath, 'utf8'), persisted);
  assert.equal(f.job.active, false);
});

test('duplicate starts are rejected without interrupting the active render', async t => {
  const f = fixture(t);
  let release;
  const first = f.job.run(params, async (_, cb) => {
    cb.onProfile({ encoder: 'h264_nvenc' });
    await new Promise(resolve => { release = resolve; });
    f.setTime(1);
    return { durationSeconds: 21600 };
  }, {});
  await assert.rejects(f.job.run(params, () => {}, {}), /already running/);
  assert.equal(f.job.active, true);
  release();
  assert.equal((await first).success, true);
});

test('failure to save timing or send notifications does not turn an exported video into failure', async t => {
  const f = fixture(t);
  f.history.add = () => { throw new Error('Read-only disk'); };
  f.job.notify = () => { throw new Error('No notification service'); };
  const result = await successfulRender(f);
  assert.equal(result.success, true);
  assert.equal(result.historySaved, false);
  assert.equal(f.events.filter(([event]) => event === 'render-complete').length, 1);
});

test('history is bounded, damaged history is tolerated, and intro duration is included', async t => {
  const f = fixture(t);
  await successfulRender(f);
  const record = f.history.records[0];
  for (let i = 0; i < 55; i++) f.history.add({ ...record, outputPath: `book-${i}.mp4` });
  const restarted = new RenderHistory(f.filePath);
  assert.equal(restarted.records.length, 50);
  assert.equal(restarted.info(params).lastRender.outputPath, 'book-54.mp4');
  fs.writeFileSync(f.filePath, '{truncated');
  assert.equal(new RenderHistory(f.filePath).info(params).lastRender, null);
  assert.equal(videoDuration({ ...params, introClipPath: 'intro.mp4', introDurationRaw: 10 }), 21610);
  assert.equal(videoDuration({ ...params, introClipPath: 'intro.mp4', introDurationRaw: 10,
    introStyle: 'overlap', introFadeDuration: 2 }), 21608);
});

test('success plays one chime, sends a silent toast, and restores the app when clicked', () => {
  const notifications = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.shown = true; }
  }
  const calls = [];
  const window = {
    isDestroyed: () => false, isFocused: () => false, isMinimized: () => true,
    webContents: { send: event => calls.push(event) }, flashFrame: () => {}, once: () => {},
    restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus')
  };
  const notify = createRenderNotifier({ Notification, getWindow: () => window, beep: () => {}, onWarning: () => {} });
  const result = { success: true, outputPath: 'Brazil.mp4', mp3Path: 'Brazil.mp3', elapsedSeconds: 1680 };
  notify(result, true);
  assert.deepEqual(calls, ['render-chime']);
  assert.equal(notifications[0].shown, true);
  assert.equal(notifications[0].options.silent, true);
  assert.match(notifications[0].options.body, /28m 0s/);
  assert.match(notifications[0].options.body, /Brazil\.mp4 \+ Brazil\.mp3/);
  notifications[0].emit('click');
  assert.deepEqual(calls.slice(1), ['restore', 'show', 'focus']);
  calls.length = 0;
  notify(result, false);
  assert.deepEqual(calls, []);
  assert.equal(notifications.length, 2);
  notify({ success: false }, true);
  assert.equal(notifications.length, 2);
});
