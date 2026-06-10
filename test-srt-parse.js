// Test: multi-block chapter title accumulation
const srtSnippet = `2137
02:55:44,013 --> 02:55:50,218
Chapter 8 - The Blessed Effects and Happy
Results of Putting on Christ.<break

2138
02:55:50,218 --> 02:55:51,279
time="1.6s"/>

2139
02:55:51,279 --> 02:55:56,275
When Alexander set out to conquer the
world, he divided all he had among his

2485
03:23:19,546 --> 03:23:26,686
Chapter 9 - On Past Experiences, and
Present Frames and Feelings—Their Right

2486
03:23:26,686 --> 03:23:29,923
Use and Abuse.<break time="1.6s"/>

2487
03:23:29,923 --> 03:23:35,000
Some body text here that should be ignored.`;

// ── reproduce the new two-pass parser logic ────────────────────────────────

function toTitleCase(str) {
  const letters = str.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0 || letters !== letters.toUpperCase()) return str;
  const smalls = new Set(['a','an','the','and','but','or','for','nor','on','at','to','of','in','by','up']);
  return str.toLowerCase().replace(/[^\s-]+/g, (word, offset) => {
    const bare = word.replace(/^[^a-z]+|[^a-z]+$/gi, '');
    if (offset === 0 || !smalls.has(bare)) return word.replace(/[a-z]/i, letter => letter.toUpperCase());
    return word;
  });
}

function extractDateRange(title) { return { cleanTitle: title, dateRange: null }; }

// Pass 1
const rawBlocks = [];
const blocks = srtSnippet.trim().split(/\n\s*\n/);
for (const block of blocks) {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) continue;
  const tcLine = lines.find(l => l.includes('-->'));
  if (!tcLine) continue;
  const tcMatch = tcLine.match(/(\d+):(\d+):(\d+)[,\.](\d+)/);
  if (!tcMatch) continue;
  const startSec = parseInt(tcMatch[1])*3600 + parseInt(tcMatch[2])*60 + parseInt(tcMatch[3]);
  const textLines = lines.filter(l => !l.includes('-->') && !/^\d+$/.test(l));
  rawBlocks.push({ startSec, rawText: textLines.join(' ') });
}

// Pass 2
const entries = [];
let collecting = false, chapterStartSec = 0, accumulatedText = '';

const flushChapter = () => {
  if (!collecting) return;
  collecting = false;
  let cleanText = accumulatedText
    .replace(/<[^>]+>/g, '')
    .replace(/<\S[^\s>]*/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!cleanText) return;
  let number = null, title = cleanText;
  const m = cleanText.match(/^(?:chapter\s+)?(\d+)\s*[-:–—]\s*(.+)$/i);
  if (m) { number = parseInt(m[1],10); title = m[2].trim(); }
  if (title.endsWith('.')) title = title.slice(0,-1).trim();
  title = toTitleCase(title);
  const { cleanTitle, dateRange } = extractDateRange(title);
  entries.push({ startSec: chapterStartSec, number, title: cleanTitle, dateRange });
  accumulatedText = '';
};

for (const { startSec, rawText } of rawBlocks) {
  const hasBreak = /<break/i.test(rawText);
  if (!collecting) {
    const stripped = rawText.replace(/<[^>]+>/g,'').replace(/<\S[^\s>]*/g,'').trim();
    const isChapterStart = /^chapter\s+\d+/i.test(stripped) || /^\d+\s*[-–—]\s*[A-Za-z]/.test(stripped);
    if (isChapterStart) {
      collecting = true;
      chapterStartSec = startSec;
      accumulatedText = hasBreak ? rawText.replace(/<break.*/gi,'').trim() : rawText;
      if (hasBreak) flushChapter();
    }
  } else {
    if (hasBreak) {
      const beforeBreak = rawText.replace(/<break.*/gi,'').trim();
      if (beforeBreak) accumulatedText += ' ' + beforeBreak;
      flushChapter();
    } else {
      accumulatedText += ' ' + rawText;
    }
  }
}
flushChapter();

console.log('\n=== Results ===');
entries.forEach(e => {
  const h = Math.floor(e.startSec/3600);
  const m = Math.floor((e.startSec%3600)/60);
  const s = e.startSec % 60;
  const tc = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  const line = e.number !== null ? `(${tc}) ${e.number} - ${e.title}` : `(${tc}) ${e.title}`;
  console.log(line);
});
