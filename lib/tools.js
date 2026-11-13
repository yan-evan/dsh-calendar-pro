/**
 * 七个面向模型的日历工具：list / create / update / delete / search / health / findTime。
 * 直接调用 ctx.tools.register 注册【编译好的 JSON Schema】参数与 canonical 输出。
 *
 * @module dsh-calendar-pro/tools
 */
import { createBackend } from './backend.js';
import { CALENDAR_PROVIDERS, buildCaldavUrl, resolveAuthMethod, resolveBackendKind, resolveConfig, resolveCredentials, validateOAuthUrl, } from './config.js';
import { compileParameters } from './parameters.js';
import { assertIsoTime, DATE_ONLY_PATTERN } from './time.js';
export { assertIsoTime } from './time.js';
const EVENT_SCHEMA = { type: 'object', additionalProperties: true };
const TIMEOUT_MS = 60000;
export function asRecord(args) {
    return typeof args === 'object' && args !== null ? args : {};
}
function executionSignal(exec) {
    if (typeof exec !== 'object' || exec === null)
        return undefined;
    const signal = exec.signal;
    return signal instanceof AbortSignal ? signal : undefined;
}
export function optionalString(args, key) {
    const value = args[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
/** An omitted patch preserves the field; an explicit empty string clears it. */
function optionalPatchString(args, key) {
    const value = args[key];
    return typeof value === 'string' ? value.trim() : undefined;
}
function requiredString(args, key, label) {
    const value = optionalString(args, key);
    if (value === undefined) {
        throw new Error(label + '（参数 ' + key + '）为必填，请提供非空字符串。');
    }
    return value;
}
function optionalBoolean(args, key) {
    const value = args[key];
    return typeof value === 'boolean' ? value : undefined;
}
function booleanWithDefault(args, key, fallback) {
    const value = args[key];
    return typeof value === 'boolean' ? value : fallback;
}
/** 读取整数并 clamp 到 [min, max]；非法值返回 fallback。 */
function clampedInteger(args, key, fallback, min, max) {
    const value = args[key];
    if (typeof value !== 'number' || !Number.isInteger(value))
        return fallback;
    return Math.min(max, Math.max(min, value));
}
/** 日期/时间统一转 epoch 毫秒（date-only 按 UTC 零点），用于范围比较。 */
function toEpochMs(value) {
    const dateOnly = DATE_ONLY_PATTERN.exec(value);
    if (dateOnly !== null) {
        return new Date(value + 'T00:00:00Z').getTime();
    }
    return new Date(value).getTime();
}
export function assertTimeRange(start, end) {
    if (toEpochMs(start) > toEpochMs(end)) {
        throw new Error('end 不能早于 start：' + end + ' < ' + start + '。请确认起止时间顺序。');
    }
}
export function isoNoMillis(value) {
    return value.replace(/\.\d{3}Z$/, 'Z');
}
/** 按开始时间升序稳定排序（CalDAV 服务端返回顺序不保证稳定）。 */
export function sortEvents(events) {
    return events
        .map((event, index) => ({ event, index, startMs: toEpochMs(event.start) }))
        .sort((a, b) => a.startMs - b.startMs || a.index - b.index)
        .map(({ event }) => event);
}
function formatEvent(event) {
    const range = event.allDay ? event.start + '（全天）' : event.start + ' ~ ' + event.end;
    const extra = [event.location ? '地点：' + event.location : '', event.rrule ? '重复：' + event.rrule : '']
        .filter(Boolean).join('；');
    return '- ' + event.summary + '（' + range + '）' + (extra ? '，' + extra : '') + '，uid=' + event.uid;
}
function buildSearchFilter(query) {
    const needle = query.toLowerCase();
    return (event) => {
        const haystack = [event.summary, event.description ?? '', event.location ?? '', event.icalUid ?? '']
            .join(' ').toLowerCase();
        return haystack.includes(needle);
    };
}
export function buildCalendarTools(config, env = process.env) {
    const configOf = () => (typeof config === 'function' ? config() : config);
    let cachedKey;
    let cachedBackend;
    /**
     * 惰性构造后端：配置里选了 caldav 就解析出端点与凭据，否则用本地日历。
     * 本地后端无状态，按 kind 复用即可；caldav 要按完整解析结果比较，凭据变了就不能复用旧 token。
     */
    const service = () => {
        const current = configOf();
        const key = resolveBackendKind(current) === 'caldav'
            ? 'caldav|' + JSON.stringify(resolveConfig(current, env))
            : 'local';
        if (cachedBackend === undefined || cachedKey !== key) {
            cachedBackend = createBackend(current, env);
            cachedKey = key;
        }
        return cachedBackend;
    };
    const list = {
        name: 'calendar_list',
        description: '列出某时间段内的日历事件（默认未来 7 天）。start/end 为 ISO 8601 时间（含时区偏移，如 2025-01-01T09:00:00+08:00），全天事件返回 YYYY-MM-DD。查询窗口是半开区间 [start, end)：恰好在 end 时刻开始的事件不计入。默认展开重复事件（RRULE）：每个实例作为独立行返回，start/end 为该次发生时间，并带 isOccurrence=true 与 seriesStart（系列原开始时间）；非重复事件保持单行且 isOccurrence=false。expand=false 时重复事件按原始单条返回并带 rrule 字段。maxOccurrences 为每个重复事件的展开次数上限；触顶时 complete=false，表示结果被截断、不是该时间段的全部事件。返回每个事件的稳定标识 uid，供 calendar_update / calendar_delete 使用。',
        parameters: compileParameters({
            start: { type: 'string', description: '起始时间（ISO 8601，含时区偏移）。缺省为当前时间（UTC）。' },
            end: { type: 'string', description: '结束时间（ISO 8601，含时区偏移）。缺省为 start 后 7 天。' },
            expand: { type: 'boolean', description: '是否展开重复事件（RRULE）。默认 true；设为 false 时重复事件按原始单条返回并带 rrule 字段。' },
            maxOccurrences: { type: 'integer', description: '每个重复事件最多展开的实例数上限（默认 30，自动 clamp 到 1-200），防止无终止规则死循环。' },
        }),
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    count: { type: 'integer' },
                    start: { type: 'string' },
                    end: { type: 'string' },
                    events: { type: 'array', items: EVENT_SCHEMA },
                    complete: { type: 'boolean', description: '结果是否完整；false 表示展开被 maxOccurrences 截断。' },
                },
                required: ['count', 'events'],
            },
            render: (_args, value) => {
                const result = value;
                const lines = ['时间段 ' + result.start + ' ~ ' + result.end + ' 内共 ' + result.count + ' 个事件：'];
                for (const event of result.events)
                    lines.push(formatEvent(event));
                if (result.complete === false) {
                    lines.push('注意：重复事件展开达到 maxOccurrences 上限，以上不是该时间段的全部事件；请缩小时间范围或调大 maxOccurrences 后重查。');
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(args, exec) {
            const input = asRecord(args);
            const now = new Date();
            const defaultEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
            const start = optionalString(input, 'start') ?? isoNoMillis(now.toISOString());
            const end = optionalString(input, 'end') ?? isoNoMillis(defaultEnd.toISOString());
            assertIsoTime(start, 'start');
            assertIsoTime(end, 'end');
            assertTimeRange(start, end);
            const expand = booleanWithDefault(input, 'expand', true);
            const maxOccurrences = clampedInteger(input, 'maxOccurrences', 30, 1, 200);
            // 展开被 maxOccurrences 截断时明确告知，避免把「没算完」当成「就这些」。
            let truncated = false;
            const events = sortEvents(await service().list(start, end, { expand, maxOccurrences, onTruncated: (value) => { truncated = value; } }, executionSignal(exec)));
            return { count: events.length, start, end, events, complete: !truncated };
        },
        timeoutMs: TIMEOUT_MS,
    };
    const create = {
        name: 'calendar_create',
        description: '新建一个日历事件。summary 与 start、end（ISO 8601，含时区偏移）为必填；description、location、allDay、rrule 可选。全天事件 start/end 用 YYYY-MM-DD 或设置 allDay=true。成功返回新事件的稳定标识 uid。',
        parameters: compileParameters({
            summary: { type: 'string', required: true, description: '事件标题（必填）。' },
            start: { type: 'string', required: true, description: '开始时间（ISO 8601，含时区偏移，必填）。' },
            end: { type: 'string', required: true, description: '结束时间（ISO 8601，含时区偏移，必填）。' },
            description: { type: 'string', description: '事件描述（可选）。' },
            location: { type: 'string', description: '地点（可选）。' },
            allDay: { type: 'boolean', description: '是否全天事件（可选，默认 false）。' },
            rrule: { type: 'string', description: '重复规则（可选，RFC 5545 RRULE 语法），如 FREQ=WEEKLY;COUNT=4；calendar_list 会按该规则展开实例。' },
        }),
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: { created: EVENT_SCHEMA },
                required: ['created'],
            },
            render: (_args, value) => {
                const event = value.created;
                return [{ type: 'text', text: '已新建事件：' + formatEvent(event) }];
            },
        },
        async execute(args, exec) {
            const input = asRecord(args);
            const summary = requiredString(input, 'summary', '事件标题');
            const start = requiredString(input, 'start', '开始时间');
            const end = requiredString(input, 'end', '结束时间');
            assertIsoTime(start, 'start');
            assertIsoTime(end, 'end');
            assertTimeRange(start, end);
            const description = optionalString(input, 'description');
            const location = optionalString(input, 'location');
            const allDay = optionalBoolean(input, 'allDay');
            const rrule = optionalString(input, 'rrule');
            const fields = {
                summary,
                start,
                end,
                ...(description !== undefined ? { description } : {}),
                ...(location !== undefined ? { location } : {}),
                ...(allDay !== undefined ? { allDay } : {}),
                ...(rrule !== undefined ? { rrule } : {}),
            };
            const created = await service().create(fields, executionSignal(exec));
            return { created };
        },
        timeoutMs: TIMEOUT_MS,
    };
    const update = {
        name: 'calendar_update',
        description: '按 uid 修改日历事件。uid 必填（来自 calendar_list / calendar_search 返回的 uid）。summary、start、end、description、location、allDay、rrule 均可选，未提供的字段保留原值。description、location、rrule 显式传空字符串可分别清空说明、地点或停止重复。重复日程的 uid 指整个系列；先向用户说明，确认后传 scope="series"，不能只改某一次。有例外场次的系列不允许整体改开始时间、全天类型或重复规则。',
        parameters: compileParameters({
            uid: { type: 'string', required: true, description: '事件稳定标识（来自 calendar_list / calendar_search 的 uid，必填）。' },
            scope: { type: 'string', enum: ['series'], description: '重复日程必须先向用户说明影响；确认操作整个系列后传 series。不能只改或删除某一次。' },
            summary: { type: 'string', description: '新标题（可选）。' },
            start: { type: 'string', description: '新开始时间（ISO 8601，可选）。' },
            end: { type: 'string', description: '新结束时间（ISO 8601，可选）。' },
            description: { type: 'string', description: '新描述（可选）；空字符串清空说明，省略则保留。' },
            location: { type: 'string', description: '新地点（可选）；空字符串清空地点，省略则保留。' },
            allDay: { type: 'boolean', description: '是否全天事件（可选）。' },
            rrule: { type: 'string', description: '新的重复规则（可选）；空字符串停止重复，省略则保留。' },
        }),
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: { updated: EVENT_SCHEMA },
                required: ['updated'],
            },
            render: (_args, value) => {
                const event = value.updated;
                return [{ type: 'text', text: '已更新事件：' + formatEvent(event) }];
            },
        },
        async execute(args, exec) {
            const input = asRecord(args);
            const uid = requiredString(input, 'uid', '事件 uid');
            const changes = {};
            const summary = optionalString(input, 'summary');
            if (summary !== undefined)
                changes.summary = summary;
            const start = optionalString(input, 'start');
            if (start !== undefined) {
                assertIsoTime(start, 'start');
                changes.start = start;
            }
            const end = optionalString(input, 'end');
            if (end !== undefined) {
                assertIsoTime(end, 'end');
                changes.end = end;
            }
            const description = optionalPatchString(input, 'description');
            if (description !== undefined)
                changes.description = description;
            const location = optionalPatchString(input, 'location');
            if (location !== undefined)
                changes.location = location;
            const allDay = optionalBoolean(input, 'allDay');
            if (allDay !== undefined)
                changes.allDay = allDay;
            const rrule = optionalPatchString(input, 'rrule');
            if (rrule !== undefined)
                changes.rrule = rrule;
            const updated = await service().update(uid, changes, executionSignal(exec), input.scope === 'series' ? 'series' : undefined);
            return { updated };
        },
        timeoutMs: TIMEOUT_MS,
    };
    const remove = {
        name: 'calendar_delete',
        description: '按 uid 删除日历事件。uid 必填（来自 calendar_list / calendar_search 返回的 uid）。删除不可撤销。重复日程的 uid 指向整个系列，不能只删某一次；必须先向用户说明将删除所有场次，确认后传 scope="series"，否则拒绝。批量删除（用户要求删除某段时间、某类全部日程）时，必须先列出将要删除的数量与范围，向用户确认后再逐条执行；不得未经确认直接循环删除。',
        parameters: compileParameters({
            uid: { type: 'string', required: true, description: '事件稳定标识（来自 calendar_list / calendar_search 的 uid，必填）。' },
            scope: { type: 'string', enum: ['series'], description: '重复日程必须先向用户说明影响；确认操作整个系列后传 series。不能只改或删除某一次。' },
        }),
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    deleted: { type: 'boolean' },
                    uid: { type: 'string' },
                    href: { type: 'string' },
                },
                required: ['deleted', 'uid'],
            },
            render: (_args, value) => {
                const result = value;
                return [{ type: 'text', text: '已删除事件：uid=' + result.uid }];
            },
        },
        async execute(args, exec) {
            const input = asRecord(args);
            const uid = requiredString(input, 'uid', '事件 uid');
            const result = await service().delete(uid, executionSignal(exec), input.scope === 'series' ? 'series' : undefined);
            return { deleted: true, uid: result.uid, href: result.href };
        },
        timeoutMs: TIMEOUT_MS,
    };
    const search = {
        name: 'calendar_search',
        description: '按关键词搜索日历事件（客户端过滤：匹配标题、描述、地点与 iCal UID，不区分大小写）。只查询 start~end 窗口内的事件（start/end 缺省为当前时间前后各 1 年），query 必填，limit 可选（默认 50）。返回每个事件的稳定标识 uid。',
        parameters: compileParameters({
            query: { type: 'string', required: true, description: '搜索关键词（必填）。' },
            start: { type: 'string', description: '查询窗口起始时间（ISO 8601，含时区偏移）。缺省为当前时间前 1 年。' },
            end: { type: 'string', description: '查询窗口结束时间（ISO 8601，含时区偏移）。缺省为当前时间后 1 年。' },
            limit: { type: 'integer', description: '最多返回条数（可选，默认 50，自动 clamp 到 1-200）。' },
        }),
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    query: { type: 'string' },
                    count: { type: 'integer' },
                    events: { type: 'array', items: EVENT_SCHEMA },
                },
                required: ['query', 'count', 'events'],
            },
            render: (_args, value) => {
                const result = value;
                const lines = ['搜索「' + result.query + '」命中 ' + result.count + ' 个事件：'];
                for (const event of result.events)
                    lines.push(formatEvent(event));
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(args, exec) {
            const input = asRecord(args);
            const query = requiredString(input, 'query', '搜索关键词');
            const limit = clampedInteger(input, 'limit', 50, 1, 200);
            const now = new Date();
            const yearMs = 365 * 24 * 3600 * 1000;
            const start = optionalString(input, 'start') ?? isoNoMillis(new Date(now.getTime() - yearMs).toISOString());
            const end = optionalString(input, 'end') ?? isoNoMillis(new Date(now.getTime() + yearMs).toISOString());
            assertIsoTime(start, 'start');
            assertIsoTime(end, 'end');
            assertTimeRange(start, end);
            const all = await service().all(executionSignal(exec), { start, end });
            const matched = sortEvents(all).filter(buildSearchFilter(query)).slice(0, limit);
            return { query, count: matched.length, events: matched };
        },
        timeoutMs: TIMEOUT_MS,
    };
    const health = {
        name: 'calendar_health',
        description: 'dsh-calendar-pro 自检：检查当前数据源的配置完整性。本地日历（默认）只需确认数据源可用，无需任何账号；只有连接 CalDAV 时才检查服务商/日历地址/Basic 或 OAuth 凭据，且不发起网络连接、不验证账号授权。遇到问题时先运行本工具定位。',
        parameters: compileParameters({}),
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => {
                const rec = (value ?? {});
                const rawChecks = Array.isArray(rec.checks) ? rec.checks : [];
                const lines = ['dsh-calendar-pro 自检' + (rec.ok === true ? '：正常。' : '：发现问题。')];
                for (const item of rawChecks) {
                    const c = (item ?? {});
                    lines.push('- ' + String(c.name) + '：' + (c.ok === true ? '✅ ' + String(c.detail ?? '') : '❌ ' + String(c.detail ?? '')));
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(_args, exec) {
            executionSignal(exec)?.throwIfAborted();
            const checks = [];
            // 每次自检都重新取配置：面板刚保存的地址应当立刻反映在这里。
            const current = configOf();
            // 本地日历零配置、无需账号：只有连远程时才校验端点与凭据。
            // 「还没选数据源」是正常状态，不算故障。
            const kind = resolveBackendKind(current);
            if (kind !== 'caldav') {
                const detail = kind === 'local'
                    ? '本地日历（零配置，无需账号）'
                    : '尚未选择数据源（默认使用本地日历，无需账号）';
                checks.push({ name: '数据源', ok: true, detail });
                return { ok: true, plugin: 'dsh-calendar-pro', checks };
            }
            const rawProvider = current?.provider;
            const provider = rawProvider === undefined || rawProvider === null || rawProvider === '' ? 'custom' : String(rawProvider);
            const providerOk = CALENDAR_PROVIDERS.includes(provider);
            checks.push({ name: '服务商', ok: providerOk, detail: providerOk ? provider : '不支持 ' + provider + '；只支持 ' + CALENDAR_PROVIDERS.join(' / ') });
            try {
                const endpoint = buildCaldavUrl(current ?? {}, provider);
                if (resolveAuthMethod(current) === 'oauth')
                    validateOAuthUrl(endpoint, 'caldavUrl');
                checks.push({ name: '日历地址', ok: true, detail: '已解析为 ' + endpoint });
            }
            catch (error) {
                checks.push({ name: '日历地址', ok: false, detail: error instanceof Error ? error.message : String(error) });
            }
            try {
                if (resolveAuthMethod(current) === 'oauth') {
                    checks.push({ name: '认证方式', ok: true, detail: 'OAuth 2.0（无需 username/password）' });
                }
                else {
                    const hasUser = typeof current?.username === 'string' && current.username.trim() !== '';
                    checks.push({ name: '账号', ok: hasUser, detail: hasUser ? '已配置 Basic 账号' : '未配置：请填 username（iCloud 为账号邮箱）' });
                }
            }
            catch (error) {
                checks.push({ name: '认证方式', ok: false, detail: error instanceof Error ? error.message : String(error) });
            }
            try {
                const credentials = resolveCredentials(current, env);
                checks.push({ name: '认证凭据', ok: true, detail: credentials.oauth === undefined
                        ? '已配置 Basic 凭据；仅检查配置，未联网验证'
                        : '已配置 clientId、clientSecret、refreshToken 与 tokenUrl；仅检查配置，未联网验证' });
            }
            catch (error) {
                checks.push({ name: '认证凭据', ok: false, detail: error instanceof Error ? error.message : String(error) });
            }
            return { ok: checks.every((check) => check.ok === true), plugin: 'dsh-calendar-pro', checks };
        },
        timeoutMs: TIMEOUT_MS,
    };
    const findTime = {
        name: 'calendar_find_time',
        description: '只读查询当前连接日历的空闲时段，不创建或预约日程。须提供带时区的 start/end（最多 31 天）与 IANA timeZone；默认工作日周一至周五 09:00–18:00、60 分钟时长、15 分钟候选间隔。按查询时区解释全天和浮动时间，排除透明或取消事件，展开完整的重复例外；读取或展开不完整时明确失败，不把部分结果当空闲。bufferMinutes 仅用于定时日程前后缓冲。候选可重叠，只反映读取时当前连接的一个日历，不保证其他日历或参会者空闲；创建前需向用户核对。',
        parameters: compileParameters({
            start: { type: 'string', required: true, description: '查询开始，带 Z 或 UTC 偏移的 ISO 时间' },
            end: { type: 'string', required: true, description: '查询结束，不包含端点，最多 31 天' },
            timeZone: { type: 'string', required: true, description: '工作时间和全天日期使用的 IANA 时区，如 Asia/Shanghai' },
            durationMinutes: { type: 'integer', description: '时长 5–480 分钟，默认 60' },
            workStart: { type: 'string', description: '每天工作开始 HH:mm，默认 09:00' },
            workEnd: { type: 'string', description: '每天工作结束 HH:mm，默认 18:00，不支持跨日窗口' },
            weekdays: { type: 'array', items: 'integer', description: '工作日，周一 1 至周日 7；默认 [1,2,3,4,5]' },
            bufferMinutes: { type: 'integer', description: '定时日程前后缓冲 0–120 分钟，默认 0' },
            stepMinutes: { type: 'integer', description: '本地钟点候选间隔 1–60 分钟，默认 15' },
            limit: { type: 'integer', description: '最多返回 1–100 个候选，默认 20' },
        }),
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => {
                const result = value;
                return [{ type: 'text', text: ['当前连接日历的空闲候选（' + result.timeZone + '；读取于 ' + result.checkedAt + '；不代表其他日历或参会者空闲）：', ...result.slots.map(s => s.start + ' ~ ' + s.end), result.hasMore ? '候选数量已达上限，可调整范围或数量后再查。' : result.count ? '候选仅供选择，尚未预约或创建日程。' : '完整查询范围内没有符合条件的时段。'].join('\n') }];
            } },
        execute: (args, exec) => service().availability(asRecord(args), executionSignal(exec)),
        timeoutMs: TIMEOUT_MS,
    };
    return [list, create, update, remove, search, health, findTime];
}
