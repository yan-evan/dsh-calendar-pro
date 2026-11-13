/**
 * CalDAV 访问层：用 tsdav 客户端对单个日历集合做 查询/新建/更新/删除。
 * 直接用集合 URL 操作（createDAVClient 不带 defaultAccountType，跳过服务发现）。
 *
 * @module dsh-calendar-pro/caldav
 */
import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import { availabilityRequest, findAvailableTimes } from './availability.js';
import { busyResource } from './availability-ical.js';
import { createProxyFetch } from './proxy-fetch.js';
import { createOAuthFetch, OAuthError } from './oauth.js';
import { loadTsdav } from './tsdav-lazy.js';
import { buildICalString, expandEventFromICal, ExpansionLimitError, generateUid, parseEventFromICal, updateICalString, isRecurringResource, } from './ical.js';
/** 一次 REPORT 里能拿到的日历数据（部分服务器把它放在 _cdata 里）。 */
function dataOf(response) {
    const value = response?.props?.calendarData;
    const text = value !== null && typeof value === 'object' && '_cdata' in value ? value._cdata : value;
    return typeof text === 'string' ? text : '';
}
function toObject(response, baseUrl) {
    const etagValue = response?.props?.getetag;
    const etag = etagValue !== null && typeof etagValue === 'object' && '_cdata' in etagValue ? etagValue._cdata : etagValue;
    return {
        url: new URL(String(response?.href ?? ''), baseUrl).href,
        ...(typeof etag === 'string' && etag !== '' ? { etag } : {}),
        data: dataOf(response),
    };
}
/**
 * 全量收集日程原文，**不经过 tsdav 的 fetchCalendarObjects**。
 *
 * 理由：`fetchCalendarObjects` 无论走哪条分支，最后都会执行
 * `assertDAVObjectResponses(...)`，只要服务器少给一个 href 的 calendar-data 就抛
 * `incomplete response`，整个导出/导入全挂（iCloud、Google 实测会这样）。
 * 这里直接发 calendar-query 并自己解析响应：缺数据的条目跳过，不影响其余。
 * 若服务器完全不在 query 里返回 calendar-data，再按 20 条一批做 multiget，
 * 某批失败就逐条重试并跳过仍失败的条目（不再让一条坏数据毁掉整批）。
 */
export async function collectCalendarObjects(client, calendarUrl, signal) {
    signal?.throwIfAborted();
    const props = { 'd:getetag': {}, 'c:calendar-data': {} };
    const filters = [{ 'comp-filter': { _attributes: { name: 'VCALENDAR' }, 'comp-filter': { _attributes: { name: 'VEVENT' } } } }];
    const fetchOptions = signal !== undefined ? { fetchOptions: { signal } } : {};
    const responses = await client.calendarQuery({ url: calendarUrl, props, filters, depth: '1', ...fetchOptions });
    signal?.throwIfAborted();
    const mapped = (responses ?? []).map((response) => toObject(response, calendarUrl));
    const withData = mapped.filter((object) => (object.data ?? '') !== '');
    if (withData.length > 0)
        return withData;
    // 服务器忽略了 query 里的 calendar-data：分块多取，逐条兜底。
    const urls = [...new Set(mapped.map((object) => {
            try {
                const parsed = new URL(object.url);
                return parsed.pathname + parsed.search;
            }
            catch {
                return '';
            }
        }).filter((url) => url !== ''))];
    const out = [];
    const one = async (href) => {
        try {
            const result = await client.calendarMultiGet({ url: calendarUrl, props, objectUrls: [href], depth: '1', ...fetchOptions });
            for (const response of result ?? []) {
                const object = toObject(response, calendarUrl);
                if ((object.data ?? '') !== '')
                    out.push(object);
            }
        }
        catch (error) { /* 单条取不到就跳过，不影响导出的其余日程 */ }
    };
    for (let index = 0; index < urls.length; index += 20) {
        signal?.throwIfAborted();
        const chunk = urls.slice(index, index + 20);
        try {
            const result = await client.calendarMultiGet({ url: calendarUrl, props, objectUrls: chunk, depth: '1', ...fetchOptions });
            signal?.throwIfAborted();
            for (const response of result ?? []) {
                const object = toObject(response, calendarUrl);
                if ((object.data ?? '') !== '')
                    out.push(object);
            }
        }
        catch (error) {
            signal?.throwIfAborted();
            // 整批失败（很可能是服务器漏了某个 href）：逐条重试，把损失限制在那一条。
            for (const href of chunk)
                await one(href);
        }
    }
    // 查到了 href 却一条数据都没取到：必须报错，不能静默导出一个空文件。
    if (mapped.length > 0 && out.length === 0) {
        throw new Error('服务器未返回任何日程内容（calendar-data），导出已中止，以免生成空文件。');
    }
    return out;
}
/**
 * tsdav 2.5 起对「服务器漏一个 href 或 calendar-data」不再返回残缺数组，而是整批抛错。
 * 这几类错误只说明响应不完整，不代表认证失败或服务不可用，可以退化到自解析的 query。
 */
function isIncompleteDavResponse(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /incomplete response|missing calendarData|expected a DAV multistatus response/.test(message);
}
export async function fetchObjectsPreferringQuery(fetchObjects, signal) {
    signal?.throwIfAborted();
    try {
        const single = await fetchObjects(false);
        signal?.throwIfAborted();
        if (single.some((object) => String(object.data ?? '') !== ''))
            return single;
    }
    catch (error) {
        signal?.throwIfAborted();
        // 服务器不支持在 query 里带 calendar-data：落到下面的多取路径。
    }
    const multi = await fetchObjects(true);
    signal?.throwIfAborted();
    return multi;
}
/** CalDAV 操作错误：带中文指引。 */
export class CalDAVError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.name = 'CalDAVError';
        this.status = status;
    }
}
function ensureTrailingSlash(value) {
    return value.endsWith('/') ? value : value + '/';
}
function normalizeUrl(value) {
    const trimmed = value.trim();
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
function authenticationError(config, status) {
    const guidance = config.oauth !== undefined
        ? '请检查 OAuth 授权范围、日历访问权限及 refreshToken；授权失效时请重新授权。Google CalDAV 不接受应用专用密码。'
        : '请检查 username 与 password / DSH_CALENDAR_PASSWORD；iCloud 必须使用应用专用密码，其他服务请确认账号权限。Google CalDAV 需改用 OAuth 2.0。';
    return new CalDAVError('账号认证失败（' + status + '）：' + guidance, status);
}
/** 把底层错误翻译成与当前认证方式匹配的指引。 */
function translateError(error, action, config) {
    if (error instanceof CalDAVError)
        return error;
    // 展开超限是可操作的明确提示，不能被下面的 OAuth 通用文案覆盖。
    if (error instanceof ExpansionLimitError)
        return new CalDAVError(error.message);
    if (error instanceof OAuthError)
        return new CalDAVError(error.message, error.status);
    const message = error instanceof Error ? error.message : String(error);
    const status = error?.status;
    if (status === 401 || status === 403 || /401|403/.test(message)) {
        return authenticationError(config, status ?? (/401/.test(message) ? 401 : 403));
    }
    if (config.oauth !== undefined) {
        return new CalDAVError(action + ' 失败：CalDAV 响应或网络请求异常，请检查日历地址与服务权限。', status);
    }
    return new CalDAVError(action + ' 失败：' + message, status);
}
/** 对单个日历集合的封装。 */
export class CalendarService {
    config;
    /** 数据源标识；与本地后端共用 CalendarBackend 接口时用于区分（见 backend.ts）。 */
    kind = 'caldav';
    collectionUrl;
    clientPromise;
    constructor(config) {
        this.config = config;
        this.collectionUrl = ensureTrailingSlash(config.caldavUrl);
    }
    client() {
        if (this.clientPromise === undefined) {
            const transport = this.config.proxyUrl !== '' ? createProxyFetch(this.config.proxyUrl) : globalThis.fetch;
            const oauth = this.config.oauth;
            this.clientPromise = loadTsdav().then(({ createDAVClient }) => createDAVClient({
                serverUrl: this.config.caldavUrl,
                credentials: oauth === undefined ? { username: this.config.username, password: this.config.password } : {},
                // createDAVClient 的 Oauth 分支只在初始化时取头；改由 fetch 在每次请求时检查过期。
                authMethod: oauth === undefined ? 'Basic' : 'Custom',
                ...(oauth === undefined ? {} : { authFunction: async () => ({}) }),
                fetch: oauth === undefined ? transport : createOAuthFetch(oauth, transport, this.config.caldavUrl),
            }));
        }
        // 创建失败时清掉缓存，让下一次工具调用有机会重试，而不是永久复用 rejected promise。
        return this.clientPromise.catch((error) => {
            this.clientPromise = undefined;
            throw error;
        });
    }
    calendar() {
        return { url: this.collectionUrl };
    }
    /**
     * 读一批对象：正常走 tsdav；遇到「响应不完整」时退化到自解析的 calendar-query，
     * 不让一条坏数据毁掉整批。退化路径拿到的是全量对象，带窗口时在本地按重叠过滤。
     */
    async readObjects(timeRange, signal) {
        const client = await this.client();
        signal?.throwIfAborted();
        try {
            return await client.fetchCalendarObjects({
                calendar: this.calendar(),
                ...(timeRange !== undefined ? { timeRange } : {}),
                urlFilter: (url) => typeof url === 'string' && url.length > 0,
                ...(signal !== undefined ? { fetchOptions: { signal } } : {}),
            });
        }
        catch (error) {
            signal?.throwIfAborted();
            if (!isIncompleteDavResponse(error))
                throw error;
            const objects = await this.fetchAllObjects(signal);
            if (timeRange === undefined)
                return objects;
            const from = Date.parse(timeRange.start), to = Date.parse(timeRange.end);
            return objects.filter((object) => {
                const data = String(object.data ?? '');
                // 重复系列的主记录可能早于窗口，但实例会落进来，保留给下游展开判断。
                if (isRecurringResource(data))
                    return true;
                const event = parseEventFromICal(data, object.url, object.etag);
                if (event === null)
                    return false;
                const start = Date.parse(event.start), end = Date.parse(event.end ?? event.start);
                if (Number.isNaN(start))
                    return false;
                return start < to && (Number.isNaN(end) ? start > from : end > from);
            });
        }
    }
    /** 列出某时间段内的事件；expand 为 true 时在窗口内展开 RRULE。 */
    async list(startIso, endIso, options, signal) {
        const expand = options?.expand !== false;
        const maxOccurrences = options?.maxOccurrences ?? 30;
        signal?.throwIfAborted();
        try {
            const objects = await this.readObjects({ start: startIso, end: endIso }, signal);
            signal?.throwIfAborted();
            return expand
                ? this.toExpandedEvents(objects, startIso, endIso, maxOccurrences, options?.onTruncated)
                : this.toEvents(objects);
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '读取日历', this.config);
        }
    }
    /** 列出全部（或 timeRange 窗口内）事件，供客户端过滤用。 */
    async all(signal, timeRange) {
        signal?.throwIfAborted();
        try {
            const objects = await this.readObjects(timeRange, signal);
            signal?.throwIfAborted();
            return this.toEvents(objects);
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '读取日历', this.config);
        }
    }
    toEvents(objects) {
        const events = [];
        for (const object of objects) {
            const event = parseEventFromICal(String(object.data ?? ''), object.url, object.etag);
            if (event !== null)
                events.push(event);
        }
        return events;
    }
    /** A complete read of the connected collection; never writes or reserves events. */
    async availability(input, signal) {
        const request = availabilityRequest(input), deadline = Date.now() + 20000, cancel = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
        cancel.throwIfAborted();
        const start = new Date(request.startMs - 2 * 86400000).toISOString(), end = new Date(request.endMs + 2 * 86400000).toISOString();
        try {
            const objects = await this.readObjects({ start, end }, cancel);
            cancel.throwIfAborted();
            if (objects.length > 1000)
                throw new Error('日历资源超过 1000 条，请缩小空闲查询范围');
            const events = [];
            let bytes = 0;
            for (const object of objects) {
                cancel.throwIfAborted();
                const data = String(object.data ?? '');
                bytes += Buffer.byteLength(data);
                if (bytes > 8 * 1024 * 1024)
                    throw new Error('日历资源总量超过 8 MiB，请缩小空闲查询范围');
                if (Date.now() > deadline)
                    throw new Error('空闲查询超时，请缩小范围');
                events.push(...busyResource(data, object.url, start, end, request.timeZone, deadline));
                if (events.length > 10000)
                    throw new Error('日程实例超过 10000 条，请缩小空闲查询范围');
            }
            cancel.throwIfAborted();
            const result = findAvailableTimes(events, input);
            if (Date.now() > deadline)
                throw new Error('空闲查询超时，请缩小范围');
            return result;
        }
        catch (error) {
            cancel.throwIfAborted();
            throw translateError(error, '查询空闲时段', this.config);
        }
    }
    /** 列出并展开：每个对象经 expandEventFromICal 展开为若干实例行。 */
    toExpandedEvents(objects, startIso, endIso, maxOccurrences, onTruncated) {
        const events = [];
        let truncated = false;
        for (const object of objects) {
            events.push(...expandEventFromICal(String(object.data ?? ''), object.url, object.etag, startIso, endIso, maxOccurrences, { onTruncated: (value) => { if (value)
                    truncated = true; } }));
        }
        onTruncated?.(truncated);
        return events;
    }
    /** 按 uid（href）找到服务器对象（含 etag 与原始 data）。 */
    async findObject(uid, signal) {
        signal?.throwIfAborted();
        // 直接 multiget 已知 href；先限制到当前集合，不能把任意 URL 当作事件。
        let target;
        try {
            const collection = new URL(this.collectionUrl);
            const object = new URL(uid.trim());
            const relativePath = object.pathname.slice(collection.pathname.length);
            const decodedPath = decodeURIComponent(relativePath);
            if (object.origin !== collection.origin || object.username || object.password || object.hash
                || !object.pathname.startsWith(collection.pathname) || !relativePath
                || decodedPath.split(/[\\/]/).some(segment => segment === '.' || segment === '..')
                || /%2f|%5c/i.test(relativePath))
                throw new Error('invalid href');
            target = normalizeUrl(object.href);
        }
        catch {
            throw new CalDAVError('uid 必须是当前日历中的事件地址：请用 calendar_list 或 calendar_search 重新获取。');
        }
        const client = await this.client();
        signal?.throwIfAborted();
        let objects;
        try {
            objects = await client.fetchCalendarObjects({
                calendar: this.calendar(),
                objectUrls: [target],
                urlFilter: (url) => normalizeUrl(url) === target,
                ...(signal !== undefined ? { fetchOptions: { signal } } : {}),
            });
        }
        catch (error) {
            signal?.throwIfAborted();
            // 单个 href 取不到（404 / 服务器漏数据 / 新版 tsdav 的严格断言）等价于「没这个事件」，
            // 由调用方给出稳定的「找不到 uid」提示，绝不继续 PUT / DELETE。
            if (isIncompleteDavResponse(error))
                return undefined;
            throw error;
        }
        signal?.throwIfAborted();
        // 207 中单个 href 的 404 也可能被 tsdav 转成无 data 的对象，不能据此 PUT/DELETE。
        return objects.find((object) => normalizeUrl(object.url) === target
            && typeof object.data === 'string' && object.data.trim() !== '');
    }
    /** 新建事件，返回带 href/uid 的事件。 */
    async create(fields, signal) {
        signal?.throwIfAborted();
        const icalUid = fields.icalUid ?? generateUid();
        const iCalString = buildICalString({ ...fields, icalUid });
        const filename = 'event-' + createHash('sha256').update(icalUid).digest('hex') + '.ics';
        // 本地 filename 只是 PUT 目标，服务器可以按自己的规则分配 href；先按本地猜测兜底。
        let href = new URL(filename, this.collectionUrl).href;
        try {
            const client = await this.client();
            signal?.throwIfAborted();
            const response = await client.createCalendarObject({
                calendar: this.calendar(),
                iCalString,
                filename,
                ...(signal !== undefined ? { fetchOptions: { signal } } : {}),
            });
            signal?.throwIfAborted();
            assertOk(response, '新建事件', this.config);
            href = await this.resolveCreatedHref(response, filename, signal);
        }
        catch (error) {
            signal?.throwIfAborted();
            if (error instanceof CalDAVError)
                throw error;
            throw translateError(error, '新建事件', this.config);
        }
        const event = parseEventFromICal(iCalString, href);
        if (event === null)
            throw new CalDAVError('新建事件失败：生成的 iCal 无法解析');
        return event;
    }
    /** 解析 PUT 响应的 Location；取不到时回读一次确认，避免把本地猜测的 href 当成 uid。 */
    async resolveCreatedHref(response, filename, signal) {
        const location = response.headers.get('location')?.trim();
        if (location !== undefined && location !== '') {
            try {
                return new URL(location, this.collectionUrl).href;
            }
            catch {
                // Location 不是合法 URL 时退回回读确认。
            }
        }
        const guessed = new URL(filename, this.collectionUrl).href;
        const confirmed = await this.findObject(guessed, signal);
        return confirmed === undefined ? guessed : confirmed.url;
    }
    /** Complete UID inventory before import, including recurrence overrides outside the visible date window. */
    async importSnapshot(signal) {
        signal?.throwIfAborted();
        try {
            const objects = await this.fetchAllObjects(signal);
            signal?.throwIfAborted();
            if (objects.length > 5000)
                throw new CalDAVError('当前日历超过 5000 个对象，无法完整检查重复；请使用较小的目标日历');
            const uids = new Set();
            let bytes = 0;
            for (const object of objects) {
                const data = String(object.data ?? '');
                bytes += Buffer.byteLength(data);
                if (bytes > 16 * 1024 * 1024)
                    throw new CalDAVError('当前日历数据超过 16 MiB，无法完整检查重复');
                let calendar;
                try {
                    calendar = new ICAL.Component(ICAL.parse(data));
                }
                catch {
                    throw new CalDAVError('服务器包含无法读取的日程，重复检查未完成；请先检查目标日历');
                }
                for (const event of calendar.getAllSubcomponents('vevent')) {
                    const uid = String(event.getFirstPropertyValue('uid') ?? '');
                    if (uid)
                        uids.add(uid);
                }
            }
            return { uids, events: this.toEvents(objects) };
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '检查日历重复项', this.config);
        }
    }
    /** Insert one already reviewed UID resource; tsdav uses If-None-Match:* and never overwrites existing objects. */
    async importRaw(uid, data, signal) {
        signal?.throwIfAborted();
        const calendar = new ICAL.Component(ICAL.parse(data));
        const events = calendar.getAllSubcomponents('vevent');
        if (!uid || !events.length || events.some(event => event.getFirstPropertyValue('uid') !== uid))
            throw new CalDAVError('导入资源必须只包含同一 UID 的日程系列');
        const filename = 'import-' + createHash('sha256').update(uid).digest('hex') + '.ics';
        try {
            const client = await this.client();
            signal?.throwIfAborted();
            const response = await client.createCalendarObject({ calendar: this.calendar(), filename, iCalString: data, ...(signal ? { fetchOptions: { signal } } : {}) });
            signal?.throwIfAborted();
            assertOk(response, '导入日程', this.config);
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '导入日程', this.config);
        }
    }
    /**
     * 全量抓取对象（数据 + etag）。
     *
     * 默认路径是「先 query 拿 href，再 multiget 取数据」；部分服务器（iCloud / Google）
     * 的 multiget 会漏掉某些 href，tsdav 校验后直接抛 `incomplete response` —— 导出就挂在这。
     * 所以先试「一次 calendar-query 直接要 calendar-data」（useMultiGet:false），
     * 一条数据都没拿到再退回默认多取。两条路都失败才算真失败。
     */
    async fetchAllObjects(signal) {
        signal?.throwIfAborted();
        const client = await this.client();
        signal?.throwIfAborted();
        const url = this.collectionUrl;
        try {
            const objects = await collectCalendarObjects(client, url, signal);
            signal?.throwIfAborted();
            return objects.map((object) => ({ url: object.url, ...(object.etag !== undefined ? { etag: object.etag } : {}), data: object.data }));
        }
        catch (error) {
            signal?.throwIfAborted();
            // 连 query 本身都发不出去（少数服务器要求特殊 REPORT）：保留旧路径作为最后兜底。
            return await fetchObjectsPreferringQuery((useMultiGet) => client.fetchCalendarObjects({
                calendar: this.calendar(),
                urlFilter: (href) => typeof href === 'string' && href.length > 0,
                useMultiGet,
                ...(signal !== undefined ? { fetchOptions: { signal } } : {}),
            }), signal);
        }
    }
    /**
     * 全部资源的原文（导出用）。
     * 一次 fetchCalendarObjects 就把 data 全带回来了，不需要再逐条 raw —— 那会变成 N+1 请求。
     */
    async rawAll(signal) {
        signal?.throwIfAborted();
        try {
            const objects = await this.fetchAllObjects(signal);
            const out = [];
            for (const object of objects) {
                const data = String(object.data ?? '');
                if (data !== '')
                    out.push(data);
            }
            return out;
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '读取日历原文', this.config);
        }
    }
    /** 原始 iCalendar 文本（迁移用）：直接返回服务器对象内容，不经过解析再拼装。 */
    async raw(uid, signal) {
        signal?.throwIfAborted();
        try {
            const object = await this.findObject(uid, signal);
            if (object === undefined)
                throw new CalDAVError('找不到要迁移的日程，请刷新日历后重试。');
            const data = String(object.data ?? '');
            if (data === '')
                throw new CalDAVError('该日程内容为空，无法迁移。');
            return data;
        }
        catch (error) {
            signal?.throwIfAborted();
            if (error instanceof CalDAVError)
                throw error;
            throw translateError(error, '读取日程原文', this.config);
        }
    }
    /** Read the resource master rather than a projected occurrence. */
    async get(uid, signal) {
        try {
            const object = await this.findObject(uid, signal);
            const event = object && parseEventFromICal(String(object.data ?? ''), object.url, object.etag);
            if (!event)
                throw new CalDAVError('找不到或无法解析日程，请刷新日历后重试。');
            return event;
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '读取系列事件', this.config);
        }
    }
    /** 按 uid 更新事件；未提供的字段保留原值。 */
    async update(uid, changes, signal, scope) {
        signal?.throwIfAborted();
        let object;
        try {
            object = await this.findObject(uid, signal);
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '查找事件', this.config);
        }
        if (object === undefined) {
            throw new CalDAVError('找不到 uid 对应的事件：请用 calendar_list 或 calendar_search 重新获取最新 uid，' +
                '该事件可能已被删除或 uid 已过期。');
        }
        const existing = parseEventFromICal(String(object.data ?? ''), object.url, object.etag);
        if (!existing)
            throw new CalDAVError('无法解析原日程，更新已取消；请在原日历客户端检查。');
        if (isRecurringResource(String(object.data ?? '')) && scope !== 'series')
            throw new CalDAVError('这是整个重复系列。请先向用户说明影响，确认后显式传 scope="series"；当前不支持只改某一次。');
        const start = changes.start ?? existing?.start;
        const end = changes.end ?? existing?.end;
        if (start === undefined || end === undefined) {
            throw new CalDAVError('无法确定事件的开始/结束时间：请同时提供 start 与 end。');
        }
        const startMs = new Date(start).getTime();
        const endMs = new Date(end).getTime();
        if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
            throw new CalDAVError('更新时间范围无效：end 不能早于 start（' + end + ' < ' + start + '）。');
        }
        const merged = {
            summary: changes.summary ?? existing?.summary ?? '',
            start,
            end,
            ...(changes.description !== undefined ? { description: changes.description } : existing?.description !== undefined ? { description: existing.description } : {}),
            ...(changes.location !== undefined ? { location: changes.location } : existing?.location !== undefined ? { location: existing.location } : {}),
            allDay: changes.allDay ?? existing?.allDay,
            ...(changes.rrule !== undefined ? { rrule: changes.rrule } : existing?.rrule !== undefined ? { rrule: existing.rrule } : {}),
            ...(existing?.icalUid !== undefined ? { icalUid: existing.icalUid } : {}),
        };
        // 字段级覆盖：保留原 VCALENDAR/VEVENT 的 ATTENDEE、VALARM 等属性，只改显式给出的字段。
        // 原 calendar-data 无法解析时回退到整条重建，保持旧的可用行为。
        const iCalString = updateICalString(String(object.data ?? ''), changes) ?? buildICalString(merged);
        try {
            const client = await this.client();
            signal?.throwIfAborted();
            const response = await client.updateCalendarObject({
                calendarObject: { url: object.url, etag: object.etag, data: iCalString },
                ...(signal !== undefined ? { fetchOptions: { signal } } : {}),
            });
            signal?.throwIfAborted();
            assertOk(response, '更新事件', this.config);
        }
        catch (error) {
            signal?.throwIfAborted();
            if (error instanceof CalDAVError)
                throw error;
            throw translateError(error, '更新事件', this.config);
        }
        const event = parseEventFromICal(iCalString, object.url, object.etag);
        if (event === null)
            throw new CalDAVError('更新事件失败：生成的 iCal 无法解析');
        return event;
    }
    /** 按 uid 删除事件。 */
    async delete(uid, signal, scope) {
        signal?.throwIfAborted();
        let object;
        try {
            object = await this.findObject(uid, signal);
        }
        catch (error) {
            signal?.throwIfAborted();
            throw translateError(error, '查找事件', this.config);
        }
        if (object === undefined) {
            throw new CalDAVError('找不到 uid 对应的事件：请用 calendar_list 或 calendar_search 重新获取最新 uid，' +
                '该事件可能已被删除或 uid 已过期。');
        }
        if (isRecurringResource(String(object.data ?? '')) && scope !== 'series')
            throw new CalDAVError('这是整个重复系列。请先向用户说明影响，确认后显式传 scope="series"；当前不支持只删某一次。');
        try {
            const client = await this.client();
            signal?.throwIfAborted();
            const response = await client.deleteCalendarObject({
                calendarObject: { url: object.url, etag: object.etag },
                ...(signal !== undefined ? { fetchOptions: { signal } } : {}),
            });
            signal?.throwIfAborted();
            assertOk(response, '删除事件', this.config);
        }
        catch (error) {
            signal?.throwIfAborted();
            if (error instanceof CalDAVError)
                throw error;
            throw translateError(error, '删除事件', this.config);
        }
        return { uid: object.url, href: object.url };
    }
}
/** 校验 HTTP 响应，把 401/403 与其它非 2xx 转成中文错误。 */
function assertOk(response, action, config) {
    if (response.status === 401 || response.status === 403) {
        throw authenticationError(config, response.status);
    }
    if (!response.ok) {
        throw new CalDAVError(action + ' 失败：服务器返回 ' + response.status +
            (config.oauth === undefined ? ' ' + response.statusText : ''), response.status);
    }
}
