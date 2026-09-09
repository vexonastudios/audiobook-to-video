const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fluent = require('fluent-ffmpeg');
const { resolveOpeningTitleSequence } = require('./openingTitles');
const { buildChapterTimeline, transitionAlpha } = require('./chapterTimeline');
const { resolvePrintPromotionSchedule } = require('./printPromotion');

let ffmpegPath = require('ffmpeg-static');
let ffprobePath = require('@ffprobe-installer/ffprobe').path;

ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
fluent.setFfmpegPath(ffmpegPath);
fluent.setFfprobePath(ffprobePath);

const OUTPUT_FPS = 30;
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const OUTPUT_SIZE = `${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}`;
const FRAME_DURATION = 1 / OUTPUT_FPS;
// 3000 is exactly divisible by 30fps and keeps signed 32-bit track durations
// safe for nearly 199 hours. A 90000 timescale overflows that boundary at
// 6:37:41 and can produce a green video surface in Windows Media Player.
const VIDEO_TRACK_TIMESCALE = 3000;
// Keep source-image samples close enough together that FFmpeg can build the
// constant-frame-rate stream without ambiguous chapter-boundary rounding.
const MAX_HOLD_SAMPLE_DURATION = 1;

const nvencAvailability = new Map();

async function renderVideo(params, callbacks) {
  const {
    coverDataURL,
    bgDataURL,
    wavPath,
    outputPath,
    chapters,
    blurAmount,
    bgOpacity,
    bgOffsetY = 0,
    accentColor,
    logoDataURL,
    crf = 18,
    coverBorderWidth = 0,
    coverBacklight = 0.45,
    transitionStyle = 'cut',
    transitionDuration = 1,
    introClipPath = null,
    introAudioEnabled = true,
    introStyle = 'push',
    introFadeDuration = 1,
    codec = 'h264',
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
    audioCacheDir = path.join(os.tmpdir(), 'audiobook-video-generator-audio-cache')
  } = params;

  const {
    onProgress,
    onLog,
    prepareFrameRenderer,
    renderFrameToFile,
    renderOpeningFrameToFile,
    renderTransitionFrameToFile,
    renderPromotionFrameToFile,
    isCancelled = () => false
  } = callbacks;

  if (!chapters || chapters.length === 0) throw new Error('No chapters were provided for rendering.');
  const chapterTimeline = buildChapterTimeline(chapters, transitionStyle, transitionDuration, OUTPUT_FPS);
  if (!prepareFrameRenderer || !renderFrameToFile || !renderTransitionFrameToFile) {
    throw new Error('Optimized frame renderer callbacks are unavailable.');
  }
  if (printPromoEnabled && !renderPromotionFrameToFile) {
    throw new Error('Print promotion renderer callback is unavailable.');
  }

  const renderStartedAt = Date.now();
  const tmpDir = path.join(os.tmpdir(), `vexona-render-${Date.now()}-${process.pid}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  let abortRequested = false;
  let audioPromise = null;
  const cancelled = () => abortRequested || isCancelled();
  const totalDuration = chapters[chapters.length - 1].endTime;

  const reportProgress = (percent, label) => {
    onProgress({ phase: 'encoding', percent: Math.max(0, Math.min(99, Math.round(percent))), label });
  };

  const timed = async (label, fn) => {
    const startedAt = Date.now();
    const value = await fn();
    onLog(`⏱ ${label}: ${formatElapsed((Date.now() - startedAt) / 1000)}`);
    return value;
  };

  try {
    const useGPU = await detectNvenc(codec, onLog);
    callbacks.onProfile?.({ encoder: useGPU
      ? (codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc')
      : (codec === 'h265' ? 'libx265' : 'libx264') });
    onLog(`\n🚀 Optimized timeline: ${OUTPUT_SIZE}, constant ${OUTPUT_FPS}fps, ${useGPU ? 'NVENC' : 'CPU'}`);

    const introData = introClipPath ? await probeMedia(introClipPath) : null;
    const overlapFade = introClipPath && introStyle === 'overlap'
      ? Math.min(introFadeDuration, introData.duration, totalDuration)
      : 0;

    // Audio preparation runs concurrently with all visual work.
    audioPromise = introClipPath && introStyle === 'overlap'
      ? prepareOverlapAudio({
          audiobookPath: wavPath,
          introClipPath,
          introData,
          introAudioEnabled,
          fadeDuration: overlapFade,
          audiobookDuration: totalDuration,
          cacheDir: audioCacheDir,
          isCancelled: cancelled,
          onLog
        })
      : prepareAudioTrack({
          inputPath: wavPath,
          fastAudioCopy,
          cacheDir: audioCacheDir,
          isCancelled: cancelled,
          onLog
        });
    // Attach a handler immediately so an early encoder failure cannot become an
    // unhandled rejection while visual frames are still being rendered.
    audioPromise.catch(() => {});

    reportProgress(2, 'Preparing frame renderer...');
    await prepareFrameRenderer({
      coverDataURL,
      bgDataURL: bgDataURL || coverDataURL,
      blurAmount,
      bgOpacity,
      bgOffsetY,
      accentColor,
      logoDataURL,
      printPromoImageDataURL,
      authorPhotoDataURL,
      authorPhotoPositionX,
      authorPhotoPositionY,
      authorPhotoZoom,
      coverBorderWidth,
      coverBacklight,
      titleFontSize
    });

    const chapterFramePaths = await timed('Chapter still rendering', async () => {
      onLog(`\n🖼️ Rendering ${chapters.length} chapter stills once...`);
      const paths = [];
      for (let i = 0; i < chapters.length; i++) {
        if (cancelled()) throw new Error('RENDER_CANCELLED');
        const framePath = path.join(tmpDir, `still_${String(i).padStart(3, '0')}.png`);
        await renderFrameToFile({
          chapter: chapters[i],
          blendAlpha: 0,
          nextChapter: null
        }, framePath);
        paths.push(framePath);
        reportProgress(2 + ((i + 1) / chapters.length) * 10, `Rendered still ${i + 1} / ${chapters.length}`);
      }
      return paths;
    });

    const transitionFrames = await timed('Transition rendering', async () => {
      const groups = [];
      if (transitionStyle === 'cut' || chapters.length < 2) return groups;

      const totalFrames = chapterTimeline.transitions.reduce((sum, transition) => sum + (transition?.frameCount || 0), 0);
      let renderedFrames = 0;
      onLog(`\n✨ Rendering ${chapters.length - 1} transitions from completed stills (${totalFrames} frames)...`);

      for (let i = 0; i < chapters.length - 1; i++) {
        const transition = chapterTimeline.transitions[i];
        if (!transition) { groups.push(null); continue; }
        const frameCount = transition.frameCount;
        if (frameCount < Math.round(OUTPUT_FPS * transitionDuration)) {
          onLog(`  Transition ${i + 1} shortened to ${transition.duration.toFixed(2)}s to fit adjacent chapters; timestamps unchanged.`);
        }
        const transitionDir = path.join(tmpDir, `transition_${String(i).padStart(3, '0')}`);
        fs.mkdirSync(transitionDir, { recursive: true });
        const paths = [];

        for (let f = 0; f < frameCount; f++) {
          if (cancelled()) throw new Error('RENDER_CANCELLED');
          const framePath = path.join(transitionDir, `f_${String(f).padStart(4, '0')}.png`);
          await renderTransitionFrameToFile({
            fromPath: chapterFramePaths[i],
            toPath: chapterFramePaths[i + 1],
            transitionStyle,
            alpha: transitionAlpha(transition, f)
          }, framePath);
          paths.push(framePath);
          renderedFrames++;
          reportProgress(12 + (renderedFrames / totalFrames) * 10, `Rendered transition frame ${renderedFrames} / ${totalFrames}`);
        }
        groups.push(paths);
      }
      return groups;
    });

    const firstChapterDuration = chapters[0].endTime - chapters[0].startTime;
    let openingSequence = openingTitlesEnabled
      ? resolveOpeningTitleSequence(
          openingTitles,
          Math.max(0, chapterTimeline.stills[0].duration - FRAME_DURATION),
          OUTPUT_FPS
        )
      : null;
    const requiredOpeningLead = introClipPath && introStyle === 'overlap'
      ? Math.min(overlapFade, Math.max(FRAME_DURATION, firstChapterDuration - FRAME_DURATION))
      : 0;
    if (openingSequence && openingSequence.duration + 1e-9 < requiredOpeningLead) {
      onLog('⚠ Opening titles skipped because the first chapter is too short for the intro overlap.');
      openingSequence = null;
    }

    const openingSegmentPath = openingTitlesEnabled
      ? await timed('Opening title rendering', async () => {
          if (!openingSequence) {
            onLog('⚠ Opening titles skipped because no completed cards fit inside the first chapter.');
            return null;
          }
          if (!renderOpeningFrameToFile) throw new Error('Opening title renderer callback is unavailable.');

          const openingDir = path.join(tmpDir, 'opening_titles');
          fs.mkdirSync(openingDir, { recursive: true });
          const blankPath = path.join(openingDir, 'blank.png');
          const cardPaths = [];
          const stillCount = openingSequence.cards.length + 1;
          onLog(`\n✨ Rendering ${openingSequence.cards.length} opening title card${openingSequence.cards.length === 1 ? '' : 's'} once (${openingSequence.duration.toFixed(1)}s sequence)...`);

          await renderOpeningFrameToFile({
            chapter: chapters[0],
            openingBlank: true
          }, blankPath);
          reportProgress(22 + (1 / stillCount) * 4, `Rendered opening title still 1 / ${stillCount}`);

          for (let index = 0; index < openingSequence.cards.length; index++) {
            if (cancelled()) throw new Error('RENDER_CANCELLED');
            const framePath = path.join(openingDir, `card_${String(index).padStart(2, '0')}.png`);
            await renderOpeningFrameToFile({
              chapter: chapters[0],
              openingPreviewCard: openingSequence.cards[index]
            }, framePath);
            cardPaths.push(framePath);
            reportProgress(22 + ((index + 2) / stillCount) * 4, `Rendered opening title still ${index + 2} / ${stillCount}`);
          }

          const segmentPath = path.join(openingDir, 'opening_titles.mp4');
          reportProgress(27, 'Animating opening title cards with FFmpeg...');
          await encodeOpeningTitleSequenceVideo({
            blankPath,
            cardPaths,
            chapterPath: chapterFramePaths[0],
            sequence: openingSequence,
            outputPath: segmentPath,
            useGPU,
            codec,
            crf,
            isCancelled: cancelled
          });
          return segmentPath;
        })
      : null;

    let timelineEntries = buildTimelineEntries({
      chapterTimeline,
      chapterFramePaths,
      transitionFrames,
    });

    if (printPromoEnabled) {
      timelineEntries = await timed('Print promotion rendering', async () => {
        const schedule = resolvePrintPromotionSchedule(totalDuration, printPromoStart, printPromoDuration, wavPath);
        if (schedule.length === 0) {
          onLog('⚠ Print promotion skipped because the audiobook is too short.');
          return timelineEntries;
        }

        const promotionDir = path.join(tmpDir, 'print_promotion');
        fs.mkdirSync(promotionDir, { recursive: true });
        return renderPrintPromotionTimeline({
          entries: timelineEntries, schedule, outputDir: promotionDir,
          renderPromotionFrameToFile, isCancelled: cancelled, onLog,
          onProgress: fraction => reportProgress(28 + fraction * 4, 'Rendering print-edition promotions...')
        });
      });
    }

    let visualVideoPath;
    let finalDuration = totalDuration;

    if (introClipPath && introStyle === 'overlap') {
      const openingChapterDuration = chapters[0].endTime - chapters[0].startTime;
      const safeFade = Math.min(overlapFade, Math.max(FRAME_DURATION, openingChapterDuration - FRAME_DURATION));
      if (safeFade < overlapFade) onLog(`⚠ Intro fade shortened to ${safeFade.toFixed(2)}s to fit the opening chapter.`);

      visualVideoPath = await timed('Intro overlap video assembly', async () => {
        reportProgress(33, 'Encoding intro overlap...');
        const headPath = path.join(tmpDir, 'intro_overlap_head.mp4');
        await encodeOverlapHeadVideo({
          introClipPath,
          firstStillPath: openingSegmentPath ? null : timelineEntries[0].path,
          bookVideoPath: openingSegmentPath,
          introDuration: introData.duration,
          fadeDuration: safeFade,
          outputPath: headPath,
          useGPU,
          codec,
          crf,
          isCancelled: cancelled
        });

        const timelineTrim = openingSegmentPath ? openingSequence.duration : safeFade;
        const tailEntries = trimTimelineEntries(timelineEntries, timelineTrim);
        const timelineTailPath = path.join(tmpDir, 'visual_timeline_tail.mp4');
        await encodeVisualTimeline({
          entries: tailEntries,
          expectedDuration: totalDuration - timelineTrim,
          manifestPath: path.join(tmpDir, 'visual_tail.ffconcat'),
          outputPath: timelineTailPath,
          useGPU,
          codec,
          crf,
          isCancelled: cancelled,
          onProgress: seconds => reportProgress(35 + (seconds / Math.max(1, totalDuration - timelineTrim)) * 25, 'Encoding visual timeline...')
        });

        const combinedPath = path.join(tmpDir, 'visual_with_intro.mp4');
        const segments = [headPath];
        if (openingSegmentPath && openingSequence.duration - safeFade > FRAME_DURATION) {
          const openingTailPath = path.join(tmpDir, 'opening_titles_tail.mp4');
          await encodeVideoRange({
            inputPath: openingSegmentPath,
            start: safeFade,
            duration: openingSequence.duration - safeFade,
            outputPath: openingTailPath,
            useGPU,
            codec,
            crf,
            isCancelled: cancelled
          });
          segments.push(openingTailPath);
        }
        segments.push(timelineTailPath);
        await concatMediaFiles(
          segments,
          combinedPath,
          cancelled,
          introData.duration + totalDuration - safeFade
        );
        return combinedPath;
      });
      finalDuration = introData.duration + totalDuration - safeFade;

    } else {
      visualVideoPath = await timed('Visual timeline encoding', async () => {
        reportProgress(33, 'Encoding visual timeline...');
        const resultPath = path.join(tmpDir, 'visual_main.mp4');
        const timelineTrim = openingSegmentPath ? openingSequence.duration : 0;
        const entriesToEncode = timelineTrim > 0
          ? trimTimelineEntries(timelineEntries, timelineTrim)
          : timelineEntries;
        const timelinePath = openingSegmentPath
          ? path.join(tmpDir, 'visual_after_opening.mp4')
          : resultPath;
        await encodeVisualTimeline({
          entries: entriesToEncode,
          expectedDuration: totalDuration - timelineTrim,
          manifestPath: path.join(tmpDir, 'visual_main.ffconcat'),
          outputPath: timelinePath,
          useGPU,
          codec,
          crf,
          isCancelled: cancelled,
          onProgress: seconds => reportProgress(33 + (seconds / Math.max(1, totalDuration - timelineTrim)) * 27, 'Encoding visual timeline...')
        });
        if (openingSegmentPath) {
          await concatMediaFiles([openingSegmentPath, timelinePath], resultPath, cancelled, totalDuration);
        }
        return resultPath;
      });
    }

    reportProgress(62, 'Finishing audio preparation...');
    const preparedAudio = await timed('Audio preparation', async () => audioPromise);

    if (introClipPath && introStyle === 'push') {
      const mainMuxedPath = path.join(tmpDir, 'main_muxed.mp4');
      await timed('Main audio/video mux', () => muxAudioVideo({
        videoPath: visualVideoPath,
        audioPath: preparedAudio.path,
        outputPath: mainMuxedPath,
        expectedDuration: totalDuration,
        isCancelled: cancelled,
        onProgress: seconds => reportProgress(64 + (seconds / Math.max(1, totalDuration)) * 13, 'Muxing audiobook audio...')
      }));

      await timed('Sequential intro assembly', () => prependSequentialIntro({
        introClipPath,
        introData,
        introAudioEnabled,
        mainVideoPath: mainMuxedPath,
        preparedAudio,
        outputPath,
        tmpDir,
        useGPU,
        codec,
        crf,
        isCancelled: cancelled,
        onLog,
        onProgress: label => reportProgress(80, label)
      }));
      finalDuration = introData.duration + totalDuration;

    } else {
      await timed('Final audio/video mux', () => muxAudioVideo({
        videoPath: visualVideoPath,
        audioPath: preparedAudio.path,
        outputPath,
        expectedDuration: finalDuration,
        isCancelled: cancelled,
        onProgress: seconds => reportProgress(65 + (seconds / Math.max(1, finalDuration)) * 34, 'Writing final MP4...')
      }));
    }

    onProgress({ phase: 'done', percent: 100 });
    const stat = fs.statSync(outputPath);
    onLog(`\n✅ Optimized export complete in ${formatElapsed((Date.now() - renderStartedAt) / 1000)}`);
    onLog(`📦 Output: ${formatBytes(stat.size)} | ${OUTPUT_SIZE} | constant ${OUTPUT_FPS}fps | ${preparedAudio.description}`);
    return { durationSeconds: finalDuration };

  } catch (error) {
    abortRequested = true;
    if (audioPromise) await audioPromise.catch(() => {});
    throw error;
  } finally {
    abortRequested = true;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function buildTimelineEntries({
  chapterTimeline,
  chapterFramePaths,
  transitionFrames,
}) {
  const entries = [];
  for (let i = 0; i < chapterTimeline.stills.length; i++) {
    const stillDuration = chapterTimeline.stills[i].duration;
    entries.push({ path: chapterFramePaths[i], duration: stillDuration, kind: 'still', chapterIndex: i });

    if (transitionFrames[i]) {
      for (const framePath of transitionFrames[i]) {
        entries.push({ path: framePath, duration: FRAME_DURATION, kind: 'transition', chapterIndex: i });
      }
    }
  }

  return entries;
}

function trimTimelineEntries(entries, trimSeconds) {
  let remaining = trimSeconds;
  const result = [];
  for (const entry of entries) {
    if (remaining >= entry.duration - 1e-9) {
      remaining -= entry.duration;
      continue;
    }
    result.push({ ...entry, duration: entry.duration - remaining });
    remaining = 0;
  }
  if (remaining > 1e-6 || result.length === 0) throw new Error('Intro overlap consumed the entire visual timeline.');
  return result;
}

async function renderPrintPromotionTimeline({
  entries, schedule, outputDir, renderPromotionFrameToFile, isCancelled, onLog, onProgress
}) {
  for (const [occurrence, timing] of schedule.entries()) {
    if (isCancelled()) throw new Error('RENDER_CANCELLED');
    const samplePlan = buildPromotionSamplePlan(entries, timing.start, timing.duration);
    const promotionEntries = [];
    onLog(`\n📚 Rendering print-edition promotion ${occurrence + 1}/${schedule.length} at ${formatTimestamp(timing.start)} (${timing.duration.toFixed(1)}s)...`);
    for (const [i, sample] of samplePlan.entries()) {
      if (isCancelled()) throw new Error('RENDER_CANCELLED');
      const framePath = path.join(outputDir, `promo_${occurrence}_${String(i).padStart(4, '0')}.png`);
      await renderPromotionFrameToFile({ basePath: sample.basePath, visibility: sample.visibility }, framePath);
      promotionEntries.push({ path: framePath, duration: sample.duration, kind: 'promotion' });
      onProgress((occurrence + (i + 1) / samplePlan.length) / schedule.length);
    }
    entries = replaceTimelineRange(entries, timing.start, timing.start + timing.duration, promotionEntries);
  }
  return entries;
}

function buildPromotionSamplePlan(entries, start, duration) {
  const indexedEntries = [];
  let cursor = 0;
  for (const entry of entries) {
    indexedEntries.push({ entry, start: cursor, end: cursor + entry.duration });
    cursor += entry.duration;
  }

  const fadeDuration = Math.min(0.6, duration / 3);
  const holdEnd = duration - fadeDuration;
  const samples = [];
  let elapsed = 0;
  let baseIndex = 0;

  while (elapsed < duration - 1e-9) {
    const absoluteTime = start + elapsed;
    while (baseIndex < indexedEntries.length - 1 && absoluteTime >= indexedEntries[baseIndex].end - 1e-9) {
      baseIndex++;
    }

    const indexed = indexedEntries[baseIndex];
    const baseRemaining = Math.max(FRAME_DURATION, indexed.end - absoluteTime);
    const phaseEnd = elapsed < fadeDuration
      ? fadeDuration
      : (elapsed < holdEnd ? holdEnd : duration);
    const animated = elapsed < fadeDuration || elapsed >= holdEnd;
    const step = Math.min(
      animated ? FRAME_DURATION : Math.max(FRAME_DURATION, phaseEnd - elapsed),
      baseRemaining,
      duration - elapsed
    );
    const midpoint = elapsed + step / 2;
    let visibility = 1;
    if (midpoint < fadeDuration) {
      const t = Math.max(0, Math.min(1, midpoint / fadeDuration));
      visibility = 1 - Math.pow(1 - t, 3);
    } else if (midpoint > holdEnd) {
      const t = Math.max(0, Math.min(1, (duration - midpoint) / fadeDuration));
      visibility = 1 - Math.pow(1 - t, 3);
    }

    samples.push({
      basePath: indexed.entry.path,
      duration: step,
      visibility
    });
    elapsed += step;
  }

  const delta = duration - samples.reduce((sum, sample) => sum + sample.duration, 0);
  if (samples.length > 0) samples[samples.length - 1].duration += delta;
  return samples;
}

function replaceTimelineRange(entries, start, end, replacementEntries) {
  const totalDuration = sumEntryDurations(entries);
  return [
    ...sliceTimelineRange(entries, 0, start),
    ...replacementEntries,
    ...sliceTimelineRange(entries, end, totalDuration)
  ];
}

function sliceTimelineRange(entries, rangeStart, rangeEnd) {
  const result = [];
  let cursor = 0;
  for (const entry of entries) {
    const entryStart = cursor;
    const entryEnd = cursor + entry.duration;
    const overlapStart = Math.max(entryStart, rangeStart);
    const overlapEnd = Math.min(entryEnd, rangeEnd);
    if (overlapEnd - overlapStart > 1e-9) {
      result.push({ ...entry, duration: overlapEnd - overlapStart });
    }
    cursor = entryEnd;
    if (cursor >= rangeEnd - 1e-9) break;
  }
  return result;
}

async function encodeOpeningTitleSequenceVideo({
  blankPath,
  cardPaths,
  chapterPath,
  sequence,
  outputPath,
  useGPU,
  codec,
  crf,
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

  await runFFmpeg([
    ...inputArgs,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-frames:v', String(sequence.frameCount),
    ...videoEncodeArgs({ useGPU, codec, crf }),
    '-r', String(OUTPUT_FPS), '-fps_mode:v', 'cfr',
    '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
    '-an', '-movflags', '+faststart', '-y', outputPath
  ], isCancelled);
}

async function encodeVideoRange({
  inputPath,
  start,
  duration,
  outputPath,
  useGPU,
  codec,
  crf,
  isCancelled
}) {
  await runFFmpeg([
    '-i', inputPath,
    '-vf', `trim=start=${start.toFixed(6)}:duration=${duration.toFixed(6)},setpts=PTS-STARTPTS,fps=${OUTPUT_FPS},format=yuv420p`,
    '-t', duration.toFixed(6),
    ...videoEncodeArgs({ useGPU, codec, crf }),
    '-r', String(OUTPUT_FPS), '-fps_mode:v', 'cfr',
    '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
    '-an', '-movflags', '+faststart', '-y', outputPath
  ], isCancelled);
}

async function encodeVisualTimeline({
  entries,
  expectedDuration,
  manifestPath,
  outputPath,
  useGPU,
  codec,
  crf,
  isCancelled,
  onProgress
}) {
  writeTimelineManifest(entries, manifestPath);
  await runFFmpegWithProgress({
    args: [
      '-progress', 'pipe:2', '-nostats',
      '-f', 'concat', '-safe', '0', '-i', manifestPath,
      '-t', expectedDuration.toFixed(6),
      ...videoEncodeArgs({ useGPU, codec, crf, stillTimeline: true }),
      '-r', String(OUTPUT_FPS), '-fps_mode:v', 'cfr',
      '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
      '-an', '-movflags', '+faststart', '-y', outputPath
    ],
    totalDuration: expectedDuration,
    isCancelled,
    onProgress
  });
}

function writeTimelineManifest(entries, manifestPath) {
  const manifestEntries = entries.flatMap(splitLongHoldEntry);
  const last = manifestEntries[manifestEntries.length - 1];
  const repeatLast = last.duration > FRAME_DURATION + 1e-9;
  if (repeatLast) last.duration -= FRAME_DURATION;

  const lines = ['ffconcat version 1.0'];
  for (const entry of manifestEntries) {
    lines.push(`file ${quoteConcatPath(entry.path)}`);
    lines.push(`option framerate ${OUTPUT_FPS}`);
    lines.push(`duration ${entry.duration.toFixed(9)}`);
  }

  // The concat image demuxer needs a repeated final sample so the preceding
  // duration is honored. Its natural 1/30s duration restores the subtracted hold.
  if (repeatLast) {
    lines.push(`file ${quoteConcatPath(last.path)}`);
    lines.push(`option framerate ${OUTPUT_FPS}`);
  }
  fs.writeFileSync(manifestPath, lines.join('\n'), 'utf8');
}

function splitLongHoldEntry(entry) {
  const boundarySampleDuration = FRAME_DURATION * 2;
  if (entry.kind === 'transition' || entry.duration <= boundarySampleDuration) {
    return [{ ...entry }];
  }

  const chunks = [];
  // Reserve a sample immediately before the next chapter/transition. Without
  // it, an input seek between the last periodic sample and the boundary can
  // select the following chapter a fraction of a second too early.
  let remaining = entry.duration - boundarySampleDuration;
  while (remaining > MAX_HOLD_SAMPLE_DURATION + 1e-9) {
    chunks.push({ ...entry, duration: MAX_HOLD_SAMPLE_DURATION });
    remaining -= MAX_HOLD_SAMPLE_DURATION;
  }

  // Avoid a final sample too short for the concat image demuxer. A hold just
  // over one second is preferable to introducing a zero-duration tail sample.
  if (remaining <= FRAME_DURATION && chunks.length > 0) {
    chunks[chunks.length - 1].duration += remaining;
  } else if (remaining > 1e-9) {
    chunks.push({ ...entry, duration: remaining });
  }
  chunks.push({ ...entry, duration: boundarySampleDuration });
  return chunks;
}

function videoEncodeArgs({ useGPU, codec, crf, stillTimeline = false }) {
  if (useGPU) {
    return [
      '-c:v', codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc',
      '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', String(crf),
      // A 10-second GOP and B-frames keep long, motionless chapter cards
      // compact without sacrificing standard-player compatibility.
      '-pix_fmt', 'yuv420p', '-g', String(OUTPUT_FPS * 10), '-bf', codec === 'h265' ? '0' : '3',
      ...(codec === 'h265' ? ['-tag:v', 'hvc1'] : [])
    ];
  }
  return [
    '-c:v', codec === 'h265' ? 'libx265' : 'libx264',
    '-preset', 'fast',
    ...(stillTimeline && codec === 'h264' ? ['-tune', 'stillimage'] : []),
    '-crf', String(crf), '-pix_fmt', 'yuv420p', '-g', String(OUTPUT_FPS * 10), '-bf', '3',
    ...(codec === 'h265' ? ['-tag:v', 'hvc1'] : [])
  ];
}

function sumEntryDurations(entries) {
  return entries.reduce((sum, entry) => sum + entry.duration, 0);
}

async function prepareAudioTrack({ inputPath, fastAudioCopy, cacheDir, isCancelled, onLog }) {
  const media = await probeMedia(inputPath);
  if (!media.audio) throw new Error('The audiobook file does not contain an audio stream.');

  const copyable = ['aac', 'mp3'].includes(media.audio.codec);
  if (fastAudioCopy && copyable) {
    onLog(`🔊 Audio: copying existing ${media.audio.codec.toUpperCase()} stream (no re-encode).`);
    return {
      path: inputPath,
      description: `${media.audio.codec.toUpperCase()} stream copy`,
      codec: media.audio.codec,
      sampleRate: media.audio.sampleRate,
      channels: media.audio.channels,
      cached: false
    };
  }

  const cacheKey = createCacheKey({
    type: 'audiobook-aac-v2',
    input: fileFingerprint(inputPath),
    bitrate: 192000,
    sampleRate: 44100
  });

  const encoded = await encodeCachedAac({
    cacheDir,
    cacheKey,
    expectedDuration: media.duration,
    buildArgs: () => ['-i', inputPath, '-map', '0:a:0'],
    isCancelled,
    onLog
  });

  return {
    path: encoded.path,
    description: encoded.cached ? 'Cached AAC' : `${encoded.encoderLabel} AAC`,
    codec: 'aac',
    sampleRate: 44100,
    channels: media.audio.channels || 2,
    cached: encoded.cached
  };
}

async function prepareOverlapAudio({
  audiobookPath,
  introClipPath,
  introData,
  introAudioEnabled,
  fadeDuration,
  audiobookDuration,
  cacheDir,
  isCancelled,
  onLog
}) {
  const useIntroAudio = introAudioEnabled && introData.hasAudio;
  const leadDuration = Math.max(0, introData.duration - fadeDuration);
  const expectedDuration = introData.duration + audiobookDuration - fadeDuration;
  const cacheKey = createCacheKey({
    type: 'overlap-aac-v2',
    audiobook: fileFingerprint(audiobookPath),
    intro: fileFingerprint(introClipPath),
    introAudioEnabled: useIntroAudio,
    introDuration: introData.duration,
    fadeDuration,
    bitrate: 192000,
    sampleRate: 44100
  });

  const encoded = await encodeCachedAac({
    cacheDir,
    cacheKey,
    expectedDuration,
    buildArgs: () => {
      if (useIntroAudio) {
        const filter =
          `[0:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration=${introData.duration.toFixed(6)},asetpts=PTS-STARTPTS[introa];` +
          `[1:a]aresample=44100,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[booka];` +
          `[introa][booka]acrossfade=d=${fadeDuration.toFixed(6)}:c1=tri:c2=tri[aout]`;
        return [
          '-i', introClipPath,
          '-i', audiobookPath,
          '-filter_complex', filter,
          '-map', '[aout]',
          '-t', expectedDuration.toFixed(6)
        ];
      }

      const filter =
        `anullsrc=r=44100:cl=stereo:d=${leadDuration.toFixed(6)}[silence];` +
        `[1:a]aresample=44100,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[booka];` +
        `[silence][booka]concat=n=2:v=0:a=1[aout]`;
      return [
        '-i', introClipPath,
        '-i', audiobookPath,
        '-filter_complex', filter,
        '-map', '[aout]',
        '-t', expectedDuration.toFixed(6)
      ];
    },
    isCancelled,
    onLog
  });

  return {
    path: encoded.path,
    description: encoded.cached ? 'Cached AAC intro mix' : `${encoded.encoderLabel} AAC intro mix`,
    codec: 'aac',
    sampleRate: 44100,
    channels: 2,
    cached: encoded.cached
  };
}

async function encodeCachedAac({
  cacheDir,
  cacheKey,
  expectedDuration,
  buildArgs,
  isCancelled,
  onLog
}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${cacheKey}.m4a`);
  pruneAudioCache(cacheDir, cachePath);

  if (isUsableCacheFile(cachePath)) {
    const now = new Date();
    try { fs.utimesSync(cachePath, now, now); } catch (_) {}
    onLog(`⚡ Audio cache hit: ${path.basename(cachePath)}`);
    return { path: cachePath, cached: true, encoderLabel: 'Cached' };
  }

  const encoders = process.platform === 'win32'
    ? [{ name: 'aac_mf', label: 'Media Foundation' }, { name: 'aac', label: 'FFmpeg native' }]
    : [{ name: 'aac', label: 'FFmpeg native' }];

  let lastError = null;
  for (const encoder of encoders) {
    if (isCancelled()) throw new Error('RENDER_CANCELLED');
    const partialPath = `${cachePath}.${process.pid}.${encoder.name}.partial.m4a`;
    try {
      onLog(`🔊 Encoding audio with ${encoder.label} AAC...`);
      await runFFmpeg([
        ...buildArgs(encoder.name),
        '-vn', '-c:a', encoder.name, '-b:a', '192k', '-ar', '44100',
        '-movflags', '+faststart', '-y', partialPath
      ], isCancelled);

      if (fs.existsSync(cachePath)) fs.unlinkSync(partialPath);
      else fs.renameSync(partialPath, cachePath);
      pruneAudioCache(cacheDir, cachePath);
      return { path: cachePath, cached: false, encoderLabel: encoder.label };
    } catch (error) {
      try { fs.unlinkSync(partialPath); } catch (_) {}
      if (isCancelled() || error.message === 'RENDER_CANCELLED') throw new Error('RENDER_CANCELLED');
      lastError = error;
      onLog(`⚠ ${encoder.label} AAC failed; ${encoder.name === 'aac' ? 'no encoder fallback remains.' : 'trying native AAC.'}`);
    }
  }
  throw lastError || new Error('No AAC encoder was available.');
}

function pruneAudioCache(cacheDir, protectedPath = null, maxBytes = 5 * 1024 * 1024 * 1024) {
  let entries;
  try {
    entries = fs.readdirSync(cacheDir)
      .filter(name => name.toLowerCase().endsWith('.m4a'))
      .map(name => {
        const filePath = path.join(cacheDir, name);
        const stat = fs.statSync(filePath);
        return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
      });
  } catch (_) {
    return;
  }

  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of entries) {
    if (totalBytes <= maxBytes) break;
    if (protectedPath && path.resolve(entry.filePath) === path.resolve(protectedPath)) continue;
    try {
      fs.unlinkSync(entry.filePath);
      totalBytes -= entry.size;
    } catch (_) {}
  }
}

async function muxAudioVideo({
  videoPath,
  audioPath,
  outputPath,
  expectedDuration,
  isCancelled,
  onProgress
}) {
  await runFFmpegWithProgress({
    args: [
      '-progress', 'pipe:2', '-nostats',
      '-i', videoPath, '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c', 'copy', '-t', expectedDuration.toFixed(6),
      '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
      '-movflags', '+faststart', '-y', outputPath
    ],
    totalDuration: expectedDuration,
    isCancelled,
    onProgress
  });
}

async function encodeOverlapHeadVideo({
  introClipPath,
  firstStillPath,
  bookVideoPath = null,
  introDuration,
  fadeDuration,
  outputPath,
  useGPU,
  codec,
  crf,
  isCancelled
}) {
  const offset = Math.max(0, introDuration - fadeDuration);
  const bookInputArgs = bookVideoPath
    ? ['-i', bookVideoPath]
    : ['-loop', '1', '-framerate', String(OUTPUT_FPS), '-i', firstStillPath];
  const filter =
    `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS},` +
    `format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[intro];` +
    `[1:v]fps=${OUTPUT_FPS},trim=duration=${(fadeDuration + FRAME_DURATION).toFixed(6)},` +
    `format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[book];` +
    `[intro][book]xfade=transition=fade:duration=${fadeDuration.toFixed(6)}:offset=${offset.toFixed(6)}[vout]`;

  await runFFmpeg([
    '-i', introClipPath,
    ...bookInputArgs,
    '-filter_complex', filter,
    '-map', '[vout]', '-t', introDuration.toFixed(6),
    ...videoEncodeArgs({ useGPU, codec, crf }),
    '-r', String(OUTPUT_FPS), '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
    '-an', '-movflags', '+faststart', '-y', outputPath
  ], isCancelled);
}

async function prependSequentialIntro({
  introClipPath,
  introData,
  introAudioEnabled,
  mainVideoPath,
  preparedAudio,
  outputPath,
  tmpDir,
  useGPU,
  codec,
  crf,
  isCancelled,
  onLog,
  onProgress
}) {
  onProgress('Normalizing intro clip...');
  const normalizedIntro = path.join(tmpDir, 'intro_normalized.mp4');
  const useIntroAudio = introAudioEnabled && introData.hasAudio;
  const sampleRate = preparedAudio.sampleRate || 44100;
  const channels = preparedAudio.channels || 2;
  const channelLayout = channels === 1 ? 'mono' : 'stereo';
  const audioCodec = preparedAudio.codec === 'mp3' ? 'mp3' : 'aac';
  const audioEncoders = audioCodec === 'mp3'
    ? (process.platform === 'win32' ? ['mp3_mf', 'libmp3lame'] : ['libmp3lame'])
    : (process.platform === 'win32' ? ['aac_mf', 'aac'] : ['aac']);

  const videoFilter =
    `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=${OUTPUT_FPS},format=yuv420p[v]`;

  let lastError = null;
  for (const audioEncoder of audioEncoders) {
    const partialPath = `${normalizedIntro}.${audioEncoder}.partial.mp4`;
    const filter = useIntroAudio
      ? videoFilter
      : `${videoFilter};anullsrc=d=${introData.duration.toFixed(6)}:r=${sampleRate}:cl=${channelLayout}[a]`;
    const mapArgs = useIntroAudio
      ? ['-map', '[v]', '-map', '0:a:0']
      : ['-map', '[v]', '-map', '[a]'];

    try {
      await runFFmpeg([
        '-i', introClipPath,
        '-filter_complex', filter,
        ...mapArgs,
        '-t', introData.duration.toFixed(6),
        ...videoEncodeArgs({ useGPU, codec, crf }),
        '-r', String(OUTPUT_FPS), '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
        '-c:a', audioEncoder, '-b:a', '192k', '-ar', String(sampleRate), '-ac', String(channels),
        '-movflags', '+faststart', '-y', partialPath
      ], isCancelled);
      fs.renameSync(partialPath, normalizedIntro);
      lastError = null;
      break;
    } catch (error) {
      try { fs.unlinkSync(partialPath); } catch (_) {}
      if (isCancelled()) throw new Error('RENDER_CANCELLED');
      lastError = error;
    }
  }
  if (lastError) throw lastError;

  onLog('🎬 Concatenating normalized intro without re-encoding the audiobook...');
  onProgress('Concatenating intro and audiobook...');
  await concatMediaFiles([normalizedIntro, mainVideoPath], outputPath, isCancelled);
}

async function concatMediaFiles(inputPaths, outputPath, isCancelled, expectedDuration = null) {
  const listPath = `${outputPath}.ffconcat`;
  fs.writeFileSync(listPath, [
    'ffconcat version 1.0',
    ...inputPaths.map(inputPath => `file ${quoteConcatPath(inputPath)}`)
  ].join('\n'), 'utf8');

  try {
    await runFFmpeg([
      '-f', 'concat', '-safe', '0', '-i', listPath,
      ...(Number.isFinite(expectedDuration) ? ['-t', expectedDuration.toFixed(6)] : []),
      '-c', 'copy', '-video_track_timescale', String(VIDEO_TRACK_TIMESCALE),
      '-movflags', '+faststart', '-y', outputPath
    ], isCancelled);
  } finally {
    try { fs.unlinkSync(listPath); } catch (_) {}
  }
}

async function detectNvenc(codec, onLog) {
  if (nvencAvailability.has(codec)) return nvencAvailability.get(codec);
  const encoder = codec === 'h265' ? 'hevc_nvenc' : 'h264_nvenc';
  const outputPath = path.join(os.tmpdir(), `vexona-${codec}-nvenc-test-${process.pid}.mp4`);
  try {
    await runFFmpeg([
      '-f', 'lavfi', '-i', `color=black:s=${OUTPUT_SIZE}:r=5:d=0.25`,
      '-c:v', encoder, '-preset', 'p2', '-rc', 'constqp', '-qp', '28',
      '-pix_fmt', 'yuv420p', '-an', '-y', outputPath
    ], null, 10000);
    nvencAvailability.set(codec, true);
    onLog(`🎮 NVIDIA NVENC detected for ${codec.toUpperCase()}.`);
  } catch (_) {
    nvencAvailability.set(codec, false);
    onLog(`⚙️ NVENC unavailable for ${codec.toUpperCase()}; using CPU video encoding.`);
  } finally {
    try { fs.unlinkSync(outputPath); } catch (_) {}
  }
  return nvencAvailability.get(codec);
}

function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    fluent.ffprobe(filePath, (error, metadata) => {
      if (error) return reject(new Error(error.message));
      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      resolve({
        duration: Number(metadata.format.duration || 0),
        hasAudio: !!audioStream,
        audio: audioStream ? {
          codec: audioStream.codec_name,
          sampleRate: Number(audioStream.sample_rate || 44100),
          channels: Number(audioStream.channels || 2)
        } : null,
        video: videoStream ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height
        } : null
      });
    });
  });
}

function createCacheKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

function fileFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: path.resolve(filePath),
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs)
  };
}

function isUsableCacheFile(filePath) {
  try { return fs.statSync(filePath).size > 1024; } catch (_) { return false; }
}

function quoteConcatPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, `'\\''`);
  return `'${normalized}'`;
}

function runFFmpeg(args, isCancelled, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    let settled = false;
    const appendError = chunk => { stderr = (stderr + chunk.toString()).slice(-64000); };
    proc.stderr.on('data', appendError);

    const cancelPoller = isCancelled ? setInterval(() => {
      if (!settled && isCancelled()) {
        settled = true;
        proc.kill();
        reject(new Error('RENDER_CANCELLED'));
      }
    }, 200) : null;

    const timer = timeoutMs ? setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs) : null;

    proc.on('close', code => {
      if (timer) clearTimeout(timer);
      if (cancelPoller) clearInterval(cancelPoller);
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed (code ${code}):\n${stderr.slice(-3000)}`));
    });
    proc.on('error', error => {
      if (timer) clearTimeout(timer);
      if (cancelPoller) clearInterval(cancelPoller);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function runFFmpegWithProgress({ args, totalDuration, onProgress, isCancelled }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    let settled = false;
    proc.stderr.on('data', chunk => {
      const value = chunk.toString();
      stderr = (stderr + value).slice(-64000);
      if (!onProgress) return;

      for (const match of value.matchAll(/out_time_(?:ms|us)=(\d+)/g)) {
        onProgress(Math.min(totalDuration, Number(match[1]) / 1000000));
      }
      const clock = value.match(/(?:out_time|time)=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (clock) onProgress(Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]));
    });

    const cancelPoller = isCancelled ? setInterval(() => {
      if (!settled && isCancelled()) {
        settled = true;
        proc.kill();
        reject(new Error('RENDER_CANCELLED'));
      }
    }, 200) : null;

    proc.on('close', code => {
      if (cancelPoller) clearInterval(cancelPoller);
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed (code ${code}):\n${stderr.slice(-3000)}`));
    });
    proc.on('error', error => {
      if (cancelPoller) clearInterval(cancelPoller);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function formatTimestamp(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  if (hours > 0) return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

module.exports = { renderVideo, renderPrintPromotionTimeline };
