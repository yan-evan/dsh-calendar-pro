/**
 * 本地日历后端：一个 JSON 文件，里面存 iCalendar 原文。
 *
 * 为什么存 iCal 而不是自定义结构：解析、RRULE 展开、字段覆盖更新、时区处理全部复用
 * `ical.ts`；导出就是拼 `.ics`，迁移到 CalDAV 直接 PUT，零转换层。
 *
 * 并发：读改写全部用同步 fs，Node 单线程下不会在同一个 tick 里交错，因此不需要锁；
 * 落盘用「临时文件 + rename」，进程被杀也不会留下半份文件。
 */
import { availabilityRequest, findAvailableTimes } from './availability.js';
import { busyResource } from './availability-ical.js';
import { buildICalString, expandEventFromICal, generateUid, isRecurringResource, parseEventFromICal, updateICalString, } from './ical.js';
import { calendarFile, readJsonFile, writeJsonAtomic } from './store.js';
/** 本地资源的 href 前缀：uid 仍是 `local://<iCalUID>`，与 CalDAV 的 URL 形状保持一致。 */
const HREF_PREFIX = 'local://';
const MAX_OBJECTS = 5000;
function emptyFile() {
    return { version: 1, revision: 0, events: {} };
}
/** 事件与窗口是否有重叠；全天事件用 YYYY-MM-DD 比较，与解析层保持一致。 */
function overlaps(event, startIso, endIso) {
    const start = Date.parse(event.start);
    const end = Date.parse(event.end) || start;
    const from = Date.parse(startIso);
    const to = Date.parse(endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(from) || !Number.isFinite(to))
        return false;
    return end > from && start < to;
}
export class LocalBackend {
    file;
    kind = 'local';
    constructor(file = calendarFile()) {
        this.file = file;
    }
    /** 读取并清洗：坏记录（无法解析、ical 不是字符串）直接丢弃，不让一个坏条目拖垮整份文件。 */
    read() {
        const raw = readJsonFile(this.file, emptyFile());
        const source = raw.events;
        const events = {};
        if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
            for (const [href, record] of Object.entries(source)) {
                if (record === null || typeof record !== 'object')
                    continue;
                const entry = record;
                if (typeof entry.ical !== 'string' || entry.ical === '')
                    continue;
                events[href] = {
                    ical: entry.ical,
                    revision: typeof entry.revision === 'number' ? entry.revision : 0,
                    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
                };
            }
        }
        return { version: 1, revision: typeof raw.revision === 'number' ? raw.revision : 0, events };
    }
    write(file, now) {
        writeJsonAtomic(this.file, { version: 1, revision: file.revision, events: file.events, updatedAt: now });
    }
    require(file, uid) {
        const record = file.events[uid];
        if (record === undefined)
            throw new Error('找不到这条本地日程，可能已被删除；请刷新日历后重试。');
        return record;
    }
    async list(startIso, endIso, options, signal) {
        signal?.throwIfAborted();
        const file = this.read();
        const maxOccurrences = options?.maxOccurrences ?? 30;
        const expand = options?.expand !== false;
        const out = [];
        let truncated = false;
        for (const [href, record] of Object.entries(file.events)) {
            signal?.throwIfAborted();
            // 与 CalDAV 一侧同一条路径：窗口内展开，避免把「没走到窗口」当成「窗口内没有」。
            const events = expand
                ? expandEventFromICal(record.ical, href, undefined, startIso, endIso, maxOccurrences, {
                    onTruncated: (value) => { if (value)
                        truncated = true; },
                })
                : (() => {
                    const event = parseEventFromICal(record.ical, href);
                    return event === null ? [] : [event];
                })();
            for (const event of events) {
                // CalDAV 一侧由服务器按 timeRange 过滤，本地必须自己筛：
                // 非重复事件在 expandEventFromICal 里不判断窗口（原样返回单条）。
                if (overlaps(event, startIso, endIso))
                    out.push(event);
            }
        }
        options?.onTruncated?.(truncated);
        return out;
    }
    async all(signal, timeRange) {
        signal?.throwIfAborted();
        const file = this.read();
        const out = [];
        for (const [href, record] of Object.entries(file.events)) {
            signal?.throwIfAborted();
            const event = parseEventFromICal(record.ical, href);
            if (event === null)
                continue;
            if (timeRange !== undefined && !overlaps(event, timeRange.start, timeRange.end))
                continue;
            out.push(event);
        }
        return out;
    }
    async availability(input, signal) {
        signal?.throwIfAborted();
        const request = availabilityRequest(input);
        // 与 CalDAV 一侧相同的安全边界：前后各多读 2 天，覆盖跨时区与跨日边界。
        const start = new Date(request.startMs - 2 * 86400000).toISOString();
        const end = new Date(request.endMs + 2 * 86400000).toISOString();
        const deadline = Date.now() + 20000;
        const file = this.read();
        const events = [];
        let bytes = 0;
        for (const [href, record] of Object.entries(file.events)) {
            signal?.throwIfAborted();
            bytes += record.ical.length;
            if (bytes > 8 * 1024 * 1024)
                throw new Error('本地日历数据超过 8 MiB，请缩小空闲查询范围');
            if (Date.now() > deadline)
                throw new Error('空闲查询超时，请缩小范围');
            events.push(...busyResource(record.ical, href, start, end, request.timeZone, deadline));
            if (events.length > 10000)
                throw new Error('日程实例超过 10000 条，请缩小空闲查询范围');
        }
        return findAvailableTimes(events, input);
    }
    async create(fields, signal) {
        signal?.throwIfAborted();
        const icalUid = fields.icalUid ?? generateUid();
        const href = HREF_PREFIX + icalUid;
        const ical = buildICalString({ ...fields, icalUid });
        const file = this.read();
        if (file.events[href] !== undefined)
            throw new Error('已存在同 UID 的本地日程，未写入。');
        file.revision += 1;
        file.events[href] = { ical, revision: file.revision, updatedAt: new Date().toISOString() };
        this.write(file, new Date().toISOString());
        const event = parseEventFromICal(ical, href);
        if (event === null)
            throw new Error('新建日程失败：生成的 iCal 无法解析');
        return event;
    }
    /** 全部资源的原文（导出用）；坏记录已在 read() 里剔除。 */
    async rawAll(signal) {
        signal?.throwIfAborted();
        return Object.values(this.read().events).map((record) => record.ical);
    }
    /** 原始 iCalendar 文本：迁移原样搬运，保留 ATTENDEE / EXDATE 等未建模字段。 */
    async raw(uid, signal) {
        signal?.throwIfAborted();
        return this.require(this.read(), uid).ical;
    }
    async get(uid, signal) {
        signal?.throwIfAborted();
        const record = this.require(this.read(), uid);
        const event = parseEventFromICal(record.ical, uid);
        if (event === null)
            throw new Error('这条本地日程的内容无法解析，请检查数据文件。');
        return event;
    }
    async update(uid, changes, signal, scope) {
        signal?.throwIfAborted();
        const file = this.read();
        const record = this.require(file, uid);
        // 与 CalDAV 侧同一条安全契约：操作整个重复系列前必须显式确认。
        if (isRecurringResource(record.ical) && scope !== 'series') {
            throw new Error('这是整个重复系列。请先向用户说明影响，确认后显式传 scope="series"；当前不支持只改某一次。');
        }
        const next = updateICalString(record.ical, changes);
        if (next === null)
            throw new Error('这条本地日程无法更新：原内容缺少主日程。');
        file.revision += 1;
        file.events[uid] = { ical: next, revision: file.revision, updatedAt: new Date().toISOString() };
        this.write(file, new Date().toISOString());
        const event = parseEventFromICal(next, uid);
        if (event === null)
            throw new Error('更新后无法解析这条日程，原记录已保留。');
        return event;
    }
    async delete(uid, signal, scope) {
        signal?.throwIfAborted();
        const file = this.read();
        const record = this.require(file, uid);
        // 与 CalDAV 侧同一条安全契约：删除整个重复系列前必须显式确认。
        if (isRecurringResource(record.ical) && scope !== 'series') {
            throw new Error('这是整个重复系列。请先向用户说明影响，确认后显式传 scope="series"；当前不支持只删某一次。');
        }
        delete file.events[uid];
        file.revision += 1;
        this.write(file, new Date().toISOString());
        return { uid, href: uid };
    }
    async importSnapshot(signal) {
        signal?.throwIfAborted();
        const file = this.read();
        const hrefs = Object.keys(file.events);
        if (hrefs.length > MAX_OBJECTS)
            throw new Error('本地日历超过 ' + MAX_OBJECTS + ' 个日程，无法完整检查重复');
        const uids = new Set();
        const events = [];
        for (const [href, record] of Object.entries(file.events)) {
            signal?.throwIfAborted();
            const event = parseEventFromICal(record.ical, href);
            if (event === null)
                continue;
            events.push(event);
            const icalUid = event.icalUid;
            if (typeof icalUid === 'string' && icalUid !== '')
                uids.add(icalUid);
        }
        return { uids, events };
    }
    async importRaw(uid, data, signal) {
        signal?.throwIfAborted();
        const parsed = parseEventFromICal(data, HREF_PREFIX + uid);
        if (parsed === null)
            throw new Error('导入资源缺少可解析的主日程，未写入。');
        const href = HREF_PREFIX + uid;
        const file = this.read();
        // 与 CalDAV 一侧的 If-None-Match:* 对齐：绝不覆盖已经存在的资源。
        if (file.events[href] !== undefined)
            throw new Error('本地已存在 UID 为 ' + uid + ' 的日程，未覆盖。');
        file.revision += 1;
        file.events[href] = { ical: data, revision: file.revision, updatedAt: new Date().toISOString() };
        this.write(file, new Date().toISOString());
    }
}
