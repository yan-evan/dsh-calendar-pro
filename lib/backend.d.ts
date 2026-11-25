/**
 * 日历后端接口：本地日历与 CalDAV 共用。
 * 业务层（工具、面板路由、导入）只依赖这一面；两者由 config.backend 决定，互斥生效。
 *
 * 连接多本日历（同一账户）时由 AggregateBackend 包装多份 CalendarService：
 * 接口形状保持不变，只多了可选的 calendarId 参数。
 */
import type { AvailabilityInput, AvailabilityResult } from './availability.js';
import { type CalendarDegrade } from './aggregate.js';
import { type BackendKind, type CalendarConfig } from './config.js';
import type { CalendarEvent, EventFields } from './ical.js';
/** 列取选项；onDegraded 只在聚合多本日历时触发。 */
export interface CalendarListOptions {
    expand?: boolean;
    maxOccurrences?: number;
    onTruncated?: (truncated: boolean) => void;
    /** 某本日历读失败（显式指定单一日历时直接抛错，不会走这里）。 */
    onDegraded?: (degraded: CalendarDegrade[]) => void;
}
export interface CalendarBackend {
    readonly kind: BackendKind;
    /** 时间段内的事件；expand 为 true（默认）时在窗口内展开 RRULE。 */
    list(startIso: string, endIso: string, options?: CalendarListOptions, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent[]>;
    /** 全量（或窗口内）事件，不展开重复；供迁移、去重与客户端过滤使用。 */
    all(signal?: AbortSignal, timeRange?: {
        start: string;
        end: string;
    }, calendarId?: string): Promise<CalendarEvent[]>;
    /** 空闲查询所需的占用实例（已展开 RRULE、已处理时区）；聚合层据此求并集。 */
    busy?(input: AvailabilityInput, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent[]>;
    availability(input: AvailabilityInput, signal?: AbortSignal, calendarId?: string): Promise<AvailabilityResult>;
    create(fields: EventFields, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent>;
    get(uid: string, signal?: AbortSignal): Promise<CalendarEvent>;
    update(uid: string, changes: Partial<EventFields>, signal?: AbortSignal, scope?: 'series', calendarId?: string): Promise<CalendarEvent>;
    delete(uid: string, signal?: AbortSignal, scope?: 'series', calendarId?: string): Promise<{
        uid: string;
        href: string;
    }>;
    /** 全量 UID 清单 + 事件（用于导入去重、迁移预检）。 */
    importSnapshot(signal?: AbortSignal): Promise<{
        uids: Set<string>;
        events: CalendarEvent[];
    }>;
    /** 写入一条已审阅的资源（同 UID 的整个系列），已存在时不得覆盖。source 是归档来源日历标签（仅本地留存）。 */
    importRaw(uid: string, data: string, signal?: AbortSignal, source?: {
        id: string;
        name: string;
    }): Promise<void>;
    /** 取某个资源的 iCalendar 原文（迁移要原样搬运，不能走会丢字段的解析再拼装）。 */
    raw(uid: string, signal?: AbortSignal): Promise<string>;
    /** 一次取出全部资源原文供导出使用；多日历时是所有日历的并集。 */
    rawAll(signal?: AbortSignal): Promise<string[]>;
}
/**
 * 按配置构造后端。
 * backend 未设置时返回本地后端：读操作返回空数组，写操作在首次新建时创建数据文件。
 * backend 为 caldav 但账号不全时，resolveCalendarTargets 抛中文指引错误，不静默回退。
 */
export declare function createBackend(config: CalendarConfig | undefined, env?: NodeJS.ProcessEnv): CalendarBackend;
/**
 * 显式构造远程后端；未配置会抛带指引的中文错误（迁移前必须先连上）。
 * 连接多本时返回聚合后端：读跨日历，写按 uid 路由到所属日历、缺省写第一本。
 */
export declare function createCaldavBackend(config: CalendarConfig | undefined, env?: NodeJS.ProcessEnv): CalendarBackend;
/**
 * 只针对默认（第一本）日历的后端：导入、迁移、导出 ICS 的写入端用它。
 * 多日历的目标选择留到后续版本，这里保持「一个明确的集合」这一旧语义。
 */
export declare function createPrimaryCaldavBackend(config: CalendarConfig | undefined, env?: NodeJS.ProcessEnv): CalendarBackend;
/** 显式构造本地后端；迁移的目标/来源都可能用它，与当前生效的 backend 无关。 */
export declare function createLocalBackend(env?: NodeJS.ProcessEnv): CalendarBackend;
