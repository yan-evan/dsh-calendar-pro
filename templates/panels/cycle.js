/**
 * 经期记录与预测。纯函数 + 本机存储，vm 可直接加载测试（test/cycle.test.mjs）。
 *
 * 只有一种状态：**有记录就展示，清除记录就消失**。没有「启用」开关 ——
 * 「填了日期却不想看到线」这种中间态本来就不成立，想关掉就点清除。
 *
 * 隐私约束（改这里前先看）：
 *   · 数据只写浏览器 localStorage，不经过插件 API、不上传、不写日志、不进日历账号；
 *   · 没填上次开始日期时，一律返回 null，不显示任何标记；
 *   · 预测只是「按固定周期做算术」，不是医学判断，UI 上必须写明仅供备忘。
 */
const CYCLE_STORAGE_KEY = 'dsh-calendar-pro:cycle';
const CYCLE_DEFAULT = { lastStart: '', cycleLength: 28, periodLength: 5 };
const CYCLE_MIN_LENGTH = 15;
const CYCLE_MAX_LENGTH = 60;
const CYCLE_MAX_PERIOD = 14;

function cycleStorage() {
    try {
        if (typeof localStorage !== 'undefined' && localStorage !== null)
            return localStorage;
        if (typeof window !== 'undefined' && window !== null && window.localStorage)
            return window.localStorage;
    }
    catch (error) { /* 隐私模式 / 无 DOM：退化成不持久化 */ }
    return null;
}
function isValidDayKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const [y, m, d] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}
/**
 * 数值规整。**空值（''/null/undefined/纯空格）一律回落到默认值，不能当 0 处理** ——
 * `Number('') === 0`，再被 `Math.max(min, 0)` 一夹就变成下限（周期 15、经期 1），
 * 用户明明看到「默认 28 / 5」，存下来却成了「15 / 1」。
 */
function clampInt(value, min, max, fallback) {
    if (value === null || value === undefined)
        return fallback;
    if (typeof value === 'string' && value.trim() === '')
        return fallback;
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}
/** 任何来源（localStorage / 表单 / 旧版本）都先过这一层，脏数据不会让日历乱画。 */
function normalizeCycle(raw) {
    if (raw === null || raw === undefined || typeof raw !== 'object')
        return Object.assign({}, CYCLE_DEFAULT);
    // 旧版本存过 enabled 字段，这里直接忽略：日期合法就展示，不合法就等于没记录。
    const lastStart = isValidDayKey(raw.lastStart) ? raw.lastStart : '';
    return {
        lastStart,
        cycleLength: clampInt(raw.cycleLength, CYCLE_MIN_LENGTH, CYCLE_MAX_LENGTH, CYCLE_DEFAULT.cycleLength),
        periodLength: clampInt(raw.periodLength, 1, CYCLE_MAX_PERIOD, CYCLE_DEFAULT.periodLength)
    };
}
function loadCycleConfig() {
    try {
        const store = cycleStorage();
        if (store === null)
            return Object.assign({}, CYCLE_DEFAULT);
        const raw = store.getItem(CYCLE_STORAGE_KEY);
        return raw === null || raw === undefined ? Object.assign({}, CYCLE_DEFAULT) : normalizeCycle(JSON.parse(raw));
    }
    catch (error) {
        return Object.assign({}, CYCLE_DEFAULT);
    }
}
/** 模块级共享状态：设置页保存后，已挂载的日历立即跟着变；未挂载的下次进来读到新值。 */
let CYCLE_STATE = loadCycleConfig();
const CYCLE_LISTENERS = new Set();
function getCycleConfig() {
    return CYCLE_STATE;
}
function setCycleConfig(next) {
    CYCLE_STATE = normalizeCycle(next);
    try {
        const store = cycleStorage();
        if (store !== null)
            store.setItem(CYCLE_STORAGE_KEY, JSON.stringify(CYCLE_STATE));
    }
    catch (error) { /* 存不进去也允许本次会话继续用 */ }
    for (const listener of CYCLE_LISTENERS) {
        try { listener(CYCLE_STATE); }
        catch (error) { /* 一个订阅者出错不影响其它 */ }
    }
    return CYCLE_STATE;
}
function clearCycleConfig() {
    CYCLE_STATE = Object.assign({}, CYCLE_DEFAULT);
    try {
        const store = cycleStorage();
        if (store !== null)
            store.removeItem(CYCLE_STORAGE_KEY);
    }
    catch (error) { /* 同上 */ }
    for (const listener of CYCLE_LISTENERS) {
        try { listener(CYCLE_STATE); }
        catch (error) { /* 同上 */ }
    }
    return CYCLE_STATE;
}
function subscribeCycle(listener) {
    CYCLE_LISTENERS.add(listener);
    return () => CYCLE_LISTENERS.delete(listener);
}
function keyToUtc(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}
function daysBetweenKeys(from, to) {
    if (!isValidDayKey(from) || !isValidDayKey(to))
        return NaN;
    return Math.round((keyToUtc(to) - keyToUtc(from)) / 86400000);
}
/**
 * 某天是不是预计经期：以 lastStart 为第 1 天，每 cycleLength 天一轮，
 * 每轮前 periodLength 天算经期。取模用正模，所以历史（diff < 0）也能回看。
 * 返回 { day: 经期第几天, index: 第几个周期(0=记录那次，负数为过去) }，否则 null。
 */
function cycleInfoOf(config, key) {
    if (config === null || config === undefined || !isValidDayKey(config.lastStart) || !isValidDayKey(key))
        return null;
    const diff = daysBetweenKeys(config.lastStart, key);
    if (!Number.isFinite(diff))
        return null;
    const span = config.cycleLength;
    const offset = ((diff % span) + span) % span;
    if (offset >= config.periodLength)
        return null;
    return { day: offset + 1, index: Math.floor(diff / span), offset };
}
