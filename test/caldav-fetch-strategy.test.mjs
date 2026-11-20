/**
 * 全量取数策略：先发一次带 calendar-data 的 query，失败再退回 multiget。
 * 部分服务器的 multiget 会漏对象，tsdav 因此整批抛 incomplete response。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchObjectsPreferringQuery } from '../lib/caldav.js'

test('单次 query 能拿到数据时只用一次请求，不走多取', async () => {
  const calls = []
  const fetchObjects = async (useMultiGet) => {
    calls.push(useMultiGet)
    return useMultiGet ? [{ data: 'multi' }] : [{ data: 'BEGIN:VCALENDAR' }]
  }
  const result = await fetchObjectsPreferringQuery(fetchObjects)
  assert.deepEqual(calls, [false], '拿到数据就不该再走多取')
  assert.equal(String(result[0].data), 'BEGIN:VCALENDAR')
})

test('单次 query 抛错（服务器不支持 calendar-data）时退回多取', async () => {
  const calls = []
  const fetchObjects = async (useMultiGet) => {
    calls.push(useMultiGet)
    if (!useMultiGet) throw new Error('Calendar object fetch failed: incomplete response')
    return [{ data: 'multi-data' }]
  }
  const result = await fetchObjectsPreferringQuery(fetchObjects)
  assert.deepEqual(calls, [false, true], '先试单次，失败才多取')
  assert.equal(String(result[0].data), 'multi-data')
})

test('单次 query 返回空数据（服务器忽略 calendar-data）时也退回多取', async () => {
  const calls = []
  const fetchObjects = async (useMultiGet) => {
    calls.push(useMultiGet)
    return useMultiGet ? [{ data: 'real' }] : [{ data: undefined }, { data: '' }]
  }
  const result = await fetchObjectsPreferringQuery(fetchObjects)
  assert.deepEqual(calls, [false, true])
  assert.equal(String(result[0].data), 'real')
})

test('两条路都失败时向上抛，不吞错误', async () => {
  const fetchObjects = async (useMultiGet) => {
    if (!useMultiGet) throw new Error('first')
    throw new Error('Calendar object fetch failed: incomplete response')
  }
  await assert.rejects(() => fetchObjectsPreferringQuery(fetchObjects), /incomplete response/)
})

test('尊重取消信号', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => fetchObjectsPreferringQuery(async () => [{ data: 'x' }], controller.signal), /abort/i)
})
