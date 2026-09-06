const { createHash } = require('crypto');

const REPEAT_INTERVAL = 2 * 60 * 60;
const REPEAT_VARIATION = 10 * 60;
const END_CLEARANCE = 60;
const FPS = 30;

function resolvePrintPromotionSchedule(totalDuration, requestedStart = 30, requestedDuration = 8, seed = '') {
  if (![totalDuration, requestedStart, requestedDuration].every(Number.isFinite)) return [];
  const start = Math.max(0, requestedStart);
  const duration = Math.max(2, requestedDuration);
  const available = totalDuration - start - 1;
  if (available < 2) return [];
  // Preserve the existing opening appearance, including its short-book limit.
  const schedule = [{ start, duration: Math.min(duration, available) }];
  // Do not add repeats to books under two hours. A partial final interval gets
  // a repeat only if its complete card can finish before the closing minute.
  for (let anchor = REPEAT_INTERVAL; anchor < totalDuration; anchor += REPEAT_INTERVAL) {
    const previous = schedule.at(-1);
    const firstFrame = Math.ceil(Math.max(anchor - REPEAT_VARIATION,
      previous.start + previous.duration + REPEAT_INTERVAL - 2 * REPEAT_VARIATION) * FPS);
    const lastFrame = Math.floor(Math.min(anchor + REPEAT_VARIATION,
      totalDuration - END_CLEARANCE - duration) * FPS);
    if (lastFrame < firstFrame) continue;
    // Repeatable randomness keeps the same audiobook's positions consistent
    // across retries and both render modes. Output filenames do not affect it.
    const random = createHash('sha256').update(`${seed}|${totalDuration}|${anchor}`).digest().readUInt32BE(0) / 2 ** 32;
    schedule.push({ start: (firstFrame + Math.floor(random * (lastFrame - firstFrame + 1))) / FPS, duration });
  }
  return schedule;
}

function buildPrintPromotionOverlayFilter(schedule) {
  // Separate short inputs reuse the same PNG file without split branches
  // buffering full-resolution frames until a repeat hours later. One video pass.
  const filters = [];
  for (const [i, { start, duration }] of schedule.entries()) {
    const fade = Math.min(0.6, duration / 3);
    filters.push(`[${i + 1}:v]format=rgba,trim=duration=${duration.toFixed(6)},setpts=PTS-STARTPTS,` +
      `fade=t=in:st=0:d=${fade.toFixed(6)}:alpha=1,` +
      `fade=t=out:st=${(duration - fade).toFixed(6)}:d=${fade.toFixed(6)}:alpha=1,` +
      `setpts=PTS+${start.toFixed(6)}/TB[promo${i}]`);
    filters.push(`[${i === 0 ? '0:v' : `over${i - 1}`}][promo${i}]` +
      `overlay=0:0:eof_action=pass:shortest=0[${i === schedule.length - 1 ? 'vout' : `over${i}`}]`);
  }
  return filters.join(';');
}

module.exports = { resolvePrintPromotionSchedule, buildPrintPromotionOverlayFilter };
