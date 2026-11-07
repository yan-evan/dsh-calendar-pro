/**
 * 校验 templates/data/holidays.json：格式、日期合法性、区间重叠、调休冲突、公告来源覆盖。
 * 官方公告是人工录入的，这个脚本负责把「手滑写错一天」挡在 build 之前。
 * 运行：npm run holidays:check
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'templates/data/holidays.json')
if (!existsSync(file)) throw new Error('缺少 templates/data/holidays.json')
const data = JSON.parse(readFileSync(file, 'utf8'))
const errors = []
const DATE = /^\d{4}-\d{2}-\d{2}$/

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const parsed = new Date(y, m - 1, d)
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
}
function spanDays(start, end) {
  const [y1, m1, d1] = start.split('-').map(Number)
  const [y2, m2, d2] = end.split('-').map(Number)
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1
}

if (data.schema !== 1) errors.push('schema 必须是 1')
if (!validDate(data.updatedAt)) errors.push('updatedAt 不是合法日期')
if (!data.years || Object.keys(data.years).length === 0) errors.push('years 为空')
if (!Array.isArray(data.sources)) errors.push('sources 必须是数组')
if (!Array.isArray(data.pendingYears)) errors.push('pendingYears 必须是数组')

const sourceYears = new Set((data.sources || []).map((item) => String(item.year)))
for (const [year, block] of Object.entries(data.years || {})) {
  if (!/^\d{4}$/.test(year)) errors.push(`${year}: 年份键格式不对`)
  if (!sourceYears.has(year)) errors.push(`${year}: 有数据但没有对应的公告来源（sources）`)
  if ((data.pendingYears || []).map(String).includes(year)) errors.push(`${year}: 同时出现在 years 与 pendingYears`)
  const holidays = block.holidays || []
  const workdays = block.workdays || []
  if (holidays.length === 0) errors.push(`${year}: 没有放假区间`)
  for (const item of holidays) {
    if (!item.name || !validDate(item.start) || !validDate(item.end)) {
      errors.push(`${year}: 放假区间字段不合法 ${JSON.stringify(item)}`)
      continue
    }
    if (item.start > item.end) errors.push(`${year}: ${item.name} 的 start 晚于 end`)
    if (!item.start.startsWith(year) || !item.end.startsWith(year)) {
      errors.push(`${year}: ${item.name} 跨年了，请拆成两段分别放在对应年份`)
    }
  }
  const sorted = holidays.filter((h) => validDate(h.start) && validDate(h.end)).slice().sort((a, b) => a.start.localeCompare(b.start))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i - 1].end) errors.push(`${year}: ${sorted[i - 1].name} 与 ${sorted[i].name} 区间重叠`)
  }
  const seenWork = new Set()
  for (const item of workdays) {
    if (!item.name || !validDate(item.date)) {
      errors.push(`${year}: 调休上班字段不合法 ${JSON.stringify(item)}`)
      continue
    }
    if (!item.date.startsWith(year)) errors.push(`${year}: 调休日 ${item.date} 不属于该年`)
    if (seenWork.has(item.date)) errors.push(`${year}: 调休日 ${item.date} 重复`)
    seenWork.add(item.date)
    const clash = sorted.find((h) => item.date >= h.start && item.date <= h.end)
    if (clash) errors.push(`${year}: 调休日 ${item.date} 落在 ${clash.name} 放假区间内`)
  }
  const offDays = sorted.reduce((sum, h) => sum + spanDays(h.start, h.end), 0)
  console.log(`${year}: ${holidays.length} 个假期 / ${offDays} 天放假 / ${workdays.length} 天调休上班`)
}
for (const item of data.sources || []) {
  if (!item.title || !validDate(item.publishedAt) || typeof item.url !== 'string' || !/^https:\/\//.test(item.url)) {
    errors.push(`公告来源字段不合法 ${JSON.stringify(item)}`)
  }
}
const anchors = data.lunarAnchors || {}
for (const [year, value] of Object.entries(anchors)) {
  if (!/^\d{4}$/.test(year) || !validDate(value) || !value.startsWith(year)) {
    errors.push(`农历锚点 ${year}: ${value} 不合法`)
    continue
  }
  const [, month] = value.split('-').map(Number)
  if (month > 2) errors.push(`农历锚点 ${year}: 正月初一应落在 1–2 月`)
}
for (const year of Object.keys(data.years || {})) {
  if (!anchors[year]) errors.push(`${year}: 有放假数据但缺正月初一锚点（ICU 偏差无法修正）`)
}
console.log(`已收录年份: ${Object.keys(data.years || {}).join(', ')}`)
console.log(`待公告年份: ${(data.pendingYears || []).join(', ') || '无'}`)
console.log(`农历锚点年份: ${Object.keys(anchors).join(', ') || '无'}`)
if (errors.length > 0) {
  console.error('\n校验失败:')
  for (const error of errors) console.error(' - ' + error)
  process.exit(1)
}
console.log('校验通过')
