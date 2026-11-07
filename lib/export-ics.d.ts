/**
 * 把多份 iCalendar 资源合并成一个 .ics 文件（导出用）。
 *
 * 为什么不是「解析成事件再重新拼」：那样会丢掉 ATTENDEE / EXDATE / X- 扩展属性，
 * 导出就成了有损转换。这里只做文本级合并 —— 从每份资源里取出 VTIMEZONE 与 VEVENT 块，
 * 去重后塞进同一个 VCALENDAR，字节内容原样保留。
 */
export interface MergedCalendar {
    data: string;
    /** 导出的日程条数（按资源计，不是展开后的实例数）。 */
    count: number;
}
/**
 * @param sources 每个元素是一份完整的 VCALENDAR 文本（即各资源的 `raw()`）。
 * @param stamp 生成时间（DTSTAMP 用；测试可注入）。
 */
export declare function mergeCalendars(sources: readonly string[], stamp?: string): MergedCalendar;
/** 导出上限：超过就不导，避免一次生成几十 MB 的响应把面板卡死。 */
export declare const EXPORT_LIMITS: {
    maxEvents: number;
    maxBytes: number;
};
export declare function exportFilename(now?: Date): string;
