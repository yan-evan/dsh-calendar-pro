/**
 * iCloud 日历集合发现（RFC 4791 的 well-known + PROPFIND）。
 *
 * Apple 没有公开的 iCloud 日历 CalDAV 设置页，集合 URL 里的账号数字 ID 与日历 ID
 * 只能按协议问出来：
 *   1) PROPFIND /.well-known/caldav (Depth 0) → current-user-principal，拿到分区数字 ID；
 *   2) PROPFIND /<ID>/calendars/ (Depth 1) → 每本日历的 href 与 displayname。
 *
 * 安全：账号与 App 专用密码只用于本次 Basic 认证，不写盘、不进日志、不回显。
 */
import { createProxyFetch } from './proxy-fetch.js';
const BASE = 'https://caldav.icloud.com';
const PRINCIPAL_BODY = '<?xml version="1.0" encoding="utf-8"?>' +
    '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const CALENDARS_BODY = '<?xml version="1.0" encoding="utf-8"?>' +
    '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>';
/** 提取任意命名空间前缀下的 <href>（iCloud 用 D:，其它服务可能不带前缀）。 */
function hrefsOf(xml) {
    return [...xml.matchAll(/<(?:\w+:)?href[^>]*>([^<]*)<\/(?:\w+:)?href>/gi)]
        .map((match) => match[1].trim())
        .filter((value) => value !== '');
}
async function propfind(url, body, depth, options, auth) {
    const fetchImpl = options.fetchImpl ??
        (options.proxyUrl !== undefined ? createProxyFetch(options.proxyUrl) : globalThis.fetch);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
    let response;
    try {
        response = await fetchImpl(url, {
            method: 'PROPFIND',
            headers: {
                Authorization: auth,
                Depth: depth,
                'Content-Type': 'application/xml; charset=utf-8',
            },
            body,
            signal: controller.signal,
        });
    }
    catch {
        throw new Error('连不上 caldav.icloud.com：检查网络，或在「代理地址」里填代理后重试');
    }
    finally {
        clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
        throw new Error('认证失败：请确认账号是 Apple ID 邮箱、密码是 App 专用密码（不是登录密码）');
    }
    if (!response.ok)
        throw new Error('iCloud 返回 ' + response.status + '，请稍后重试');
    const text = await response.text();
    if (text.length > 2_000_000)
        throw new Error('iCloud 应答过大，已中止');
    return text;
}
/** 返回可选日历列表；凭据不落盘，调用方负责把选中的 url 填进连接表单。 */
export async function discoverIcloudCalendars(options) {
    const username = options.username.trim();
    const password = options.password.trim();
    if (username === '' || password === '')
        throw new Error('先填 Apple ID 邮箱和 App 专用密码');
    const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const principalXml = await propfind(BASE + '/.well-known/caldav', PRINCIPAL_BODY, '0', options, auth);
    const principal = hrefsOf(principalXml).find((href) => /\/\d+\/principal\/?/.test(href));
    if (principal === undefined)
        throw new Error('没读到 iCloud 账号 ID，请确认账号与专用密码');
    const accountId = /\/(\d+)\//.exec(principal)?.[1];
    if (accountId === undefined)
        throw new Error('iCloud 应答里没有账号数字 ID');
    const listXml = await propfind(`${BASE}/${accountId}/calendars/`, CALENDARS_BODY, '1', options, auth);
    const found = [];
    for (const block of listXml.split(/<(?:\w+:)?response\b[^>]*>/i).slice(1)) {
        const href = hrefsOf(block)[0];
        if (href === undefined)
            continue;
        // 只要 resourcetype 里带 calendar 的集合，排除收件箱、通知、outbox 等伪集合。
        if (!/<(?:\w+:)?calendar\b/i.test(block))
            continue;
        if (/\/(inbox|outbox|notification|freebusy)\/?$/i.test(href))
            continue;
        const name = /<(?:\w+:)?displayname[^>]*>([\s\S]*?)<\/(?:\w+:)?displayname>/i.exec(block)?.[1]?.trim();
        let url;
        try {
            url = new URL(href, BASE).href;
        }
        catch {
            continue;
        }
        if (!url.endsWith('/'))
            url += '/';
        found.push({ name: name !== undefined && name !== '' ? name : '未命名日历', url });
    }
    if (found.length === 0)
        throw new Error('没发现可用的日历集合');
    const seen = new Set();
    return found.filter((item) => {
        if (seen.has(item.url))
            return false;
        seen.add(item.url);
        return true;
    });
}
