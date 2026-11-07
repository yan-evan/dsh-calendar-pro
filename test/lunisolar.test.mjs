/**
 * 农历与法定节假日：用 vm 直接加载 templates/panels/lunisolar.js（纯函数，不依赖 React/DOM）。
 * 假日数据按国务院办公厅公告逐条核对，见 templates/data/holidays.json 的 sources。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../templates/panels/lunisolar.js', import.meta.url), 'utf8')
const data = JSON.parse(readFileSync(new URL('../templates/data/holidays.json', import.meta.url), 'utf8'))
const context = vm.createContext({ Intl, console })
vm.runInContext(
  'const CALENDAR_HOLIDAYS = ' + JSON.stringify(data) + ';\n' + source +
  '\nglobalThis.__api = { lunarPartsOf, holidayOf, dayDecorOf, lunarLabelOf, holidayBadgeOf, lunarChineseDay, holidayCovered, holidaySources };',
  context
)
const api = context.__api
const date = (y, m, d) => new Date(y, m - 1, d, 12)

test('中文农历日名：初一 / 十一 / 二十 / 廿九 / 三十', () => {
  assert.equal(api.lunarChineseDay(1), '初一')
  assert.equal(api.lunarChineseDay(10), '初十')
  assert.equal(api.lunarChineseDay(11), '十一')
  assert.equal(api.lunarChineseDay(20), '二十')
  assert.equal(api.lunarChineseDay(21), '廿一')
  assert.equal(api.lunarChineseDay(29), '廿九')
  assert.equal(api.lunarChineseDay(30), '三十')
})

test('传统节日优先于农历日名，且落在公告里的农历日期上', () => {
  assert.equal(api.lunarPartsOf(date(2026, 2, 17)).festival, '春节', '2026 正月初一')
  assert.equal(api.lunarPartsOf(date(2026, 2, 17)).text, '春节')
  assert.equal(api.lunarPartsOf(date(2026, 6, 19)).festival, '端午节', '2026 五月初五')
  assert.equal(api.lunarPartsOf(date(2026, 9, 25)).festival, '中秋节', '2026 八月十五')
  assert.equal(api.lunarPartsOf(date(2026, 3, 3)).festival, '元宵节', '2026 正月十五')
})

test('闰月与除夕：不写死腊月三十，用次日是否正月初一判断', () => {
  const leap = api.lunarPartsOf(date(2025, 8, 1))
  assert.equal(leap.monthRaw, '闰六月')
  assert.equal(leap.isLeap, true)
  assert.equal(leap.text, '初八')
  assert.equal(api.lunarPartsOf(date(2025, 1, 28)).festival, '除夕', '2025 除夕，公告里春节从这天开始')
  assert.equal(api.lunarPartsOf(date(2027, 2, 5)).festival, '除夕', '2027 腊月只有廿九天')
})

test('2026 官方放假与调休：放假区间、调休上班、普通工作日', () => {
  // 对象来自 vm realm，不能用 deepEqual 比原型，逐字段断言。
  const newYear = api.holidayOf('2026-01-01')
  assert.equal(newYear.type, 'off')
  assert.equal(newYear.name, '元旦')
  assert.equal(newYear.label, '休')
  assert.equal(api.holidayOf('2026-01-04').type, 'work', '元旦调休上班')
  assert.equal(api.holidayOf('2026-02-15').name, '春节', '春节 2/15 起连休 9 天')
  assert.equal(api.holidayOf('2026-02-23').type, 'off')
  assert.equal(api.holidayOf('2026-02-14').type, 'work')
  assert.equal(api.holidayOf('2026-02-28').type, 'work')
  assert.equal(api.holidayOf('2026-04-05').name, '清明节')
  assert.equal(api.holidayOf('2026-05-09').type, 'work')
  assert.equal(api.holidayOf('2026-09-20').type, 'work')
  assert.equal(api.holidayOf('2026-10-07').type, 'off', '国庆 10/1–10/7')
  assert.equal(api.holidayOf('2026-10-10').type, 'work')
  assert.equal(api.holidayOf('2026-07-01'), null, '普通工作日不显示角标')
})

test('ICU 农历偏差由「正月初一锚点」整段平移修正', () => {
  // 本机 ICU 认为 2027 正月初一是 2/7，公开历法是 2/6；不修正会把除夕标到 2/6。
  assert.equal(api.lunarPartsOf(date(2027, 2, 6)).festival, '春节')
  assert.equal(api.lunarPartsOf(date(2027, 2, 5)).festival, '除夕')
  assert.equal(api.lunarPartsOf(date(2026, 2, 17)).festival, '春节', '2026 无需平移，锚点不应把正确日期改坏')
  const jan15 = api.lunarPartsOf(date(2027, 1, 15))
  const jan16 = api.lunarPartsOf(date(2027, 1, 16))
  assert.equal(jan16.day - jan15.day, 1, '跨农历年边界按最近锚点取偏移，日期不能跳')
  assert.equal(data.lunarAnchors['2027'], '2027-02-06')
})

test('2025 官方放假与调休（回看历史月份仍然准确）', () => {
  assert.equal(api.holidayOf('2025-01-28').name, '春节')
  assert.equal(api.holidayOf('2025-02-08').type, 'work')
  assert.equal(api.holidayOf('2025-10-08').name, '国庆节·中秋节')
  assert.equal(api.holidayOf('2025-10-11').type, 'work')
})

test('公告未发布的年份：返回 null，绝不拿媒体推算冒充官方数据', () => {
  assert.equal(api.holidayOf('2027-01-01'), null)
  assert.equal(api.holidayCovered('2027-01-01'), false)
  assert.equal(api.holidayCovered('2026-01-01'), true)
  assert.deepEqual(data.pendingYears, ['2027'])
})

test('视图层入口：农历 + 角标 + 英文界面隐藏农历', () => {
  const decor = api.dayDecorOf(date(2026, 1, 1))
  assert.equal(decor.key, '2026-01-01')
  assert.equal(api.lunarLabelOf(decor, true).length > 0, true)
  assert.equal(api.lunarLabelOf(decor, false), null, '英文界面不显示农历')
  assert.deepEqual(api.holidayBadgeOf(decor).label, '休')
  assert.equal(api.holidayBadgeOf(api.dayDecorOf(date(2026, 1, 4))).label, '班')
  assert.equal(api.holidayBadgeOf(api.dayDecorOf(date(2027, 1, 1))), null)
})

test('数据自洽：来源覆盖、区间不重叠、调休日不落在放假区间内', () => {
  const sourceYears = data.sources.map((item) => String(item.year)).sort()
  assert.deepEqual(sourceYears, Object.keys(data.years).sort(), '每个年份都要有公告来源')
  assert.equal(data.sources.find((item) => item.year === 2026).url.startsWith('https://www.gov.cn/'), true, '2026 用中国政府网原文')
  for (const [year, block] of Object.entries(data.years)) {
    const sorted = block.holidays.slice().sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < sorted.length; i++) {
      assert.equal(sorted[i].start > sorted[i - 1].end, true, `${year}: ${sorted[i - 1].name} 与 ${sorted[i].name} 不能重叠`)
    }
    for (const item of block.workdays) {
      assert.equal(item.date.startsWith(year), true)
      assert.equal(sorted.some((h) => item.date >= h.start && item.date <= h.end), false, `${year}: 调休日 ${item.date} 不该在假期里`)
    }
    assert.equal(block.holidays.length >= 6, true, `${year}: 一年至少 6 段假期`)
  }
})

test('构建产物注入了节假日数据（不是运行时联网）', () => {
  const built = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(built, /const CALENDAR_HOLIDAYS = \{/)
  assert.match(built, /2026-02-15/)
  assert.match(built, /2025-10-11/)
  assert.match(built, /"schema":1/)
})
