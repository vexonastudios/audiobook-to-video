const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RenderHistory } = require('../src/renderHistory');
const { RenderJob } = require('../src/renderJob');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-feedback-ui-'));
app.setPath('userData', root);
const projectRoot = path.resolve(__dirname, '..');

async function runTest() {
  const history = new RenderHistory(path.join(root, 'history.json'));
  let clock = 0;
  let mode = 'success';
  let release;
  let alerts = 0;
  let fallbackBeeps = 0;
  const window = new BrowserWindow({
    width: 1400, height: 1000, show: false,
    webPreferences: { preload: path.join(projectRoot, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required', offscreen: true }
  });
  // Exercise the real audio engine without sounding repeated test alerts.
  window.webContents.setAudioMuted(true);
  const send = (channel, data) => window.webContents.send(channel, data);
  const job = new RenderJob({ history, send, now: () => clock,
    notify: (_, enabled) => { alerts++; if (enabled) send('render-chime'); } });
  const handlers = {
    'get-gpu-name': () => 'Test GPU',
    'get-render-info': (_, params) => history.info(params),
    'set-completion-sound': (_, enabled) => history.setSound(enabled),
    'preview-render-chime': () => send('render-chime'),
    'render-chime-fallback': () => { fallbackBeeps++; },
    'write-text-file': () => true,
    'cancel-render': () => job.cancel(),
    'start-render': (_, params) => {
      clock = 0;
      return job.run(params, async (p, cb) => {
        cb.onProfile({ encoder: 'h264_nvenc' });
        clock = 30000;
        cb.onProgress({ percent: 33, phase: 'encoding', label: 'Encoding visual timeline…' });
        clock = mode === 'hold' ? 700000 : 1400000;
        cb.onProgress({ percent: 60, phase: 'encoding', label: 'Writing final MP4…' });
        if (mode === 'hold' || mode === 'cancel') await new Promise(resolve => { release = resolve; });
        if (mode === 'fail') throw new Error('Test encoder failure');
        if (cb.isCancelled()) throw new Error('RENDER_CANCELLED');
        clock = 1680000;
        return { durationSeconds: p.chapters.at(-1).endTime };
      }, {});
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(name, handler);
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function waitFor(expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  }
  async function prepareBook(seconds = 21600) {
    await evaluate(`Object.assign(state, {
      coverPath: 'cover.png', wavPath: 'book.mp3', outputPath: 'Timing Test Brazil.mp4',
      audioDuration: ${seconds}, transitionStyle: 'cut',
      chapters: [{ startTime: 0, endTime: ${seconds}, timecode: '0:00', title: 'Introduction', isNumbered: false }]
    }); checkExportReady();`);
  }
  try {
    await window.loadFile(path.join(projectRoot, 'renderer', 'index.html'));
    await waitFor(`!document.getElementById('completion-sound-toggle').disabled`);
    assert.match(await evaluate(`document.getElementById('render-estimate').textContent`), /after a successful render/);
    await evaluate(`window.chimeContexts = []; window.chimeNotes = [];
      const OriginalAudioContext = window.AudioContext;
      window.AudioContext = class extends OriginalAudioContext {
        constructor(...args) { super(...args); window.chimeContexts.push(this); }
        createOscillator() { const node = super.createOscillator(); window.chimeNotes.push(node); return node; }
      }; void 0;`);
    await prepareBook();
    await evaluate('beginRender()');
    await waitFor('window.chimeNotes.length === 3');
    assert.deepEqual(await evaluate('window.chimeNotes.map(node => node.frequency.value)'), [523.25, 659.25, 783.989990234375]);
    assert.equal(await evaluate(`document.getElementById('render-elapsed').textContent`), 'Completed in: 28m 0s');
    await waitFor(`document.getElementById('last-render-time').textContent.includes('28m 0s')`);
    assert.equal(alerts, 1);
    await prepareBook(10800);
    await waitFor(`document.getElementById('render-estimate').textContent.includes('about 14 min')`);

    // Persist the preference, then reload the whole renderer.
    await evaluate(`document.getElementById('completion-sound-toggle').click()`);
    await waitFor(`!document.getElementById('completion-sound-toggle').disabled`);
    assert.equal(history.settings.completionSound, false);
    await window.loadFile(path.join(projectRoot, 'renderer', 'index.html'));
    await waitFor(`!document.getElementById('completion-sound-toggle').disabled`);
    assert.equal(await evaluate(`document.getElementById('completion-sound-toggle').checked`), false);
    assert.match(await evaluate(`document.getElementById('last-render-time').textContent`), /28m 0s/);
    await evaluate(`window.observedChimes = 0;
      const BaseContext = window.AudioContext;
      window.AudioContext = class extends BaseContext {
        constructor(...args) { super(...args); window.observedChimes++; }
      }; void 0;`);

    await prepareBook(10800);
    mode = 'hold';
    await evaluate(`document.getElementById('btn-export').click()`);
    await waitFor(`document.getElementById('render-estimate').textContent.includes('Estimated remaining: about 2 min')`);
    assert.equal(await evaluate(`document.getElementById('render-elapsed').textContent`), 'Elapsed: 11m 40s');
    if (process.env.RENDER_FEEDBACK_SCREENSHOT) {
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await new Promise(resolve => {
        window.webContents.once('paint', resolve);
        window.webContents.invalidate();
      });
      const screenshot = await window.webContents.capturePage();
      fs.writeFileSync(process.env.RENDER_FEEDBACK_SCREENSHOT, screenshot.toPNG());
    }
    release();
    await waitFor('!state.isRendering');
    assert.equal(alerts, 2);
    const savedCount = history.records.length;
    mode = 'fail';
    await evaluate('beginRender()');
    assert.match(await evaluate(`document.getElementById('render-elapsed').textContent`), /Failed after/);
    mode = 'cancel';
    await evaluate(`document.getElementById('btn-export').click()`);
    await waitFor('state.isRendering');
    await evaluate(`document.getElementById('btn-stop').click()`);
    await evaluate('window.api.cancelRender()');
    release();
    await waitFor('!state.isRendering');
    assert.match(await evaluate(`document.getElementById('render-elapsed').textContent`), /Cancelled after/);
    assert.equal(history.records.length, savedCount);
    assert.equal(alerts, 2);
    assert.equal(await evaluate('window.observedChimes'), 0);
    await evaluate(`document.getElementById('btn-test-render-sound').click()`);
    await waitFor('window.observedChimes === 1');
    assert.equal(fallbackBeeps, 0);
    console.log('Render feedback UI passed: timings, live ETA, restart, sound engine, failure and cancellation.');
  } finally {
    if (!window.isDestroyed()) window.destroy();
    for (const name of Object.keys(handlers)) ipcMain.removeHandler(name);
  }
}

app.whenReady().then(runTest).then(() => app.quit()).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on('quit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} });
