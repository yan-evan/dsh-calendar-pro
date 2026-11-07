/**
 * CalDAV 访问层：用 tsdav 客户端对单个日历集合做 查询/新建/更新/删除。
 * 直接用集合 URL 操作（createDAVClient 不带 defaultAccountType，跳过服务发现）。
 *
 * @module dsh-calendar-pro/caldav
 */
import { type AvailabilityInput, type AvailabilityResult } from './availability.js';
import type { ResolvedConfig } from './config.js';
import { type CalendarEvent, type EventFields } from './ical.js';
/**
 * 全量抓取对象的取数策略（独立出来便于测试）。
 *
 * tsdav 默认路径是「query 拿 href → multiget 取数据」，multiget 之后会校验
 * 「每个 href 都拿到了数据」，少一条就抛 `incomplete response`（iCloud / Google 实测会这样）。
 * 所以先试一次 calendar-query 直接带 calendar-data（useMultiGet:false）：
 *   · 拿到数据 → 直接用，一次请求搞定；
 *   · 抛错或一条数据都没有 → 退回默认多取。
 * 两条都失败才算真失败（异常向上抛）。
 */
export interface RawCalendarObject {
    url: string;
    etag?: string;
    data?: string;
}
type QueryClient = {
    calendarQuery: (params: Record<string, unknown>) => Promise<any[]>;
    calendarMultiGet: (params: Record<string, unknown>) => Promise<any[]>;
};
/**
 * 全量收集日程原文，**不经过 tsdav 的 fetchCalendarObjects**。
 *
 * 理由：`fetchCalendarObjects` 无论走哪条分支，最后都会执行
 * `assertDAVObjectResponses(...)`，只要服务器少给一个 href 的 calendar-data 就抛
 * `incomplete response`，整个导出/导入全挂（iCloud、Google 实测会这样）。
 * 这里直接发 calendar-query 并自己解析响应：缺数据的条目跳过，不影响其余。
 * 若服务器完全不在 query 里返回 calendar-data，再按 20 条一批做 multiget，
 * 某批失败就逐条重试并跳过仍失败的条目（不再让一条坏数据毁掉整批）。
 */
export declare function collectCalendarObjects(client: QueryClient, calendarUrl: string, signal?: AbortSignal): Promise<RawCalendarObject[]>;
export declare function fetchObjectsPreferringQuery<T extends {
    data?: unknown;
}>(fetchObjects: (useMultiGet: boolean) => Promise<T[]>, signal?: AbortSignal): Promise<T[]>;
/** CalDAV 操作错误：带中文指引。 */
export declare class CalDAVError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number);
}
/** 对单个日历集合的封装。 */
export declare class CalendarService {
    private readonly config;
    /** 数据源标识；与本地后端共用 CalendarBackend 接口时用于区分（见 backend.ts）。 */
    readonly kind: "caldav";
    private readonly collectionUrl;
    private clientPromise?;
    constructor(config: ResolvedConfig);
    private client;
    private calendar;
    /**
     * 读一批对象：正常走 tsdav；遇到「响应不完整」时退化到自解析的 calendar-query，
     * 不让一条坏数据毁掉整批。退化路径拿到的是全量对象，带窗口时在本地按重叠过滤。
     */
    private readObjects;
    /** 列出某时间段内的事件；expand 为 true 时在窗口内展开 RRULE。 */
    list(startIso: string, endIso: string, options?: {
        expand?: boolean;
        maxOccurrences?: number;
    }, signal?: AbortSignal): Promise<CalendarEvent[]>;
    /** 列出全部（或 timeRange 窗口内）事件，供客户端过滤用。 */
    all(signal?: AbortSignal, timeRange?: {
        start: string;
        end: string;
    }): Promise<CalendarEvent[]>;
    private toEvents;
    /** A complete read of the connected collection; never writes or reserves events. */
    availability(input: AvailabilityInput, signal?: AbortSignal): Promise<AvailabilityResult>;
    /** 列出并展开：每个对象经 expandEventFromICal 展开为若干实例行。 */
    private toExpandedEvents;
    /** 按 uid（href）找到服务器对象（含 etag 与原始 data）。 */
    private findObject;
    /** 新建事件，返回带 href/uid 的事件。 */
    create(fields: EventFields, signal?: AbortSignal): Promise<CalendarEvent>;
    /** 解析 PUT 响应的 Location；取不到时回读一次确认，避免把本地猜测的 href 当成 uid。 */
    private resolveCreatedHref;
    /** Complete UID inventory before import, including recurrence overrides outside the visible date window. */
    importSnapshot(signal?: AbortSignal): Promise<{
        uids: Set<string>;
        events: CalendarEvent[];
    }>;
    /** Insert one already reviewed UID resource; tsdav uses If-None-Match:* and never overwrites existing objects. */
    importRaw(uid: string, data: string, signal?: AbortSignal): Promise<void>;
    /**
     * 全量抓取对象（数据 + etag）。
     *
     * 默认路径是「先 query 拿 href，再 multiget 取数据」；部分服务器（iCloud / Google）
     * 的 multiget 会漏掉某些 href，tsdav 校验后直接抛 `incomplete response` —— 导出就挂在这。
     * 所以先试「一次 calendar-query 直接要 calendar-data」（useMultiGet:false），
     * 一条数据都没拿到再退回默认多取。两条路都失败才算真失败。
     */
    private fetchAllObjects;
    /**
     * 全部资源的原文（导出用）。
     * 一次 fetchCalendarObjects 就把 data 全带回来了，不需要再逐条 raw —— 那会变成 N+1 请求。
     */
    rawAll(signal?: AbortSignal): Promise<string[]>;
    /** 原始 iCalendar 文本（迁移用）：直接返回服务器对象内容，不经过解析再拼装。 */
    raw(uid: string, signal?: AbortSignal): Promise<string>;
    /** Read the resource master rather than a projected occurrence. */
    get(uid: string, signal?: AbortSignal): Promise<CalendarEvent>;
    /** 按 uid 更新事件；未提供的字段保留原值。 */
    update(uid: string, changes: Partial<EventFields>, signal?: AbortSignal, scope?: 'series'): Promise<CalendarEvent>;
    /** 按 uid 删除事件。 */
    delete(uid: string, signal?: AbortSignal, scope?: 'series'): Promise<{
        uid: string;
        href: string;
    }>;
}
export {};
