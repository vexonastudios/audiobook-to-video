const fs = require('fs');
const path = require('path');

const HISTORY_LIMIT = 50;

function renderProfile(params, encoder = null) {
  const transitionStyle = params.transitionStyle || 'cut';
  return {
    pipeline: params.forceLegacyRender ? 'legacy-v1' : 'optimized-v1',
    width: 1920,
    height: 1080,
    fps: 30,
    codec: params.codec || 'h264',
    encoder,
    crf: params.crf ?? 18,
    transitionStyle,
    transitionDuration: transitionStyle === 'cut' ? 0 : (params.transitionDuration ?? 1),
    openingTitles: params.openingTitlesEnabled === true,
    printPromotion: params.printPromoEnabled !== false,
    introStyle: params.introClipPath ? (params.introStyle || 'push') : 'none',
    fastAudio: params.fastAudioCopy !== false,
    companionMp3: true,
    audioFormat: path.extname(params.wavPath || '').toLowerCase()
  };
}

function videoDuration(params) {
  const chapters = params.chapters || [];
  const book = Number(chapters[chapters.length - 1]?.endTime || params.audioDuration || 0);
  const intro = params.introClipPath ? Number(params.introDurationRaw || 0) : 0;
  const overlap = intro && params.introStyle === 'overlap'
    ? Math.min(params.introFadeDuration ?? 1, intro, book) : 0;
  return Math.max(0, book + intro - overlap);
}

function compatible(a, b) {
  return Object.keys(a).every(key => (key === 'encoder' && !a.encoder) || a[key] === b[key]);
}

function validRecord(record) {
  return record && Number.isFinite(record.elapsedSeconds) && record.elapsedSeconds > 0
    && Number.isFinite(record.videoSeconds) && record.videoSeconds > 0
    && typeof record.outputPath === 'string' && typeof record.completedAt === 'string'
    && record.profile && typeof record.profile.encoder === 'string';
}

class RenderHistory {
  constructor(filePath) {
    this.filePath = filePath;
    this.settings = { completionSound: true };
    this.records = [];
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.records = Array.isArray(data.records) ? data.records.filter(validRecord).slice(-HISTORY_LIMIT) : [];
      this.settings.completionSound = data.settings?.completionSound !== false;
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not read render history:', error.message);
    }
  }

  persist(records, settings) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, settings, records }, null, 2));
    fs.renameSync(temporaryPath, this.filePath);
    this.records = records;
    this.settings = settings;
  }

  setSound(enabled) {
    this.persist(this.records, { completionSound: enabled !== false });
    return this.settings;
  }

  add(record) {
    if (!validRecord(record)) throw new Error('Invalid render timing record.');
    this.persist([...this.records, record].slice(-HISTORY_LIMIT), this.settings);
  }

  estimate(params, encoder = null) {
    const duration = videoDuration(params);
    const profile = renderProfile(params, encoder);
    const previous = [...this.records].reverse().find(record => compatible(profile, record.profile));
    if (!previous || !Number.isFinite(duration) || duration <= 0) return null;
    return {
      seconds: previous.elapsedSeconds * duration / previous.videoSeconds,
      previous
    };
  }

  info(params) {
    const estimate = this.estimate(params);
    return {
      settings: this.settings,
      lastRender: this.records[this.records.length - 1] || null,
      estimatedSeconds: estimate?.seconds ?? null,
      basis: estimate ? path.basename(estimate.previous.outputPath) : null
    };
  }
}

// Use measured checkpoints: the progress bar's percentages are work units,
// not fractions of wall-clock time (encoding occupies only 33–60%).
function historicalElapsedAt(record, percent) {
  const points = Array.isArray(record.checkpoints) ? record.checkpoints.filter(point => point
    && Number.isFinite(point.percent) && Number.isFinite(point.elapsedSeconds)
    && point.elapsedSeconds >= 0 && point.elapsedSeconds <= record.elapsedSeconds) : [];
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1];
    const right = points[i];
    if (right.percent >= percent && right.percent > left.percent && right.elapsedSeconds >= left.elapsedSeconds) {
      return left.elapsedSeconds + (right.elapsedSeconds - left.elapsedSeconds)
        * (percent - left.percent) / (right.percent - left.percent);
    }
  }
  return null;
}

module.exports = { RenderHistory, renderProfile, videoDuration, historicalElapsedAt };
