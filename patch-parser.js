const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'renderer', 'app.js');
let src = fs.readFileSync(filePath, 'utf8');

const START = 'function parseSrtToChapters(srtText) {';
const END_SENTINEL = 'function secToTimecode(sec) {';

const si = src.indexOf(START);
const ei = src.indexOf(END_SENTINEL);

if (si < 0 || ei < 0) {
  console.error('Markers not found', si, ei);
  process.exit(1);
}

console.log(`Replacing chars ${si}–${ei} (${ei - si} bytes)`);

const newFn = `function parseSrtToChapters(srtText) {
  // ── Pass 1: Parse every SRT block into { startSec, rawText } ──────────
  const rawBlocks = [];
  const blocks = srtText.trim().split(/\\n\\s*\\n/);

  for (const block of blocks) {
    const lines = block.split('\\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const tcLine = lines.find(l => l.includes('-->'));
    if (!tcLine) continue;

    const tcMatch = tcLine.match(/(\\d+):(\\d+):(\\d+)[,\\.](\\d+)/);
    if (!tcMatch) continue;

    const startSec = parseInt(tcMatch[1]) * 3600
                   + parseInt(tcMatch[2]) * 60
                   + parseInt(tcMatch[3]);

    // Text lines = everything that isn't the index number or timecode
    const textLines = lines.filter(l => !l.includes('-->') && !/^\\d+$/.test(l));
    const rawText = textLines.join(' ');

    rawBlocks.push({ startSec, rawText });
  }

  // ── Pass 2: Walk blocks, accumulating chapter titles across blocks ──────
  //
  // Pattern the TTS encoder produces:
  //   Block A:  "Chapter 9 - On Past Experiences, and"       ← chapter heading starts
  //   Block B:  "Present Frames and Feelings—Their Right"     ← title continues
  //   Block C:  "Use and Abuse.<break time=\\"1.6s\\"/>"      ← <break marks end of title
  //   Block D:  "When Alexander set out to..."               ← body text (ignore)
  //
  // Rule: once we see a chapter-starting block, keep collecting rawText from
  // subsequent blocks until we hit one that contains "<break" — that block
  // provides the last fragment of the title (text before the <break).

  const entries = [];
  let collecting = false;
  let chapterStartSec = 0;
  let accumulatedText = '';

  const flushChapter = () => {
    if (!collecting) return;
    collecting = false;

    // Strip all SSML/HTML tags
    let cleanText = accumulatedText
      .replace(/<[^>]+>/g, '')       // complete tags: <break time="1.6s"/>
      .replace(/<\\S[^\\s>]*/g, '')   // orphaned open-tag fragments: <break
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    // Extract chapter number and title
    let number = null;
    let title = cleanText;
    const prefixMatch = cleanText.match(/^(?:chapter\\s+)?(\\d+)\\s*[-:–—]\\s*(.+)$/i);
    if (prefixMatch) {
      number = parseInt(prefixMatch[1], 10);
      title = prefixMatch[2].trim();
    }

    // Strip trailing period
    if (title.endsWith('.')) title = title.slice(0, -1).trim();

    // Title-case ALL CAPS
    title = toTitleCase(title);

    // Extract date ranges
    const { cleanTitle, dateRange } = extractDateRange(title);
    title = cleanTitle;

    entries.push({ startSec: chapterStartSec, number, title, dateRange });
    accumulatedText = '';
  };

  for (const { startSec, rawText } of rawBlocks) {
    const hasBreak = /<break/i.test(rawText);

    if (!collecting) {
      // Check if this block starts a chapter heading (strip tags first)
      const stripped = rawText
        .replace(/<[^>]+>/g, '')
        .replace(/<\\S[^\\s>]*/g, '')
        .trim();

      const isChapterStart =
        /^chapter\\s+\\d+/i.test(stripped) ||
        /^\\d+\\s*[-–—]\\s*[A-Za-z]/.test(stripped) ||
        /^[\\[\\(]?(?:(?:the\\s+)?(?:author['']s|editor['']s)\\s+)?(?:preface|introduction)[\\]\\).:\\s]*$/i.test(stripped);

      if (isChapterStart) {
        collecting = true;
        chapterStartSec = startSec;
        // Keep text up to any <break (handles single-block chapters)
        accumulatedText = hasBreak
          ? rawText.replace(/<break.*/gi, '').trim()
          : rawText;

        if (hasBreak) flushChapter(); // fully self-contained in one block
      }
      // else: ordinary body text, ignore

    } else {
      // Mid-collection: keep appending until we hit a <break block
      if (hasBreak) {
        const beforeBreak = rawText.replace(/<break.*/gi, '').trim();
        if (beforeBreak) accumulatedText += ' ' + beforeBreak;
        flushChapter();
      } else {
        accumulatedText += ' ' + rawText;
      }
    }
  }

  // Flush any open collection at EOF
  flushChapter();

`;

const before = src.slice(0, si);
const after   = src.slice(ei);

fs.writeFileSync(filePath, before + newFn + after, 'utf8');
console.log('Done — parseSrtToChapters replaced successfully.');
