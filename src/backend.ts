/**
 * 日历后端：本地日历与远程 CalDAV 共用的一面。
 *
 * 业务层（工具、面板路由、导入）只依赖这个接口，不关心数据存在哪；
 * 两者互斥，由 config.backend 决定，任何时刻只有一个生效。
 */
import type { AvailabilityInput, AvailabilityResult } from './availability.js'
import { CalendarService } from './caldav.js'
import { resolveBackendKind, resolveConfig, type BackendKind, type CalendarConfig } from './config.js'
import type { CalendarEvent, EventFields } from './ical.js'
import { LocalBackend } from './local-backend.js'

export interface CalendarBackend {
  readonly kind: BackendKind
  /** 时间段内的事件；expand 为 true（默认）时在窗口内展开 RRULE。 */
  list(
    startIso: string,
    endIso: string,
    options?: { expand?: boolean; maxOccurrences?: number; onTruncated?: (truncated: boolean) => void },
    signal?: AbortSignal,
  ): Promise<CalendarEvent[]>
  /** 全量（或窗口内）事件，不展开重复；供迁移、去重与客户端过滤使用。 */
  all(signal?: AbortSignal, timeRange?: { start: string; end: string }): Promise<CalendarEvent[]>
  availability(input: AvailabilityInput, signal?: AbortSignal): Promise<AvailabilityResult>
  create(fields: EventFields, signal?: AbortSignal): Promise<CalendarEvent>
  get(uid: string, signal?: AbortSignal): Promise<CalendarEvent>
  update(uid: string, changes: Partial<EventFields>, signal?: AbortSignal, scope?: 'series'): Promise<CalendarEvent>
  delete(uid: string, signal?: AbortSignal, scope?: 'series'): Promise<{ uid: string; href: string }>
  /** 全量 UID 清单 + 事件（用于导入去重、迁移预检）。 */
  importSnapshot(signal?: AbortSignal): Promise<{ uids: Set<string>; events: CalendarEvent[] }>
  /** 写入一条已审阅的资源（同 UID 的整个系列），已存在时不得覆盖。 */
  importRaw(uid: string, data: string, signal?: AbortSignal): Promise<void>
  /** 取某个资源的 iCalendar 原文（迁移要原样搬运，不能走会丢字段的解析再拼装）。 */
  raw(uid: string, signal?: AbortSignal): Promise<string>
  /**
   * 一次取出全部资源的原文，供导出使用。
   * 不写成「先 snapshot 再逐条 raw」：那对 CalDAV 是 N+1 次请求，事件一多必然超时。
   */
  rawAll(signal?: AbortSignal): Promise<string[]>
}

/**
 * 按配置构造后端。
 *
 * `backend` 未设置（首启、用户还没选）时返回本地后端：此时本地日历是空的，
 * 读操作返回空集、写操作会在用户第一次新建日程时惰性创建数据文件。
 * 选中的是 caldav 却没配好账号，由 resolveConfig 抛出带指引的中文错误 —— 不静默回退。
 */
export function createBackend(config: CalendarConfig | undefined, env: NodeJS.ProcessEnv = process.env): CalendarBackend {
  if (resolveBackendKind(config) === 'caldav') return createCaldavBackend(config, env)
  return createLocalBackend()
}

/** 显式构造远程后端；未配置会抛带指引的中文错误（迁移前必须先连上）。 */
export function createCaldavBackend(config: CalendarConfig | undefined, env: NodeJS.ProcessEnv = process.env): CalendarBackend {
  return new CalendarService(resolveConfig(config, env))
}

/** 显式构造本地后端；迁移的目标/来源都可能用它，与当前生效的 backend 无关。 */
export function createLocalBackend(): CalendarBackend {
  return new LocalBackend()
}
