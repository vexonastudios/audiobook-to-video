const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildChapterTimeline, transitionAlpha } = require('../src/chapterTimeline');
const { renderProfile } = require('../src/renderHistory');

function chapters(starts, endTime) {
  return starts.map((startTime, i) => ({ startTime, endTime: starts[i + 1] ?? endTime }));
}

function checkSchedule(input, style, duration) {
  const plan = buildChapterTimeline(input, style, duration);
  let frame = 0;
  plan.stills.forEach((still, i) => {
    assert.equal(still.startFrame, frame);
    assert.ok(still.frameCount >= 1);
    frame += still.frameCount;
    const transition = plan.transitions[i];
    if (transition) {
      assert.equal(transition.startFrame, frame);
      assert.equal(frame + transition.beforeFrames, Math.round(input[i + 1].startTime * 30));
      assert.equal(transitionAlpha(transition, transition.beforeFrames), 0.5);
      assert.equal(transitionAlpha(transition, 0), 0);
      frame += transition.frameCount;
    } else if (i + 1 < input.length) {
      assert.equal(frame, Math.round(input[i + 1].startTime * 30));
    }
  });
  assert.equal(frame, Math.round(input.at(-1).endTime * 30));
  assert.equal(frame, plan.totalFrames);
  return plan;
}

test('Cut is the default in the scheduler and render estimates', () => {
  const plan = checkSchedule(chapters([0, 1.017, 4.01], 8), undefined, undefined);
  assert.ok(plan.transitions.every(t => t === null));
  assert.equal(renderProfile({}).transitionStyle, 'cut');
  assert.equal(renderProfile({}).transitionDuration, 0);
  assert.equal(renderProfile({ transitionStyle: 'fade' }).transitionDuration, 1);
});

test('every effect stays on absolute markers even with fractional chapters and odd frame durations', () => {
  const input = chapters(Array.from({ length: 300 }, (_, i) => i * 30.017), 9020.013);
  for (const style of ['cut', 'fade', 'dissolve', 'flare', 'zoom']) {
    for (const duration of [0.3, 1, 1.1, 3]) checkSchedule(input, style, duration);
  }
});

test('short chapters shorten transitions without borrowing time from later chapters', () => {
  const plan = checkSchedule(chapters([0, 0.2, 0.4, 2, 4], 6), 'fade', 3);
  assert.ok(plan.transitions[0].duration < 3);
  assert.ok(plan.transitions[1].duration < 3);
});

test('one-frame chapters use Cut when there is no room for both halves of a fade', () => {
  const plan = checkSchedule(chapters([0, 1 / 30, 2 / 30, 1], 31 / 30), 'fade', 3);
  assert.ok(plan.transitions.every(t => t === null));
});

test('zero duration and one-chapter books have no transitions', () => {
  assert.ok(checkSchedule(chapters([0, 2], 4), 'fade', 0).transitions.every(t => t === null));
  assert.deepEqual(checkSchedule(chapters([0], 12), 'fade', 3).transitions, []);
});

test('invalid chapter markers fail clearly instead of creating a drifting timeline', () => {
  assert.throws(() => buildChapterTimeline(chapters([0, 1, 1], 3)), /at least one video frame/);
  assert.throws(() => buildChapterTimeline(chapters([0, 1], 3), 'fade', NaN), /finite number/);
});
