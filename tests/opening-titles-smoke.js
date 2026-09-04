const {
  buildOpeningTitleCards,
  normalizeOpeningTitles,
  resolveOpeningTitleSequence,
  resolveOpeningTitleFrame
} = require('../src/openingTitles');

const fields = normalizeOpeningTitles({
  title: '  The Book  ',
  subtitle: ' A Story ',
  author: ' Author Name ',
  originallyPublished: ' 1910 ',
  site: ' scrollreader.com '
});
const cards = buildOpeningTitleCards(fields);
if (cards.length !== 4) throw new Error(`Expected four opening cards, got ${cards.length}`);
if (cards[0].primary !== 'The Book' || cards[0].secondary !== 'A Story') {
  throw new Error('Title and subtitle were not normalized into one card.');
}

const sequence = resolveOpeningTitleSequence(fields, 30, 30);
if (!sequence || sequence.duration !== 12 || sequence.frameCount !== 360) {
  throw new Error(`Expected a 12-second/360-frame sequence, got ${JSON.stringify(sequence)}`);
}

const opening = resolveOpeningTitleFrame(cards, 0, sequence.duration);
if (opening.fromCard !== null || opening.toCard !== cards[0] || opening.mix !== 0) {
  throw new Error('Opening sequence did not begin with a fade into the title card.');
}
const author = resolveOpeningTitleFrame(cards, 3.3, sequence.duration);
if (author.toCard !== cards[1] || author.mix <= 0 || author.mix >= 1) {
  throw new Error('Opening sequence did not crossfade from title to author.');
}
const ending = resolveOpeningTitleFrame(cards, 11.8, sequence.duration);
if (!ending.toChapter || ending.mix <= 0 || ending.mix >= 1) {
  throw new Error('Opening sequence did not dissolve into the first chapter.');
}

const tooShort = resolveOpeningTitleSequence(fields, 5, 30);
if (tooShort !== null) throw new Error('A sequence that cannot give each card 1.5 seconds should be skipped.');

console.log(`Opening title smoke test passed: ${cards.length} cards, ${sequence.frameCount} frames`);
