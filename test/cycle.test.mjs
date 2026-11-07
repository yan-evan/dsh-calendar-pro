/**
 * 经期预测与本机存储：vm 直接加载 templates/panels/cycle.js（纯函数，无 React / DOM 依赖）。
 * 重点是「脏数据不乱画、历史能回看、预测按固定周期、数据不出本机」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../templates/panels/cycle.js', import.meta.url), 'utf8')
function makeApi(seed) {
  const map = new Map(seed ? Object.entries(seed) : [])
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
  const context = vm.createContext({ localStorage: storage, Date, Number, Math, JSON, Set, console })
  vm.runInContext(source + '\nglobalThis.__api = { normalizeCycle, loadCycleConfig, getCycleConfig, setCycleConfig, clearCycleConfig, subscribeCycle, cycleInfoOf, daysBetweenKeys, CYCLE_STORAGE_KEY };', context)
  return { api: context.__api, map, storage }
}
const config = (overrides = {}) => Object.assign({ lastStart: '2026-11-01', cycleLength: 28, periodLength: 5 }, overrides)

test('参数校验：脏数据回退默认值，超出范围被夹住，没有开始日期就等于没有记录', () => {
  const { api } = makeApi()
  assert.equal(api.normalizeCycle(null).lastStart, '')
  assert.equal(api.normalizeCycle({ lastStart: '2026-02-30' }).lastStart, '', '不存在的日期不算')
  assert.equal(api.normalizeCycle({ lastStart: '2026-11-01' }).cycleLength, 28)
  assert.equal(api.normalizeCycle({ lastStart: '2026-11-01', cycleLength: 999 }).cycleLength, 60)
  assert.equal(api.normalizeCycle({ lastStart: '2026-11-01', cycleLength: 2 }).cycleLength, 15)
  assert.equal(api.normalizeCycle({ lastStart: '2026-11-01', periodLength: 99 }).periodLength, 14)
  assert.equal(api.normalizeCycle({ lastStart: '' }).lastStart, '', '没填开始日期就是空记录')
})

test('空输入回落到默认 28 / 5，不能当成 0 再被夹到下限（15 / 1）', () => {
  const { api } = makeApi()
  // 表单里清空数字输入后拿到的是 ''；Number('') === 0，若直接夹范围就成了「周期 15、经期 1」。
  for (const blank of ['', '   ', null, undefined, 'abc', NaN]) {
    const cfg = api.normalizeCycle({ lastStart: '2026-11-01', cycleLength: blank, periodLength: blank })
    assert.equal(cfg.cycleLength, 28, '空值要回落到默认周期：' + String(blank))
    assert.equal(cfg.periodLength, 5, '空值要回落到默认经期：' + String(blank))
  }
  // 真的填了 0 才算「超出范围」，这时才夹到下限。
  const zero = api.normalizeCycle({ lastStart: '2026-11-01', cycleLength: 0, periodLength: 0 })
  assert.equal(zero.cycleLength, 15)
  assert.equal(zero.periodLength, 1)
  // 正常值原样保留（用户看到 28 / 5，存下来就得是 28 / 5）。
  const normal = api.normalizeCycle({ lastStart: '2026-11-01', cycleLength: 28, periodLength: 5 })
  assert.equal(normal.cycleLength, 28)
  assert.equal(normal.periodLength, 5)
  const strings = api.normalizeCycle({ lastStart: '2026-11-01', cycleLength: '30', periodLength: '6' })
  assert.equal(strings.cycleLength, 30, '表单给的是字符串，要能正确解析')
  assert.equal(strings.periodLength, 6)
})

test('没有启用开关：旧存储里的 enabled 被忽略，只要日期还在就照旧展示', () => {
  const { api } = makeApi()
  // 0.1.0 早期版本把「是否展示」存成 enabled；现在展示与否只看有没有日期。
  const legacy = api.normalizeCycle({ enabled: false, lastStart: '2026-11-01', cycleLength: 30, periodLength: 6 })
  assert.equal(legacy.lastStart, '2026-11-01', '旧记录不能因为 enabled=false 就丢掉')
  assert.equal('enabled' in legacy, false, '规整后的配置里不再有 enabled 字段')
  assert.equal(api.cycleInfoOf(legacy, '2026-11-01').day, 1, '日期在就继续画线')
})

test('预测：经期首末日、周期边界、下一轮、历史回看', () => {
  const { api } = makeApi()
  const cfg = config()
  assert.deepEqual(JSON.parse(JSON.stringify(api.cycleInfoOf(cfg, '2026-11-01'))), { day: 1, index: 0, offset: 0 })
  assert.equal(api.cycleInfoOf(cfg, '2026-11-05').day, 5, '经期第 5 天')
  assert.equal(api.cycleInfoOf(cfg, '2026-11-06'), null, '第 6 天已不在经期')
  assert.equal(api.cycleInfoOf(cfg, '2026-11-28'), null)
  assert.equal(api.cycleInfoOf(cfg, '2026-11-29').day, 1, '下一个周期 11/29 开始')
  assert.equal(api.cycleInfoOf(cfg, '2026-11-29').index, 1)
  assert.equal(api.cycleInfoOf(cfg, '2026-10-04').day, 1, '上一个周期也能回看')
  assert.equal(api.cycleInfoOf(cfg, '2026-10-04').index, -1)
  assert.equal(api.cycleInfoOf(config({ lastStart: '' }), '2026-11-01'), null, '清除记录后不画')
  assert.equal(api.cycleInfoOf(config(), 'bad-date'), null)
})

test('存储：只写本机 localStorage，可读取、可清除、坏 JSON 不崩', () => {
  const key = makeApi().api.CYCLE_STORAGE_KEY
  const seeded = makeApi({ [key]: JSON.stringify(config()) })
  assert.equal(seeded.api.getCycleConfig().lastStart, '2026-11-01')
  const fresh = makeApi()
  fresh.api.setCycleConfig(config({ lastStart: '2026-10-01', cycleLength: 30 }))
  assert.equal(JSON.parse(fresh.map.get(fresh.api.CYCLE_STORAGE_KEY)).cycleLength, 30)
  fresh.api.clearCycleConfig()
  assert.equal(fresh.map.has(fresh.api.CYCLE_STORAGE_KEY), false, '清除要把记录从本机删掉')
  assert.equal(fresh.api.getCycleConfig().lastStart, '')
  const broken = makeApi({ [key]: '{not json' })
  assert.equal(broken.api.getCycleConfig().lastStart, '', '损坏的存储不能让页面崩')
})

test('订阅：设置页保存后，已挂载的日历能立刻拿到新配置', () => {
  const { api } = makeApi()
  const seen = []
  const unsubscribe = api.subscribeCycle((next) => seen.push(next.lastStart))
  api.setCycleConfig(config({ lastStart: '2026-11-01' }))
  api.clearCycleConfig()
  unsubscribe()
  api.setCycleConfig(config({ lastStart: '2026-11-01' }))
  assert.equal(seen.length, 2, '退订后不再收到通知')
  assert.equal(seen[0], '2026-11-01')
  assert.equal(seen[1], '', '清除也会通知，日历那边把线擦掉')
})

test('经期数据不经过插件 API：源码里没有 fetch / importApi / CalDAV 写入', () => {
  const text = readFileSync(new URL('../templates/panels/cycle.js', import.meta.url), 'utf8')
  assert.equal(/fetch\s*\(/.test(text), false)
  assert.equal(/importApi|api\s*\(|caldav|XMLHttpRequest/i.test(text), false)
  assert.match(text, /localStorage/)
})
