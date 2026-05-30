/**
 * Parses chapter markers from the format:
 * (0:00) Introduction
 * (0:38) 1 - Double Trouble
 * (1:00:21) 6 - An Apartment Burglary
 */

function parseTimeToSeconds(timeStr) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function secondsToTimecode(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Parse chapter text into structured objects.
 * Returns array of { startTime, endTime, number, title, isNumbered }
 * endTime is set after calling assignEndTimes()
 */
function parseChapters(text) {
  const lines = text.trim().split('\n');
  const chapters = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match (M:SS) or (H:MM:SS) at start
    const match = trimmed.match(/^\((\d+:\d+(?::\d+)?)\)\s+(.+)$/);
    if (!match) continue;

    const timeStr = match[1];
    const rest = match[2].trim();
    const startTime = parseTimeToSeconds(timeStr);

    // Check if chapter has a number: "17 - Kano's Curio Shop"
    const numberedMatch = rest.match(/^(\d+)\s*[-–—]\s*(.+)$/);
    if (numberedMatch) {
      chapters.push({
        startTime,
        endTime: null,
        number: parseInt(numberedMatch[1], 10),
        title: numberedMatch[2].trim(),
        isNumbered: true,
        timecode: timeStr
      });
    } else {
      // Unnumbered (e.g. "Introduction")
      chapters.push({
        startTime,
        endTime: null,
        number: null,
        title: rest,
        isNumbered: false,
        timecode: timeStr
      });
    }
  }

  return chapters;
}

/**
 * Assigns endTime to each chapter.
 * Each chapter ends when the next begins.
 * The last chapter ends at audioDuration.
 */
function assignEndTimes(chapters, audioDuration) {
  for (let i = 0; i < chapters.length; i++) {
    if (i < chapters.length - 1) {
      chapters[i].endTime = chapters[i + 1].startTime;
    } else {
      chapters[i].endTime = audioDuration;
    }
  }
  return chapters;
}

/**
 * Format one chapter for display in UI
 */
function formatChapter(ch) {
  return ch.isNumbered
    ? `Chapter ${ch.number}: ${ch.title}`
    : ch.title;
}

module.exports = { parseChapters, assignEndTimes, parseTimeToSeconds, secondsToTimecode, formatChapter };
