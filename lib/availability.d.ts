import type { CalendarEvent } from './ical.js';
export interface AvailabilityInput {
    start: string;
    end: string;
    timeZone: string;
    durationMinutes?: number;
    workStart?: string;
    workEnd?: string;
    weekdays?: number[];
    bufferMinutes?: number;
    stepMinutes?: number;
    limit?: number;
}
export interface AvailabilityResult {
    start: string;
    end: string;
    timeZone: string;
    durationMinutes: number;
    workStart: string;
    workEnd: string;
    weekdays: number[];
    bufferMinutes: number;
    stepMinutes: number;
    checkedAt: string;
    busyEventCount: number;
    count: number;
    hasMore: boolean;
    slots: Array<{
        start: string;
        end: string;
    }>;
    scope: 'connected-calendar';
    complete: boolean;
}
export declare function availabilityRequest(input: AvailabilityInput): {
    startMs: number;
    endMs: number;
    formatter: Intl.DateTimeFormat;
    timeZone: string;
    durationMinutes: number;
    workStart: {
        text: string;
        minute: number;
    };
    workEnd: {
        text: string;
        minute: number;
    };
    weekdays: number[];
    bufferMinutes: number;
    stepMinutes: number;
    limit: number;
};
/**
 * 只用完整展开的事件集合计算空闲；日程标题不进入计算结果。
 * @param complete - 事件集合是否完整；false 表示集合被截断，结果只反映已知的部分。
 */
export declare function findAvailableTimes(events: CalendarEvent[], input: AvailabilityInput, complete?: boolean): AvailabilityResult;
