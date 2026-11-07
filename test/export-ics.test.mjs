/**
 * 导出合并：文本级拼接，不能有损。
 *
 * 重点：VEVENT 全部保留、VTIMEZONE 按 TZID 去重、X- 扩展属性原样、空输入不炸。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EXPORT_LIMITS, exportFilename, mergeCalendars } from '../lib/export-ics.js'

const wrap = (body, zone) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  ...(zone === undefined ? [] : ['BEGIN:VTIMEZONE', 'TZID:' + zone, 'END:VTIMEZONE']),
  ...body,
  'END:VCALENDAR',
].join('\r\n')

const vevent = (uid, extra = []) => [
  'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:20261105T000000Z',
  'DTSTART:20261105T020000Z', 'DTEND:20261105T030000Z', 'SUMMARY:' + uid,
  ...extra, 'END:VEVENT',
]

test('合并多份资源：VEVENT 全保留，VCALENDAR 只留一个外壳', () => {
  const merged = mergeCalendars([
    wrap(vevent('a'), 'Asia/Shanghai'),
    wrap(vevent('b'), 'Asia/Shanghai'),
  ], '2026-11-05T08:00:00Z')
  assert.equal(merged.count, 2)
  assert.equal(merged.data.match(/BEGIN:VCALENDAR/g).length, 1, '外壳只能有一个')
  assert.equal(merged.data.match(/END:VCALENDAR/g).length, 1)
  assert.equal(merged.data.match(/BEGIN:VEVENT/g).length, 2)
  assert.match(merged.data, /UID:a/)
  assert.match(merged.data, /UID:b/)
  assert.match(merged.data, /X-EXPORTED-AT:20261105T080000Z/, '导出时间戳写进文件头')
})

test('VTIMEZONE 按 TZID 去重，不同时区各留一份', () => {
  const merged = mergeCalendars([
    wrap(vevent('a'), 'Asia/Shanghai'),
    wrap(vevent('b'), 'Asia/Shanghai'),
    wrap(vevent('c'), 'Europe/London'),
  ])
  assert.equal(merged.data.match(/BEGIN:VTIMEZONE/g).length, 2, '同一时区只留一份')
  assert.match(merged.data, /TZID:Asia\/Shanghai/)
  assert.match(merged.data, /TZID:Europe\/London/)
})

test('未建模字段原样保留（ATTENDEE / EXDATE / X- 扩展）', () => {
  const merged = mergeCalendars([
    wrap(vevent('a', [
      'ATTENDEE;CN=张三:mailto:zhangsan@example.com',
      'EXDATE:20261112T020000Z',
      'X-CUSTOM-FLAG:keep-me',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT10M', 'END:VALARM',
    ])),
  ])
  assert.match(merged.data, /ATTENDEE;CN=张三:mailto:zhangsan@example.com/)
  assert.match(merged.data, /EXDATE:20261112T020000Z/)
  assert.match(merged.data, /X-CUSTOM-FLAG:keep-me/)
  assert.match(merged.data, /RRULE:FREQ=WEEKLY;COUNT=3/)
  assert.match(merged.data, /BEGIN:VALARM/, '子组件（提醒）不能被截断')
})

test('空输入与坏输入：返回空壳而不是抛错', () => {
  const merged = mergeCalendars([])
  assert.equal(merged.count, 0)
  assert.match(merged.data, /BEGIN:VCALENDAR/)
  assert.match(merged.data, /END:VCALENDAR/)
  assert.equal(mergeCalendars(['', 'not-an-ics']).count, 0)
})

test('文件名与上限常量', () => {
  assert.equal(exportFilename(new Date(2026, 10, 5)), 'dsh-calendar-20261105.ics')
  assert.equal(EXPORT_LIMITS.maxEvents, 5000)
  assert.equal(EXPORT_LIMITS.maxBytes, 10 * 1024 * 1024)
})
