const { performance } = require('perf_hooks');
const { renderProfile, videoDuration, historicalElapsedAt } = require('./renderHistory');

class RenderJob {
  constructor({ history, send, notify, now = () => performance.now() }) {
    this.history = history;
    this.send = send;
    this.notify = notify;
    this.now = now;
    this.active = false;
    this.cancelled = false;
  }

  cancel() {
    if (this.active) this.cancelled = true;
  }

  async run(params, renderVideo, callbacks) {
    if (this.active) throw new Error('A render is already running.');
    this.active = true;
    this.cancelled = false;
    const start = this.now();
    const startedAt = new Date().toISOString();
    const elapsed = () => Math.max(0, (this.now() - start) / 1000);
    let encoder = null;
    let estimate = this.history.estimate(params);
    let finishEstimate = estimate?.seconds ?? null;
    const checkpoints = [{ percent: 0, elapsedSeconds: 0 }];
    const timing = () => this.send('render-timing', {
      elapsedSeconds: elapsed(),
      estimatedSeconds: finishEstimate,
      remainingSeconds: finishEstimate === null ? null : Math.max(0, finishEstimate - elapsed()),
      overdue: finishEstimate !== null && elapsed() >= finishEstimate,
      basis: estimate?.previous.outputPath || null
    });
    const timer = setInterval(timing, 1000);
    timing();
    let result;
    try {
      const rendered = await renderVideo(params, {
        ...callbacks,
        isCancelled: () => this.cancelled,
        onProfile: profile => {
          encoder = profile.encoder;
          estimate = this.history.estimate(params, encoder);
          finishEstimate = estimate?.seconds ?? null;
          timing();
        },
        onLog: message => this.send('render-log', message),
        onProgress: data => {
          // Completion includes pipeline cleanup, so reserve 100 for its return.
          const percent = Math.min(99, Math.max(0, Math.floor(data.percent || 0)));
          const seconds = elapsed();
          if (percent > checkpoints[checkpoints.length - 1].percent) {
            checkpoints.push({ percent, elapsedSeconds: seconds });
            const historical = estimate && historicalElapsedAt(estimate.previous, percent);
            if (seconds >= 5 && historical > 0 && percent >= 10) {
              const remaining = Math.max(0, estimate.previous.elapsedSeconds - historical);
              finishEstimate = seconds + remaining * seconds / historical;
            }
          }
          this.send('render-progress', data.phase === 'done'
            ? { phase: 'encoding', label: 'Finishing render…', percent }
            : { ...data, percent });
          timing();
        }
      });
      if (this.cancelled) throw new Error('RENDER_CANCELLED');
      const elapsedSeconds = elapsed();
      const record = {
        startedAt,
        completedAt: new Date().toISOString(),
        elapsedSeconds,
        videoSeconds: rendered?.durationSeconds || videoDuration(params),
        outputPath: params.outputPath,
        chapterCount: params.chapters?.length || 0,
        appVersion: params.appVersion,
        profile: renderProfile(params, encoder),
        checkpoints: [...checkpoints, { percent: 100, elapsedSeconds }]
      };
      let historySaved = true;
      try {
        this.history.add(record);
      } catch (error) {
        historySaved = false;
        this.send('render-log', `⚠ Video saved, but render timing could not be saved: ${error.message}`);
      }
      result = { success: true, outputPath: params.outputPath, elapsedSeconds, record, historySaved };
    } catch (error) {
      const cancelled = this.cancelled || error.message === 'RENDER_CANCELLED';
      result = { success: false, cancelled, error: cancelled ? null : error.message, elapsedSeconds: elapsed() };
    } finally {
      clearInterval(timer);
      this.active = false;
      this.cancelled = false;
    }
    this.send('render-complete', result);
    if (result.success) {
      try {
        await this.notify(result, this.history.settings.completionSound);
      } catch (error) {
        this.send('render-log', `⚠ Video saved, but the completion alert could not be played: ${error.message}`);
      }
    }
    return result;
  }
}

module.exports = { RenderJob };
