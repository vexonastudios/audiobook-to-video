const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const fluent = require('fluent-ffmpeg');
const { resolveOpeningTitleSequence } = require('./openingTitles');
const { buildChapterTimeline, transitionAlpha } = require('./chapterTimeline');
const { resolvePrintPromotionSchedule, buildPrintPromotionOverlayFilter } = require('./printPromotion');
let ffmpegPath = require('ffmpeg-static');
let ffprobePath = require('@ffprobe-installer/ffprobe').path;

ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');

fluent.setFfmpegPath(ffmpegPath);
fluent.setFfprobePath(ffprobePath);

const OUTPUT_FPS = 30;
const TRANSITION_FPS = 30; // match chapter FPS — halves render cost, fixes concat FPS mismatch
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const OUTPUT_SIZE = `${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}`;
// Exact for 30fps, while keeping MP4 video-track counters decoder-safe for
// audiobooks up to nearly 199 hours (90000 crosses signed 32-bit at 6:37:41).
const VIDEO_TRACK_TIMESCALE = 3000;

// ── GPU Detection (run once at startup) ─────────────────────────────────────
// We test NVENC once before touching real data, so we never waste time on
// per-segment fallbacks that stall everything.
let nvencAvailable = null;  // null = not yet tested

async function detectNvenc(onLog) {
  if (nvencAvailable !== null) return nvencAvailable;

  const testOut = path.join(os.tmpdir(), `nvenc_test_${Date.now()}.mp4`);

  // Use an in-memory output-sized black frame via lavfi (no disk image needed)
  const args = [
    '-f', 'lavfi', '-i', `color=black:s=${OUTPUT_SIZE}:r=5:d=1`,
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
    coverBacklight = 0.45,
    transitionStyle = 'cut',
    transitionDuration = 1.0,
    introClipPath = null,
    introAudioEnabled = true,
    introStyle = 'push',
    introFadeDuration = 1.0,
    codec = 'h264',   // 'h264' = h264_nvenc/libx264 | 'h265' = hevc_nvenc/libx265
    fastAudioCopy = true,
    printPromoEnabled = true,
    printPromoImageDataURL = null,
    authorPhotoDataURL = null,
    authorPhotoPositionX = 50,
    authorPhotoPositionY = 35,
    authorPhotoZoom = 1,
    printPromoStart = 30,
    printPromoDuration = 8,
    openingTitlesEnabled = false,
    openingTitles = {},
    titleFontSize = 0,
    bgOffsetY = 0
  } = params;

  const {
    onProgress,
    onLog,
    renderFrame,
    renderOpeningFrameToFile,
    renderPromotionOverlayToFile,
    encodeParallelism,
    isCancelled = () => false
  } = callbacks;
  const chapterTimeline = buildChapterTimeline(chapters, transitionStyle, transitionDuration, OUTPUT_FPS);
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
    callbacks.onProfile?.({ encoder: useGPU
      ? (codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc')
      : (codec === 'h265' ? 'libx265' : 'libx264') });
    // RTX 5090 supports up to 8 concurrent NVENC sessions; CPU stays ≤ 3
    // A host/test may cap concurrency when another render is using the GPU.
    const maximumParallelism = useGPU ? 8 : 3;
    const parallelism = Number.isInteger(encodeParallelism) && encodeParallelism > 0
      ? Math.min(encodeParallelism, maximumParallelism) : maximumParallelism;
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
        bgOffsetY,
        chapter: ch,
        blendAlpha: 0,
        nextChapter: null,
        accentColor, logoDataURL,
        coverBorderWidth,
        coverBacklight,
        titleFontSize
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
      onLog(`\n✨ Rendering ${transitionStyle} transitions (up to ${transitionDuration}s each; chapter markers stay fixed)...`);

      for (let i = 0; i < chapters.length - 1; i++) {
        if (isCancelled()) throw new Error('RENDER_CANCELLED');
        const transition = chapterTimeline.transitions[i];
        if (!transition) { transSegmentPaths.push(null); continue; }
        const transFrameCount = transition.frameCount;
        if (transFrameCount < Math.round(TRANSITION_FPS * transitionDuration)) {
          onLog(`  Transition ${i + 1} shortened to ${transition.duration.toFixed(2)}s to fit adjacent chapters; timestamps unchanged.`);
        }
        onLog(`  Transition ${i + 1}/${chapters.length - 1}: Ch.${i + 1} → Ch.${i + 2}`);

        const transDir = path.join(tmpDir, `trans_${String(i).padStart(3,'0')}`);
        fs.mkdirSync(transDir, { recursive: true });

        const transFramePaths = [];

        for (let f = 0; f < transFrameCount; f++) {
          const alpha = transitionAlpha(transition, f);

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
          duration: transition.duration,
          crf,
          useGPU,
          codec,
          isCancelled
        });
        transSegmentPaths.push(transSegPath);
      }
    }

    const openingSequence = openingTitlesEnabled
      ? resolveOpeningTitleSequence(
          openingTitles,
          Math.max(0, chapterTimeline.stills[0].duration - (1 / OUTPUT_FPS)),
          OUTPUT_FPS
        )
      : null;
    let openingSegmentPath = null;

    if (openingTitlesEnabled) {
      if (!openingSequence) {
        onLog('⚠ Opening titles skipped because no completed cards fit inside the first chapter.');
      } else {
        if (!renderOpeningFrameToFile) throw new Error('Opening title renderer callback is unavailable.');
        const openingDir = path.join(tmpDir, 'opening_titles');
        fs.mkdirSync(openingDir, { recursive: true });
        const blankPath = path.join(openingDir, 'blank.png');
        const cardPaths = [];
        const stillCount = openingSequence.cards.length + 1;
        onLog(`\n✨ Rendering ${openingSequence.cards.length} opening title card${openingSequence.cards.length === 1 ? '' : 's'} once (${openingSequence.duration.toFixed(1)}s sequence)...`);

        const baseOpeningParams = {
          coverDataURL,
          bgDataURL: bgDataURL || coverDataURL,
          blurAmount,
          bgOpacity,
          bgOffsetY,
          chapter: chapters[0],
          accentColor,
          logoDataURL,
          authorPhotoDataURL,
          authorPhotoPositionX,
          authorPhotoPositionY,
          authorPhotoZoom,
          coverBorderWidth,
          coverBacklight,
          titleFontSize
        };
        await renderOpeningFrameToFile({ ...baseOpeningParams, openingBlank: true }, blankPath);
        onProgress({
          phase: 'frames',
          current: 1,
          total: stillCount,
          percent: 32
        });

        for (let index = 0; index < openingSequence.cards.length; index++) {
          if (isCancelled()) throw new Error('RENDER_CANCELLED');
          const framePath = path.join(openingDir, `card_${String(index).padStart(2, '0')}.png`);
          await renderOpeningFrameToFile({
            ...baseOpeningParams,
            openingPreviewCard: openingSequence.cards[index]
          }, framePath);
          cardPaths.push(framePath);
          onProgress({
            phase: 'frames',
            current: index + 2,
            total: stillCount,
            percent: 30 + Math.round(((index + 2) / stillCount) * 10)
          });
        }

        openingSegmentPath = path.join(tmpDir, 'opening_titles.mp4');
        await encodeOpeningTitleSequenceVideo({
          blankPath,
          cardPaths,
          chapterPath: chapterFramePaths[0],
          sequence: openingSequence,
          outputPath: openingSegmentPath,
          crf,
          useGPU,
          codec,
          isCancelled
        });
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
        // Consume the shared absolute-frame schedule; never round individual
        // chapter durations or add minimum holds outside their original slot.
        const openingFrames = i === 0 && openingSequence ? openingSequence.frameCount : 0;
        const frames = chapterTimeline.stills[i].frameCount - openingFrames;
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
    if (openingSegmentPath) allSegs.push(openingSegmentPath);
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
      '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
      '-y', mergedVideoPath
    ]);

    const totalDuration = chapters[chapters.length - 1].endTime;
    let finalDuration = totalDuration;
    let videoForMux = mergedVideoPath;
    if (printPromoEnabled) {
      if (!renderPromotionOverlayToFile) throw new Error('Print promotion renderer callback is unavailable.');
      const schedule = resolvePrintPromotionSchedule(totalDuration, printPromoStart, printPromoDuration, wavPath);
      if (schedule.length > 0) {
        onLog(`\n📚 Adding ${schedule.length} print-edition promotion(s) at ${schedule.map(t => formatSec(t.start)).join(', ')}...`);
        onProgress({ phase: 'encoding', percent: 92, label: 'Adding print-edition promotion...' });
        const overlayPath = path.join(tmpDir, 'print_promotion_overlay.png');
        const promotedVideoPath = path.join(tmpDir, 'merged_video_with_promotion.mp4');
        await renderPromotionOverlayToFile({
          coverDataURL,
          printPromoImageDataURL,
          accentColor,
          visibility: 1
        }, overlayPath);
        await encodeLegacyPrintPromotion({
          videoPath: mergedVideoPath,
          overlayPath,
          outputPath: promotedVideoPath,
          schedule,
          totalDuration,
          useGPU,
          codec,
          crf,
          isCancelled
        });
        videoForMux = promotedVideoPath;
      } else {
        onLog('⚠ Print promotion skipped because the audiobook is too short.');
      }
    }

    // ── 6. Mux audio (video -c copy, only audio encodes) ─────────
    onLog('\n🔊 Muxing audio...');
    onProgress({ phase: 'encoding', percent: 94, label: 'Muxing audio...' });

    const ext = path.extname(wavPath).toLowerCase();
    const hasIntro = !!introClipPath;
    const isSequentialIntro = hasIntro && introStyle === 'push';

    // Check if we can and want to copy audio
    const audioDetails = await getAudioDetails(wavPath);
    const isCopyableFormat = ['.mp3', '.m4a', '.aac'].includes(ext) || ['mp3', 'aac', 'm4a'].includes(audioDetails.codec);
    const useAudioCopy = fastAudioCopy && isCopyableFormat;

    const audioCodecArgs = useAudioCopy 
      ? ['-c:a', 'copy'] 
      : ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100'];

    const muxedTempPath = hasIntro ? path.join(tmpDir, 'muxed_temp.mp4') : outputPath;

    await runFFmpegWithProgress({
      args: [
        '-i', videoForMux,
        '-i', wavPath,
        '-c:v', 'copy',
        ...audioCodecArgs,
        '-shortest',
        '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
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
      finalDuration = Number(introData.duration) + totalDuration - (introStyle === 'overlap' ? introFadeDuration : 0);
      const useAudio = introAudioEnabled && introData.hasAudio;

      const filterArgs = [];

      if (introStyle === 'overlap') {
        const D = introFadeDuration;
        const T = Math.max(0, introData.duration - D);
        
        // Scale the intro to match the 1080p frame renderer, force the fps, and apply xfade.
        if (useAudio) {
          filterArgs.push(
            '-filter_complex',
            `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
            `[1:v]fps=${OUTPUT_FPS}[v1]; ` +
            `[v0][v1]xfade=transition=fade:duration=${D}:offset=${T}[vout]; ` +
            `[0:a][1:a]acrossfade=d=${D}[aout]`,
            '-map', '[vout]',
            '-map', '[aout]'
          );
        } else {
          filterArgs.push(
            '-filter_complex',
            `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
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
            `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
            `[1:v]fps=${OUTPUT_FPS}[v1]; ` +
            `[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[vout][aout]`,
            '-map', '[vout]',
            '-map', '[aout]'
          );
        } else {
          // If no intro audio, generate silence so concat still works seamlessly
          filterArgs.push(
            '-filter_complex',
            `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v0]; ` +
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

      if (introStyle === 'overlap') {
        const totalOverlapDuration = introData.duration + totalDuration - introFadeDuration;
        onLog(`   - Re-encoding entire video with intro crossfade (${formatSec(totalOverlapDuration)})...`);
        await runFFmpegWithProgress({
          args: [
            '-i', introClipPath,
            '-i', muxedTempPath,
            ...filterArgs,
            ...encodeArgs,
            '-ar', '44100',
            '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
            '-y', outputPath
          ],
          totalDuration: totalOverlapDuration,
          isCancelled,
          onProgress: (sec) => {
            const pct = 98 + Math.round((sec / totalOverlapDuration) * 1.9);
            onProgress({
              phase: 'encoding',
              percent: Math.min(99, pct),
              label: `Encoding crossfade: ${formatSec(sec)} / ${formatSec(totalOverlapDuration)}`
            });
          }
        });
      } else {
        // Sequential / Push style using instant concat demuxer!
        // 1. Normalize intro to exactly match muxedTempPath
        const normalizedIntro = path.join(tmpDir, 'intro_normalized.mp4');
        
        let introAudioCodecArgs = [];
        let normalizeFilter;
        let mapArgs;

        if (useAudio) {
          normalizeFilter = `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v]`;
          mapArgs = ['-map', '[v]', '-map', '0:a'];
          if (useAudioCopy && audioDetails.codec) {
            // Match the audiobook's audio properties
            const targetCodec = audioDetails.codec === 'mp3' ? 'libmp3lame' : 'aac';
            introAudioCodecArgs = [
              '-c:a', targetCodec,
              '-b:a', '192k',
              '-ar', String(audioDetails.sampleRate || 44100),
              '-ac', String(audioDetails.channels || 2)
            ];
          } else {
            introAudioCodecArgs = ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100'];
          }
        } else {
          const sampleRate = (useAudioCopy && audioDetails.sampleRate) ? audioDetails.sampleRate : 44100;
          normalizeFilter = `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS}[v]; anullsrc=d=${introData.duration}:r=${sampleRate}[a]`;
          mapArgs = ['-map', '[v]', '-map', '[a]'];
          if (useAudioCopy && audioDetails.codec) {
            const targetCodec = audioDetails.codec === 'mp3' ? 'libmp3lame' : 'aac';
            introAudioCodecArgs = [
              '-c:a', targetCodec,
              '-b:a', '192k',
              '-ar', String(sampleRate),
              '-ac', String(audioDetails.channels || 2)
            ];
          } else {
            introAudioCodecArgs = ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100'];
          }
        }

        onLog('   - Normalizing intro clip parameters...');
        onProgress({ phase: 'encoding', percent: 98, label: 'Normalizing intro clip...' });
        await runFFmpeg([
          '-i', introClipPath,
          '-filter_complex', normalizeFilter,
          ...mapArgs,
          ...encodeArgs,
          ...introAudioCodecArgs,
          '-r', String(OUTPUT_FPS),
          '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
          '-y', normalizedIntro
        ], isCancelled);

        // 2. Concat demux normalized intro with main video instantly
        onLog('   - Instantly concatenating intro and audiobook...');
        onProgress({ phase: 'encoding', percent: 99, label: 'Concatenating intro and audiobook...' });
        const introConcatListPath = path.join(tmpDir, 'intro_concat_list.txt');
        require('fs').writeFileSync(introConcatListPath, `file '${normalizedIntro.replace(/\\/g, '/')}'\nfile '${muxedTempPath.replace(/\\/g, '/')}'`, 'utf8');

        await runFFmpeg([
          '-f', 'concat', '-safe', '0',
          '-i', introConcatListPath,
          '-c', 'copy',
          '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
          '-y', outputPath
        ], isCancelled);
      }
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
    return { durationSeconds: finalDuration };

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
    bgOffsetY: params.bgOffsetY,
    accentColor: params.accentColor,
    logoDataURL: params.logoDataURL,
    coverBorderWidth: params.coverBorderWidth,
    coverBacklight: params.coverBacklight,
    titleFontSize: params.titleFontSize
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
      '-i', imagePath,
      '-frames:v', String(Math.round(duration * fps)),
      '-c:v', nvencCodec,
      '-preset', 'p4',
      '-tune', 'hq',
      '-rc', 'vbr',
      '-cq', String(crf),
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
      '-an', '-y', outputPath
    ], isCancelled);
  }
  // CPU fallback
  const cpuCodec = codec === 'h265' ? 'libx265' : 'libx264';
  return runFFmpeg([
    '-loop', '1', '-framerate', String(fps),
    '-i', imagePath,
    '-frames:v', String(Math.round(duration * fps)),
    '-c:v', cpuCodec,
    '-preset', 'ultrafast',
    '-tune', codec === 'h265' ? 'fastdecode' : 'stillimage',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
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
      '-frames:v', String(Math.round(duration * fps)),
      '-c:v', nvencCodec,
      '-preset', 'p4',
      '-tune', 'hq',
      '-rc', 'vbr',
      '-cq', String(crf),
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
      '-an', '-y', outputPath
    ], isCancelled);
  }
  // CPU fallback
  const cpuCodec = codec === 'h265' ? 'libx265' : 'libx264';
  return runFFmpeg([
    '-framerate', String(fps),
    '-i', inputPattern,
    '-frames:v', String(Math.round(duration * fps)),
    '-c:v', cpuCodec,
    '-preset', 'ultrafast',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
    '-an', '-y', outputPath
  ], isCancelled);
}

function encodeOpeningTitleSequenceVideo({
  blankPath,
  cardPaths,
  chapterPath,
  sequence,
  outputPath,
  crf,
  useGPU,
  codec = 'h264',
  isCancelled
}) {
  if (!sequence || cardPaths.length !== sequence.cards.length) {
    throw new Error('Opening title card images do not match the resolved sequence.');
  }

  const { cardTimings, fadeDuration, duration } = sequence;
  const imageInputs = [
    { path: blankPath, duration: fadeDuration },
    ...cardPaths.map((imagePath, index) => ({
      path: imagePath,
      duration: cardTimings[index].duration + (index === cardPaths.length - 1 ? 0 : fadeDuration)
    })),
    { path: chapterPath, duration: fadeDuration }
  ];
  const inputArgs = imageInputs.flatMap(input => [
    '-loop', '1', '-framerate', String(OUTPUT_FPS),
    '-t', input.duration.toFixed(6), '-i', input.path
  ]);
  const filters = imageInputs.map((_, index) =>
    `[${index}:v]fps=${OUTPUT_FPS},scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:flags=lanczos,` +
    `format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`
  );

  let currentLabel = 'v0';
  for (let index = 0; index < cardPaths.length; index++) {
    const outputLabel = `opening_xfade_${index}`;
    const offset = cardTimings[index].start;
    filters.push(
      `[${currentLabel}][v${index + 1}]xfade=transition=fade:` +
      `duration=${fadeDuration.toFixed(6)}:offset=${offset.toFixed(6)}[${outputLabel}]`
    );
    currentLabel = outputLabel;
  }

  const chapterInputIndex = imageInputs.length - 1;
  filters.push(
    `[${currentLabel}][v${chapterInputIndex}]xfade=transition=fade:` +
    `duration=${fadeDuration.toFixed(6)}:offset=${(duration - fadeDuration).toFixed(6)}[opening_final]`
  );
  filters.push(
    `[opening_final]trim=end_frame=${sequence.frameCount},setpts=PTS-STARTPTS[vout]`
  );

  const videoArgs = useGPU
    ? [
        '-c:v', codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc',
        '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', String(crf)
      ]
    : [
        '-c:v', codec === 'h265' ? 'libx265' : 'libx264',
        '-preset', 'ultrafast', '-crf', String(crf)
      ];

  return runFFmpeg([
    ...inputArgs,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-frames:v', String(sequence.frameCount),
    ...videoArgs,
    '-pix_fmt', 'yuv420p', '-r', String(OUTPUT_FPS), '-fps_mode:v', 'cfr',
    '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
    '-an', '-y', outputPath
  ], isCancelled);
}

function encodeLegacyPrintPromotion({
  videoPath,
  overlayPath,
  outputPath,
  schedule,
  totalDuration,
  useGPU,
  codec,
  crf,
  isCancelled
}) {
  const filter = buildPrintPromotionOverlayFilter(schedule);
  const artworkInputs = schedule.flatMap(({ duration }) => [
    '-loop', '1', '-framerate', String(OUTPUT_FPS), '-t', duration.toFixed(6), '-i', overlayPath
  ]);
  const videoArgs = useGPU
    ? [
        '-c:v', codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc',
        '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', String(crf)
      ]
    : [
        '-c:v', codec === 'h265' ? 'libx265' : 'libx264',
        '-preset', 'fast', '-crf', String(crf)
      ];

  return runFFmpeg([
    '-i', videoPath,
    ...artworkInputs,
    '-filter_complex', filter,
    '-map', '[vout]', '-t', totalDuration.toFixed(6),
    ...videoArgs,
    '-pix_fmt', 'yuv420p', '-r', String(OUTPUT_FPS),
    '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE), '-an', '-y', outputPath
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

function getAudioDetails(wavPath) {
  return new Promise((resolve, reject) => {
    fluent.ffprobe(wavPath, (err, metadata) => {
      if (err) reject(new Error(err.message));
      else {
        const stream = metadata.streams.find(s => s.codec_type === 'audio');
        resolve({
          duration: parseFloat(metadata.format.duration),
          codec: stream ? stream.codec_name : null,
          sampleRate: stream ? parseInt(stream.sample_rate) : null,
          channels: stream ? parseInt(stream.channels) : null
        });
      }
    });
  });
}

async function getAudioDuration(wavPath) {
  const details = await getAudioDetails(wavPath);
  return details.duration;
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

const { renderVideo: renderVideoOptimized } = require('./renderPipeline');

async function renderVideoDispatch(params, callbacks) {
  if (params.forceLegacyRender) {
    callbacks.onLog('\n🛡 Compatibility Mode: using the legacy constant-30fps renderer.');
    return renderVideo(params, callbacks);
  }
  return renderVideoOptimized(params, callbacks);
}

module.exports = {
  renderVideo: renderVideoDispatch,
  renderVideoLegacy: renderVideo,
  getAudioDuration,
  getVideoDuration
};
