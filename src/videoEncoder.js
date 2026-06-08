const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const fluent = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

fluent.setFfmpegPath(ffmpegPath);
fluent.setFfprobePath(ffprobePath);

const OUTPUT_FPS = 5;
const TRANSITION_FPS = 5; // match chapter FPS — halves render cost, fixes concat FPS mismatch

// ── GPU Detection (run once at startup) ─────────────────────────────────────
// We test NVENC once before touching real data, so we never waste time on
// per-segment fallbacks that stall everything.
let nvencAvailable = null;  // null = not yet tested

async function detectNvenc(onLog) {
  if (nvencAvailable !== null) return nvencAvailable;

  const testOut = path.join(os.tmpdir(), `nvenc_test_${Date.now()}.mp4`);

  // Use an in-memory 1280x720 black frame via lavfi (no disk image needed)
  const args = [
    '-f', 'lavfi', '-i', 'color=black:s=1280x720:r=5:d=1',
    '-t', '0.5',
    '-c:v', 'h264_nvenc',
    '-preset', 'p2',
    '-rc', 'constqp',
    '-qp', '28',
    '-pix_fmt', 'yuv420p',
    '-an', '-y', testOut
  ];

  try {
    await runFFmpeg(args, null, 10000);   // 10s timeout
    nvencAvailable = true;
    onLog && onLog('🎮 NVIDIA NVENC detected — using GPU acceleration!');
  } catch (_) {
    nvencAvailable = false;
    onLog && onLog('⚙️  NVENC not available — using CPU encoder (ultrafast).');
  } finally {
    try { fs.unlinkSync(testOut); } catch (_) {}
  }

  return nvencAvailable;
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

async function renderVideo(params, callbacks) {
  const {
    coverDataURL, bgDataURL, wavPath, outputPath,
    chapters, blurAmount, bgOpacity, accentColor,
    logoDataURL, crf = 28,
    coverBorderWidth = 0,
    transitionStyle = 'fade',
    transitionDuration = 1.0,
    introClipPath = null,
    introAudioEnabled = true,
    introStyle = 'overlap',
    introFadeDuration = 1.0,
    codec = 'h264'   // 'h264' = h264_nvenc/libx264 | 'h265' = hevc_nvenc/libx265
  } = params;

  const { onProgress, onLog, renderFrame, isCancelled = () => false } = callbacks;
  const tmpDir = path.join(os.tmpdir(), `vexona-render-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Total work units for smooth overall progress:
  //   30% → still rendering   (chapters.length steps)
  //   55% → segment encoding  (chapters.length steps)
  //   10% → concat + mux      (fixed)
  const totalSteps = chapters.length * 2; // stills + segments
  let completedSteps = 0;

  function emitProgress(label) {
    const pct = Math.min(99, Math.round((completedSteps / totalSteps) * 90));
    onProgress({ phase: 'encoding', percent: pct, label });
  }

  try {
    // ── 1. Detect GPU once ──────────────────────────────────────────
    const useGPU = await detectNvenc(onLog);
    // RTX 5090 supports up to 8 concurrent NVENC sessions; CPU stays ≤ 3
    const parallelism = useGPU ? 8 : 3;
    if (useGPU) onLog(`🚀 Codec: ${codec === 'h265' ? 'H.265 HEVC NVENC' : 'H.264 NVENC'} | Parallelism: ${parallelism}`);
    else onLog(`⚙️  Codec: ${codec === 'h265' ? 'H.265 libx265' : 'H.264 libx264'} | Parallelism: ${parallelism}`);
    onLog(`\n🎬 Rendering ${chapters.length} chapter stills...`);

    // ── 2. Render one still PNG per chapter ────────────────────────
    const chapterFramePaths = [];
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const framePath = path.join(tmpDir, `still_${String(i).padStart(3, '0')}.png`);

      completedSteps++;
      emitProgress(`Rendering still ${i + 1} / ${chapters.length}`);
      onLog(`  Still ${i + 1}/${chapters.length}: ${ch.isNumbered ? `Ch.${ch.number} — ${ch.title}` : ch.title}`);

      const dataURL = await renderFrame({
        coverDataURL,
        bgDataURL: bgDataURL || coverDataURL,
        blurAmount, bgOpacity,
        chapter: ch,
        blendAlpha: 0,
        nextChapter: null,
        accentColor, logoDataURL,
        coverBorderWidth
      });

      if (!dataURL) throw new Error(`Frame render returned null for chapter ${i}`);
      const buf = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
      fs.writeFileSync(framePath, buf);
      chapterFramePaths.push(framePath);
    }

    // ── 3. Render transition frames & encode transition segments ─────────────
    // For each pair of adjacent chapters, generate TRANSITION_FPS * transitionDuration
    // frames blending from chapter[i] to chapter[i+1] and encode a short segment.

    const transSegmentPaths = []; // one per gap between chapters (length = chapters.length - 1)

    if (transitionStyle !== 'cut' && chapters.length > 1) {
      const transFrameCount = Math.max(2, Math.round(TRANSITION_FPS * transitionDuration));
      onLog(`\n✨ Rendering ${transitionStyle} transitions (${transitionDuration}s each, ${transFrameCount} frames)...`);

      for (let i = 0; i < chapters.length - 1; i++) {
        if (isCancelled()) throw new Error('RENDER_CANCELLED');
        onLog(`  Transition ${i + 1}/${chapters.length - 1}: Ch.${i + 1} → Ch.${i + 2}`);

        const transDir = path.join(tmpDir, `trans_${String(i).padStart(3,'0')}`);
        fs.mkdirSync(transDir, { recursive: true });

        const transFramePaths = [];

        for (let f = 0; f < transFrameCount; f++) {
          const alpha = f / (transFrameCount - 1); // 0.0 → 1.0

          // Build per-frame params based on transition type
          const frameParams = buildTransitionFrameParams({
            params,
            chapterA: chapters[i],
            chapterB: chapters[i + 1],
            alpha,
            transitionStyle
          });

          const dataURL = await renderFrame(frameParams);
          if (!dataURL) throw new Error(`Transition frame render returned null (trans ${i}, frame ${f})`);

          const framePath = path.join(transDir, `f_${String(f).padStart(4,'0')}.png`);
          const buf = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
          fs.writeFileSync(framePath, buf);
          transFramePaths.push(framePath);
        }

        // Encode the transition frames into a short video segment
        const transSegPath = path.join(tmpDir, `trans_seg_${String(i).padStart(3,'0')}.mp4`);
        await encodeFrameSequence({
          frameDir: transDir,
          outputPath: transSegPath,
          fps: TRANSITION_FPS,
          duration: transitionDuration,
          crf,
          useGPU,
          codec,
          isCancelled
        });
        transSegmentPaths.push(transSegPath);
      }
    }

    // ── 4. Encode chapter segments in parallel batches ───────────────────────
    onLog(`\n🎞️ Encoding ${chapters.length} segments at ${OUTPUT_FPS}fps (${parallelism} at a time, ${useGPU ? 'GPU' : 'CPU'})...`);

    const segmentPaths = chapters.map((_, i) =>
      path.join(tmpDir, `seg_${String(i).padStart(3, '0')}.mp4`)
    );

    let completedSegs = 0;
    for (let b = 0; b < chapters.length; b += parallelism) {
      if (isCancelled()) throw new Error('RENDER_CANCELLED');

      const batchIdxs = Array.from({ length: Math.min(parallelism, chapters.length - b) }, (_, k) => b + k);

      await Promise.all(batchIdxs.map(async (i) => {
        const ch = chapters[i];
        const rawDuration = ch.endTime - ch.startTime;

        // ── Transition budget ────────────────────────────────────────────────
        // Transitions are interleaved BETWEEN segments by the concat step, so
        // naïvely they ADD time to the video, causing ~1s of drift per chapter.
        // Fix: carve the transition time OUT of the adjacent chapter segments so
        // that total video duration == total audio duration.
        //
        //   Each segment donates:
        //     • transitionDuration/2 to the transition that FOLLOWS it  (trailing)
        //     • transitionDuration/2 to the transition that PRECEDES it  (leading)
        //
        // First/last chapters only donate one half (they have one neighbour).
        const usingTransitions = transitionStyle !== 'cut' && chapters.length > 1;
        const hasLeading  = usingTransitions && i > 0;
        const hasTrailing = usingTransitions && i < chapters.length - 1;
        const transitionBudget = (hasLeading  ? transitionDuration / 2 : 0)
                               + (hasTrailing ? transitionDuration / 2 : 0);

        // Snap to whole frames; keep minimum of one frame (0.2s at 5fps)
        const adjustedDuration = Math.max(1 / OUTPUT_FPS, rawDuration - transitionBudget);
        const frames   = Math.round(adjustedDuration * OUTPUT_FPS);
        const duration = frames / OUTPUT_FPS;

        await encodeSegment({
          imagePath: chapterFramePaths[i],
          outputPath: segmentPaths[i],
          duration, fps: OUTPUT_FPS, crf, useGPU, codec, isCancelled
        });
        completedSegs++;
        completedSteps++;
        emitProgress(`Encoded segment ${completedSegs} / ${chapters.length}`);
        onLog(`  ✓ Segment ${completedSegs}/${chapters.length} (${duration.toFixed(2)}s)`);
      }));
    }

    // ── 5. Concat: interleave chapter segs with transition segs ────────────
    onLog('\n📋 Concatenating segments (instant copy)...');
    onProgress({ phase: 'encoding', percent: 91, label: 'Concatenating segments...' });

    const concatListPath = path.join(tmpDir, 'concat.txt');

    // Build interleaved list: seg0, [trans0], seg1, [trans1], ... segN
    const allSegs = [];
    for (let i = 0; i < segmentPaths.length; i++) {
      allSegs.push(segmentPaths[i]);
      if (transSegmentPaths[i]) allSegs.push(transSegmentPaths[i]);
    }

    fs.writeFileSync(concatListPath,
      allSegs.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');

    const mergedVideoPath = path.join(tmpDir, 'merged_video.mp4');
    await runFFmpeg([
      '-f', 'concat', '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      '-y', mergedVideoPath
    ]);

    // ── 6. Mux audio (video -c copy, only audio encodes) ─────────
    onLog('\n🔊 Muxing audio...');
    onProgress({ phase: 'encoding', percent: 94, label: 'Muxing audio...' });

    const totalDuration = chapters[chapters.length - 1].endTime;
    
    const ext = path.extname(wavPath).toLowerCase();
    const canCopyAudio = ['.mp3', '.m4a', '.aac'].includes(ext);
    const audioCodecArgs = canCopyAudio 
      ? ['-c:a', 'copy'] 
      : ['-c:a', 'aac', '-b:a', '192k'];

    const hasIntro = !!introClipPath;
    const muxedTempPath = hasIntro ? path.join(tmpDir, 'muxed_temp.mp4') : outputPath;

    await runFFmpegWithProgress({
      args: [
        '-i', mergedVideoPath,
        '-i', wavPath,
        '-c:v', 'copy',
        ...audioCodecArgs,
        '-shortest',
        '-movflags', '+faststart',
        '-y', muxedTempPath
      ],
      totalDuration,
      isCancelled,
      onProgress: (sec) => {
        const pct = 94 + Math.round((sec / totalDuration) * (hasIntro ? 3 : 5));
        onProgress({
          phase: 'encoding',
          percent: Math.min(99, pct),
          label: `Muxing audio: ${formatSec(sec)} / ${formatSec(totalDuration)}`
        });
      }
    });

    // ── 7. Prepend Intro Clip ───────────────────────────────────────
    if (hasIntro) {
      onLog('\n🎬 Prepending intro clip...');
      onProgress({ phase: 'encoding', percent: 98, label: 'Adding intro clip...' });

      // We need the duration and audio info of the intro clip
      const introData = await getVideoDuration(introClipPath);
      const useAudio = introAudioEnabled && introData.hasAudio;

      const filterArgs = [];

      if (introStyle === 'overlap') {
        const D = introFadeDuration;
        const T = Math.max(0, introData.duration - D);
        
        // We scale the intro to 1280x720 (to match frameWindow), force the fps, and apply xfade.
        if (useAudio) {
          filterArgs.push(
            '-filter_complex',
            `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
            `[1:v]fps=${OUTPUT_FPS}[v1]; ` +
            `[v0][v1]xfade=transition=fade:duration=${D}:offset=${T}[vout]; ` +
            `[0:a][1:a]acrossfade=d=${D}[aout]`,
            '-map', '[vout]',
            '-map', '[aout]'
          );
        } else {
          filterArgs.push(
            '-filter_complex',
            `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
            `[1:v]fps=${OUTPUT_FPS}[v1]; ` +
            `[v0][v1]xfade=transition=fade:duration=${D}:offset=${T}[vout]`,
            '-map', '[vout]',
            '-map', '1:a'
          );
        }
      } else {
        // Sequential / Push style using concat
        if (useAudio) {
          filterArgs.push(
            '-filter_complex',
            `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
            `[1:v]fps=${OUTPUT_FPS}[v1]; ` +
            `[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[vout][aout]`,
            '-map', '[vout]',
            '-map', '[aout]'
          );
        } else {
          // If no intro audio, generate silence so concat still works seamlessly
          filterArgs.push(
            '-filter_complex',
            `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
            `[1:v]fps=${OUTPUT_FPS}[v1]; ` +
            `anullsrc=d=${introData.duration}:r=44100[silence]; ` +
            `[v0][silence][v1][1:a]concat=n=2:v=1:a=1[vout][aout]`,
            '-map', '[vout]',
            '-map', '[aout]'
          );
        }
      }

      const nvencCodec = codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc';
      const cpuCodec = codec === 'h265' ? 'libx265' : 'libx264';
      const finalCodec = useGPU ? nvencCodec : cpuCodec;
      
      const encodeArgs = useGPU ? [
        '-c:v', finalCodec,
        '-preset', 'p4',
        '-tune', 'hq',
        '-rc', 'vbr',
        '-cq', String(crf),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k'
      ] : [
        '-c:v', finalCodec,
        '-preset', 'fast',
        '-crf', String(crf),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k'
      ];

      await runFFmpeg([
        '-i', introClipPath,
        '-i', muxedTempPath,
        ...filterArgs,
        ...encodeArgs,
        '-y', outputPath
      ], isCancelled);
    }

    onLog('\n✅ Video export complete!');
    onProgress({ phase: 'done', percent: 100 });

    try {
      const stat = fs.statSync(outputPath);
      const mb = (stat.size / 1024 / 1024).toFixed(0);
      const gb = (stat.size / 1024 / 1024 / 1024).toFixed(2);
      const codecLabel = useGPU
        ? (codec === 'h265' ? 'GPU HEVC NVENC' : 'GPU H.264 NVENC')
        : (codec === 'h265' ? 'CPU H.265 libx265' : 'CPU H.264 libx264');
      onLog(`📦 Output: ${mb > 1024 ? gb + ' GB' : mb + ' MB'} | ${OUTPUT_FPS}fps | ${codecLabel}`);
    } catch (_) {}

  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ── Transition Frame Parameter Builder ──────────────────────────────────

/**
 * Translates a transition style + alpha into `renderFrame` params.
 * The frame window's renderFrame understands blendAlpha + nextChapter
 * for cross-dissolve. For other styles we fake the alpha on a single frame.
 *
 * Modes:
 *   fade      — fade to black (alpha 0..0.5 fade out, 0.5..1 fade in)
 *   dissolve  — true cross-dissolve between both chapters
 *   flare     — white flare burn at midpoint
 *   zoom      — zoom into chapter A as it fades, zoom out from chapter B
 */
function buildTransitionFrameParams({ params, chapterA, chapterB, alpha, transitionStyle }) {
  const base = {
    coverDataURL: params.coverDataURL,
    bgDataURL: params.bgDataURL,
    blurAmount: params.blurAmount,
    bgOpacity: params.bgOpacity,
    accentColor: params.accentColor,
    logoDataURL: params.logoDataURL,
    coverBorderWidth: params.coverBorderWidth
  };

  switch (transitionStyle) {
    case 'dissolve':
      // True dissolve: blend A into B
      return { ...base, chapter: chapterA, nextChapter: chapterB, blendAlpha: alpha, transitionType: 'dissolve' };

    case 'flare':
      // 0..0.5: fade out A into white; 0.5..1: fade in B from white
      if (alpha <= 0.5) {
        return { ...base, chapter: chapterA, nextChapter: null, blendAlpha: 0,
                 transitionType: 'flare', flareAlpha: alpha * 2 };
      } else {
        return { ...base, chapter: chapterB, nextChapter: null, blendAlpha: 0,
                 transitionType: 'flare', flareAlpha: 1 - (alpha - 0.5) * 2 };
      }

    case 'zoom':
      // 0..0.5: zoom in A while fading; 0.5..1: zoom out B while fading in
      if (alpha <= 0.5) {
        return { ...base, chapter: chapterA, nextChapter: null, blendAlpha: 0,
                 transitionType: 'zoom', zoomAlpha: alpha * 2, zoomIn: true };
      } else {
        return { ...base, chapter: chapterB, nextChapter: null, blendAlpha: 0,
                 transitionType: 'zoom', zoomAlpha: 1 - (alpha - 0.5) * 2, zoomIn: false };
      }

    case 'fade':
    default:
      // 0..0.5: fade A to black; 0.5..1: fade B in from black
      if (alpha <= 0.5) {
        return { ...base, chapter: chapterA, nextChapter: null, blendAlpha: 0,
                 transitionType: 'fade', fadeAlpha: 1 - alpha * 2 };
      } else {
        return { ...base, chapter: chapterB, nextChapter: null, blendAlpha: 0,
                 transitionType: 'fade', fadeAlpha: (alpha - 0.5) * 2 };
      }
  }
}

// ── Segment Encoder ───────────────────────────────────────────────────────────

function encodeSegment({ imagePath, outputPath, duration, fps, crf, useGPU, codec = 'h264', isCancelled }) {
  if (useGPU) {
    // RTX 5090 optimised settings:
    //   preset p4    — balanced quality/speed (5090 HW makes this as fast as p2 on older cards)
    //   tune hq      — high-quality mode, zero cost on dedicated NVENC hardware
    //   rc vbr+cq    — quality-based VBR (correct NVENC equivalent of CRF)
    const nvencCodec = codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc';
    return runFFmpeg([
      '-loop', '1', '-framerate', String(fps),
      '-t', duration.toFixed(6),
      '-i', imagePath,
      '-c:v', nvencCodec,
      '-preset', 'p4',
      '-tune', 'hq',
      '-rc', 'vbr',
      '-cq', String(crf),
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-an', '-y', outputPath
    ], isCancelled);
  }
  // CPU fallback
  const cpuCodec = codec === 'h265' ? 'libx265' : 'libx264';
  return runFFmpeg([
    '-loop', '1', '-framerate', String(fps),
    '-t', duration.toFixed(6),
    '-i', imagePath,
    '-c:v', cpuCodec,
    '-preset', 'ultrafast',
    '-tune', codec === 'h265' ? 'fastdecode' : 'stillimage',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-an', '-y', outputPath
  ], isCancelled);
}

/**
 * Encode a directory of sequentially named PNG frames into a video segment.
 * Used for transition sequences where each frame is unique.
 */
function encodeFrameSequence({ frameDir, outputPath, fps, duration, crf, useGPU, codec = 'h264', isCancelled }) {
  const inputPattern = path.join(frameDir, 'f_%04d.png');
  if (useGPU) {
    const nvencCodec = codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc';
    return runFFmpeg([
      '-framerate', String(fps),
      '-i', inputPattern,
      '-t', duration.toFixed(6),
      '-c:v', nvencCodec,
      '-preset', 'p4',
      '-tune', 'hq',
      '-rc', 'vbr',
      '-cq', String(crf),
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-an', '-y', outputPath
    ], isCancelled);
  }
  // CPU fallback
  const cpuCodec = codec === 'h265' ? 'libx265' : 'libx264';
  return runFFmpeg([
    '-framerate', String(fps),
    '-i', inputPattern,
    '-t', duration.toFixed(6),
    '-c:v', cpuCodec,
    '-preset', 'ultrafast',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-an', '-y', outputPath
  ], isCancelled);
}


// ── FFmpeg Helpers ────────────────────────────────────────────────────────────

function runFFmpeg(args, isCancelled, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    let killed = false;
    proc.stderr.on('data', c => { stderr += c.toString(); });

    // Poll for cancellation every 200ms and kill the process immediately
    const cancelPoller = isCancelled ? setInterval(() => {
      if (isCancelled() && !killed) {
        killed = true;
        proc.kill();
        reject(new Error('RENDER_CANCELLED'));
      }
    }, 200) : null;

    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => {
        killed = true;
        proc.kill();
        if (cancelPoller) clearInterval(cancelPoller);
        reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    proc.on('close', code => {
      if (timer) clearTimeout(timer);
      if (cancelPoller) clearInterval(cancelPoller);
      if (killed) return; // already rejected
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed (code ${code}):\n${stderr.slice(-1500)}`));
    });
    proc.on('error', (e) => {
      if (timer) clearTimeout(timer);
      if (cancelPoller) clearInterval(cancelPoller);
      if (!killed) reject(e);
    });
  });
}

function runFFmpegWithProgress({ args, totalDuration, onProgress, isCancelled }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    let killed = false;
    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      const m = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && onProgress) {
        const sec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        onProgress(sec);
      }
    });

    // Poll for cancellation every 200ms
    const cancelPoller = isCancelled ? setInterval(() => {
      if (isCancelled() && !killed) {
        killed = true;
        proc.kill();
        reject(new Error('RENDER_CANCELLED'));
      }
    }, 200) : null;

    proc.on('close', code => {
      if (cancelPoller) clearInterval(cancelPoller);
      if (killed) return;
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed (code ${code}):\n${stderr.slice(-2000)}`));
    });
    proc.on('error', (e) => {
      if (cancelPoller) clearInterval(cancelPoller);
      if (!killed) reject(e);
    });
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatSec(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function getAudioDuration(wavPath) {
  return new Promise((resolve, reject) => {
    fluent.ffprobe(wavPath, (err, metadata) => {
      if (err) reject(new Error(err.message));
      else resolve(metadata.format.duration);
    });
  });
}

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    fluent.ffprobe(videoPath, (err, metadata) => {
      if (err) reject(new Error(err.message));
      else {
        const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');
        resolve({ duration: metadata.format.duration, hasAudio });
      }
    });
  });
}

module.exports = { renderVideo, getAudioDuration, getVideoDuration };
