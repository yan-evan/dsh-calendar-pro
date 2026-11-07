/**
 * 农历 + 国务院办公厅法定节假日 / 调休。
 *
 * 设计约束：
 *   · 浏览器端 client.js 是单文件 IIFE，不能 import npm 包，也不该为一个日历去联网。
 *     农历改用 ECMAScript Intl 的 chinese calendar（ICU 自带，零依赖、零数据表），
 *     不支持或静默回落成公历的实现会被自检挡掉，宁可不显示也不显示错日期。
 *   · CALENDAR_HOLIDAYS 由 scripts/build-client.mjs 从 templates/data/holidays.json 注入，
 *     这里只消费、绝不内置猜测数据。公告没发布的年份返回 null，不显示「休 / 班」。
 *   · 全部是纯函数，test/lunisolar.test.mjs 用 vm 直接加载，不依赖 React / DOM。
 */
const LUNAR_DAY_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 农历传统节日。闰月不过节，匹配时先去掉「闰」前缀。 */
const LUNAR_FESTIVALS = {
    '正月|1': '春节',
    '正月|15': '元宵节',
    '二月|2': '龙抬头',
    '五月|5': '端午节',
    '七月|7': '七夕',
    '八月|15': '中秋节',
    '九月|9': '重阳节',
    '腊月|8': '腊八节'
};
function lunarChineseDay(n) {
    if (n === 10) return '初十';
    if (n === 20) return '二十';
    if (n === 30) return '三十';
    if (n < 10) return '初' + LUNAR_DAY_DIGITS[n];
    if (n < 20) return '十' + LUNAR_DAY_DIGITS[n - 10];
    if (n < 30) return '廿' + LUNAR_DAY_DIGITS[n - 20];
    return String(n);
}
/**
 * 拿一个能用的农历格式器。两个坑：
 *   1. 老宿主可能不支持 u-ca-chinese，构造会抛 RangeError；
 *   2. 更阴的是「不抛、静默回落成公历」——2026-02-17 公历是 2月17日、农历是正月初一，
 *      用这个已知日期探一下即可区分。
 */
function createLunarFormatter() {
    try {
        if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function')
            return null;
        const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
        const parts = formatter.formatToParts(new Date(2026, 1, 17, 12));
        const month = (parts.find((p) => p.type === 'month') || {}).value || '';
        const day = (parts.find((p) => p.type === 'day') || {}).value || '';
        if (day !== '1' || !/[\u4e00-\u9fa5]/.test(month))
            return null;
        return formatter;
    }
    catch (error) {
        return null;
    }
}
const LUNAR_FORMAT = createLunarFormatter();
/** 本地墙钟的 YYYY-MM-DD，与 client.js 的 dayKey 保持同一格式。 */
function localDayKey(date) {
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}
/**
 * ICU 个别年份与中国农历差一天：用「正月初一锚点」整段平移。
 * 取不晚于 date 的最近一个锚点（自然处理跨农历年边界），算出该年 ICU 正月初一
 * 比锚点晚几天，查询时就把公历日期往后挪几天再问 ICU。
 * 没有锚点的年份不修正（shift = 0），手册 §7 说明每年补锚点的流程。
 */
const LUNAR_SHIFT_CACHE = new Map();
function lunarAnchors() {
    return (typeof CALENDAR_HOLIDAYS === 'undefined' ? null : CALENDAR_HOLIDAYS.lunarAnchors) || {};
}
function shiftOf(date, forYear) {
    const anchors = lunarAnchors();
    const anchor = anchors[String(forYear)];
    if (anchor === undefined)
        return 0;
    if (LUNAR_SHIFT_CACHE.has(String(forYear)))
        return LUNAR_SHIFT_CACHE.get(String(forYear));
    if (LUNAR_FORMAT === null)
        return 0;
    const [ay, am, ad] = anchor.split('-').map(Number);
    const anchorDate = new Date(ay, am - 1, ad, 12);
    // 正月初一一定落在 1/20–2/25 之间，扫一遍找到 ICU 认为的那天。
    let icuNewYear = null;
    for (let i = 0; i < 40; i++) {
        const probe = new Date(forYear, 0, 20 + i, 12);
        const raw = rawWithoutShift(probe);
        if (raw !== null && raw.month === '正月' && raw.day === 1) {
            icuNewYear = probe;
            break;
        }
    }
    let shift = 0;
    if (icuNewYear !== null)
        shift = Math.round((startOfLocal(icuNewYear) - startOfLocal(anchorDate)) / 86400000);
    LUNAR_SHIFT_CACHE.set(String(forYear), Math.max(-2, Math.min(2, shift)));
    return LUNAR_SHIFT_CACHE.get(String(forYear));
}
function startOfLocal(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
/** 不带锚点修正的原始 ICU 解析，仅供 shiftOf 扫描与 lunarPartsRaw 内部使用。 */
function rawWithoutShift(date) {
    try {
        const parts = LUNAR_FORMAT.formatToParts(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12));
        const monthRaw = (parts.find((p) => p.type === 'month') || {}).value || '';
        const day = parseInt((parts.find((p) => p.type === 'day') || {}).value, 10);
        if (monthRaw === '' || !Number.isFinite(day) || day < 1 || day > 30)
            return null;
        const isLeap = monthRaw.charAt(0) === '闰';
        return { monthRaw, month: isLeap ? monthRaw.slice(1) : monthRaw, day, isLeap };
    }
    catch (error) {
        return null;
    }
}
/** 只解析月/日，不做节日判断 —— 供「次日是否正月初一」这类内部查询使用。 */
function lunarPartsRaw(date) {
    if (LUNAR_FORMAT === null)
        return null;
    // 按「不晚于该日的最近锚点」决定用哪个农历年的偏移量。
    const anchors = lunarAnchors();
    let forYear = date.getFullYear();
    const anchorThisYear = anchors[String(forYear)];
    if (anchorThisYear !== undefined) {
        const [ay, am, ad] = anchorThisYear.split('-').map(Number);
        if (date < new Date(ay, am - 1, ad, 0))
            forYear -= 1;
    }
    const shift = shiftOf(date, forYear);
    const probe = shift === 0 ? date : new Date(date.getFullYear(), date.getMonth(), date.getDate() + shift, 12);
    return rawWithoutShift(probe);
}
/**
 * 一天的农历信息。显示优先级：传统节日 > 初一显示月名（含闰月标记）> 中文日名。
 * 除夕不写死「腊月三十」：腊月可能只有廿九天，用「次日是正月初一」判断才准。
 */
function lunarPartsOf(date) {
    const raw = lunarPartsRaw(date);
    if (raw === null)
        return null;
    let festival = LUNAR_FESTIVALS[raw.month + '|' + raw.day] || null;
    if (festival === null && raw.month === '腊月') {
        const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12);
        const next = lunarPartsRaw(tomorrow);
        if (next !== null && next.month === '正月' && next.day === 1)
            festival = '除夕';
    }
    const first = raw.day === 1;
    const dayText = lunarChineseDay(raw.day);
    return {
        month: raw.month,
        monthRaw: raw.monthRaw,
        day: raw.day,
        isLeap: raw.isLeap,
        festival,
        first,
        text: festival || (first ? raw.monthRaw : dayText),
        full: '农历' + raw.monthRaw + dayText
    };
}
/**
 * 查某天是「休」还是「班」。调休上班优先于放假区间（公告里两者不会重叠，兜个底）。
 * 未收录的年份返回 null —— 不猜、不用媒体推算填坑。
 */
function holidayOf(key) {
    const years = (typeof CALENDAR_HOLIDAYS === 'undefined' ? null : CALENDAR_HOLIDAYS.years) || {};
    const year = years[String(key).slice(0, 4)];
    if (year === undefined || year === null)
        return null;
    const works = year.workdays || [];
    for (const item of works) {
        if (item.date === key)
            return { type: 'work', name: item.name, label: '班' };
    }
    const holidays = year.holidays || [];
    for (const item of holidays) {
        // YYYY-MM-DD 字典序即时间序，无需转 Date。
        if (key >= item.start && key <= item.end)
            return { type: 'off', name: item.name, label: '休' };
    }
    return null;
}
/** 这一年的官方安排有没有收录（用于「数据待更新」提示，而非把空白当成普通工作日）。 */
function holidayCovered(key) {
    const years = (typeof CALENDAR_HOLIDAYS === 'undefined' ? null : CALENDAR_HOLIDAYS.years) || {};
    return Object.prototype.hasOwnProperty.call(years, String(key).slice(0, 4));
}
/** 数据来源清单，供设置页 / 手册 / 测试核对。 */
function holidaySources() {
    return typeof CALENDAR_HOLIDAYS === 'undefined' ? [] : (CALENDAR_HOLIDAYS.sources || []);
}
/** 视图层统一入口：一次拿齐农历与休/班，避免三个视图各写一遍判断。 */
function dayDecorOf(date) {
    const key = localDayKey(date);
    return { key, lunar: lunarPartsOf(date), holiday: holidayOf(key), covered: holidayCovered(key) };
}
/** 显示的农历文字：英文界面不显示农历（避免中英混排），但休/班角标保留。 */
function lunarLabelOf(decor, showLunar) {
    if (showLunar !== true || decor === null || decor.lunar === null)
        return null;
    return decor.lunar.text;
}
function holidayBadgeOf(decor) {
    if (decor === null || decor.holiday === null)
        return null;
    return { type: decor.holiday.type, label: decor.holiday.label, title: decor.holiday.name + (decor.holiday.type === 'work' ? '（调休上班）' : '（放假）') };
}
