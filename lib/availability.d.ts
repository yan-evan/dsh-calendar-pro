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
    /**
     * 结果依据哪些日历：
     * connected-calendar = 只有当前连接的那一本（旧行为的默认值）；
     * all-enabled-calendars = 全部已连接日历的并集；selected-calendars = 本次指定日历的并集。
     */
    scope: 'connected-calendar' | 'all-enabled-calendars' | 'selected-calendars';
    /** 参与计算的日历名（多日历时才有）。 */
    calendars?: string[];
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
 * 只用完整展开的事件集合计算空闲；标题不参与计算。
 * @param complete 事件集合是否完整，false 表示结果只反映已知部分
 */
export declare function findAvailableTimes(events: CalendarEvent[], input: AvailabilityInput, complete?: boolean): AvailabilityResult;
