/**
 * 回归测试：自检分流、全天事件时长、迁移失败中止、重复系列确认、
 * 夏令时候选、时间类型一致、窗口端点语义、展开截断提示。
 *
 * 每条都断言约定的正确行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildCalendarTools } from '../lib/tools.js'
import { LocalBackend } from '../lib/local-backend.js'
import { buildICalString, expandEventFromICal, parseEventFromICal, updateICalString } from '../lib/ical.js'
import { findAvailableTimes } from '../lib/availability.js'
import { CalendarSettingsBackend } from '../lib/web.js'

const freshFile = () => join(mkdtempSync(join(tmpdir(), 'dshc-fix-')), 'calendar.json')

const ics = (lines, uid = 'fixture@example.com') => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN',
  'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:20260101T000000Z',
  ...lines,
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')

// ===========================================================================
// 自检：本地日历不应要求 CalDAV 账号
// ===========================================================================

test('本地日历模式下自检通过，不要求 CalDAV 账号', async () => {
  const health = buildCalendarTools({ backend: 'local' }, {}).find((t) => t.name === 'calendar_health')
  const value = await health.execute({})
  assert.equal(value.ok, true, '本地日历零配置，不该被判成故障')
  assert.equal(value.checks.length, 1)
  assert.equal(value.checks[0].name, '数据源')
  assert.match(String(value.checks[0].detail), /本地日历/)
  assert.match(health.output.render({}, value)[0].text, /自检：正常/)
})

test('未选数据源（首启）时自检同样通过', async () => {
  const health = buildCalendarTools(undefined, {}).find((t) => t.name === 'calendar_health')
  const value = await health.execute({})
  assert.equal(value.ok, true)
  assert.match(String(value.checks[0].detail), /尚未选择数据源/)
})

test('连接 CalDAV 时仍检查端点与凭据（分流不影响远程路径）', async () => {
  const health = buildCalendarTools({ provider: 'custom', caldavUrl: 'https://caldav.example.com/x' }, {}).find((t) => t.name === 'calendar_health')
  const value = await health.execute({})
  assert.equal(value.ok, false)
  assert.equal(value.checks.length, 4)
  assert.ok(value.checks.filter((c) => c.ok === false).length >= 2)
})

// ===========================================================================
// 全天事件：缺 DTEND 时按次日算，且列表与空闲查询结论一致
// ===========================================================================

test('缺 DTEND 的全天事件结束日为次日，且当天窗口能查到', async () => {
  const backend = new LocalBackend(freshFile())
  await backend.importRaw('allday1', ics(['DTSTART;VALUE=DATE:20261105', 'SUMMARY:全天单日']))

  const all = await backend.all()
  assert.equal(all[0].start, '2026-11-05')
  assert.equal(all[0].end, '2026-11-06', 'RFC 5545 §3.6.1：全天事件缺 DTEND 时结束日应为次日')

  const sameDay = await backend.list('2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z')
  assert.equal(sameDay.length, 1, '事件当天必须能被查到')
  assert.equal(sameDay[0].end, '2026-11-06')
})

test('全天事件在 list 与 find_time 里的结论一致', async () => {
  const backend = new LocalBackend(freshFile())
  await backend.importRaw('allday1', ics(['DTSTART;VALUE=DATE:20261105', 'SUMMARY:全天单日']))
  const [event] = await backend.all()
  const free = findAvailableTimes([event], {
    start: '2026-11-04T16:00:00Z', end: '2026-11-06T16:00:00Z', timeZone: 'Asia/Shanghai',
    durationMinutes: 60, limit: 20,
  })
  assert.equal(free.busyEventCount, 1, 'find_time 必须认得这条全天日程占满一天')
  const listed = await backend.list('2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z')
  assert.equal(listed.length, 1, 'list 与 find_time 不能对同一条日程给出相反结论')
})

test('重复的全天事件逐日推进，实例结束日仍是次日', () => {
  const raw = ics(['DTSTART;VALUE=DATE:20250203', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:假期'])
  const events = expandEventFromICal(raw, 'local://rec', undefined, '2025-02-03', '2025-02-06', 30)
  assert.deepEqual(events.map((e) => e.start), ['2025-02-03', '2025-02-04', '2025-02-05'])
  assert.deepEqual(events.map((e) => e.end), ['2025-02-04', '2025-02-05', '2025-02-06'])
})

// ===========================================================================
// 迁移：有条目失败时中止，不切换数据源
// ===========================================================================

/** 造一个假 settings 面：记录写入，面板就能把 backend 切过去。 */
function fakeFace() {
  const state = { stored: {}, writes: 0 }
  return {
    state,
    face: {
      kind: 'file',
      read: () => ({ ...state.stored }),
      descriptor: () => ({ revision: 0 }),
      replace: async (value) => { state.stored = { ...value }; state.writes += 1 },
    },
  }
}

function makeReq(body) {
  return {
    method: 'POST',
    headers: { host: 'localhost:3080', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
  }
}

function makeRes() {
  const state = { status: 0, body: undefined }
  return {
    state,
    writeHead(status) { state.status = status },
    end(text) { state.body = JSON.parse(text) },
  }
}

/** 源端：临时 DSH_HOME 下的本地日历，预置 count 条事件。 */
function seedLocalCalendar(count) {
  const home = mkdtempSync(join(tmpdir(), 'dshc-fixhome-'))
  const dir = join(home, 'data', 'dsh-calendar-pro')
  mkdirSync(dir, { recursive: true })
  const events = {}
  for (let i = 1; i <= count; i++) {
    const day = String(i + 4).padStart(2, '0')
    events['local://u' + i] = {
      ical: ics(['DTSTART:202611' + day + 'T020000Z', 'DTEND:202611' + day + 'T030000Z', 'SUMMARY:会议' + i], 'u' + i),
      revision: i, updatedAt: '',
    }
  }
  writeFileSync(join(dir, 'calendar.json'), JSON.stringify({ version: 1, revision: count, events }, null, 2))
  return home
}

test('迁移部分失败时不切换数据源', async () => {
  const { CalendarService } = await import('../lib/caldav.js')
  const originalImportRaw = CalendarService.prototype.importRaw
  const originalSnapshot = CalendarService.prototype.importSnapshot
  // 目标端完全离线：预检返回空清单，写入时第 2 条抛错，制造 migrated=2 / failed=1。
  CalendarService.prototype.importSnapshot = async function () { return { uids: new Set(), events: [] } }
  CalendarService.prototype.importRaw = async function (uid) {
    if (uid === 'u2') throw new Error('模拟目标端写入失败：409 Conflict')
  }
  const home = seedLocalCalendar(3)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { face, state } = fakeFace()
    const backend = new CalendarSettingsBackend({
      config: { backend: 'local', provider: 'custom', caldavUrl: 'https://caldav.example.com/cal/', username: 'u@example.com', password: 'p' },
      env: {}, settings: face,
    })
    const res = makeRes()
    await backend.handle(makeReq({ action: 'migrateRun' }), res)

    assert.equal(res.state.status, 400, '部分失败必须报错，不能静默成功')
    assert.equal(res.state.body.ok, false)
    assert.match(String(res.state.body.error.message), /迁移已中止/)
    assert.match(String(res.state.body.error.message), /1 条复制失败/)
    assert.equal(state.stored.backend, undefined, '失败时绝不能把数据源切到目标端')
    assert.equal(state.writes, 0, '失败时不能写入 backend')
  } finally {
    CalendarService.prototype.importRaw = originalImportRaw
    CalendarService.prototype.importSnapshot = originalSnapshot
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

// ===========================================================================
// 重复系列：本地后端同样要求 scope="series"
// ===========================================================================

test('本地后端删除重复系列必须显式传 scope="series"', async () => {
  const backend = new LocalBackend(freshFile())
  const created = await backend.create({
    icalUid: 'rec', summary: '周会',
    start: '2026-11-05T02:00:00Z', end: '2026-11-05T03:00:00Z',
    rrule: 'FREQ=WEEKLY;COUNT=5',
  })
  assert.equal(created.uid, 'local://rec')

  await assert.rejects(
    () => backend.delete(created.uid, undefined, undefined),
    /重复系列[\s\S]*scope="series"/,
    '未确认时必须拒绝，且不能删除任何东西',
  )
  assert.equal((await backend.all()).length, 1, '拒绝后记录必须原样保留')

  // 显式确认后才允许操作整个系列。
  await backend.delete(created.uid, undefined, 'series')
  assert.equal((await backend.all()).length, 0)
})

test('本地后端整体修改重复系列必须显式传 scope="series"', async () => {
  const backend = new LocalBackend(freshFile())
  const created = await backend.create({
    icalUid: 'rec2', summary: '周会',
    start: '2026-11-05T02:00:00Z', end: '2026-11-05T03:00:00Z',
    rrule: 'FREQ=WEEKLY;COUNT=5',
  })
  await assert.rejects(
    () => backend.update(created.uid, { start: '2026-11-12T02:00:00Z' }, undefined, undefined),
    /重复系列[\s\S]*scope="series"/,
  )
  const unchanged = await backend.get(created.uid)
  assert.equal(unchanged.start, '2026-11-05T02:00:00Z', '拒绝后原时间必须不变')
})

test('非重复日程不受 scope 限制', async () => {
  const backend = new LocalBackend(freshFile())
  const created = await backend.create({
    icalUid: 'single', summary: '一次性', start: '2026-11-05T02:00:00Z', end: '2026-11-05T03:00:00Z',
  })
  await backend.delete(created.uid, undefined, undefined)
  assert.equal((await backend.all()).length, 0)
})

// ===========================================================================
// 夏令时：候选按本地墙钟，不重复也不虚构
// ===========================================================================

const NY = 'America/New_York'
const localClock = (iso) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(Date.parse(iso)).map((p) => [p.type, p.value]))
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute
}

test('DST 回拨日的候选不重复本地钟点，也不出现零长度候选', () => {
  // 覆盖完整本地日 2026-11-01（真实 25 小时）
  const result = findAvailableTimes([], {
    start: '2026-11-01T04:00:00Z', end: '2026-11-02T05:00:00Z', timeZone: NY,
    weekdays: [1, 2, 3, 4, 5, 6, 7], workStart: '00:00', workEnd: '23:59',
    durationMinutes: 60, stepMinutes: 60, limit: 100,
  })
  const starts = result.slots.map((s) => localClock(s.start))
  assert.equal(new Set(starts).size, starts.length, '同一个本地钟点不能被给出两次')

  const zeroLength = result.slots.filter((s) => localClock(s.start).slice(11) === localClock(s.end).slice(11))
  assert.equal(zeroLength.length, 0, '不能出现本地起止钟点相同的零长度候选')

  // 回拨那一小时（本地 01:00）只能出现一次。
  assert.equal(starts.filter((s) => s.slice(11) === '01:00').length, 1)
})

test('DST 前跳日不虚构不存在的本地钟点', () => {
  const result = findAvailableTimes([], {
    start: '2026-03-08T05:00:00Z', end: '2026-03-09T04:00:00Z', timeZone: NY,
    weekdays: [1, 2, 3, 4, 5, 6, 7], workStart: '00:00', workEnd: '23:59',
    durationMinutes: 60, stepMinutes: 60, limit: 100,
  })
  const starts = result.slots.map((s) => localClock(s.start))
  assert.equal(new Set(starts).size, starts.length)
  assert.ok(!starts.some((s) => s.slice(11) === '02:00'), '本地 02:00 在前跳日不存在，不能被给出')
})

test('普通日的候选不受影响', () => {
  const result = findAvailableTimes([], {
    start: '2026-11-02T00:00:00Z', end: '2026-11-03T00:00:00Z', timeZone: NY,
    weekdays: [1, 2, 3, 4, 5, 6, 7], workStart: '00:00', workEnd: '23:59',
    durationMinutes: 60, stepMinutes: 60, limit: 100,
  })
  assert.equal(result.count, 23)
  const starts = result.slots.map((s) => localClock(s.start))
  assert.equal(new Set(starts).size, starts.length)
})

// ===========================================================================
// 时间：DTSTART 与 DTEND 的 VALUE 类型必须一致
// ===========================================================================

test('只改开始时间时 DTEND 必须跟着换表示', () => {
  const src = ics(['DTSTART:20261105T020000Z', 'DTEND:20261105T030000Z', 'SUMMARY:原定时'], 'u6')
  const out = updateICalString(src, { start: '2026-12-01' })
  assert.ok(out !== null)
  assert.match(out, /DTSTART;VALUE=DATE:20261201/)
  assert.doesNotMatch(out, /DTEND:20261105T030000Z/, 'DTEND 不得保留 DATE-TIME 表示')

  const parsed = parseEventFromICal(out, 'local://u6')
  assert.equal(parsed.start, '2026-12-01')
  assert.equal(parsed.end, '2026-12-02', '全天事件的结束日应为次日')
  assert.ok(Date.parse(parsed.end) > Date.parse(parsed.start), '结束不得早于开始')
})

test('DTSTART 与 DTEND 的 VALUE 类型必须一致', () => {
  const src = ics(['DTSTART:20261105T020000Z', 'DTEND:20261105T030000Z', 'SUMMARY:定时'], 'u6b')
  // 只给结束时间、类型与开始不同：应被拒绝而不是写出混用的 VEVENT。
  assert.throws(() => updateICalString(src, { end: '2026-12-01' }), /同时为全天日期或具体时间/)
})

test('全天事件带具体时刻时也必须占满一天且类型一致', () => {
  const ical = buildICalString({ summary: '整天', start: '2026-11-05T09:00:00+08:00', end: '2026-11-05T10:00:00+08:00', allDay: true })
  assert.match(ical, /DTSTART;VALUE=DATE:20261105/)
  assert.match(ical, /DTEND;VALUE=DATE:20261106/)
  const parsed = parseEventFromICal(ical, 'local://u6c')
  assert.equal(parsed.start, '2026-11-05')
  assert.equal(parsed.end, '2026-11-06')
})

test('新建时结束早于开始必须被拒绝', () => {
  assert.throws(
    () => buildICalString({ summary: '倒置', start: '2026-12-01T10:00:00Z', end: '2026-11-05' }),
    /结束时间早于开始时间/,
  )
})

test('更新后的 iCal 能被本插件自己的导入器接受', async () => {
  const { parseImportICS } = await import('../lib/import-ical.js')
  const src = ics(['DTSTART:20261105T020000Z', 'DTEND:20261105T030000Z', 'SUMMARY:定时'], 'u6d')
  const out = updateICalString(src, { start: '2026-12-01' })
  const parsed = parseImportICS(out)
  assert.equal(parsed.items.length, 1, '自己产出的文件必须能被自己导入')
  assert.deepEqual(parsed.items[0].row.errors, [], '导入器不得报「开始与结束类型不一致」')
  assert.equal(parsed.items[0].row.start, '2026-12-01')
  assert.equal(parsed.items[0].row.end, '2026-12-02')
})

// ===========================================================================
// 查询窗口：各路径统一为半开区间 [start, end)
// ===========================================================================

test('三条路径对同一个 end 端点给出相同答案', async () => {
  const raw = ics(['DTSTART:20261101T030000Z', 'DTEND:20261101T040000Z', 'RRULE:FREQ=DAILY;COUNT=10', 'SUMMARY:每日'], 'edge')
  const start = '2026-11-01T00:00:00Z', end = '2026-11-05T03:00:00Z'

  // (a) 本地 calendar_list
  const backend = new LocalBackend(freshFile())
  await backend.importRaw('edge', raw)
  const localCount = (await backend.list(start, end)).length

  // (b) CalDAV 展开路径
  const expanded = expandEventFromICal(raw, 'local://edge', undefined, start, end, 30).length

  // (c) find_time 的 overlap 路径
  const overlapped = expandEventFromICal(raw, 'local://edge', undefined, start, end, 30, { overlap: true }).length

  assert.equal(localCount, expanded, '本地与 CalDAV 展开必须一致')
  assert.equal(localCount, overlapped, 'list 与 find_time 必须一致')
  assert.equal(localCount, 4, '窗口末尾那一刻开始的实例不计入（半开区间）')
})

test('恰好落在窗口末尾的重复实例不计入', () => {
  // 非重复事件在 expandEventFromICal 里提前 return（不做窗口过滤，由各后端自己筛），
  // 所以端点语义要在重复系列上验证。
  const raw = ics(['DTSTART:20261101T030000Z', 'DTEND:20261101T040000Z', 'RRULE:FREQ=DAILY;COUNT=10', 'SUMMARY:每日'], 'edge2')
  const events = expandEventFromICal(raw, 'local://edge2', undefined, '2026-11-01T00:00:00Z', '2026-11-05T03:00:00Z', 30)
  assert.equal(events.length, 4, '窗口末尾那一刻开始的实例不计入（半开区间）')
  assert.ok(!events.some((e) => e.start === '2026-11-05T03:00:00Z'))
  // 放宽 1 小时后必须出现。
  const inside = expandEventFromICal(raw, 'local://edge2', undefined, '2026-11-01T00:00:00Z', '2026-11-05T04:00:00Z', 30)
  assert.equal(inside.length, 5)
})

// ===========================================================================
// 展开截断与文档一致性
// ===========================================================================

test('工具注释与实际注册的工具数量一致', () => {
  const tools = buildCalendarTools({ backend: 'local' }, {})
  assert.equal(tools.length, 7)
  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'calendar_create', 'calendar_delete', 'calendar_find_time', 'calendar_health',
    'calendar_list', 'calendar_search', 'calendar_update',
  ])
})

test('源码里不再残留「五个工具」的过期注释', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  for (const file of ['src/index.ts', 'src/tools.ts']) {
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(text, /五个面向模型的/, file + ' 仍写着「五个面向模型的工具」')
  }
})

test('展开被截断时 list 明确报告 complete=false', async () => {
  const home = seedLocalCalendar(0)
  const dir = join(home, 'data', 'dsh-calendar-pro')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'calendar.json'), JSON.stringify({
    version: 1, revision: 1,
    events: {
      'local://daily': {
        ical: ics(['DTSTART:20260101T090000Z', 'DTEND:20260101T100000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:每日'], 'daily'),
        revision: 1, updatedAt: '',
      },
    },
  }, null, 2))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const tool = buildCalendarTools({ backend: 'local' }, {}).find((t) => t.name === 'calendar_list')
    const value = await tool.execute({ start: '2026-01-01T00:00:00Z', end: '2026-12-31T00:00:00Z', maxOccurrences: 30 })
    assert.equal(value.complete, false, '一年 365 个实例只展开 30 个，必须报告被截断')
    assert.match(tool.output.render({}, value)[0].text, /不是该时间段的全部事件/)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('完整展开时 complete=true', async () => {
  const home = seedLocalCalendar(0)
  const dir = join(home, 'data', 'dsh-calendar-pro')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'calendar.json'), JSON.stringify({
    version: 1, revision: 1,
    events: {
      'local://daily2': {
        ical: ics(['DTSTART:20260101T090000Z', 'DTEND:20260101T100000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:每日'], 'daily2'),
        revision: 1, updatedAt: '',
      },
    },
  }, null, 2))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const tool = buildCalendarTools({ backend: 'local' }, {}).find((t) => t.name === 'calendar_list')
    const value = await tool.execute({ start: '2026-01-01T00:00:00Z', end: '2026-12-31T00:00:00Z', maxOccurrences: 30 })
    assert.equal(value.complete, true)
    assert.equal(value.count, 3)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})
