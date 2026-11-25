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
import { type AvailabilityInput, type AvailabilityResult } from './availability.js';
import type { CalendarBackend, CalendarListOptions } from './backend.js';
import type { CalendarEvent, EventFields } from './ical.js';
/** 参与聚合的一本日历。 */
export interface CalendarSlice {
    /** 规范化集合 URL，也是 calendarId 的规范形态。 */
    id: string;
    name: string;
    backend: CalendarBackend;
}
/** 某本日历读取失败时的降级信息：明确上报，不静默丢数据。 */
export interface CalendarDegrade {
    calendar: string;
    id: string;
    message: string;
}
/** 面板与工具展示用的日历摘要。 */
export interface CalendarBrief {
    id: string;
    name: string;
}
/** uid 是否落在某本日历的集合路径下（href 自带集合，这是写路由的唯一依据）。 */
export declare function hrefInSlice(href: string, id: string): boolean;
export declare class AggregateBackend implements CalendarBackend {
    private readonly slices;
    readonly kind: "caldav";
    constructor(slices: CalendarSlice[]);
    /** 全部已连接日历的摘要；工具与面板用它列出可选日历。 */
    briefs(): CalendarBrief[];
    /** 参与聚合的各本日历；归档到本地时按本分组、逐本读取。 */
    sliceList(): CalendarSlice[];
    /** 只在连接多本时才标来源日历，单本输出与旧版本保持一致。 */
    private decorate;
    /** calendarId → 目标日历；接受集合 URL 或唯一的展示名，留空表示全部。 */
    private select;
    list(startIso: string, endIso: string, options?: CalendarListOptions, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent[]>;
    /** 全量读取（搜索用）：任一日历读失败直接抛错，避免「搜不到」被当成「没有」。 */
    all(signal?: AbortSignal, timeRange?: {
        start: string;
        end: string;
    }, calendarId?: string): Promise<CalendarEvent[]>;
    /** 各本日历的占用实例并集；任何一本读不全就整体失败，绝不给出「部分空闲」。 */
    busy(input: AvailabilityInput, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent[]>;
    availability(input: AvailabilityInput, signal?: AbortSignal, calendarId?: string): Promise<AvailabilityResult>;
    /** 新建：留空 calendarId 时写第一本（默认日历），显式指定则写那一本。 */
    create(fields: EventFields, signal?: AbortSignal, calendarId?: string): Promise<CalendarEvent>;
    get(uid: string, signal?: AbortSignal): Promise<CalendarEvent>;
    update(uid: string, changes: Partial<EventFields>, signal?: AbortSignal, scope?: 'series', calendarId?: string): Promise<CalendarEvent>;
    delete(uid: string, signal?: AbortSignal, scope?: 'series', calendarId?: string): Promise<{
        uid: string;
        href: string;
    }>;
    /** 导入写在默认日历：预览与去重只看那一本，避免「预览在 A、写入在 B」。 */
    importSnapshot(signal?: AbortSignal): Promise<{
        uids: Set<string>;
        events: CalendarEvent[];
    }>;
    importRaw(uid: string, data: string, signal?: AbortSignal, source?: {
        id: string;
        name: string;
    }): Promise<void>;
    raw(uid: string, signal?: AbortSignal): Promise<string>;
    /** 导出：把所有已连接日历的原文一起取回，调用方拼成一个 .ics。 */
    rawAll(signal?: AbortSignal): Promise<string[]>;
    private primary;
    /** uid 只应落在一本日历里；落不进任何一本说明 uid 已过期或不是本插件给的。 */
    private owner;
    /** 写操作目标：uid 的归属与显式 calendarId 必须一致，不一致就报错而不是猜。 */
    private writeTarget;
}
