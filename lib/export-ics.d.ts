/**
 * 把多份 iCalendar 资源合并成一个 .ics（导出用）。
 * 只做文本级合并：取出 VTIMEZONE 与 VEVENT 块去重后塞进同一 VCALENDAR，
 * 不解析重组，避免丢掉 ATTENDEE / EXDATE / X- 扩展属性。
 */
export interface MergedCalendar {
    data: string;
    /** 导出的日程条数（按资源计，不是展开后的实例数）。 */
    count: number;
}
/**
 * @param sources 每元素是一份完整 VCALENDAR 文本（各资源的 raw()）
 * @param stamp 生成时间，DTSTAMP 用，测试可注入
 */
export declare function mergeCalendars(sources: readonly string[], stamp?: string): MergedCalendar;
/** 导出上限：超过就不导，避免一次生成几十 MB 的响应把面板卡死。 */
export declare const EXPORT_LIMITS: {
    maxEvents: number;
    maxBytes: number;
};
export declare function exportFilename(now?: Date): string;
