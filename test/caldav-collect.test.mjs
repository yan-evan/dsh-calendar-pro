/**
 * 直接解析 calendar-query 响应的收集器。
 *
 * 目标是绕开 tsdav 「少一条数据就整批抛 incomplete response」的校验，
 * 并锁住「缺数据的条目跳过、其余照常导出」这个行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectCalendarObjects } from '../lib/caldav.js'

const BASE = 'https://cal.example.test/dav/user/calendar/'
const ics = (uid) => 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:' + uid + '\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
const response = (href, data, cdata = false) => ({
  href,
  props: {
    getetag: '"etag-' + href + '"',
    ...(data === undefined ? {} : { calendarData: cdata ? { _cdata: data } : data }),
  },
})

test('query 直接带 calendar-data 时一次完成，缺数据的条目跳过而不是整批失败', async () => {
  const calls = { query: 0, multi: 0 }
  const client = {
    calendarQuery: async () => {
      calls.query += 1
      return [response('a.ics', ics('a')), response('b.ics', ics('b'), true), response('c.ics', undefined)]
    },
    calendarMultiGet: async () => { calls.multi += 1; return [] },
  }
  const objects = await collectCalendarObjects(client, BASE)
  assert.equal(calls.query, 1)
  assert.equal(calls.multi, 0, 'query 里已经有数据，不该再发 multiget')
  assert.equal(objects.length, 2, '缺 calendarData 的 c.ics 只跳过自己')
  assert.equal(objects[0].url, BASE + 'a.ics')
  assert.equal(objects[0].etag, '"etag-a.ics"')
  assert.match(objects[1].data, /UID:b/, '_cdata 形式也要解析出来')
})

test('服务器忽略 calendar-data 时分块 multiget；整批失败则逐条重试并跳过坏条目', async () => {
  const multiCalls = []
  const client = {
    calendarQuery: async () => [response('a.ics'), response('b.ics'), response('broken.ics')],
    calendarMultiGet: async (params) => {
      multiCalls.push(params.objectUrls.slice())
      if (params.objectUrls.length > 1) throw new Error('Calendar object fetch failed: incomplete response')
      if (params.objectUrls[0].includes('broken')) throw new Error('not found')
      const href = params.objectUrls[0]
      return [response(href, ics(href))]
    },
  }
  const objects = await collectCalendarObjects(client, BASE)
  const flat = multiCalls.flat()
  assert.equal(multiCalls[0].length, 3, '先整批试一次')
  assert.equal(flat.filter((url) => url.includes('a.ics')).length >= 1, true)
  assert.equal(objects.length, 2, '坏条目被跳过，其余两条正常导出')
  assert.equal(objects.some((object) => object.url.includes('broken')), false)
})

test('超过 20 条时分批请求', async () => {
  const urls = Array.from({ length: 45 }, (_, index) => 'e' + index + '.ics')
  const batches = []
  const client = {
    calendarQuery: async () => urls.map((href) => response(href)),
    calendarMultiGet: async (params) => {
      batches.push(params.objectUrls.length)
      return params.objectUrls.map((href) => response(href, ics(href)))
    },
  }
  const objects = await collectCalendarObjects(client, BASE)
  assert.deepEqual(batches, [20, 20, 5])
  assert.equal(objects.length, 45)
})

test('尊重取消信号', async () => {
  const controller = new AbortController()
  controller.abort()
  const client = { calendarQuery: async () => [], calendarMultiGet: async () => [] }
  await assert.rejects(() => collectCalendarObjects(client, BASE, controller.signal), /abort/i)
})


test('查到 href 但一条数据都取不到时报错，不静默导出空文件', async () => {
  const client = {
    calendarQuery: async () => [response('a.ics'), response('b.ics')],
    calendarMultiGet: async () => { throw new Error('Calendar object fetch failed: incomplete response') },
  }
  await assert.rejects(() => collectCalendarObjects(client, BASE), /未返回任何日程内容/)
})
