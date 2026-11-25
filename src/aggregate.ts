/**
 * 多日历聚合：把同一账户下的若干本日历当作一个数据源。
 *
 * 读：并行拉取后按 iCal UID 合并去重。某本失败时只降级上报（显式指定 calendarId 则直接失败），
 * 不把「读不到」当成「没有日程」。
 * 写：uid 是对象 href，自带集合路径，据此路由到唯一日历；与显式 calendarId 冲突时报错，
 * 绝不静默挑一本。
 *
 * 只连接一本日历时不加 `calendar` 字段，输出与旧版本逐字一致。
 * @module dsh-calendar-pro/aggregate
 */

import { findAvailableTimes, type AvailabilityInput, type AvailabilityResult } from './availability.js'
import type { CalendarBackend, CalendarListOptions } from './backend.js'
import type { CalendarEvent, EventFields } from './ical.js'
import { sortEvents } from './time.js'

/** 参与聚合的一本日历。 */
export interface CalendarSlice {
  /** 规范化集合 URL，也是 calendarId 的规范形态。 */
  id: string
  name: string
  backend: CalendarBackend
}

/** 某本日历读取失败时的降级信息：明确上报，不静默丢数据。 */
export interface CalendarDegrade {
  calendar: string
  id: string
  message: string
}

/** 面板与工具展示用的日历摘要。 */
export interface CalendarBrief {
  id: string
  name: string
}

/**
 * 整批读操作的总预算。
 * 多本日历并行，但必须落在工具 60s 超时之内：超时按失败处理，不返回半份结果。
 */
const AGGREGATE_BUDGET_MS = 45000

function normalizeId(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** uid 是否落在某本日历的集合路径下（href 自带集合，这是写路由的唯一依据）。 */
export function hrefInSlice(href: string, id: string): boolean {
  try {
    const object = new URL(href)
    const collection = new URL(id)
    if (object.origin !== collection.origin) return false
    if (object.username !== '' || object.password !== '' || object.hash !== '') return false
    const base = collection.pathname.endsWith('/') ? collection.pathname : collection.pathname + '/'
    if (!object.pathname.startsWith(base)) return false
    const rest = object.pathname.slice(base.length)
    if (rest === '') return false
    return !rest.split('/').some((segment) => segment === '.' || segment === '..')
  } catch {
    return false
  }
}

/** 去重键：同一场日程出现在两本共享日历时只保留一条；icalUid 缺失时不参与去重。 */
function dedupeKey(event: CalendarEvent): string | undefined {
  if (typeof event.icalUid !== 'string' || event.icalUid === '') return undefined
  return event.icalUid + '|' + event.start + '|' + (event.seriesStart ?? '')
}

interface Budget {
  signal: AbortSignal
  dispose(): void
}

/** 组合外部取消信号与总预算；到点后抛出中文错误，而不是浏览器侧的英文 abort。 */
function budgetOf(signal: AbortSignal | undefined): Budget {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('多日历查询超时：请缩小时间范围，或减少已连接的日历')), AGGREGATE_BUDGET_MS)
  timer.unref?.()
  return {
    signal: signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]),
    dispose: () => clearTimeout(timer),
  }
}

/** 合并各本日历的结果：保持来源顺序，按开始时间稳定排序。 */
function mergeParts(parts: CalendarEvent[][]): CalendarEvent[] {
  const out: CalendarEvent[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    for (const event of part) {
      const key = dedupeKey(event)
      if (key !== undefined) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      out.push(event)
    }
  }
  return sortEvents(out)
}

export class AggregateBackend implements CalendarBackend {
  readonly kind = 'caldav' as const

  constructor(private readonly slices: CalendarSlice[]) {}

  /** 全部已连接日历的摘要；工具与面板用它列出可选日历。 */
  briefs(): CalendarBrief[] {
    return this.slices.map(({ id, name }) => ({ id, name }))
  }

  /** 参与聚合的各本日历；归档到本地时按本分组、逐本读取。 */
  sliceList(): CalendarSlice[] {
    return this.slices
  }

  /** 只在连接多本时才标来源日历，单本输出与旧版本保持一致。 */
  private decorate(slice: CalendarSlice, event: CalendarEvent): CalendarEvent {
    return this.slices.length > 1 ? { ...event, calendar: { id: slice.id, name: slice.name } } : event
  }

  /** calendarId → 目标日历；接受集合 URL 或唯一的展示名，留空表示全部。 */
  private select(calendarId?: string): CalendarSlice[] {
    const text = calendarId?.trim() ?? ''
    if (text === '') return this.slices
    const wanted = normalizeId(text)
    const byUrl = this.slices.find((slice) => normalizeId(slice.id) === wanted)
    if (byUrl !== undefined) return [byUrl]
    const byName = this.slices.filter((slice) => slice.name === text)
    if (byName.length === 1) return [byName[0]!]
    if (byName.length > 1) {
      throw new Error('有多本日历都叫「' + text + '」：请改用日历地址指定，当前可选：' +
        this.briefs().map((brief) => brief.name + '（' + brief.id + '）').join('；'))
    }
    const all = this.slices.map((slice) => slice.name).join('、')
    throw new Error('找不到日历「' + text + '」。当前已连接：' + (all === '' ? '（未连接任何日历）' : all))
  }

  async list(
    startIso: string,
    endIso: string,
    options?: CalendarListOptions,
    signal?: AbortSignal,
    calendarId?: string,
  ): Promise<CalendarEvent[]> {
    const selected = this.select(calendarId)
    const explicit = (calendarId?.trim() ?? '') !== ''
    const budget = budgetOf(signal)
    const degraded: CalendarDegrade[] = []
    try {
      const parts = await Promise.all(selected.map(async (slice) => {
        try {
          const events = await slice.backend.list(startIso, endIso, options, budget.signal)
          return events.map((event) => this.decorate(slice, event))
        } catch (error) {
          budget.signal.throwIfAborted()
          if (explicit) throw error
          degraded.push({ calendar: slice.name, id: slice.id, message: messageOf(error) })
          return []
        }
      }))
      options?.onDegraded?.(degraded)
      return mergeParts(parts)
    } finally {
      budget.dispose()
    }
  }

  /** 全量读取（搜索用）：任一日历读失败直接抛错，避免「搜不到」被当成「没有」。 */
  async all(
    signal?: AbortSignal,
    timeRange?: { start: string; end: string },
    calendarId?: string,
  ): Promise<CalendarEvent[]> {
    const selected = this.select(calendarId)
    const budget = budgetOf(signal)
    try {
      const parts = await Promise.all(selected.map(async (slice) => {
        const events = await slice.backend.all(budget.signal, timeRange)
        return events.map((event) => this.decorate(slice, event))
      }))
      return mergeParts(parts)
    } finally {
      budget.dispose()
    }
  }

  /** 各本日历的占用实例并集；任何一本读不全就整体失败，绝不给出「部分空闲」。 */
  async busy(input: AvailabilityInput, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent[]> {
    const selected = this.select(calendarId)
    const budget = budgetOf(signal)
    try {
      const parts = await Promise.all(selected.map(async (slice) => {
        if (typeof slice.backend.busy !== 'function') {
          throw new Error('当前日历连接不支持完整的空闲查询，请更新插件')
        }
        return slice.backend.busy(input, budget.signal)
      }))
      const events = parts.flat()
      if (events.length > 10000) throw new Error('日程实例超过 10000 条，请缩小空闲查询范围')
      return events
    } finally {
      budget.dispose()
    }
  }

  async availability(input: AvailabilityInput, signal?: AbortSignal, calendarId?: string): Promise<AvailabilityResult> {
    const selected = this.select(calendarId)
    const events = await this.busy(input, signal, calendarId)
    const explicit = (calendarId?.trim() ?? '') !== ''
    // 单本连接保持旧口径（connected-calendar 且不带 calendars），输出与升级前逐字一致。
    const multi = this.slices.length > 1
    return {
      ...findAvailableTimes(events, input),
      scope: !multi ? 'connected-calendar' : (explicit ? 'selected-calendars' : 'all-enabled-calendars'),
      ...(multi ? { calendars: selected.map((slice) => slice.name) } : {}),
    }
  }

  /** 新建：留空 calendarId 时写第一本（默认日历），显式指定则写那一本。 */
  async create(fields: EventFields, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent> {
    const slice = this.select(calendarId)[0]!
    return this.decorate(slice, await slice.backend.create(fields, signal))
  }

  async get(uid: string, signal?: AbortSignal): Promise<CalendarEvent> {
    const owner = this.owner(uid)
    return this.decorate(owner, await owner.backend.get(uid, signal))
  }

  async update(
    uid: string,
    changes: Partial<EventFields>,
    signal?: AbortSignal,
    scope?: 'series',
    calendarId?: string,
  ): Promise<CalendarEvent> {
    const slice = this.writeTarget(uid, calendarId)
    return this.decorate(slice, await slice.backend.update(uid, changes, signal, scope))
  }

  async delete(
    uid: string,
    signal?: AbortSignal,
    scope?: 'series',
    calendarId?: string,
  ): Promise<{ uid: string; href: string }> {
    const slice = this.writeTarget(uid, calendarId)
    return slice.backend.delete(uid, signal, scope)
  }

  /** 导入写在默认日历：预览与去重只看那一本，避免「预览在 A、写入在 B」。 */
  async importSnapshot(signal?: AbortSignal): Promise<{ uids: Set<string>; events: CalendarEvent[] }> {
    return this.primary().backend.importSnapshot(signal)
  }

  async importRaw(uid: string, data: string, signal?: AbortSignal, source?: { id: string; name: string }): Promise<void> {
    return this.primary().backend.importRaw(uid, data, signal, source)
  }

  async raw(uid: string, signal?: AbortSignal): Promise<string> {
    return this.owner(uid).backend.raw(uid, signal)
  }

  /** 导出：把所有已连接日历的原文一起取回，调用方拼成一个 .ics。 */
  async rawAll(signal?: AbortSignal): Promise<string[]> {
    const budget = budgetOf(signal)
    try {
      const parts = await Promise.all(this.slices.map((slice) => slice.backend.rawAll(budget.signal)))
      return parts.flat()
    } finally {
      budget.dispose()
    }
  }

  private primary(): CalendarSlice {
    const first = this.slices[0]
    if (first === undefined) throw new Error('还没有连接任何日历：请先在「连接设置」里选择日历')
    return first
  }

  /** uid 只应落在一本日历里；落不进任何一本说明 uid 已过期或不是本插件给的。 */
  private owner(uid: string): CalendarSlice {
    const matches = this.slices.filter((slice) => hrefInSlice(uid, slice.id))
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) {
      throw new Error('这个 uid 同时属于多本日历，请用 calendarId 指定：' + matches.map((slice) => slice.name).join('、'))
    }
    const all = this.slices.map((slice) => slice.name).join('、')
    throw new Error('uid 不属于任何已连接的日历：请用 calendar_list 或 calendar_search 重新获取' +
      (all === '' ? '' : '（当前已连接：' + all + '）'))
  }

  /** 写操作目标：uid 的归属与显式 calendarId 必须一致，不一致就报错而不是猜。 */
  private writeTarget(uid: string, calendarId?: string): CalendarSlice {
    const owner = this.owner(uid)
    if ((calendarId?.trim() ?? '') === '') return owner
    const selected = this.select(calendarId)[0]!
    if (normalizeId(selected.id) !== normalizeId(owner.id)) {
      throw new Error('该事件属于日历「' + owner.name + '」，与指定的 calendarId 不一致：请去掉 calendarId，或改成「' + owner.name + '」。')
    }
    return owner
  }
}
