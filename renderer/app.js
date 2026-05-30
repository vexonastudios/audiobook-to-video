/**
 * Vexona Studios Video Generator — Renderer UI Logic
 * 
 * Handles: file picking, chapter parsing, live preview, export.
 */

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

const state = {
  coverPath: null,
  bgPath: null,
  wavPath: null,
  logoPath: null,
  outputPath: null,
  audioDuration: null,

  coverDataURL: null,
  bgDataURL: null,
  logoDataURL: null,           // raw logo (active)
  logoProcessedDataURL: null,  // tinted logo (active)

  // Multi-logo library: array of { path, dataURL, processedDataURL }
  logoLibrary: [],

  accentColor: [201, 169, 110],
  isCustomColor: false,
  blurAmount: 40,
  bgOpacity: 0.65,
  bgOffsetY: 0,       // -100..+100: negative = shift up, positive = shift down
  coverBorderWidth: 0,

  // Chapter transition
  transitionStyle: 'fade',  // cut | fade | dissolve | flare | zoom
  transitionDuration: 1.0,  // seconds

  // Title font size: 0 = auto-fit, >0 = fixed px
  titleFontSize: 0,

  // Intro clip duration in seconds (shifts YouTube chapter timestamps)
  introDuration: 0,

  chapters: [],              // parsed chapters with assigned end times
  selectedChapterIndex: 0,
  isRendering: false,
  codec: 'h264',             // 'h264' | 'h265'
  gpuStatus: 'unknown',       // 'unknown' | 'gpu' | 'cpu'
  gpuName: 'GPU'              // actual GPU name detected at runtime
};

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  // Titlebar
  btnMinimize: $('btn-minimize'),
  btnMaximize: $('btn-maximize'),
  btnClose: $('btn-close'),

  // Project buttons
  btnNewProject: $('btn-new-project'),
  btnSaveProject: $('btn-save-project'),
  btnLoadProject: $('btn-load-project'),

  // File pickers
  fpCoverText: $('fp-cover-text'),
  fpBgText: $('fp-bg-text'),
  fpLogoText: $('fp-logo-text'),
  fpWavText: $('fp-wav-text'),
  fpOutputText: $('fp-output-text'),
  fpCover: $('fp-cover'),
  fpBg: $('fp-bg'),
  fpLogo: $('fp-logo'),
  fpWav: $('fp-wav'),
  fpOutput: $('fp-output'),

  btnCover: $('btn-cover'),
  btnBg: $('btn-bg'),
  btnBgClear: $('btn-bg-clear'),
  btnLogo: $('btn-logo'),
  btnWav: $('btn-wav'),
  btnOutput: $('btn-output'),

  durationDisplay: $('duration-display'),
  durationText: $('duration-text'),

  // Sliders
  blurSlider: $('blur-slider'),
  blurVal: $('blur-val'),
  opacitySlider: $('opacity-slider'),
  opacityVal: $('opacity-val'),
  bgOffsetSlider: $('bg-offset-slider'),
  bgOffsetVal: $('bg-offset-val'),
  borderSlider: $('border-slider'),
  borderVal: $('border-val'),

  // Accent
  accentPicker: $('accent-picker'),
  accentHex: $('accent-hex'),
  accentNote: $('accent-note'),

  // Logo library
  logoLibrary: $('logo-library'),

  // Transitions
  transitionSelect: $('transition-select'),
  transitionDurSlider: $('transition-dur-slider'),
  transitionDurVal: $('transition-dur-val'),
  transitionCutNote: $('transition-cut-note'),

  // Title font size
  titleFontsizeInput: $('title-fontsize-input'),
  titleFontsizeAuto: $('title-fontsize-auto'),

  // Intro duration
  introDurationInput: $('intro-duration-input'),

  // Preview
  previewCanvas: $('previewCanvas'),
  previewOverlay: $('preview-overlay'),
  previewLoading: $('preview-loading'),
  previewChapterSelect: $('preview-chapter-select'),
  btnRefreshPreview: $('btn-refresh-preview'),

  // Export
  btnExport: $('btn-export'),
  btnStop: $('btn-stop'),
  codecSelect: $('codec-select'),
  gpuBadge: $('gpu-badge'),
  gpuBadgeDot: $('gpu-badge-dot'),
  gpuBadgeText: $('gpu-badge-text'),
  progressSection: $('progress-section'),
  progressFill: $('progress-fill'),
  progressLabel: $('progress-label'),
  progressPct: $('progress-pct'),
  logBox: $('log-box'),
  logContent: $('log-content'),

  // Chapters
  chaptersTextarea: $('chapters-textarea'),
  btnImportChapters: $('btn-import-chapters'),
  btnImportSrt: $('btn-import-srt'),
  btnClearChapters: $('btn-clear-chapters'),
  btnParseChapters: $('btn-parse-chapters'),
  chaptersList: $('chapters-list'),
  chaptersSummary: $('chapters-summary'),
  chaptersCount: $('chapters-count'),
  chaptersTotalDur: $('chapters-total-dur'),

  // Tutorial
  btnTutorial: $('btn-tutorial'),
  btnCloseTutorial: $('btn-close-tutorial'),
  tutorialModal: $('tutorial-modal'),
};

// ─────────────────────────────────────────────────────────────
// Titlebar
// ─────────────────────────────────────────────────────────────

els.btnMinimize.addEventListener('click', () => window.api.minimize());
els.btnMaximize.addEventListener('click', () => window.api.maximize());
els.btnClose.addEventListener('click', () => window.api.close());

// ─────────────────────────────────────────────────────────────
// Project Persistence
// ─────────────────────────────────────────────────────────────

els.btnNewProject.addEventListener('click', () => {
  if (confirm('Are you sure you want to start a new project? Any unsaved changes will be lost.')) {
    // Keep global logo, clear the rest
    const globalLogo = localStorage.getItem('audiobook-video-gen-global-logo');
    localStorage.removeItem('audiobook-video-gen-session');
    
    // Reset state but keep logo
    Object.assign(state, {
      coverPath: null,
      bgPath: null,
      wavPath: null,
      outputPath: null,
      audioDuration: null,
      coverDataURL: null,
      bgDataURL: null,
      logoProcessedDataURL: null,
      accentColor: [201, 169, 110],
      isCustomColor: false,
      blurAmount: 40,
      bgOpacity: 0.65,
      coverBorderWidth: 0,
      transitionStyle: 'fade',
      transitionDuration: 1.0,
      chapters: [],
      selectedChapterIndex: 0,
      isRendering: false
    });
    // Reset transition UI
    els.transitionSelect.value = 'fade';
    els.transitionDurSlider.value = 10;
    els.transitionDurVal.textContent = '1.0s';
    updateTransitionUI();

    if (!globalLogo) {
      state.logoPath = null;
      state.logoDataURL = null;
    }

    // Reset UI
    els.fpCoverText.textContent = 'Choose cover image…';
    els.fpCover.classList.remove('has-file');
    
    els.fpBgText.textContent = 'None — using blurred cover';
    els.fpBg.classList.remove('has-file');
    els.btnBgClear.style.display = 'none';

    if (!globalLogo) {
      els.fpLogoText.textContent = 'Choose logo PNG…';
      els.fpLogo.classList.remove('has-file');
    }

    els.fpWavText.textContent = 'Choose WAV/Audio file…';
    els.fpWav.classList.remove('has-file');
    els.durationDisplay.style.display = 'none';
    els.durationText.textContent = '—';

    els.fpOutputText.textContent = 'Choose output location…';
    els.fpOutput.classList.remove('has-file');

    els.blurSlider.value = 40;
    els.blurVal.textContent = '40px';
    els.opacitySlider.value = 65;
    els.opacityVal.textContent = '65%';
    els.borderSlider.value = 0;
    els.borderVal.textContent = '0px';

    updateAccentDisplay(state.accentColor, true);

    els.chaptersTextarea.value = '';
    renderChapterList();
    updatePreviewSelect();

    // Clear preview canvas
    const ctx = els.previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, 640, 360);
    els.previewOverlay.classList.remove('hidden');
    
    els.logContent.innerHTML = '';
    els.logBox.style.display = 'none';

    checkExportReady();
    addLog('✨ Started a new project.', 'ok');
  }
});

els.btnSaveProject.addEventListener('click', async () => {
  const data = {
    coverPath: state.coverPath,
    bgPath: state.bgPath,
    logoPath: state.logoPath,
    wavPath: state.wavPath,
    outputPath: state.outputPath,
    blurAmount: state.blurAmount,
    bgOpacity: state.bgOpacity,
    coverBorderWidth: state.coverBorderWidth,
    chaptersText: els.chaptersTextarea.value,
    selectedChapterIndex: state.selectedChapterIndex,
    transitionStyle: state.transitionStyle,
    transitionDuration: state.transitionDuration
  };
  const success = await window.api.saveProjectFile(JSON.stringify(data, null, 2));
  if (success) addLog('✅ Project saved successfully.', 'ok');
});

// Tutorial Logic
els.btnTutorial.addEventListener('click', () => {
  els.tutorialModal.classList.remove('hidden');
});
els.btnCloseTutorial.addEventListener('click', () => {
  els.tutorialModal.classList.add('hidden');
});
els.tutorialModal.addEventListener('click', (e) => {
  if (e.target === els.tutorialModal) els.tutorialModal.classList.add('hidden');
});

els.btnLoadProject.addEventListener('click', async () => {
  const dataStr = await window.api.loadProjectFile();
  if (!dataStr) return;
  try {
    // Fully clear UI before loading. 
    // We cannot use els.btnClearChapters.click() because it triggers saveSession()
    // which overwrites the loaded data with empty strings.
    els.chaptersTextarea.value = '';
    state.chapters = [];
    renderChapterList();
    updatePreviewSelect();

    const data = JSON.parse(dataStr);
    // Push it to our auto-save session state so the standard loader picks it up
    localStorage.setItem('audiobook-video-gen-session', dataStr);
    
    await restoreSession();
    addLog('✅ Project loaded from file.', 'ok');
  } catch (e) {
    addLog('⚠ Failed to parse project file.', 'err');
  }
});

// ─────────────────────────────────────────────────────────────
// File Pickers
// ─────────────────────────────────────────────────────────────

els.btnCover.addEventListener('click', async () => {
  const filePath = await window.api.pickCover();
  if (!filePath) return;

  state.coverPath = filePath;
  setFilePicked(els.fpCover, els.fpCoverText, filePath);

  // Load as data URL
  state.coverDataURL = await window.api.imageToDataURL(filePath);

  // Extract accent color if NOT set to custom
  if (!state.isCustomColor) {
    addLog('🎨 Extracting accent color from cover…');
    const color = await window.api.extractColor(filePath);
    state.accentColor = color;
    updateAccentDisplay(color, true);
  }

  // Re-process logo if already loaded
  if (state.logoPath) {
    await reprocessLogo();
  }

  // Refresh preview
  saveSession();
  await refreshPreview();
});

els.btnBg.addEventListener('click', async () => {
  const filePath = await window.api.pickBackground();
  if (!filePath) return;

  state.bgPath = filePath;
  state.bgDataURL = await window.api.imageToDataURL(filePath);
  setFilePicked(els.fpBg, els.fpBgText, filePath);
  els.btnBgClear.style.display = 'inline-flex';
  saveSession();
  await refreshPreview();
});

els.btnBgClear.addEventListener('click', async () => {
  state.bgPath = null;
  state.bgDataURL = null;
  els.fpBgText.textContent = 'None — using blurred cover';
  els.fpBg.classList.remove('has-file');
  els.btnBgClear.style.display = 'none';
  saveSession();
  await refreshPreview();
});

// ─────────────────────────────────────────────────────────────
// Logo Library
// ─────────────────────────────────────────────────────────────

/**
 * Renders the logo library grid. Each entry shows a thumbnail;
 * clicking it sets the active logo, hovering shows a ✕ remove button.
 */
function renderLogoLibrary() {
  const grid = els.logoLibrary;
  grid.innerHTML = '';

  state.logoLibrary.forEach((entry, idx) => {
    const thumb = document.createElement('div');
    thumb.className = `logo-thumb${state.logoPath === entry.path ? ' active' : ''}`;
    thumb.title = entry.path.split(/[\\/]/).pop();

    const img = document.createElement('img');
    img.src = entry.dataURL;
    thumb.appendChild(img);

    // Remove button
    const rmBtn = document.createElement('button');
    rmBtn.className = 'logo-remove';
    rmBtn.textContent = '✕';
    rmBtn.title = 'Remove from library';
    rmBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      state.logoLibrary.splice(idx, 1);
      // If this was the active logo, clear it
      if (state.logoPath === entry.path) {
        state.logoPath = null;
        state.logoDataURL = null;
        state.logoProcessedDataURL = null;
        els.fpLogoText.textContent = 'Choose logo PNG…';
        els.fpLogo.classList.remove('has-file');
      }
      saveLogoLibrary();
      renderLogoLibrary();
      await refreshPreview();
    });
    thumb.appendChild(rmBtn);

    // Click to set as active
    thumb.addEventListener('click', async () => {
      state.logoPath = entry.path;
      state.logoDataURL = entry.dataURL;
      setFilePicked(els.fpLogo, els.fpLogoText, entry.path);
      await reprocessLogo();
      renderLogoLibrary();
      saveSession();
      await refreshPreview();
    });

    grid.appendChild(thumb);
  });
}

/** Persist the library paths to localStorage */
function saveLogoLibrary() {
  const paths = state.logoLibrary.map(e => e.path);
  localStorage.setItem('audiobook-video-gen-logo-library', JSON.stringify(paths));
}

/** Load logo library paths from localStorage and resolve dataURLs */
async function restoreLogoLibrary() {
  const raw = localStorage.getItem('audiobook-video-gen-logo-library');
  if (!raw) return;
  try {
    const paths = JSON.parse(raw);
    for (const p of paths) {
      try {
        const dataURL = await window.api.imageToDataURL(p);
        if (dataURL && !state.logoLibrary.find(e => e.path === p)) {
          state.logoLibrary.push({ path: p, dataURL, processedDataURL: null });
        }
      } catch (_) { /* file may have moved */ }
    }
    renderLogoLibrary();
  } catch (_) {}
}

/** Add a logo to the library (if not already present) and activate it */
async function addLogoToLibrary(filePath) {
  const dataURL = await window.api.imageToDataURL(filePath);
  if (!dataURL) return;

  // Avoid duplicates
  if (!state.logoLibrary.find(e => e.path === filePath)) {
    state.logoLibrary.push({ path: filePath, dataURL, processedDataURL: null });
    saveLogoLibrary();
  }

  // Set as active
  state.logoPath = filePath;
  state.logoDataURL = dataURL;
  setFilePicked(els.fpLogo, els.fpLogoText, filePath);

  await reprocessLogo();
  renderLogoLibrary();
  saveSession();
  await refreshPreview();
}

els.btnLogo.addEventListener('click', async () => {
  const filePath = await window.api.pickLogo();
  if (!filePath) return;
  await addLogoToLibrary(filePath);
});

els.btnWav.addEventListener('click', async () => {
  const filePath = await window.api.pickWav();
  if (!filePath) return;

  state.wavPath = filePath;
  setFilePicked(els.fpWav, els.fpWavText, filePath);

  // Get duration
  try {
    const dur = await window.api.getAudioDuration(filePath);
    state.audioDuration = dur;
    els.durationText.textContent = formatDuration(dur);
    els.durationDisplay.style.display = 'flex';
    addLog(`⏱ Audio duration: ${formatDuration(dur)}`);

    // Assign end times to chapters
    if (state.chapters.length > 0) {
      assignEndTimes();
      renderChapterList();
    }
  } catch (e) {
    addLog(`⚠ Could not read audio duration: ${e.message}`, 'err');
  }

  saveSession();
  checkExportReady();
});

els.btnOutput.addEventListener('click', async () => {
  // Suggest a filename based on book/chapters
  const suggestedName = 'audiobook-video.mp4';
  const filePath = await window.api.pickOutput(suggestedName);
  if (!filePath) return;

  state.outputPath = filePath;
  setFilePicked(els.fpOutput, els.fpOutputText, filePath);
  saveSession();
  checkExportReady();
});

// ─────────────────────────────────────────────────────────────
// Sliders
// ─────────────────────────────────────────────────────────────

els.blurSlider.addEventListener('input', () => {
  state.blurAmount = parseInt(els.blurSlider.value);
  els.blurVal.textContent = `${state.blurAmount}px`;
});
els.blurSlider.addEventListener('change', () => { refreshPreview(); saveSession(); });

// ─────────────────────────────────────────────────────────────
// Transition Controls
// ─────────────────────────────────────────────────────────────

function updateTransitionUI() {
  const isCut = state.transitionStyle === 'cut';
  els.transitionDurSlider.disabled = isCut;
  els.transitionCutNote.style.display = isCut ? 'block' : 'none';
}

els.transitionSelect.addEventListener('change', () => {
  state.transitionStyle = els.transitionSelect.value;
  updateTransitionUI();
  saveSession();
});

els.transitionDurSlider.addEventListener('input', () => {
  const val = parseInt(els.transitionDurSlider.value) / 10;
  state.transitionDuration = val;
  els.transitionDurVal.textContent = val.toFixed(1) + 's';
});
els.transitionDurSlider.addEventListener('change', () => saveSession());

// ─────────────────────────────────────────────────────────────
// Title Font Size
// ─────────────────────────────────────────────────────────────

function updateTitleFontsizeUI() {
  const isAuto = els.titleFontsizeAuto.checked;
  els.titleFontsizeInput.disabled = isAuto;
  els.titleFontsizeInput.style.opacity = isAuto ? '0.4' : '1';
  state.titleFontSize = isAuto ? 0 : parseInt(els.titleFontsizeInput.value) || 0;
}

els.titleFontsizeAuto.addEventListener('change', () => {
  updateTitleFontsizeUI();
  refreshPreview();
  saveSession();
});

els.titleFontsizeInput.addEventListener('input', () => {
  if (!els.titleFontsizeAuto.checked) {
    state.titleFontSize = parseInt(els.titleFontsizeInput.value) || 0;
    refreshPreview();
  }
});
els.titleFontsizeInput.addEventListener('change', () => saveSession());

// ─────────────────────────────────────────────────────────────
// Intro Clip Duration
// ─────────────────────────────────────────────────────────────

/** Parse a M:SS or H:MM:SS string into seconds. Returns 0 if invalid. */
function parseIntroDuration(str) {
  if (!str || str.trim() === '0:00') return 0;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

els.introDurationInput.addEventListener('change', () => {
  state.introDuration = parseIntroDuration(els.introDurationInput.value);
  saveSession();
});

els.opacitySlider.addEventListener('input', () => {
  const pct = parseInt(els.opacitySlider.value);
  state.bgOpacity = pct / 100;
  els.opacityVal.textContent = pct + '%';
});
els.opacitySlider.addEventListener('change', () => { refreshPreview(); saveSession(); });

els.bgOffsetSlider.addEventListener('input', () => {
  const v = parseInt(els.bgOffsetSlider.value);
  state.bgOffsetY = v;
  els.bgOffsetVal.textContent = v === 0 ? 'Center' : (v < 0 ? `↑ ${Math.abs(v)}%` : `↓ ${v}%`);
  refreshPreview();
});
els.bgOffsetSlider.addEventListener('change', () => saveSession());

els.borderSlider.addEventListener('input', () => {
  state.coverBorderWidth = parseInt(els.borderSlider.value);
  els.borderVal.textContent = state.coverBorderWidth + 'px';
});
els.borderSlider.addEventListener('change', () => { refreshPreview(); saveSession(); });

// ─────────────────────────────────────────────────────────────
// Color Picker
// ─────────────────────────────────────────────────────────────

els.accentPicker.addEventListener('input', (e) => {
  const hex = e.target.value;
  els.accentHex.textContent = hex.toUpperCase();
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  state.accentColor = [r, g, b];
  state.isCustomColor = true;
  els.accentNote.textContent = '(custom)';
  refreshPreview();  // Live preview purely the color changes without re-tinting logo
});

els.accentPicker.addEventListener('change', async () => {
  saveSession();
  // When dragging stops, actually re-tint the heavy logo!
  if (state.logoDataURL) {
    await reprocessLogo();
    await refreshPreview();
  }
});

// ─────────────────────────────────────────────────────────────
// Chapter Parsing
// ─────────────────────────────────────────────────────────────

els.btnParseChapters.addEventListener('click', () => {
  parseChaptersFromTextarea();
});

els.chaptersTextarea.addEventListener('keydown', (e) => {
  // Ctrl+Enter to parse
  if (e.ctrlKey && e.key === 'Enter') parseChaptersFromTextarea();
});

els.btnImportChapters.addEventListener('click', async () => {
  const content = await window.api.pickChaptersFile();
  if (!content) return;
  els.chaptersTextarea.value = content;
  parseChaptersFromTextarea();
});

els.btnImportSrt.addEventListener('click', async () => {
  const content = await window.api.pickSrtFile();
  if (!content) return;

  const formatted = parseSrtToChapters(content);
  if (!formatted) {
    addLog('⚠ No chapter markers found in SRT file. Make sure chapter lines contain "Chapter" or a number prefix.', 'err');
    return;
  }

  els.chaptersTextarea.value = formatted;
  addLog(`📌 SRT imported — ${formatted.split('\n').length} chapters found.`);
  parseChaptersFromTextarea();
});

/**
 * Convert a string to Title Case — only fires if the whole string is ALL CAPS.
 */
function toTitleCase(str) {
  const letters = str.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0) return str;
  // Always apply Title Case — handles ALL CAPS, mixed case, and lowercase input.
  const smalls = new Set(['a','an','the','and','but','or','for','nor','on','at','to','of','in','by','up']);
  return str
    .toLowerCase()
    .replace(/[^\s-]+/g, (word, offset) => {
      const bare = word.replace(/^[^a-z]+|[^a-z]+$/gi, '');
      if (offset === 0 || !smalls.has(bare)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    });
}

/**
 * Extracts a date (range) from the END of a chapter title.
 *
 * Recognised formats (all anchored to end of string):
 *   — 1740 to 1744          dash + "to" range
 *   1740 to 1744            bare "to" range
 *   1769, 1770              comma-separated pair
 *   1740 and 1741           "and"-joined pair
 *   1754-1763 / 1754–1763   hyphen / en-dash range
 *   1740                    single year
 *   [1740–1744]             bracketed range (from SRT import)
 *
 * Returns { cleanTitle, dateRange } where dateRange may be null.
 * The cleanTitle has the matched date token stripped, plus any trailing
 * separator (dash, period, comma) cleaned up.
 */
function extractDateRange(title) {
  // Each entry: [ regex, builder(m) → string ]
  // All patterns end with \s*$ so they only match at the tail of the title.
  const patterns = [
    // Bracketed (SRT import): [1740–1744]
    [/\s*\[(\d{4})[\u2013\u2014-](\d{4})\]\s*$/, m => `${m[1]}\u2013${m[2]}`],

    // "— 1740 to 1744" or "– 1740 to 1744" (leading dash required)
    [/\s*[-\u2013\u2014]\s*(\d{4})\s+to\s+(\d{4})\s*$/i, m => `${m[1]}\u2013${m[2]}`],

    // "1740 to 1744" (bare, no leading dash)
    [/\s+(\d{4})\s+to\s+(\d{4})\s*$/i, m => `${m[1]}\u2013${m[2]}`],

    // "1769, 1770"
    [/\s*(\d{4}),\s*(\d{4})\s*$/, m => `${m[1]},\u00a0${m[2]}`],

    // "1740 and 1741"
    [/\s+(\d{4})\s+and\s+(\d{4})\s*$/i, m => `${m[1]},\u00a0${m[2]}`],

    // "1754-1763" or "1754–1763" (bare hyphen/en-dash range)
    [/\s*(\d{4})\s*[-\u2013\u2014]\s*(\d{4})\s*$/, m => `${m[1]}\u2013${m[2]}`],

    // Single year — only if preceded by a separator (dash, period, comma, or space after ".")
    [/(?:[-\u2013\u2014,.]|\.\s*)\s*(\d{4})\s*$/, m => m[1]],
  ];

  for (const [re, build] of patterns) {
    const match = title.match(re);
    if (match) {
      const dateRange = build(match);
      // Remove the matched portion and clean up any trailing separator
      const cleanTitle = title
        .slice(0, title.length - match[0].length)
        .replace(/[\s\-\u2013\u2014,.]+$/, '')
        .trim();
      if (!cleanTitle) continue; // guard: don't consume the whole title
      return { cleanTitle, dateRange };
    }
  }
  return { cleanTitle: title, dateRange: null };
}

/**
 * Parses an SRT file and extracts chapter timing markers.
 *
 * Strategy:
 *  - Parse every SRT block into { startSec, text }
 *  - Filter blocks whose text looks like a chapter heading:
 *      • Contains "Chapter" (case-insensitive)
 *      • OR starts with a number followed by " - "
 *  - Strip all XML/HTML tags (like <break time="1.6s"/>)
 *  - Force the first entry to be "(0:00) Introduction"
 *  - Format the rest as "(H:MM) N - Title" (or "(H:MM) Title" if no number)
 */
function parseSrtToChapters(srtText) {
  // ── Pass 1: Parse every SRT block into { startSec, rawText } ──────────
  const rawBlocks = [];
  const blocks = srtText.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const tcLine = lines.find(l => l.includes('-->'));
    if (!tcLine) continue;

    const tcMatch = tcLine.match(/(\d+):(\d+):(\d+)[,\.](\d+)/);
    if (!tcMatch) continue;

    const startSec = parseInt(tcMatch[1]) * 3600
                   + parseInt(tcMatch[2]) * 60
                   + parseInt(tcMatch[3]);

    // Text lines = everything that isn't the index number or timecode
    const textLines = lines.filter(l => !l.includes('-->') && !/^\d+$/.test(l));
    const rawText = textLines.join(' ');

    rawBlocks.push({ startSec, rawText });
  }

  // ── Pass 2: Walk blocks, accumulating chapter titles across blocks ──────
  //
  // Pattern the TTS encoder produces:
  //   Block A:  "Chapter 9 - On Past Experiences, and"       ← chapter heading starts
  //   Block B:  "Present Frames and Feelings—Their Right"     ← title continues
  //   Block C:  "Use and Abuse.<break time=\"1.6s\"/>"      ← <break marks end of title
  //   Block D:  "When Alexander set out to..."               ← body text (ignore)
  //
  // Rule: once we see a chapter-starting block, keep collecting rawText from
  // subsequent blocks until we hit one that contains "<break" — that block
  // provides the last fragment of the title (text before the <break).

  const entries = [];
  let collecting = false;
  let chapterStartSec = 0;
  let accumulatedText = '';

  const flushChapter = () => {
    if (!collecting) return;
    collecting = false;

    // Strip all SSML/HTML tags
    let cleanText = accumulatedText
      .replace(/<[^>]+>/g, '')       // complete tags: <break time="1.6s"/>
      .replace(/<\S[^\s>]*/g, '')   // orphaned open-tag fragments: <break
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    // Extract chapter number and title
    let number = null;
    let title = cleanText;
    const prefixMatch = cleanText.match(/^(?:chapter\s+)?(\d+)\s*[-:–—]\s*(.+)$/i);
    if (prefixMatch) {
      number = parseInt(prefixMatch[1], 10);
      title = prefixMatch[2].trim();
    }

    // Strip trailing period
    if (title.endsWith('.')) title = title.slice(0, -1).trim();

    // Title-case ALL CAPS
    title = toTitleCase(title);

    // Extract date ranges
    const { cleanTitle, dateRange } = extractDateRange(title);
    title = cleanTitle;

    entries.push({ startSec: chapterStartSec, number, title, dateRange });
    accumulatedText = '';
  };

  for (const { startSec, rawText } of rawBlocks) {
    const hasBreak = /<break/i.test(rawText);

    if (!collecting) {
      // Check if this block starts a chapter heading (strip tags first)
      const stripped = rawText
        .replace(/<[^>]+>/g, '')
        .replace(/<\S[^\s>]*/g, '')
        .trim();

      const isChapterStart =
        /^chapter\s+\d+/i.test(stripped) ||
        /^\d+\s*[-–—]\s*[A-Za-z]/.test(stripped) ||
        /^[\[\(]?(?:(?:the\s+)?(?:author['']s|editor['']s)\s+)?(?:preface|introduction)[\]\).:\s]*$/i.test(stripped);

      if (isChapterStart) {
        collecting = true;
        chapterStartSec = startSec;
        // Keep text up to any <break (handles single-block chapters)
        accumulatedText = hasBreak
          ? rawText.replace(/<break.*/gi, '').trim()
          : rawText;

        if (hasBreak) flushChapter(); // fully self-contained in one block
      }
      // else: ordinary body text, ignore

    } else {
      // Mid-collection: keep appending until we hit a <break block
      if (hasBreak) {
        const beforeBreak = rawText.replace(/<break.*/gi, '').trim();
        if (beforeBreak) accumulatedText += ' ' + beforeBreak;
        flushChapter();
      } else {
        accumulatedText += ' ' + rawText;
      }
    }
  }

  // Flush any open collection at EOF
  flushChapter();

  if (entries.length === 0) return null;

  // Sort by start time (SRT files are usually ordered, but just in case)
  entries.sort((a, b) => a.startSec - b.startSec);

  // Build output lines in our standard chapter format
  const outputLines = [];

  // Always force (0:00) Introduction at the start
  outputLines.push('(0:00) Introduction');

  entries.forEach((entry) => {
    const tc = secToTimecode(entry.startSec);
    const dateSuffix = entry.dateRange ? ` [${entry.dateRange}]` : '';
    if (entry.number !== null) {
      outputLines.push(`(${tc}) ${entry.number} - ${entry.title}${dateSuffix}`);
    } else {
      outputLines.push(`(${tc}) ${entry.title}${dateSuffix}`);
    }
  });

  return outputLines.join('\n');
}

function secToTimecode(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

els.btnClearChapters.addEventListener('click', () => {
  els.chaptersTextarea.value = '';
  state.chapters = [];
  renderChapterList();
  updatePreviewSelect();
  saveSession();
  checkExportReady();
});

function parseChaptersFromTextarea() {
  const text = els.chaptersTextarea.value.trim();
  if (!text) return;

  // Inline parser matching (H:)MM:SS format.
  // Continuation lines (no timestamp) are joined onto the previous chapter title.
  const rawLines = text.split('\n');
  const mergedLines = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\(\d+:\d+/.test(trimmed)) {
      mergedLines.push(trimmed);
    } else if (mergedLines.length > 0) {
      // Continuation: append to previous line (with a space)
      mergedLines[mergedLines.length - 1] += ' ' + trimmed;
    }
  }

  const chapters = [];

  for (const line of mergedLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^\((\d+:\d+(?::\d+)?)\)\s+(.+)$/);
    if (!match) continue;

    const timeStr = match[1];
    const rest = match[2].trim();

    // Parse time
    const parts = timeStr.split(':').map(Number);
    let startTime;
    if (parts.length === 2) startTime = parts[0] * 60 + parts[1];
    else startTime = parts[0] * 3600 + parts[1] * 60 + parts[2];

    // Numbered chapter?
    const numMatch = rest.match(/^(\d+)\s*[-–—]\s*(.+)$/);

    let rawTitle = numMatch ? numMatch[2].trim() : rest;
    
    // Apply Title Case to fix any ALL CAPS titles loaded from session
    rawTitle = toTitleCase(rawTitle);

    // Extract date range (handles both brackets from SRT parser and raw user input)
    const { cleanTitle, dateRange } = extractDateRange(rawTitle);

    if (numMatch) {
      chapters.push({
        startTime,
        endTime: null,
        number: parseInt(numMatch[1], 10),
        title: cleanTitle,
        dateRange,
        isNumbered: true,
        timecode: timeStr
      });
    } else {
      chapters.push({
        startTime,
        endTime: null,
        number: null,
        title: cleanTitle,
        dateRange,
        isNumbered: false,
        timecode: timeStr
      });
    }
  }

  if (chapters.length === 0) {
    addLog('⚠ No chapters found — check format: (0:38) 1 - Chapter Title', 'err');
    return;
  }

  state.chapters = chapters;
  assignEndTimes();
  renderChapterList();
  updatePreviewSelect();
  checkExportReady();
  addLog(`✅ Parsed ${chapters.length} chapters`);

  // Refresh preview with first chapter
  state.selectedChapterIndex = 0;
  saveSession();
  refreshPreview();
}

function assignEndTimes() {
  const chs = state.chapters;
  const rawAudioDur = parseFloat(state.audioDuration);
  const audioDur = isNaN(rawAudioDur) ? 0 : rawAudioDur;

  for (let i = 0; i < chs.length; i++) {
    if (i < chs.length - 1) {
      chs[i].endTime = Math.max(chs[i].startTime + 0.5, chs[i + 1].startTime);
    } else {
      chs[i].endTime = audioDur > chs[i].startTime 
        ? audioDur 
        : chs[i].startTime + 15; // default 15s padding if audio is missing/short
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Chapter List Rendering
// ─────────────────────────────────────────────────────────────

function renderChapterList() {
  const list = els.chaptersList;
  list.innerHTML = '';

  const chs = state.chapters;
  if (chs.length === 0) {
    els.chaptersSummary.style.display = 'none';
    return;
  }

  chs.forEach((ch, i) => {
    const dur = ch.endTime !== null ? ch.endTime - ch.startTime : null;
    const item = document.createElement('div');
    item.className = `chapter-item${i === state.selectedChapterIndex ? ' active' : ''}`;

    item.innerHTML = `
      <div class="ch-time">${ch.timecode}</div>
      <div class="ch-info">
        ${ch.isNumbered ? `<div class="ch-label">Chapter ${ch.number}</div>` : ''}
        <div class="ch-title">${escHtml(ch.title)}</div>
      </div>
      ${dur !== null ? `<div class="ch-dur">${formatDuration(dur)}</div>` : ''}
    `;

    item.addEventListener('click', () => {
      state.selectedChapterIndex = i;
      els.previewChapterSelect.value = String(i);
      document.querySelectorAll('.chapter-item').forEach((el, j) => {
        el.classList.toggle('active', j === i);
      });
      refreshPreview();
    });

    list.appendChild(item);
  });

  // Summary
  const totalDur = state.audioDuration
    ? formatDuration(state.audioDuration)
    : (chs[chs.length - 1].endTime ? formatDuration(chs[chs.length - 1].endTime) : '—');
  els.chaptersCount.textContent = `${chs.length} chapter${chs.length !== 1 ? 's' : ''}`;
  els.chaptersTotalDur.textContent = `Total: ${totalDur}`;
  els.chaptersSummary.style.display = 'flex';
}

// ─────────────────────────────────────────────────────────────
// Preview Select
// ─────────────────────────────────────────────────────────────

function updatePreviewSelect() {
  const sel = els.previewChapterSelect;
  sel.innerHTML = '';
  state.chapters.forEach((ch, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = ch.isNumbered
      ? `Ch.${ch.number} — ${ch.title.length > 30 ? ch.title.slice(0, 30) + '…' : ch.title}`
      : ch.title;
    sel.appendChild(opt);
  });
  sel.value = String(state.selectedChapterIndex);
}

els.previewChapterSelect.addEventListener('change', () => {
  state.selectedChapterIndex = parseInt(els.previewChapterSelect.value);
  document.querySelectorAll('.chapter-item').forEach((el, j) => {
    el.classList.toggle('active', j === state.selectedChapterIndex);
  });
  refreshPreview();
});

els.btnRefreshPreview.addEventListener('click', () => refreshPreview());

// ─────────────────────────────────────────────────────────────
// Live Preview Rendering
// ─────────────────────────────────────────────────────────────

let previewDebounce = null;

async function refreshPreview() {
  if (!state.coverDataURL) return;

  clearTimeout(previewDebounce);
  previewDebounce = setTimeout(async () => {
    await doRenderPreview();
  }, 80);
}

async function doRenderPreview() {
  if (!state.coverDataURL) return;

  els.previewLoading.style.display = 'flex';

  const chapter = state.chapters[state.selectedChapterIndex] || {
    startTime: 0, endTime: 0, number: null, title: 'Preview', isNumbered: false, timecode: '0:00'
  };

  try {
    const params = buildRenderParams(chapter);
    const dataURL = await window.api.renderPreview(params);

    if (dataURL) {
      // Draw the 1280×720 PNG into the 640×360 preview canvas (scaled)
      const img = new Image();
      img.onload = () => {
        const ctx = els.previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, 640, 360);
        ctx.drawImage(img, 0, 0, 640, 360);
        els.previewOverlay.classList.add('hidden');
      };
      img.src = dataURL;
    }
  } catch (e) {
    addLog(`⚠ Preview error: ${e.message}`, 'err');
  } finally {
    els.previewLoading.style.display = 'none';
  }
}

function buildRenderParams(chapter) {
  return {
    coverDataURL: state.coverDataURL,
    bgDataURL: state.bgDataURL || null,
    blurAmount: state.blurAmount,
    bgOpacity: state.bgOpacity,
    bgOffsetY: state.bgOffsetY,
    coverBorderWidth: state.coverBorderWidth,
    chapter,
    blendAlpha: 0,
    nextChapter: null,
    accentColor: state.accentColor,
    logoDataURL: state.logoProcessedDataURL || state.logoDataURL || null,
    transitionStyle: state.transitionStyle,
    transitionDuration: state.transitionDuration,
    titleFontSize: state.titleFontSize  // 0 = auto, >0 = fixed px
  };
}

// ─────────────────────────────────────────────────────────────
// Export / Render Video
// ─────────────────────────────────────────────────────────────

els.btnExport.addEventListener('click', async () => {
  if (state.isRendering) return;
  if (!readyToExport()) {
    addLog('⚠ Please fill in all required fields before exporting.', 'err');
    return;
  }

  beginRender();
});

async function beginRender() {
  state.isRendering = true;
  els.btnExport.disabled = true;
  els.btnStop.style.display = 'flex';
  els.progressSection.style.display = 'flex';
  els.logBox.style.display = 'block';
  els.logContent.innerHTML = '';
  setProgress(0, 'Starting render…');

  // Ensure all chapters have end times
  assignEndTimes();

  const params = {
    coverDataURL: state.coverDataURL,
    bgDataURL: state.bgDataURL || null,
    wavPath: state.wavPath,
    outputPath: state.outputPath,
    chapters: state.chapters,
    blurAmount: state.blurAmount,
    bgOpacity: state.bgOpacity,
    bgOffsetY: state.bgOffsetY,
    coverBorderWidth: state.coverBorderWidth,
    accentColor: state.accentColor,
    logoDataURL: state.logoProcessedDataURL || state.logoDataURL || null,
    transitionStyle: state.transitionStyle,
    transitionDuration: state.transitionDuration,
    codec: state.codec,
    crf: 18
  };

  addLog('🚀 Sending render job to main process…');
  await window.api.startRender(params);
}

els.btnStop.addEventListener('click', async () => {
  if (!state.isRendering) return;
  els.btnStop.disabled = true;
  els.btnStop.textContent = 'Cancelling…';
  await window.api.cancelRender();
  addLog('⛔ Cancellation requested — stopping after current segment…', 'err');
});

// Render event listeners are set up once in setupRenderListeners(), called on DOMContentLoaded.

function setupRenderListeners() {
  // Remove any previously-stacked listeners before re-adding,
  // so that each render cycle gets exactly one handler.
  window.api.removeAllListeners('render-progress');
  window.api.removeAllListeners('render-log');
  window.api.removeAllListeners('render-complete');

  window.api.onRenderProgress((data) => {
    setProgress(data.percent || 0, getPhaseLabel(data));
  });

  window.api.onRenderLog((msg) => {
    addLog(msg);
    if (msg.includes('NVENC') || msg.includes('GPU')) {
      updateGpuBadge('gpu');
    } else if (msg.includes('libx264') || msg.includes('libx265') || msg.includes('CPU')) {
      updateGpuBadge('cpu');
    }
  });

  window.api.onRenderComplete(async (result) => {
    state.isRendering = false;
    els.btnExport.disabled = false;
    els.btnStop.style.display = 'none';
    els.btnStop.disabled = false;
    els.btnStop.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg> Stop`;

    if (result.cancelled) {
      setProgress(0, '⛔ Render cancelled');
      addLog('⛔ Render stopped by user.', 'err');
    } else if (result.success) {
      setProgress(100, '✅ Video exported successfully!');
      addLog('🎉 Done! Video saved to: ' + state.outputPath, 'ok');

      // ── Save chapter markers as a companion .txt file ──────────────
      if (state.chapters.length > 0 && state.outputPath) {
        const chapterText = buildYouTubeChapters();
        if (chapterText) {
          const txtPath = state.outputPath.replace(/\.[^.]+$/, '') + '.txt';
          addLog(`📋 Saving chapter markers to: ${txtPath}`);
          const saved = await window.api.writeTextFile({ filePath: txtPath, content: chapterText });
          if (saved) {
            addLog(`✅ Chapter markers saved: ${txtPath.split(/[\\/]/).pop()}`, 'ok');
          } else {
            addLog(`⚠ Could not write chapter markers to: ${txtPath}`, 'err');
          }
        } else {
          addLog('⚠ buildYouTubeChapters() returned empty — no .txt written.', 'err');
        }
      } else {
        addLog(`⚠ Skipped .txt: chapters=${state.chapters.length}, outputPath=${state.outputPath}`, 'err');
      }
    } else {
      setProgress(0, '❌ Export failed');
      addLog('ERROR: ' + (result.error || 'Unknown error'), 'err');
    }
  });
}

function getPhaseLabel(data) {
  switch (data.phase) {
    case 'frames': return `Rendering frame ${data.current} of ${data.total}…`;
    case 'encoding':
      return data.label ? `Encoding: ${data.label}` : 'Encoding video…';
    case 'done': return '✅ Complete!';
    default: return 'Processing…';
  }
}

function setProgress(pct, label) {
  const clamped = Math.min(100, Math.max(0, pct));
  els.progressFill.style.width = `${clamped}%`;
  els.progressLabel.textContent = label;
  els.progressPct.textContent = `${Math.round(clamped)}%`;
}

/**
 * Builds a YouTube-ready chapter marker string from the current chapter list.
 * Format: "(0:00) Introduction\n(0:27) Preface\n(4:09) 1 - The Preciousness of Christ\n..."
 *
 * If state.introDuration > 0, all chapter timestamps are shifted forward by that
 * amount and a "(0:00) Intro" line is prepended (YouTube requires the first chapter
 * to start at 0:00).
 */
function buildYouTubeChapters() {
  const chs = state.chapters;
  if (!chs || chs.length === 0) return null;

  const offset = state.introDuration || 0;
  const lines = [];

  if (offset > 0) {
    lines.push(`(0:00) Intro`);
  }

  chs.forEach(ch => {
    const shifted = ch.startTime + offset;
    const tc = secToTimecode(shifted);
    const title = ch.isNumbered ? `${ch.number} - ${ch.title}` : ch.title;
    lines.push(`(${tc}) ${title}`);
  });

  return lines.join('\n');
}


// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function setFilePicked(fpEl, textEl, filePath) {
  const name = filePath.split(/[\\/]/).pop();
  textEl.textContent = name;
  fpEl.classList.add('has-file');
}

function updateAccentDisplay(color, isAuto = true) {
  const [r, g, b] = color;
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  els.accentPicker.value = hex;
  els.accentHex.textContent = hex.toUpperCase();
  els.accentNote.textContent = isAuto ? '(auto from cover)' : '(custom)';
}

async function reprocessLogo() {
  if (!state.logoPath || !state.accentColor) return;
  addLog('🎨 Tinting logo with accent color…');
  try {
    state.logoProcessedDataURL = await window.api.processLogo({
      logoPath: state.logoPath,
      accentColor: state.accentColor
    });
    addLog('✅ Logo tinted');
  } catch (e) {
    addLog(`⚠ Logo tint failed: ${e.message}`, 'err');
    state.logoProcessedDataURL = state.logoDataURL;
  }
}

function readyToExport() {
  return !!(
    state.coverPath &&
    state.wavPath &&
    state.outputPath &&
    state.chapters.length > 0 &&
    state.audioDuration
  );
}

function checkExportReady() {
  els.btnExport.disabled = !readyToExport() || state.isRendering;
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addLog(msg, type = '') {
  const line = document.createElement('span');
  line.className = `log-line${type ? ` log-${type}` : ''}`;
  line.textContent = msg + '\n';
  els.logContent.appendChild(line);
  els.logBox.style.display = 'block';
  els.logContent.scrollTop = els.logContent.scrollHeight;
}

// ─────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ─────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Arrow keys to navigate chapters in preview
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    if (state.chapters.length > 0 && state.selectedChapterIndex < state.chapters.length - 1) {
      state.selectedChapterIndex++;
      els.previewChapterSelect.value = String(state.selectedChapterIndex);
      document.querySelectorAll('.chapter-item').forEach((el, j) => {
        el.classList.toggle('active', j === state.selectedChapterIndex);
      });
      refreshPreview();
    }
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    if (state.chapters.length > 0 && state.selectedChapterIndex > 0) {
      state.selectedChapterIndex--;
      els.previewChapterSelect.value = String(state.selectedChapterIndex);
      document.querySelectorAll('.chapter-item').forEach((el, j) => {
        el.classList.toggle('active', j === state.selectedChapterIndex);
      });
      refreshPreview();
    }
  }
});

// ─────────────────────────────────────────────────────────────
// Session Persistence
// ─────────────────────────────────────────────────────────────

function saveSession() {
  const data = {
    coverPath: state.coverPath,
    bgPath: state.bgPath,
    logoPath: state.logoPath,
    wavPath: state.wavPath,
    outputPath: state.outputPath,
    blurAmount: state.blurAmount,
    bgOpacity: state.bgOpacity,
    bgOffsetY: state.bgOffsetY,
    coverBorderWidth: state.coverBorderWidth,
    chaptersText: els.chaptersTextarea.value,
    selectedChapterIndex: state.selectedChapterIndex,
    transitionStyle: state.transitionStyle,
    transitionDuration: state.transitionDuration,
    titleFontSize: state.titleFontSize,
    titleFontsizeAuto: els.titleFontsizeAuto.checked,
    introDuration: state.introDuration,
    introDurationStr: els.introDurationInput.value,
    accentColor: state.accentColor,
    isCustomColor: state.isCustomColor
  };
  localStorage.setItem('audiobook-video-gen-session', JSON.stringify(data));
}

async function restoreSession() {
  // Restore logo library first
  await restoreLogoLibrary();

  // Restore transition settings early so UI reflects saved values
  const stored0 = localStorage.getItem('audiobook-video-gen-session');
  if (stored0) {
    try {
      const d0 = JSON.parse(stored0);
      if (d0.transitionStyle) {
        state.transitionStyle = d0.transitionStyle;
        els.transitionSelect.value = d0.transitionStyle;
      }
      if (d0.transitionDuration !== undefined) {
        state.transitionDuration = d0.transitionDuration;
        els.transitionDurSlider.value = Math.round(d0.transitionDuration * 10);
        els.transitionDurVal.textContent = d0.transitionDuration.toFixed(1) + 's';
      }
      // Title font size
      if (d0.titleFontsizeAuto !== undefined) {
        els.titleFontsizeAuto.checked = d0.titleFontsizeAuto;
      }
      if (d0.titleFontSize !== undefined && d0.titleFontSize > 0) {
        els.titleFontsizeInput.value = d0.titleFontSize;
      }
      updateTitleFontsizeUI();
      // Intro duration
      if (d0.introDurationStr) {
        els.introDurationInput.value = d0.introDurationStr;
        state.introDuration = parseIntroDuration(d0.introDurationStr);
      }
    } catch (_) {}
  }
  updateTransitionUI();

  // First load the last-used logo from library as a sticky baseline
  const globalLogo = localStorage.getItem('audiobook-video-gen-global-logo');
  if (globalLogo) {
    try {
      state.logoPath = globalLogo;
      setFilePicked(els.fpLogo, els.fpLogoText, globalLogo);
      state.logoDataURL = await window.api.imageToDataURL(globalLogo);
    } catch(e) {}
  }

  const stored = localStorage.getItem('audiobook-video-gen-session');
  if (!stored) {
    // Even if no session, we might need to process the global logo if a def color exists
    if (state.logoPath && state.logoDataURL) {
      await reprocessLogo();
      await refreshPreview();
    }
    return;
  }
  
  try {
    const data = JSON.parse(stored);
    
    // Colors
    if (data.isCustomColor !== undefined) {
      state.isCustomColor = data.isCustomColor;
    }
    if (data.accentColor) {
      state.accentColor = data.accentColor;
      updateAccentDisplay(data.accentColor, !state.isCustomColor);
    }
    
    // Sliders
    if (data.blurAmount !== undefined) {
      state.blurAmount = data.blurAmount;
      els.blurSlider.value = data.blurAmount;
      els.blurVal.textContent = `${data.blurAmount}px`;
    }
    if (data.bgOpacity !== undefined) {
      state.bgOpacity = data.bgOpacity;
      els.opacitySlider.value = data.bgOpacity * 100;
      els.opacityVal.textContent = (data.bgOpacity * 100) + '%';
    }
    if (data.bgOffsetY !== undefined) {
      state.bgOffsetY = data.bgOffsetY;
      els.bgOffsetSlider.value = data.bgOffsetY;
      const v = data.bgOffsetY;
      els.bgOffsetVal.textContent = v === 0 ? 'Center' : (v < 0 ? `↑ ${Math.abs(v)}%` : `↓ ${v}%`);
    }
    if (data.coverBorderWidth !== undefined) {
      state.coverBorderWidth = data.coverBorderWidth;
      els.borderSlider.value = data.coverBorderWidth;
      els.borderVal.textContent = data.coverBorderWidth + 'px';
    }
    
    // Textarea
    if (data.chaptersText) {
      els.chaptersTextarea.value = data.chaptersText;
      parseChaptersFromTextarea();
    }
    
    if (data.selectedChapterIndex !== undefined) {
      state.selectedChapterIndex = data.selectedChapterIndex;
    }
    
    // Files
    let previewNeeded = false;
    
    if (data.coverPath) {
      try {
        state.coverPath = data.coverPath;
        setFilePicked(els.fpCover, els.fpCoverText, data.coverPath);
        state.coverDataURL = await window.api.imageToDataURL(data.coverPath);
        if (state.coverDataURL) {
          // Only auto-extract if it isn't a custom color passed by the session
          if (!state.isCustomColor) {
            const color = await window.api.extractColor(data.coverPath);
            state.accentColor = color;
            updateAccentDisplay(color, true);
          }
          previewNeeded = true;
        }
      } catch(e) {}
    }
    
    if (data.bgPath) {
      try {
        state.bgPath = data.bgPath;
        setFilePicked(els.fpBg, els.fpBgText, data.bgPath);
        state.bgDataURL = await window.api.imageToDataURL(data.bgPath);
        els.btnBgClear.style.display = 'inline-flex';
        previewNeeded = true;
      } catch(e) {}
    }
    
    if (data.logoPath) {
      try {
        state.logoPath = data.logoPath;
        localStorage.setItem('audiobook-video-gen-global-logo', data.logoPath);
        // Ensure library has this logo
        if (!state.logoLibrary.find(e => e.path === data.logoPath)) {
          const durl = await window.api.imageToDataURL(data.logoPath);
          if (durl) state.logoLibrary.push({ path: data.logoPath, dataURL: durl, processedDataURL: null });
          saveLogoLibrary();
        }
        renderLogoLibrary();
        setFilePicked(els.fpLogo, els.fpLogoText, data.logoPath);
        state.logoDataURL = await window.api.imageToDataURL(data.logoPath);
        await reprocessLogo();
        previewNeeded = true;
      } catch(e) {}
    }
    
    if (data.wavPath) {
      try {
        state.wavPath = data.wavPath;
        setFilePicked(els.fpWav, els.fpWavText, data.wavPath);
        const dur = await window.api.getAudioDuration(data.wavPath);
        state.audioDuration = dur;
        els.durationText.textContent = formatDuration(dur);
        els.durationDisplay.style.display = 'flex';
        if (state.chapters.length > 0) {
          assignEndTimes();
          renderChapterList();
        }
      } catch(e) {}
    }
    
    if (data.outputPath) {
      state.outputPath = data.outputPath;
      setFilePicked(els.fpOutput, els.fpOutputText, data.outputPath);
    }
    
    checkExportReady();
    
    // If we loaded a global logo but the project didn't explicitly override it, tint it!
    if (state.logoPath && !data.logoPath && state.accentColor) {
      await reprocessLogo();
      previewNeeded = true;
    }

    if (previewNeeded) {
      updatePreviewSelect();
      await refreshPreview();
    }
    
  } catch (e) {
    console.error('Failed to restore session:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// Codec selector
// ─────────────────────────────────────────────────────────────

els.codecSelect.addEventListener('change', () => {
  state.codec = els.codecSelect.value;
});

// ─────────────────────────────────────────────────────────────
// GPU badge
// ─────────────────────────────────────────────────────────────

function updateGpuBadge(status) {
  state.gpuStatus = status;
  if (status === 'gpu') {
    els.gpuBadge.className = 'gpu-badge gpu-badge--active';
    els.gpuBadgeDot.className = 'gpu-badge-dot gpu-badge-dot--active';
    els.gpuBadgeText.textContent = `🎮 GPU · ${state.gpuName}`;
  } else if (status === 'cpu') {
    els.gpuBadge.className = 'gpu-badge gpu-badge--cpu';
    els.gpuBadgeDot.className = 'gpu-badge-dot gpu-badge-dot--cpu';
    els.gpuBadgeText.textContent = '⚙️ CPU Fallback';
  } else {
    els.gpuBadge.className = 'gpu-badge';
    els.gpuBadgeDot.className = 'gpu-badge-dot';
    els.gpuBadgeText.textContent = 'Detecting…';
  }
}

// Restore on boot + fetch real GPU name
document.addEventListener('DOMContentLoaded', async () => {
  // Wire up render IPC listeners (exactly once, cleaned up on each render)
  setupRenderListeners();

  // Fetch real GPU name from Electron so the badge is always accurate
  try {
    const name = await window.api.getGpuName();
    if (name && name !== 'GPU') {
      state.gpuName = name;
      updateGpuBadge('gpu');
    }
  } catch (_) {}

  restoreSession();
});
