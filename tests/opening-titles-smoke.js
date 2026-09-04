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
if (cards[4].primary !== 'SCROLLREADER.COM' || fields.site !== 'scrollreader.com') {
  throw new Error('The site card should be uppercase without rewriting the stored URL.');
}

const sequence = resolveOpeningTitleSequence(fields, 30, 30);
if (!sequence || sequence.duration !== 19 || sequence.frameCount !== 570) {
  throw new Error(`Expected a 19-second/570-frame sequence, got ${JSON.stringify(sequence)}`);
}
if (sequence.cardTimings.map(card => card.duration).join(',') !== '7,3,3,3,3' || sequence.fadeDuration !== 0.65) {
  throw new Error(`Unexpected card/fade timing: ${JSON.stringify(sequence)}`);
}

const opening = resolveOpeningTitleFrame(cards, 0, sequence.duration);
if (opening.fromCard !== null || opening.toCard !== cards[0] || opening.mix !== 0) {
  throw new Error('Opening sequence did not begin with a fade into the title card.');
}
const reading = resolveOpeningTitleFrame(cards, 6, sequence.duration);
if (reading.fromCard !== cards[0] || reading.toCard !== null || reading.mix !== 0) {
  throw new Error('The title and subtitle should still be held fully visible after six seconds.');
}
const series = resolveOpeningTitleFrame(cards, 7.3, sequence.duration);
if (series.toCard !== cards[1] || series.mix <= 0 || series.mix >= 1) {
  throw new Error('Opening sequence did not crossfade from title to series.');
}
const ending = resolveOpeningTitleFrame(cards, 18.8, sequence.duration);
if (!ending.toChapter || ending.mix <= 0 || ending.mix >= 1) {
  throw new Error('Opening sequence did not dissolve into the first chapter.');
}

const tooShort = resolveOpeningTitleSequence(fields, 7, 30);
if (tooShort !== null) throw new Error('A sequence that cannot give each card 1.5 seconds should be skipped.');

const titleOnly = resolveOpeningTitleSequence({ title: 'Title without subtitle' });
if (titleOnly.duration !== 5) throw new Error('A title without a subtitle should last five seconds.');
const singleTitle = resolveOpeningTitleSequence({ title: 'Title', subtitle: 'Subtitle' });
if (singleTitle.duration !== 7 || !resolveOpeningTitleFrame(singleTitle.cards, 6.8, 7).toChapter) {
  throw new Error('A lone title/subtitle card should last seven seconds and fade back to the chapter.');
}

for (const maxDuration of [7.5, 8.17, 13.23, 17.96]) {
  const shorter = resolveOpeningTitleSequence(fields, maxDuration);
  if (!shorter || shorter.duration > maxDuration) throw new Error('Short opening must stay inside its time budget.');
  if (shorter.cardTimings.some(card => card.duration < 1.5)) throw new Error('A shortened card lost its minimum reading time.');
  if (shorter.cardTimings.some(card => Math.abs(card.start * 30 - Math.round(card.start * 30)) > 1e-6)) {
    throw new Error('Every card should start on a whole output frame.');
  }
  if (Math.abs(shorter.cardTimings.reduce((sum, card) => sum + card.duration, 0) - shorter.duration) > 1e-6) {
    throw new Error('Shortened cards did not fill the resolved sequence duration.');
  }
  const boundary = shorter.cardTimings[1].start;
  if (resolveOpeningTitleFrame(shorter.cards, boundary + 0.1, shorter.duration).toCard !== shorter.cards[1]) {
    throw new Error('Canvas preview and encoded sequence disagree about shortened card boundaries.');
  }
}

console.log(`Opening title smoke test passed: ${cards.length} cards, ${sequence.frameCount} frames`);
