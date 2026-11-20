/**
 * 邮件 → 候选：.ics 优先、模型输出过白名单、时间落在过去的丢弃。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractIcsEvents,
  extractSchedules,
  normalizeLlmEvents,
  parseLlmJson,
  offsetOf,
} from '../lib/index.js'

const NOW = Date.parse('2026-11-19T02:00:00Z')

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//test//EN',
  'BEGIN:VEVENT',
  'UID:ics-review-1',
  'SUMMARY:季度评审会',
  'DTSTART:20261201T060000Z',
  'DTEND:20261201T070000Z',
  'LOCATION:3 楼会议室',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

/** 记录调用次数的假模型：只要被调到就说明 .ics 优先那条路断了。 */
function countingLlm(json) {
  const state = { calls: 0 }
  return {
    state,
    face: {
      stream() {
        state.calls += 1
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: json }
          yield { type: 'finish', reason: 'stop' }
        })()
      },
    },
  }
}

const ROUTE = { provider: 'test', model: 'test-model' }

test('有 .ics 附件时只解析附件，不调模型（省一次模型钱，也更准）', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '评审会', date: '2026-11-18T02:00:00Z', text: '正文写了一堆时间', ics: [ICS] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(llm.state.calls, 0, '.ics 存在时不该调模型')
  assert.equal(result.schedules.length, 1)
  assert.equal(result.schedules[0].summary, '季度评审会')
  assert.equal(result.schedules[0].source, 'ics')
  assert.equal(result.schedules[0].location, '3 楼会议室')
  assert.equal(result.schedules[0].start, '2026-12-01T06:00:00Z')
})

test('.ics 里已取消、已过期的事件不入库', () => {
  const cancelled = ICS.replace('SUMMARY:季度评审会', 'SUMMARY:季度评审会\r\nSTATUS:CANCELLED')
  assert.equal(extractIcsEvents(cancelled, NOW).length, 0, 'STATUS:CANCELLED 要丢')
  const past = ICS
    .replace('DTSTART:20261201T060000Z', 'DTSTART:20260101T060000Z')
    .replace('DTEND:20261201T070000Z', 'DTEND:20260101T070000Z')
  assert.equal(extractIcsEvents(past, NOW).length, 0, '过去的事件要丢')
  const replied = ICS.replace('PRODID:-//test//EN', 'PRODID:-//test//EN\r\nMETHOD:REPLY')
  assert.equal(extractIcsEvents(replied, NOW).length, 0, 'METHOD:REPLY 是回复不是邀请')
})

test('没有 .ics 时把正文交给模型，围栏、缺字段、过去时间都被清洗', async () => {
  const llm = countingLlm('```json\n{"events":['
    + '{"summary":"产品对齐会","start":"2026-12-03T10:00","end":"2026-12-03T11:00","location":"线上"},'
    + '{"summary":"缺时间"},'
    + '{"summary":"过去的会","start":"2026-11-01T10:00","end":"2026-11-01T11:00"},'
    + '{"summary":"","start":"2026-12-05T09:00","end":"2026-12-05T10:00"}'
    + ']}\n```')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '下周安排', date: '2026-11-18T02:00:00Z', text: '12 月 3 日上午 10 点产品对齐会', ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', offset: '+08:00', now: NOW },
  )
  assert.equal(llm.state.calls, 1, '没有 .ics 就该问模型')
  assert.equal(result.llmError, undefined)
  assert.equal(result.schedules.length, 1, '缺时间 / 过去 / 无标题的都要丢')
  const event = result.schedules[0]
  assert.equal(event.summary, '产品对齐会')
  assert.equal(event.start, '2026-12-03T10:00+08:00', '缺偏移要按当前时区补')
  assert.equal(event.source, 'llm')
})

test('模型输出不是 JSON 时给出中文错误，而不是抛异常打断整轮', async () => {
  const llm = countingLlm('抱歉，我看不出这封邮件里有日程。')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '闲聊', date: '2026-11-18T02:00:00Z', text: '随便聊聊', ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 0)
  assert.ok(result.llmError !== undefined && result.llmError !== '', '解析失败要回可展示的错误')
  assert.match(result.llmError, /[\u3400-\u9fff]/, '错误文案给用户看，必须是中文')
})

test('模型流没正常结束（finish 不是 stop）时不采信半截 JSON', async () => {
  const face = {
    stream() {
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: '{"events":[{"summary":"半截' }
        yield { type: 'finish', reason: 'length' }
      })()
    },
  }
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '长邮件', date: '2026-11-18T02:00:00Z', text: '很长的正文', ics: [] },
    { llm: face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 0)
  assert.ok(result.llmError !== undefined)
})

test('模型输出条数超过上限时只取前 5 条（一封邮件不该刷出一屏待办）', () => {
  const events = Array.from({ length: 9 }, (_, index) => ({
    summary: '会议 ' + (index + 1),
    start: '2026-12-0' + ((index % 7) + 1) + 'T10:00',
    end: '2026-12-0' + ((index % 7) + 1) + 'T11:00',
  }))
  const normalized = normalizeLlmEvents({ events }, { offset: '+08:00', now: NOW })
  assert.ok(normalized.schedules.length <= 5, '实际 ' + normalized.schedules.length + ' 条')
})

test('关掉「交给模型」后即使有模型也不调用，只留 .ics', async () => {
  const llm = countingLlm('{"events":[{"summary":"不该出现","start":"2026-12-03T10:00","end":"2026-12-03T11:00"}]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '会议', date: '2026-11-18T02:00:00Z', text: '12 月 3 日 10 点开会', ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: false, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(llm.state.calls, 0)
  assert.equal(result.schedules.length, 0)
})

test('parseLlmJson 容忍围栏与前后废话，offsetOf 跟着夏令时走', () => {
  assert.deepEqual(parseLlmJson('好的：\n```json\n{"events":[]}\n```\n以上。'), { events: [] })
  assert.equal(offsetOf(new Date('2026-07-01T00:00:00Z'), 'Europe/London'), '+01:00')
  assert.equal(offsetOf(new Date('2026-12-01T00:00:00Z'), 'Europe/London'), '+00:00')
  assert.equal(offsetOf(new Date('2026-12-01T00:00:00Z'), 'Asia/Shanghai'), '+08:00')
})

test('模型写「空格分隔 / 中文日期 / 整段区间」的时间也能识别（线上真邮件踩过的坑）', () => {
  const events = [
    { summary: '空格分隔', start: '2026-11-20 10:00', end: '2026-11-20 11:00' },
    { summary: '中文日期', start: '2026年11月21日 09:00', end: '2026年11月21日 10:00' },
    { summary: '区间塞进 start', start: '2026-11-22 14:00-15:30', end: '' },
    { summary: '结束只给时间', start: '2026-11-23T08:00', end: '09:00' },
    { summary: '跨零点区间', start: '2026-11-24 22:00-01:00', end: '' },
  ]
  const normalized = normalizeLlmEvents({ events }, { offset: '+08:00', now: NOW })
  assert.equal(normalized.schedules.length, 5, '五种写法都不该被丢')
  const byName = Object.fromEntries(normalized.schedules.map(item => [item.summary, item]))
  assert.equal(byName['空格分隔'].start, '2026-11-20T10:00+08:00')
  assert.equal(byName['中文日期'].start, '2026-11-21T09:00+08:00')
  assert.equal(byName['区间塞进 start'].end, '2026-11-22T15:30+08:00')
  assert.equal(byName['结束只给时间'].end, '2026-11-23T09:00+08:00')
  assert.equal(byName['跨零点区间'].end, '2026-11-25T01:00+08:00')
  assert.equal(byName['跨零点区间'].allDay, false)
})

test('线上那封会议邀请（正文写「会议时间：2026-11-20 10:00-11:00」）能被识别', async () => {
  const body = [
    '大家好，请大家明天按照下面的链接参加线上会议',
    '陈岩：邀请您参加在线会议',
    '会议主题：征信变量管理系统项目详设评审',
    '会议时间：2026-11-20 10:00-11:00',
    '入会连接：https://omr.bj.bob/meeting/?meeting=910115476140',
    '会议号：910115476140',
  ].join('\n')
  const reply = JSON.stringify({
    events: [{
      summary: '征信变量管理系统项目详设评审',
      start: '2026-11-20 10:00',
      end: '2026-11-20 11:00',
      allDay: false,
      location: '线上',
      description: '会议号 910115476140',
      confidence: 0.9,
    }],
  })
  const result = await extractSchedules(
    { from: 'chenyan3@bankofbeijing.com.cn', subject: '会议邀请', date: '2026-11-19T09:33:15Z', text: body, ics: [] },
    { llm: countingLlm(reply).face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: Date.parse('2026-11-19T09:40:00Z') },
  )
  assert.equal(result.llmError, undefined)
  assert.equal(result.schedules.length, 1)
  assert.equal(result.schedules[0].start, '2026-11-20T10:00+08:00')
  assert.equal(result.schedules[0].end, '2026-11-20T11:00+08:00')
})

const REAL_INVITE = [
  '大家好，请大家明天按照下面的链接参加线上会议',
  '陈岩：邀请您参加在线会议',
  '会议主题：征信变量管理系统项目详设评审',
  '会议时间：2026-11-20 10:00-11:00',
  '入会连接： https://omr.bj.bob/meeting/?meeting=910115476140^5b6B5L+h5Y+Y6YeP',
  '会议号：910115476140',
].join('\n')

test('模型答「没有日程」时，正文信息栏里的会议时间仍然能落成候选', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'chenyan3@bankofbeijing.com.cn', subject: '会议邀请', date: '2026-11-19T09:33:15Z', text: REAL_INVITE, ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 1)
  assert.equal(result.schedules[0].summary, '征信变量管理系统项目详设评审')
  assert.equal(result.schedules[0].start, '2026-11-20T10:00+08:00')
  assert.equal(result.schedules[0].end, '2026-11-20T11:00+08:00')
  assert.equal(result.schedules[0].location, '线上')
  assert.equal(result.llmError, undefined, '兜底成功就不该再报失败')
})

test('模型答歪时也先用信息栏兜底，而不是直接标记失败', async () => {
  const llm = countingLlm('抱歉，我判断不了')
  const result = await extractSchedules(
    { from: 'x@y.z', subject: '会议邀请', date: '2026-11-19T09:33:15Z', text: REAL_INVITE, ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 1)
  assert.equal(result.schedules[0].start, '2026-11-20T10:00+08:00')
  assert.equal(result.llmError, undefined)
})

test('没有会议时间信息栏的普通邮件不会被兜底误判成日程', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'shop@example.com', subject: '双十一活动通知', date: '2026-11-19T01:00:00Z', text: '全场五折，活动时间有限，赶紧下单吧。客服时间 9:00-18:00。', ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 0, '没有「会议时间」这类标签不能瞎猜')
})

test('备注按日程元素写：入会链接、会议号都要带上，且链接尾部的编码会截掉', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '会议邀请', date: '2026-11-19T09:33:15Z', text: REAL_INVITE, ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  const notes = result.schedules[0].description
  assert.match(notes, /线上会议/)
  assert.match(notes, /入会链接：https:\/\/omr\.bj\.bob\/meeting\/\?meeting=910115476140$/m)
  assert.equal(notes.includes('^5b6B'), false, '链接尾部的编码串不该留在备注里')
  assert.match(notes, /会议号：910115476140/)
})

test('模型漏掉链接时，从正文把链接补进备注', async () => {
  const llm = countingLlm('{"events":[{"summary":"征信变量管理系统项目详设评审","start":"2026-11-20 10:00","end":"2026-11-20 11:00","location":"线上"}]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '会议邀请', date: '2026-11-19T09:33:15Z', text: REAL_INVITE, ics: [] },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.match(result.schedules[0].description, /https:\/\/omr\.bj\.bob\/meeting\//)
  assert.match(result.schedules[0].description, /会议号：910115476140/)
})

test('口语邀约：模型答空时也能从「明天下午5点，请到C992会议室」里读出一条', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '会议邀请', date: '2026-11-19T14:30:02Z', ics: [], text: '你好陈岩。明天下午5点，请到C992会议室，我们一起商量新公司职位问题。' },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 1)
  const item = result.schedules[0]
  assert.equal(item.summary, '商量新公司职位问题')
  assert.equal(item.start, '2026-11-20T17:00:00+08:00')
  assert.equal(item.end, '2026-11-20T18:00:00+08:00')
  assert.equal(item.location, 'C992会议室')
})

test('口语邀约：营销文案不会被当成日程', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '促销', date: '2026-11-19T14:30:02Z', ics: [], text: '明天下午3点直播间有优惠，客服时间9:00-18:00。' },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 0)
})

test('口语邀约：本周已经过去的那天不猜成下周', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '约', date: '2026-11-19T14:30:02Z', ics: [], text: '本周一上午10点，请到A301会议室，我们讨论预算。' },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 0)
})

test('口语邀约：写死「11月21日下午5点」也要认', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '会议邀请3', date: '2026-11-19T15:03:04Z', ics: [], text: '你好陈岩。11月21日下午5点，请到C992会议室，我们一起商量新公司职位问题。' },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 1)
  assert.equal(result.schedules[0].start, '2026-11-21T17:00:00+08:00')
  assert.equal(result.schedules[0].location, 'C992会议室')
})

test('口语邀约：写 ISO 日期（2026-11-21）也认', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '约', date: '2026-11-19T15:03:04Z', ics: [], text: '2026-11-21 17:00，请到C992会议室，我们一起商量新公司职位问题。' },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: NOW },
  )
  assert.equal(result.schedules.length, 1)
  assert.equal(result.schedules[0].start, '2026-11-21T17:00:00+08:00')
})

test('口语邀约：年底写「1月3日」说的是明年，不落到今年', async () => {
  const llm = countingLlm('{"events":[]}')
  const result = await extractSchedules(
    { from: 'a@b.c', subject: '约', date: '2026-12-28T02:00:00Z', ics: [], text: '1月3日上午10点，请到A301会议室，我们讨论预算。' },
    { llm: llm.face, route: ROUTE, useLlm: true, timeZone: 'Asia/Shanghai', now: Date.parse('2026-12-28T02:05:00Z') },
  )
  assert.equal(result.schedules.length, 1)
  assert.equal(result.schedules[0].start.slice(0, 10), '2027-01-03')
})
