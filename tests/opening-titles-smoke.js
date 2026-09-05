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
if (cards.length !== 6) throw new Error(`Expected six opening states, got ${cards.length}`);
if (cards[0].primary !== 'The Book' || cards[0].secondary !== '' || cards[1].secondary !== 'A Story') {
  throw new Error('The title-only state should precede the title/subtitle state.');
}
if (cards[0].label !== 'A Scroll Reader Original') {
  throw new Error('Custom presentation label was not retained.');
}
if (cards[2].primary !== 'The Heritage Library' || cards[2].label !== 'BOOK 2 IN THE SERIES') {
  throw new Error('Series name and book number were not normalized into a series card.');
}
if (cards[5].primary !== 'SCROLLREADER.COM' || fields.site !== 'scrollreader.com') {
  throw new Error('The site card should be uppercase without rewriting the stored URL.');
}

const sequence = resolveOpeningTitleSequence(fields, 30, 30);
if (!sequence || sequence.duration !== 20 || sequence.frameCount !== 600) {
  throw new Error(`Expected a 20-second/600-frame sequence, got ${JSON.stringify(sequence)}`);
}
if (sequence.cardTimings.map(card => card.duration).join(',') !== '2,6,3,3,3,3' || sequence.fadeDuration !== 0.65) {
  throw new Error(`Unexpected card/fade timing: ${JSON.stringify(sequence)}`);
}

const opening = resolveOpeningTitleFrame(cards, 0, sequence.duration);
if (opening.fromCard !== null || opening.toCard !== cards[0] || opening.mix !== 0) {
  throw new Error('Opening sequence did not begin with a fade into the title card.');
}
const reading = resolveOpeningTitleFrame(cards, 6, sequence.duration);
if (reading.fromCard !== cards[1] || reading.toCard !== null || reading.mix !== 0) {
  throw new Error('The title and subtitle should still be held fully visible after six seconds.');
}
const beforeSubtitle = resolveOpeningTitleFrame(cards, 1.99, sequence.duration);
if (beforeSubtitle.fromCard !== cards[0] || beforeSubtitle.toCard !== null) throw new Error('Subtitle appeared before two seconds.');
const subtitle = resolveOpeningTitleFrame(cards, 2.3, sequence.duration);
if (subtitle.fromCard !== cards[0] || subtitle.toCard !== cards[1] || subtitle.mix <= 0 || subtitle.mix >= 1) {
  throw new Error('Subtitle did not fade in after two seconds.');
}
const series = resolveOpeningTitleFrame(cards, 8.3, sequence.duration);
if (series.toCard !== cards[2] || series.mix <= 0 || series.mix >= 1) {
  throw new Error('Opening sequence did not crossfade from title to series.');
}
const ending = resolveOpeningTitleFrame(cards, 19.8, sequence.duration);
if (!ending.toChapter || ending.mix <= 0 || ending.mix >= 1) {
  throw new Error('Opening sequence did not dissolve into the first chapter.');
}

const tooShort = resolveOpeningTitleSequence(fields, 7, 30);
if (tooShort !== null) throw new Error('A sequence that cannot preserve the reading holds should be skipped.');

const titleOnly = resolveOpeningTitleSequence({ title: 'Title without subtitle' });
if (titleOnly.duration !== 6) throw new Error('A title without a subtitle should last six seconds.');
const singleTitle = resolveOpeningTitleSequence({ title: 'Title', subtitle: 'Subtitle' });
if (singleTitle.duration !== 8 || !resolveOpeningTitleFrame(singleTitle.cards, 7.8, 8).toChapter) {
  throw new Error('A lone title/subtitle card should last eight seconds and fade back to the chapter.');
}

for (const maxDuration of [13.3, 14.17, 17.23, 19.96]) {
  const shorter = resolveOpeningTitleSequence(fields, maxDuration);
  if (!shorter || shorter.duration > maxDuration) throw new Error('Short opening must stay inside its time budget.');
  if (shorter.cardTimings.some(card => card.duration < 1.5)) throw new Error('A shortened card lost its minimum reading time.');
  if (shorter.cardTimings[1].start !== 2 || shorter.cardTimings[1].duration - 2 * shorter.fadeDuration < 4) {
    throw new Error('Short opening changed the two-second subtitle delay or four-second reading hold.');
  }
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

for (const [titleFields, minimum] of [[{ title: 'Title' }, 5.3], [{ title: 'Title', subtitle: 'Subtitle' }, 7.3]]) {
  if (resolveOpeningTitleSequence(titleFields, minimum - 0.04)) throw new Error('Too-short chapter squeezed the reading hold.');
  const minimumSequence = resolveOpeningTitleSequence(titleFields, minimum);
  if (!minimumSequence || minimumSequence.cardTimings.at(-1).duration - 2 * minimumSequence.fadeDuration < 4 - 1e-6) {
    throw new Error('Title must stay fully visible at least four seconds even at the minimum chapter length.');
  }
}

console.log(`Opening title smoke test passed: ${cards.length} cards, ${sequence.frameCount} frames`);
