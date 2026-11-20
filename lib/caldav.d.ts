/**
 * CalDAV 访问层：用 tsdav 对单个日历集合做查询、新建、更新、删除。
 * 直接用集合 URL 操作，createDAVClient 不带 defaultAccountType，跳过服务发现。
 * @module dsh-calendar-pro/caldav
 */
import { type AvailabilityInput, type AvailabilityResult } from './availability.js';
import type { ResolvedConfig } from './config.js';
import { type CalendarEvent, type EventFields } from './ical.js';
/**
 * 全量取数策略（独立以便测试）。
 * tsdav 默认 query + multiget，响应缺条目时抛 incomplete response（iCloud / Google 实测）。
 * 先试一次带 calendar-data 的 calendar-query：拿到就用，报错或空结果再退回 multiget。
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
 * 全量收集日程原文，绕过 tsdav 的 fetchCalendarObjects。
 * 该方法无论走哪条分支都校验响应完整性，服务器漏一个 href 就整批失败。
 * 这里直接发 calendar-query 自行解析：缺数据的条目跳过；
 * 服务器不在 query 里返回 calendar-data 时，按 20 条一批 multiget，单批失败再逐条重试。
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
     * 读一批对象：正常走 tsdav，遇响应不完整退化到自解析 query，单条坏数据不影响整批。
     * 退化路径拿全量对象，带窗口时本地按重叠过滤。
     */
    private readObjects;
    /** 列出某时间段内的事件；expand 为 true 时在窗口内展开 RRULE。 */
    list(startIso: string, endIso: string, options?: {
        expand?: boolean;
        maxOccurrences?: number;
        onTruncated?: (truncated: boolean) => void;
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
    /** 解析 PUT 响应的 Location；取不到时回读一次，避免用本地文件名当 uid。 */
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
     * 先试 calendar-query 直接取 calendar-data，空结果再退回默认 multiget；两条都失败才算失败。
     */
    private fetchAllObjects;
    /**
     * 全部资源原文，供导出使用。一次取回即可，逐条 raw 会变成 N+1 请求。
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
