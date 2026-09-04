const {
  buildOpeningTitleCards,
  normalizeOpeningTitles,
  resolveOpeningTitleSequence,
  resolveOpeningTitleFrame
} = require('../src/openingTitles');

const fields = normalizeOpeningTitles({
  presentationLabel: '  A Scroll Reader Original  ',
  title: '  The Book  ',
  subtitle: ' A Story ',
  seriesName: ' The Heritage Library ',
  bookNumber: ' 2 ',
  author: ' Author Name ',
  originallyPublished: ' 1910 ',
  site: ' scrollreader.com '
});
const cards = buildOpeningTitleCards(fields);
if (cards.length !== 5) throw new Error(`Expected five opening cards, got ${cards.length}`);
if (cards[0].primary !== 'The Book' || cards[0].secondary !== 'A Story') {
  throw new Error('Title and subtitle were not normalized into one card.');
}
if (cards[0].label !== 'A Scroll Reader Original') {
  throw new Error('Custom presentation label was not retained.');
}
if (cards[1].primary !== 'The Heritage Library' || cards[1].label !== 'BOOK 2 IN THE SERIES') {
  throw new Error('Series name and book number were not normalized into a series card.');
}

const sequence = resolveOpeningTitleSequence(fields, 30, 30);
if (!sequence || sequence.duration !== 15 || sequence.frameCount !== 450) {
  throw new Error(`Expected a 15-second/450-frame sequence, got ${JSON.stringify(sequence)}`);
}
if (sequence.cardDuration !== 3 || sequence.fadeDuration !== 0.65) {
  throw new Error(`Unexpected card/fade timing: ${JSON.stringify(sequence)}`);
}

const opening = resolveOpeningTitleFrame(cards, 0, sequence.duration);
if (opening.fromCard !== null || opening.toCard !== cards[0] || opening.mix !== 0) {
  throw new Error('Opening sequence did not begin with a fade into the title card.');
}
const series = resolveOpeningTitleFrame(cards, 3.3, sequence.duration);
if (series.toCard !== cards[1] || series.mix <= 0 || series.mix >= 1) {
  throw new Error('Opening sequence did not crossfade from title to series.');
}
const ending = resolveOpeningTitleFrame(cards, 14.8, sequence.duration);
if (!ending.toChapter || ending.mix <= 0 || ending.mix >= 1) {
  throw new Error('Opening sequence did not dissolve into the first chapter.');
}

const tooShort = resolveOpeningTitleSequence(fields, 7, 30);
if (tooShort !== null) throw new Error('A sequence that cannot give each card 1.5 seconds should be skipped.');

console.log(`Opening title smoke test passed: ${cards.length} cards, ${sequence.frameCount} frames`);
