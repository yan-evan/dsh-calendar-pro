/**
 * 多日历聚合与配置解析的单元测试。
 * 只覆盖 P1 的核心约定：合并去重、降级、来源标注、按 uid 路由、空闲并集、calendarList 解析。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AggregateBackend, availableCalendars, buildCalendarTools, calendarNameOf, hrefInSlice,
  normalizeCollectionUrl, parseCalendarList, resolveCalendarTargets, resolveCalendars,
} from '../lib/index.js'

const HOME = 'https://cal.example/me/calendars/home/'
const WORK = 'https://cal.example/me/calendars/work/'

const event = (icalUid, start, summary = '事件') => ({
  uid: HOME + icalUid + '.ics', href: HOME + icalUid + '.ics', summary,
  start, end: new Date(new Date(start).getTime() + 3600000).toISOString().replace('.000', ''),
  allDay: false, icalUid,
})

/** 假后端：只实现聚合层会碰的那几个方法，同时记录调用。 */
function fakeSlice(id, name, options = {}) {
  const calls = { list: 0, all: 0, busy: 0, create: [], update: [], delete: [], rawAll: 0 }
  const fail = options.fail === true
  const guard = () => { if (fail) throw new Error(name + ' 读取失败（fixture）') }
  return {
    id, name, calls,
    backend: {
      kind: 'caldav',
      async list() { calls.list += 1; guard(); return options.events ?? [] },
      async all() { calls.all += 1; guard(); return options.events ?? [] },
      async busy() { calls.busy += 1; guard(); return options.busy ?? [] },
      async create(fields) {
        calls.create.push(fields)
        return { uid: id + 'new.ics', href: id + 'new.ics', summary: fields.summary, start: fields.start, end: fields.end, allDay: false }
      },
      async get(uid) { return { uid, href: uid, summary: '读取', start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z', allDay: false } },
      async update(uid, changes) {
        calls.update.push({ uid, changes })
        return { uid, href: uid, summary: changes.summary ?? '更新', start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z', allDay: false }
      },
      async delete(uid) { calls.delete.push(uid); return { uid, href: uid } },
      async importSnapshot() { return { uids: new Set(), events: [] } },
      async importRaw() {},
      async raw() { return '' },
      async rawAll() { calls.rawAll += 1; return [name + '.ics'] },
    },
  }
}

test('集合 URL 规范化与展示名：去查询串、拒绝账号密码与片段', () => {
  assert.equal(normalizeCollectionUrl('https://cal.example/a/?x=1'), 'https://cal.example/a/')
  assert.equal(normalizeCollectionUrl('  https://cal.example/a/  '), 'https://cal.example/a/')
  assert.equal(normalizeCollectionUrl('https://u:p@cal.example/a/'), undefined)
  assert.equal(normalizeCollectionUrl('https://cal.example/a/#f'), undefined)
  assert.equal(normalizeCollectionUrl('ftp://cal.example/a/'), undefined)
  assert.equal(normalizeCollectionUrl(1), undefined)
  assert.equal(calendarNameOf(HOME), 'home')
})

test('parseCalendarList：字符串与数组都认、按 URL 去重、坏条目跳过', () => {
  const refs = parseCalendarList('[{"url":"' + HOME + '","name":"家庭"},"' + WORK + '"]')
  assert.deepEqual(refs.map((ref) => ref.url), [HOME, WORK])
  assert.equal(refs[0].name, '家庭')
  assert.deepEqual(parseCalendarList([{ url: HOME }, { url: HOME }]).length, 1, '同 URL 只留一条')
  assert.deepEqual(parseCalendarList([{ url: 'ftp://x/' }, { url: WORK }]).map((ref) => ref.url), [WORK], '坏条目跳过而不是整体失败')
  assert.equal(parseCalendarList('').length, 0, '空串 = 没配置')
  assert.equal(parseCalendarList(undefined).length, 0)
  assert.throws(() => parseCalendarList('not json'), /不是合法 JSON/)
  assert.throws(() => parseCalendarList('{"url":"x"}'), /必须是数组/)
  assert.throws(() => parseCalendarList([{ url: 'ftp://x/' }]), /没有有效的日历集合 URL/)
})

test('resolveCalendars：calendarList 优先，缺省退化成 caldavUrl 那一本', () => {
  assert.deepEqual(resolveCalendars({ calendarList: '["' + HOME + '"]', caldavUrl: WORK }).map((ref) => ref.url), [HOME])
  const single = resolveCalendars({ provider: 'custom', caldavUrl: HOME + '?x=1' })
  assert.equal(single.length, 1)
  assert.equal(single[0].url, HOME, 'caldavUrl 也做规范化（去掉查询串）')
  assert.equal(single[0].name, 'home')
  assert.deepEqual(availableCalendars({ provider: 'custom' }), [], '没地址时面板拿到空列表而不是抛错')
  assert.throws(() => resolveCalendars({ provider: 'custom' }), /caldavUrl/)
})

test('resolveCalendarTargets：凭据共用，集合 URL 各自一份', () => {
  const targets = resolveCalendarTargets({
    provider: 'custom', username: 'me', password: 'p', calendarList: '["' + HOME + '","' + WORK + '"]',
  }, {})
  assert.equal(targets.length, 2)
  assert.deepEqual(targets.map((target) => target.config.caldavUrl), [HOME, WORK])
  assert.ok(targets.every((target) => target.config.username === 'me' && target.config.password === 'p'))
})

test('hrefInSlice：只认同源、集合路径下的对象', () => {
  assert.equal(hrefInSlice(HOME + 'e1.ics', HOME), true)
  assert.equal(hrefInSlice(WORK + 'e1.ics', HOME), false)
  assert.equal(hrefInSlice('https://other.example/me/calendars/home/e1.ics', HOME), false)
  assert.equal(hrefInSlice(HOME, HOME), false, '集合自身不是对象')
  assert.equal(hrefInSlice(HOME + '../x.ics', HOME), false)
})

test('合并：跨日历去重、按开始时间排序、每条都标来源日历', async () => {
  const home = fakeSlice(HOME, '家庭', {
    events: [event('a', '2026-11-02T09:00:00Z', '共享会议'), event('b', '2026-11-02T13:00:00Z', '家庭聚餐')],
  })
  // 共享日历：同一个 iCal UID 出现在另一本里，href 不同。
  const work = fakeSlice(WORK, '工作', {
    events: [{ ...event('a', '2026-11-02T09:00:00Z', '共享会议'), uid: WORK + 'a.ics', href: WORK + 'a.ics' },
      event('c', '2026-11-02T11:00:00Z', '周会')],
  })
  const events = await new AggregateBackend([home, work]).list('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')
  assert.deepEqual(events.map((item) => item.summary), ['共享会议', '周会', '家庭聚餐'])
  assert.deepEqual(events.map((item) => item.calendar.name), ['家庭', '工作', '家庭'])
  assert.equal(new Set(events.map((item) => item.calendarId ?? item.calendar.id)).size, 2)
})

test('只连一本时不写 calendar 字段，输出与旧版一致', async () => {
  const single = fakeSlice(HOME, '家庭', { events: [event('a', '2026-11-02T09:00:00Z')] })
  const events = await new AggregateBackend([single]).list('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')
  assert.equal(events.length, 1)
  assert.equal(events[0].calendar, undefined)
})

test('某本读失败：聚合结果降级上报，显式指定时直接失败', async () => {
  const home = fakeSlice(HOME, '家庭', { events: [event('a', '2026-11-02T09:00:00Z')] })
  const broken = fakeSlice(WORK, '工作', { fail: true })
  const backend = new AggregateBackend([home, broken])
  let degraded = []
  const events = await backend.list('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', { onDegraded: (info) => { degraded = info } })
  assert.equal(events.length, 1, '能读到的日历仍然返回')
  assert.deepEqual(degraded.map((item) => item.calendar), ['工作'])
  assert.match(degraded[0].message, /读取失败/)
  await assert.rejects(() => backend.list('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', {}, undefined, '工作'), /读取失败/)
})

test('calendarId 接受地址或唯一名称；找不到 / 重名都给出可操作的中文提示', async () => {
  const home = fakeSlice(HOME, '家庭', { events: [event('a', '2026-11-02T09:00:00Z')] })
  const work = fakeSlice(WORK, '工作', { events: [event('c', '2026-11-02T11:00:00Z')] })
  const backend = new AggregateBackend([home, work])
  const byUrl = await backend.list('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', {}, undefined, WORK.slice(0, -1))
  assert.deepEqual(byUrl.map((item) => item.calendar.name), ['工作'], '结尾斜杠可省')
  const byName = await backend.list('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z', {}, undefined, '家庭')
  assert.deepEqual(byName.map((item) => item.calendar.name), ['家庭'])
  await assert.rejects(() => backend.all(undefined, undefined, '不存在'), /找不到日历/)
  const twins = new AggregateBackend([fakeSlice(HOME, '日程'), fakeSlice(WORK, '日程')])
  await assert.rejects(() => twins.all(undefined, undefined, '日程'), /都叫「日程」/)
})

test('空闲查询按全部日历求并集，任一本不通就整体失败', async () => {
  const a = event('m1', '2026-11-02T09:00:00Z', '家庭日程')
  const b = { ...event('m2', '2026-11-02T10:00:00Z', '工作日程'), uid: WORK + 'm2.ics', href: WORK + 'm2.ics' }
  const home = fakeSlice(HOME, '家庭', { busy: [a] })
  const work = fakeSlice(WORK, '工作', { busy: [b] })
  const input = { start: '2026-11-02T00:00:00Z', end: '2026-11-03T00:00:00Z', timeZone: 'UTC', durationMinutes: 60, limit: 5 }
  const result = await new AggregateBackend([home, work]).availability(input)
  assert.equal(result.scope, 'all-enabled-calendars')
  assert.deepEqual(result.calendars, ['家庭', '工作'])
  assert.equal(result.slots[0].start, '2026-11-02T11:00:00.000Z', '两本里的占用都要算进去')
  assert.equal(home.calls.busy + work.calls.busy, 2)

  const single = await new AggregateBackend([home]).availability(input)
  assert.equal(single.scope, 'connected-calendar')
  assert.equal(single.calendars, undefined)

  const selected = await new AggregateBackend([home, work]).availability(input, undefined, '工作')
  assert.equal(selected.scope, 'selected-calendars')
  assert.equal(selected.slots[0].start, '2026-11-02T09:00:00.000Z', '只看工作那本，家庭不参与')

  const brokenWork = fakeSlice(WORK, '工作', { fail: true })
  await assert.rejects(() => new AggregateBackend([home, brokenWork]).availability(input), /读取失败/)
})

test('写操作按 uid 路由到所属日历，不一致时报错而不是猜', async () => {
  const home = fakeSlice(HOME, '家庭')
  const work = fakeSlice(WORK, '工作')
  const backend = new AggregateBackend([home, work])

  await backend.update(WORK + 'x.ics', { summary: '改期' })
  assert.equal(work.calls.update.length, 1)
  assert.equal(home.calls.update.length, 0)

  await assert.rejects(() => backend.update(WORK + 'x.ics', { summary: '改期' }, undefined, undefined, '家庭'), /不属于|不一致/)
  await assert.rejects(() => backend.delete('/not-a-calendar/x.ics'), /不属于任何已连接的日历/)

  const created = await backend.create({ summary: '默认写第一本', start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z' })
  assert.equal(home.calls.create.length, 1)
  assert.deepEqual(created.calendar, { id: HOME, name: '家庭' })
  await backend.create({ summary: '指定工作', start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z' }, undefined, '工作')
  assert.equal(work.calls.create.length, 1)
})

test('导出取全部日历的原文；导入仍写默认日历', async () => {
  const home = fakeSlice(HOME, '家庭')
  const work = fakeSlice(WORK, '工作')
  const backend = new AggregateBackend([home, work])
  assert.deepEqual(await backend.rawAll(), ['家庭.ics', '工作.ics'])
  assert.equal(home.calls.rawAll, 1)
  assert.equal(work.calls.rawAll, 1)
})

test('工具层 health：多日历时逐本列出，单本仍是原来那四项', async () => {
  const multi = buildCalendarTools({
    provider: 'custom', username: 'me', password: 'p',
    calendarList: '["' + HOME + '","' + WORK + '"]',
  }, {}).find((tool) => tool.name === 'calendar_health')
  const value = await multi.execute({})
  assert.equal(value.ok, true)
  assert.equal(value.checks.length, 6, '4 项基础检查 + 2 本日历')
  assert.match(value.checks[4].name, /日历 1 · home/)
  assert.equal(value.checks[4].detail, HOME)

  const single = buildCalendarTools({ provider: 'custom', username: 'me', password: 'p', caldavUrl: HOME }, {})
    .find((tool) => tool.name === 'calendar_health')
  assert.equal((await single.execute({})).checks.length, 4)

  const broken = buildCalendarTools({ provider: 'custom', username: 'me', password: 'p', calendarList: 'oops' }, {})
    .find((tool) => tool.name === 'calendar_health')
  const failed = await broken.execute({})
  assert.equal(failed.ok, false)
  assert.ok(failed.checks.some((check) => check.name === '日历列表' && check.ok === false))
})
