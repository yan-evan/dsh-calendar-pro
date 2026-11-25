/**
 * 本地日历后端：单个 JSON 文件承载 CRUD，语义与 CalDAV 一侧对齐。
 * uid 形状 local://<iCalUID>；list 展开重复事件、all 不展开；导入不覆盖已有资源。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBackend } from '../lib/local-backend.js'
import { createBackend } from '../lib/backend.js'
import { resolveBackendKind } from '../lib/config.js'

const freshFile = () => join(mkdtempSync(join(tmpdir(), 'dshc-local-')), 'calendar.json')

test('空日历：读返回空集，改/删给出可读错误，且不会凭空创建文件', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  assert.deepEqual(await backend.list('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'), [])
  assert.deepEqual(await backend.all(), [])
  assert.equal(existsSync(file), false, '只读操作不该创建数据文件')
  await assert.rejects(() => backend.get('local://nope'), /找不到这条本地日程/)
  await assert.rejects(() => backend.update('local://nope', { summary: 'x' }), /找不到这条本地日程/)
  await assert.rejects(() => backend.delete('local://nope'), /找不到这条本地日程/)
})

test('新建 → 列表 → 更新 → 删除，uid 固定为 local://<iCalUID>', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  const created = await backend.create({
    icalUid: 'uid-fixed-1',
    summary: '评审',
    start: '2026-11-05T02:00:00Z',
    end: '2026-11-05T03:00:00Z',
    location: '会议室',
  })
  assert.equal(created.uid, 'local://uid-fixed-1')
  assert.equal(created.summary, '评审')
  assert.equal(created.allDay, false)
  assert.equal(existsSync(file), true, '新建后必须落盘')

  const listed = await backend.list('2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z')
  assert.equal(listed.length, 1)
  assert.equal(listed[0].uid, 'local://uid-fixed-1')

  // 窗口外不返回
  assert.deepEqual(await backend.list('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z'), [])

  const updated = await backend.update(created.uid, { summary: '评审（改）' })
  assert.equal(updated.summary, '评审（改）')
  assert.equal(updated.location, '会议室', '没给的字段要保留')
  assert.equal((await backend.get(created.uid)).summary, '评审（改）')

  const removed = await backend.delete(created.uid)
  assert.equal(removed.uid, created.uid)
  assert.deepEqual(await backend.all(), [])
})

test('重复事件：list 展开成多行，all 保留原始 RRULE，expand=false 也不展开', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  await backend.create({
    icalUid: 'uid-rrule',
    summary: '周会',
    start: '2026-11-05T02:00:00Z',
    end: '2026-11-05T03:00:00Z',
    rrule: 'FREQ=WEEKLY;COUNT=3',
  })
  const expanded = await backend.list('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')
  assert.equal(expanded.length, 3, '三次都要出现')
  assert.equal(expanded.every(event => event.isOccurrence === true), true)

  const raw = await backend.all()
  assert.equal(raw.length, 1, '全量读取不展开')
  assert.equal(raw[0].rrule, 'FREQ=WEEKLY;COUNT=3')

  const flat = await backend.list('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', { expand: false })
  assert.equal(flat.length, 1)
  assert.equal(flat[0].rrule, 'FREQ=WEEKLY;COUNT=3')
})

test('导入：同 UID 绝不覆盖；importSnapshot 给出 UID 清单', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN',
    'BEGIN:VEVENT', 'UID:uid-imported', 'DTSTAMP:20261105T000000Z',
    'DTSTART:20261105T040000Z', 'DTEND:20261105T050000Z', 'SUMMARY:导入的日程',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  await backend.importRaw('uid-imported', ics)
  const snapshot = await backend.importSnapshot()
  assert.equal(snapshot.uids.has('uid-imported'), true)
  assert.equal(snapshot.events.length, 1)

  await assert.rejects(() => backend.importRaw('uid-imported', ics), /已存在 UID/)
  assert.equal((await backend.all()).length, 1, '重复导入不该产生第二条')
})

test('坏数据不会拖垮整份文件：非字符串 ical 与坏 JSON 都当空处理', async () => {
  const file = freshFile()
  writeFileSync(file, JSON.stringify({
    version: 1,
    revision: 3,
    events: {
      'local://ok': { ical: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:ok\nDTSTART:20261105T020000Z\nSUMMARY:好记录\nEND:VEVENT\nEND:VCALENDAR', revision: 1 },
      'local://bad': { ical: 42, revision: 1 },
    },
  }), 'utf8')
  const backend = new LocalBackend(file)
  const events = await backend.all()
  assert.equal(events.length, 1, '坏记录被丢掉，好记录照常读出')
  assert.equal(events[0].summary, '好记录')

  writeFileSync(file, '{ not json', 'utf8')
  const broken = new LocalBackend(file)
  assert.deepEqual(await broken.all(), [])
  assert.equal((await broken.create({ icalUid: 'uid-after-broken', summary: '仍可写', start: '2026-11-05T02:00:00Z', end: '2026-11-05T03:00:00Z' })).summary, '仍可写')
})

test('归档来源标签：importRaw 带标签，列表/快照带出，update 保留；旧文件无标签不丢 ical', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN',
    'BEGIN:VEVENT', 'UID:uid-src', 'DTSTAMP:20261105T000000Z',
    'DTSTART:20261105T040000Z', 'DTEND:20261105T050000Z', 'SUMMARY:归档来的日程',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  const source = { id: 'https://cal.example/me/calendars/home/', name: '家庭' }
  await backend.importRaw('uid-src', ics, undefined, source)

  const all = await backend.all()
  assert.equal(all.length, 1)
  assert.deepEqual(all[0].calendar, source, '全量读取要带回来源标签')

  const snapshot = await backend.importSnapshot()
  assert.deepEqual(snapshot.events[0].calendar, source, '快照也要带回标签，去重时能识别来源')

  const updated = await backend.update('local://uid-src', { summary: '归档来的日程（改）' })
  assert.deepEqual(updated.calendar, source, '更新日程不能把来源标签冲掉')

  // 旧文件：记录没有 calendar 字段，ical 照常读出，事件不带标签；形状不对的标签直接忽略。
  writeFileSync(file, JSON.stringify({
    version: 1,
    revision: 2,
    events: {
      'local://old': { ical: ics, revision: 1, updatedAt: '' },
      'local://broken': { ical: ics, revision: 1, updatedAt: '', calendar: { id: 42, name: '坏标签' } },
    },
  }), 'utf8')
  const legacy = new LocalBackend(file)
  const legacyEvents = await legacy.all()
  assert.equal(legacyEvents.length, 2, '记录都保留，坏形状标签被剥掉而不是丢整条')
  assert.ok(legacyEvents.every((event) => event.calendar === undefined), '两条都不带标签')
})

test('rawAll 一次取全部原文（导出不能逐条取，那是 N+1）', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  await backend.create({ icalUid: 'r1', summary: 'A', start: '2026-11-05T02:00:00Z', end: '2026-11-05T03:00:00Z' })
  await backend.create({ icalUid: 'r2', summary: 'B', start: '2026-11-06T02:00:00Z', end: '2026-11-06T03:00:00Z' })
  const sources = await backend.rawAll()
  assert.equal(sources.length, 2)
  assert.equal(sources.every(text => text.includes('BEGIN:VCALENDAR')), true)
  assert.equal(sources.some(text => /SUMMARY:A/.test(text)), true)
})

test('全量读取支持 timeRange 过滤（迁移预检要用）', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  await backend.create({ icalUid: 'u-old', summary: '去年', start: '2025-03-01T02:00:00Z', end: '2025-03-01T03:00:00Z' })
  await backend.create({ icalUid: 'u-new', summary: '明年', start: '2027-03-01T02:00:00Z', end: '2027-03-01T03:00:00Z' })
  assert.equal((await backend.all()).length, 2)
  assert.equal((await backend.all(undefined, { start: '2025-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' })).length, 1)
})

test('空闲查询可用：本地后端与远程同一套算法，不抛错并给出结构', async () => {
  const file = freshFile()
  const backend = new LocalBackend(file)
  await backend.create({ icalUid: 'u-busy', summary: '占位', start: '2026-11-05T09:00:00Z', end: '2026-11-05T10:00:00Z' })
  const result = await backend.availability({
    start: '2026-11-05T08:00:00Z', end: '2026-11-06T08:00:00Z',
    timeZone: 'Asia/Shanghai', durationMinutes: 60,
  })
  assert.equal(Array.isArray(result.slots), true)
  assert.equal(result.scope, 'connected-calendar')
})

test('后端选择：未选过走本地，选了 caldav 才解析远程配置，非法值报中文错误', () => {
  assert.equal(resolveBackendKind(undefined), undefined, '没选过就是 undefined，面板显示首启页')
  assert.equal(resolveBackendKind({ backend: 'local' }), 'local')
  assert.equal(resolveBackendKind({ backend: 'caldav' }), 'caldav')
  // 升级用户：旧配置里有 CalDAV 端点，直接视为 caldav，不被首启页拦住。
  assert.equal(resolveBackendKind({ caldavUrl: 'https://example.test/dav/' }), 'caldav')
  assert.equal(resolveBackendKind({ provider: 'icloud', username: 'me' }), 'caldav')
  assert.throws(() => resolveBackendKind({ backend: 'sqlite' }), /只支持 local \/ caldav/)

  assert.equal(createBackend(undefined).kind, 'local')
  assert.equal(createBackend({ backend: 'local' }).kind, 'local')
  // 选了 caldav 却没配账号：明确报错，不能静默回退到本地。
  assert.throws(() => createBackend({ backend: 'caldav' }), /账号|caldavUrl|未配置/)
})
