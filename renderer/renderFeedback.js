/* global api */
window.RenderFeedback = (() => {
  let getParams;
  let active = false;
  let refreshTimer;
  let requestId = 0;
  let soundReady = false;
  let soundSaving = false;
  const element = id => document.getElementById(id);
  const duration = seconds => {
    const whole = Math.max(0, Math.round(seconds));
    const h = Math.floor(whole / 3600);
    const m = Math.floor(whole % 3600 / 60);
    const s = whole % 60;
    return h ? `${h}h ${m}m ${s}s` : (m ? `${m}m ${s}s` : `${s}s`);
  };
  const approximate = seconds => seconds < 60 ? 'under 1 min' : `about ${Math.max(1, Math.round(seconds / 60))} min`;

  async function playChime() {
    let context;
    try {
      context = new AudioContext();
      await context.resume();
      const start = context.currentTime + 0.03;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const when = start + index * 0.28;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(0.22, when + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.65);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(when);
        oscillator.stop(when + 0.7);
        if (index === 2) oscillator.onended = () => context.close().catch(() => {});
      });
    } catch (error) {
      if (context) await context.close().catch(() => {});
      console.warn('Completion chime failed; using system beep.', error);
      await window.api.renderChimeFallback().catch(() => {});
    }
  }

  async function refreshNow() {
    if (!getParams) return;
    const id = ++requestId;
    try {
      const info = await window.api.getRenderInfo(getParams());
      if (id !== requestId) return;
      if (!soundSaving) element('completion-sound-toggle').checked = info.settings.completionSound;
      soundReady = true;
      element('completion-sound-toggle').disabled = soundSaving;
      const last = info.lastRender;
      element('last-render-time').hidden = !last;
      if (last) {
        const name = last.outputPath.split(/[\\/]/).pop();
        element('last-render-time').textContent = `Last render: ${duration(last.elapsedSeconds)} · ${name}`;
        element('last-render-time').title = `Video length: ${duration(last.videoSeconds)}\nCompleted: ${new Date(last.completedAt).toLocaleString()}`;
      }
      if (!active) {
        element('render-estimate').textContent = info.estimatedSeconds === null
          ? 'Estimate available after a successful render with similar settings.'
          : `Estimated render: ${approximate(info.estimatedSeconds)}`;
        element('render-estimate').title = info.basis
          ? `Based on ${info.basis}, adjusted for video length. Actual time varies with computer load and audio caching.` : '';
      }
    } catch (error) {
      if (!active) element('render-estimate').textContent = 'Render timing history is unavailable.';
      console.warn('Could not load render timing:', error);
    }
  }

  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshNow, 200);
  }

  function start() {
    active = true;
    element('render-elapsed').hidden = false;
    element('render-elapsed').textContent = 'Elapsed: 0s';
    element('render-estimate').textContent = 'Calculating render estimate…';
    element('render-estimate').title = '';
  }

  function finish(result) {
    active = false;
    if (Number.isFinite(result.elapsedSeconds)) {
      element('render-elapsed').hidden = false;
      const label = result.success ? 'Completed in' : (result.cancelled ? 'Cancelled after' : 'Failed after');
      element('render-elapsed').textContent = `${label}: ${duration(result.elapsedSeconds)}`;
    }
    refresh();
  }

  function init(paramsCallback) {
    getParams = paramsCallback;
    window.api.onRenderTiming(data => {
      if (!active) return;
      element('render-elapsed').textContent = `Elapsed: ${duration(data.elapsedSeconds)}`;
      element('render-estimate').textContent = data.overdue
        ? 'Taking longer than estimated…'
        : (data.remainingSeconds === null ? 'Learning render speed for these settings…'
          : `Estimated remaining: ${approximate(data.remainingSeconds)}`);
    });
    window.api.onRenderChime(playChime);
    element('completion-sound-toggle').addEventListener('change', async event => {
      const toggle = event.target;
      const enabled = toggle.checked;
      soundSaving = true;
      toggle.disabled = true;
      try {
        await window.api.setCompletionSound(enabled);
      } catch (error) {
        toggle.checked = !enabled;
        element('render-estimate').textContent = 'Could not save the completion sound setting.';
      } finally {
        soundSaving = false;
        toggle.disabled = !soundReady;
      }
    });
    element('btn-test-render-sound').addEventListener('click', () => window.api.previewRenderChime());
    refresh();
  }

  return { init, refresh, start, finish };
})();
