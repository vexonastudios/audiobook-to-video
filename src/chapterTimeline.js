// One frame-aligned schedule shared by both encoders. Round absolute chapter
// markers, never each segment's duration: rounding durations accumulates drift.
function buildChapterTimeline(chapters, transitionStyle = 'cut', transitionDuration = 1, fps = 30) {
  if (!chapters?.length) throw new Error('No chapters were provided for rendering.');
  const markers = [0, ...chapters.slice(1).map(ch => ch.startTime), chapters.at(-1).endTime]
    .map(seconds => Math.round(seconds * fps));
  const lengths = chapters.map((_, i) => markers[i + 1] - markers[i]);
  if (markers.some(frame => !Number.isFinite(frame)) || lengths.some(frames => frames < 1)) {
    throw new Error('Chapter markers must be in order and at least one video frame apart.');
  }

  const requestedFrames = transitionStyle === 'cut' ? 0 : Math.max(0, Math.round(transitionDuration * fps));
  if (!Number.isFinite(requestedFrames)) throw new Error('Transition duration must be a finite number.');
  // Reserve a still frame for every chapter. Each neighbor gets at most its
  // share of the remaining time, so two transitions cannot swallow a chapter.
  const capacity = lengths.map((frames, i) => Math.floor((frames - 1)
    / Math.max(1, Number(i > 0) + Number(i < lengths.length - 1))));
  const transitions = chapters.slice(1).map((_, i) => {
    const beforeFrames = Math.min(Math.floor(requestedFrames / 2), capacity[i]);
    const afterFrames = Math.min(Math.ceil(requestedFrames / 2), capacity[i + 1]);
    if (beforeFrames < 1 || afterFrames < 1) return null;
    const frameCount = beforeFrames + afterFrames;
    return {
      beforeFrames, afterFrames, frameCount,
      startFrame: markers[i + 1] - beforeFrames,
      boundaryFrame: markers[i + 1],
      duration: frameCount / fps
    };
  });
  const stills = lengths.map((_, i) => {
    const startFrame = markers[i] + (transitions[i - 1]?.afterFrames || 0);
    const endFrame = markers[i + 1] - (transitions[i]?.beforeFrames || 0);
    return { startFrame, frameCount: endFrame - startFrame, duration: (endFrame - startFrame) / fps };
  });
  return { stills, transitions, totalFrames: markers.at(-1), fps };
}

function transitionAlpha(transition, frame) {
  // Alpha 0.5 (black / the chapter handoff) lands on the chapter marker even
  // when a fade is shortened or its two halves have different frame counts.
  return frame < transition.beforeFrames
    ? 0.5 * frame / transition.beforeFrames
    : 0.5 + 0.5 * (frame - transition.beforeFrames) / Math.max(1, transition.afterFrames - 1);
}

module.exports = { buildChapterTimeline, transitionAlpha };
