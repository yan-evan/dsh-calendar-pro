/**
 * DST 切换日的跨天移动。TZ 须在任何 Date 运算前设定，因此单独成文件。
 */
process.env.TZ = 'America/New_York';

const { api: internals } = await import('./helpers/client-internals.mjs');
const { moveSlot, rangeOfSlot } = internals;

import test from 'node:test';
import assert from 'node:assert/strict';

test('DST 进入日（2026-03-08 少一小时）：跨天移动不偏一小时', () => {
  const slot = { dayKey: '2026-03-07', minutes: 9 * 60, durationMinutes: 60, allDay: false };
  const next = moveSlot(slot, 1, 0, 15);
  assert.equal(next.dayKey, '2026-03-08', '日期是 3/8');
  assert.equal(next.minutes, 9 * 60, '墙钟仍是 09:00（按毫秒加会变成 10:00）');
  const range = rangeOfSlot(next);
  const start = new Date(range.start);
  assert.equal(start.getHours(), 9);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getDate(), 8);
});

test('DST 离开日（2026-11-01 多一小时）：跨天移动同样保持墙钟', () => {
  const slot = { dayKey: '2026-10-31', minutes: 9 * 60, durationMinutes: 60, allDay: false };
  const next = moveSlot(slot, 1, 0, 15);
  assert.equal(next.dayKey, '2026-11-01');
  assert.equal(next.minutes, 9 * 60);
  const start = new Date(rangeOfSlot(next).start);
  assert.equal(start.getHours(), 9);
  assert.equal(start.getDate(), 1);
});

test('DST 当天往前挪一天也一样（回到 23 小时的那天）', () => {
  const slot = { dayKey: '2026-03-08', minutes: 9 * 60, durationMinutes: 60, allDay: false };
  const prev = moveSlot(slot, -1, 0, 15);
  assert.equal(prev.dayKey, '2026-03-07');
  assert.equal(prev.minutes, 9 * 60);
});
