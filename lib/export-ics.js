/**
 * 把多份 iCalendar 资源合并成一个 .ics 文件（导出用）。
 *
 * 为什么不是「解析成事件再重新拼」：那样会丢掉 ATTENDEE / EXDATE / X- 扩展属性，
 * 导出就成了有损转换。这里只做文本级合并 —— 从每份资源里取出 VTIMEZONE 与 VEVENT 块，
 * 去重后塞进同一个 VCALENDAR，字节内容原样保留。
 */
/** 逐行扫描，取出指定组件的完整块（含 BEGIN/END），支持内部嵌套子组件（如 VEVENT 里的 VALARM）。 */
function blocksOf(source, component) {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let depth = 0;
    let current = null;
    for (const line of lines) {
        const upper = line.toUpperCase();
        if (current === null && upper === 'BEGIN:' + component) {
            current = [line];
            depth = 1;
            continue;
        }
        if (current === null)
            continue;
        current.push(line);
        if (upper.startsWith('BEGIN:'))
            depth += 1;
        else if (upper.startsWith('END:')) {
            depth -= 1;
            if (depth === 0) {
                out.push(current.join('\r\n'));
                current = null;
            }
        }
    }
    return out;
}
/** VTIMEZONE 的 TZID，用于跨资源去重（同一条时区定义只保留一份）。 */
function timezoneId(block) {
    for (const line of block.split('\r\n')) {
        if (line.toUpperCase().startsWith('TZID:'))
            return line.slice(5).trim();
    }
    return '';
}
const PRODUCT_ID = '-//dsh-calendar-pro//export//CN';
/**
 * @param sources 每个元素是一份完整的 VCALENDAR 文本（即各资源的 `raw()`）。
 * @param stamp 生成时间（DTSTAMP 用；测试可注入）。
 */
export function mergeCalendars(sources, stamp = new Date().toISOString()) {
    const events = [];
    const zones = new Map();
    for (const source of sources) {
        if (typeof source !== 'string' || source === '')
            continue;
        for (const zone of blocksOf(source, 'VTIMEZONE')) {
            const id = timezoneId(zone);
            if (id !== '' && !zones.has(id))
                zones.set(id, zone);
        }
        for (const event of blocksOf(source, 'VEVENT'))
            events.push(event);
    }
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:' + PRODUCT_ID,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-EXPORTED-AT:' + stamp.replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
        ...zones.values(),
        ...events,
        'END:VCALENDAR',
    ];
    return { data: lines.join('\r\n') + '\r\n', count: events.length };
}
/** 导出上限：超过就不导，避免一次生成几十 MB 的响应把面板卡死。 */
export const EXPORT_LIMITS = { maxEvents: 5000, maxBytes: 10 * 1024 * 1024 };
export function exportFilename(now = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return 'dsh-calendar-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '.ics';
}
