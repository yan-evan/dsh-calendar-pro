/**
 * 数据源迁移：把一端的事件原样搬到另一端（本地 ⇄ CalDAV），一次性、手动、幂等。
 *
 * 不做持续同步：双写失败或离线会让两份数据立即不一致。
 * 冲突策略：同 UID 已存在跳过，不改目标端内容；同标题且同起止判为疑似重复，
 * 默认跳过并列出；时间重叠但内容不同照常搬；缺 UID 跳过并计数。
 */
import type { CalendarBackend } from './backend.js'
import type { BackendKind } from './config.js'
import type { CalendarEvent } from './ical.js'

export interface MigrateItem {
  /** 源端的资源标识（拿原文用）。 */
  uid: string
  /** iCal UID：目标端去重的键。 */
  icalUid: string
  summary: string
  start: string
  end: string
}

export interface MigrateDuplicate extends MigrateItem {
  /** 目标端那条「看起来是同一件事」的日程。 */
  existingUid: string
}

export interface MigratePlan {
  from: BackendKind
  to: BackendKind
  /** 源端资源总数。 */
  total: number
  /** 将新建的。 */
  create: MigrateItem[]
  /** 同 UID 已存在、跳过的条数。 */
  exists: number
  /** 疑似重复、默认跳过的。 */
  duplicates: MigrateDuplicate[]
  /** 缺 iCal UID、无法判定、跳过的条数。 */
  invalid: number
}

export interface MigrateResult {
  migrated: number
  failed: Array<{ uid: string; summary: string; message: string }>
}

/** 「看起来是同一件事」的判据：标题（去空白、忽略大小写）+ 起止时间完全一致。 */
export function shapeOf(event: CalendarEvent): string {
  return [event.summary.trim().toLowerCase(), event.start, event.end].join('\u0000')
}

/** 只读预检：不写任何东西，把三类情况数清楚，交给用户决定要不要继续。 */
export async function planMigration(
  from: CalendarBackend,
  to: CalendarBackend,
  signal?: AbortSignal,
): Promise<MigratePlan> {
  const [source, target] = await Promise.all([from.importSnapshot(signal), to.importSnapshot(signal)])
  const existingUids = new Set(target.uids)
  const shapeIndex = new Map<string, string>()
  for (const event of target.events) shapeIndex.set(shapeOf(event), event.uid)

  const plan: MigratePlan = { from: from.kind, to: to.kind, total: source.events.length, create: [], exists: 0, duplicates: [], invalid: 0 }
  for (const event of source.events) {
    signal?.throwIfAborted()
    const icalUid = event.icalUid
    if (icalUid === undefined || icalUid === '') {
      plan.invalid += 1
      continue
    }
    const item: MigrateItem = { uid: event.uid, icalUid, summary: event.summary, start: event.start, end: event.end }
    if (existingUids.has(icalUid)) {
      plan.exists += 1
      continue
    }
    const twin = shapeIndex.get(shapeOf(event))
    if (twin !== undefined) {
      plan.duplicates.push({ ...item, existingUid: twin })
      continue
    }
    plan.create.push(item)
  }
  return plan
}

/**
 * 执行迁移：只搬预检判为将新建的条目，逐条原样搬运（raw() 取原文。
 * 解析再拼装会丢掉 ATTENDEE / EXDATE 这类未建模字段）。
 * @param limit 单次最多搬多少条，超出部分分批执行
 */
export async function runMigration(
  from: CalendarBackend,
  to: CalendarBackend,
  plan: MigratePlan,
  options: { limit?: number } = {},
  signal?: AbortSignal,
): Promise<MigrateResult> {
  const limit = options.limit ?? 200
  const items = plan.create.slice(0, limit)
  const result: MigrateResult = { migrated: 0, failed: [] }
  for (const item of items) {
    signal?.throwIfAborted()
    try {
      const data = await from.raw(item.uid, signal)
      await to.importRaw(item.icalUid, data, signal)
      result.migrated += 1
    } catch (error) {
      result.failed.push({
        uid: item.uid,
        summary: item.summary,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

/** 给面板用的一句话摘要，避免前端各自拼文案拼错。 */
export function describePlan(plan: MigratePlan): string {
  const parts = ['将迁移 ' + plan.create.length + ' 条', '已存在跳过 ' + plan.exists + ' 条']
  if (plan.duplicates.length > 0) parts.push('疑似重复跳过 ' + plan.duplicates.length + ' 条')
  if (plan.invalid > 0) parts.push('缺少 UID 跳过 ' + plan.invalid + ' 条')
  return parts.join('，')
}
