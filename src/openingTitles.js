const OPENING_TITLE_SECONDS_PER_CARD = 3;
const OPENING_TITLE_MIN_SECONDS_PER_CARD = 1.5;
const OPENING_TITLE_FADE_SECONDS = 0.65;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOpeningTitles(fields = {}) {
  return {
    title: clean(fields.title),
    subtitle: clean(fields.subtitle),
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
      label: 'AUDIOBOOK PRESENTATION',
      primary: values.title || values.subtitle,
      secondary: values.title ? values.subtitle : ''
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
    cards.push({ type: 'site', label: 'DISCOVER MORE AT', primary: values.site, secondary: '' });
  }

  return cards;
}

function resolveOpeningTitleSequence(fields, maxDuration = Infinity, fps = 30) {
  const cards = buildOpeningTitleCards(fields);
  if (cards.length === 0 || Number.isNaN(maxDuration) || maxDuration <= 0) return null;

  const idealDuration = cards.length * OPENING_TITLE_SECONDS_PER_CARD;
  const duration = Math.min(idealDuration, maxDuration);
  if (duration < cards.length * OPENING_TITLE_MIN_SECONDS_PER_CARD) return null;

  const frameCount = Math.max(2, Math.floor(duration * fps + 1e-6));
  return {
    cards,
    frameCount,
    duration: frameCount / fps,
    fps
  };
}

function resolveOpeningTitleFrame(cards, time, duration) {
  if (!Array.isArray(cards) || cards.length === 0 || duration <= 0) {
    return { fromCard: null, toCard: null, mix: 0, toChapter: true };
  }

  const cardDuration = duration / cards.length;
  const fadeDuration = Math.min(OPENING_TITLE_FADE_SECONDS, cardDuration * 0.28);
  const safeTime = Math.max(0, Math.min(duration - Number.EPSILON, time));
  const index = Math.min(cards.length - 1, Math.floor(safeTime / cardDuration));
  const localTime = safeTime - index * cardDuration;

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
