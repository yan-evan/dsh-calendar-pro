/**
 * 本地日历后端：单个 JSON 文件，存 iCalendar 原文。
 *
 * 存 iCalendar 原文，RRULE 展开、字段覆盖、时区处理复用 ical.ts，导出即拼 .ics，
 * 迁移到 CalDAV 直接 PUT。读改写用同步 fs，单线程下不会交错；落盘走临时文件 + rename。
 */
import { type AvailabilityInput, type AvailabilityResult } from './availability.js';
import { type CalendarEvent, type EventFields } from './ical.js';
export declare class LocalBackend {
    private readonly file;
    readonly kind: "local";
    constructor(file?: string);
    /** 读取并清洗：坏记录（无法解析、ical 不是字符串）直接丢弃，不让一个坏条目拖垮整份文件。 */
    private read;
    private write;
    private require;
    list(startIso: string, endIso: string, options?: {
        expand?: boolean;
        maxOccurrences?: number;
        onTruncated?: (truncated: boolean) => void;
    }, signal?: AbortSignal): Promise<CalendarEvent[]>;
    all(signal?: AbortSignal, timeRange?: {
        start: string;
        end: string;
    }): Promise<CalendarEvent[]>;
    availability(input: AvailabilityInput, signal?: AbortSignal): Promise<AvailabilityResult>;
    create(fields: EventFields, signal?: AbortSignal): Promise<CalendarEvent>;
    /** 全部资源的原文（导出用）；坏记录已在 read() 里剔除。 */
    rawAll(signal?: AbortSignal): Promise<string[]>;
    /** 原始 iCalendar 文本：迁移原样搬运，保留 ATTENDEE / EXDATE 等未建模字段。 */
    raw(uid: string, signal?: AbortSignal): Promise<string>;
    get(uid: string, signal?: AbortSignal): Promise<CalendarEvent>;
    update(uid: string, changes: Partial<EventFields>, signal?: AbortSignal, scope?: 'series'): Promise<CalendarEvent>;
    delete(uid: string, signal?: AbortSignal, scope?: 'series'): Promise<{
        uid: string;
        href: string;
    }>;
    importSnapshot(signal?: AbortSignal): Promise<{
        uids: Set<string>;
        events: CalendarEvent[];
    }>;
    importRaw(uid: string, data: string, signal?: AbortSignal): Promise<void>;
}
