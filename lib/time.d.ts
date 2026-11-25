/** Validate calendar dates before Date/ical.js can silently normalize them. */
export declare const DATE_ONLY_PATTERN: RegExp;
/** 日期/时间统一转 epoch 毫秒（date-only 按 UTC 零点），用于范围比较。 */
export declare function toEpochMs(value: string): number;
/** 按开始时间升序稳定排序（服务端返回顺序不保证稳定，多日历合并后同样需要）。 */
export declare function sortEvents<T extends {
    start: string;
}>(events: T[]): T[];
export declare function assertIsoTime(value: string, label: string): void;
