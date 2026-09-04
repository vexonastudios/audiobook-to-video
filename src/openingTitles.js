const OPENING_TITLE_SECONDS_PER_CARD = 3;
const OPENING_TITLE_SECONDS = 5;
const OPENING_TITLE_WITH_SUBTITLE_SECONDS = 7;
const OPENING_TITLE_MIN_SECONDS_PER_CARD = 1.5;
const OPENING_TITLE_FADE_SECONDS = 0.65;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOpeningTitles(fields = {}) {
  return {
    presentationLabel: clean(fields.presentationLabel) || 'AUDIOBOOK PRESENTATION',
    title: clean(fields.title),
    subtitle: clean(fields.subtitle),
    seriesName: clean(fields.seriesName),
    bookNumber: clean(fields.bookNumber),
    author: clean(fields.author),
    originallyPublished: clean(fields.originallyPublished),
    site: clean(fields.site)
  };
}

function buildOpeningTitleCards(fields = {}) {
  const values = normalizeOpeningTitles(fields);
  const cards = [];

  if (values.title || values.subtitle) {
    cards.push({
      type: 'title',
      label: values.presentationLabel,
      primary: values.title || values.subtitle,
      secondary: values.title ? values.subtitle : ''
    });
  }
  if (values.seriesName) {
    cards.push({
      type: 'series',
      label: values.bookNumber ? `BOOK ${values.bookNumber} IN THE SERIES` : 'FROM THE SERIES',
      primary: values.seriesName,
      secondary: ''
    });
  }
  if (values.author) {
    cards.push({ type: 'author', label: 'WRITTEN BY', primary: values.author, secondary: '' });
  }
  if (values.originallyPublished) {
    cards.push({
      type: 'published',
      label: 'ORIGINALLY PUBLISHED',
      primary: values.originallyPublished,
      secondary: ''
    });
  }
  if (values.site) {
    cards.push({ type: 'site', label: 'DISCOVER MORE AT', primary: values.site.toUpperCase(), secondary: '' });
  }

  return cards;
}

function preferredCardDuration(card) {
  if (card.type === 'title') {
    return card.secondary ? OPENING_TITLE_WITH_SUBTITLE_SECONDS : OPENING_TITLE_SECONDS;
  }
  return OPENING_TITLE_SECONDS_PER_CARD;
}

// Allocate whole frames, keeping a minimum reading interval for every card and
// giving the title the extra time when the first chapter has room for it.
function resolveCardTimings(cards, frameCount, fps) {
  const minimumFrames = Math.min(
    Math.ceil(OPENING_TITLE_MIN_SECONDS_PER_CARD * fps),
    Math.floor(frameCount / cards.length)
  );
  const extraFrames = frameCount - minimumFrames * cards.length;
  const weights = cards.map(card => preferredCardDuration(card) - OPENING_TITLE_MIN_SECONDS_PER_CARD);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const extras = weights.map(weight => extraFrames * weight / totalWeight);
  const counts = extras.map(extra => minimumFrames + Math.floor(extra));
  const remainder = frameCount - counts.reduce((sum, count) => sum + count, 0);
  const remainderOrder = extras.map((extra, index) => ({ index, fraction: extra - Math.floor(extra) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) counts[remainderOrder[i].index]++;

  let cursor = 0;
  return counts.map(count => {
    const startFrame = cursor;
    cursor += count;
    return { start: startFrame / fps, duration: count / fps, end: cursor / fps };
  });
}

function resolveOpeningTitleSequence(fields, maxDuration = Infinity, fps = 30) {
  const cards = buildOpeningTitleCards(fields);
  if (cards.length === 0 || Number.isNaN(maxDuration) || maxDuration <= 0) return null;

  const idealDuration = cards.reduce((sum, card) => sum + preferredCardDuration(card), 0);
  const duration = Math.min(idealDuration, maxDuration);
  if (duration < cards.length * OPENING_TITLE_MIN_SECONDS_PER_CARD) return null;

  const frameCount = Math.max(2, Math.floor(duration * fps + 1e-6));
  const snappedDuration = frameCount / fps;
  const cardTimings = resolveCardTimings(cards, frameCount, fps);
  return {
    cards,
    frameCount,
    duration: snappedDuration,
    cardTimings,
    fadeDuration: Math.min(OPENING_TITLE_FADE_SECONDS, ...cardTimings.map(card => card.duration * 0.28)),
    fps
  };
}

function resolveOpeningTitleFrame(cards, time, duration, fps = 30) {
  if (!Array.isArray(cards) || cards.length === 0 || duration <= 0) {
    return { fromCard: null, toCard: null, mix: 0, toChapter: true };
  }

  const cardTimings = resolveCardTimings(cards, Math.max(1, Math.round(duration * fps)), fps);
  const fadeDuration = Math.min(OPENING_TITLE_FADE_SECONDS, ...cardTimings.map(card => card.duration * 0.28));
  const safeTime = Math.max(0, Math.min(duration - Number.EPSILON, time));
  const matchedIndex = cardTimings.findIndex(card => safeTime < card.end);
  const index = matchedIndex < 0 ? cards.length - 1 : matchedIndex;
  const cardDuration = cardTimings[index].duration;
  const localTime = safeTime - cardTimings[index].start;

  if (index === 0 && localTime < fadeDuration) {
    return {
      fromCard: null,
      toCard: cards[0],
      mix: smoothstep(localTime / fadeDuration),
      toChapter: false
    };
  }

  if (index > 0 && localTime < fadeDuration) {
    return {
      fromCard: cards[index - 1],
      toCard: cards[index],
      mix: smoothstep(localTime / fadeDuration),
      toChapter: false
    };
  }

  if (index === cards.length - 1 && localTime >= cardDuration - fadeDuration) {
    return {
      fromCard: cards[index],
      toCard: null,
      mix: smoothstep((localTime - (cardDuration - fadeDuration)) / fadeDuration),
      toChapter: true
    };
  }

  return { fromCard: cards[index], toCard: null, mix: 0, toChapter: false };
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

module.exports = {
  OPENING_TITLE_SECONDS_PER_CARD,
  buildOpeningTitleCards,
  normalizeOpeningTitles,
  resolveOpeningTitleSequence,
  resolveOpeningTitleFrame
};
