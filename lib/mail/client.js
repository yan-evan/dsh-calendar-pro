/**
 * 只读 IMAP 访问层：把收件箱最近 N 天或某个 UID 之后的邮件取成结构化对象
 * （信封字段 + 纯文本正文 + .ics 附件）。不发信，不改邮件状态。
 *
 * 不把邮件标为已读：取正文用 `source: true`（imapflow 走 BODY.PEEK[]），
 * 邮箱以 readOnly 打开。IMAP 连接按操作建立、用完即断，避免被服务端限流。
 * 错误文案指向账号密码、主机地址、服务端未开 IMAP 三种常见原因。
 * @module dsh-calendar-pro/mail/client
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { MAIL_BODY_LIMIT, mailConfigured, } from './types.js';
/** 单封邮件原始大小上限：超过就跳过并记录原因，不把 20 MB 附件拉下来。 */
export const MAIL_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
/** .ics 附件大小上限，与日历导入的 256 KiB 对齐。 */
export const MAIL_MAX_ICS_BYTES = 256 * 1024;
/** 面向用户的连接错误：把底层错误归并成三类可操作的原因。 */
export function friendlyMailError(error, password = '') {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const text = redactSecrets(raw, password);
    if (/Authentication|AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|auth failed/i.test(text)) {
        return '登录被拒绝：请确认邮箱地址与授权码正确，且邮箱设置里已开启 IMAP 服务（QQ / 163 需要单独生成授权码）';
    }
    if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(text))
        return '找不到邮件服务器：请检查 IMAP 主机地址是否填写正确';
    if (/ETIMEDOUT|timeout|Timed out/i.test(text))
        return '连接邮件服务器超时：请检查网络、端口与是否需要代理';
    if (/ECONNREFUSED/i.test(text))
        return '邮件服务器拒绝连接：请确认端口（SSL 一般为 993）与服务商是否开放 IMAP';
    if (/certificate|self.signed|SSL|TLS/i.test(text))
        return '邮件服务器的证书校验失败：请确认主机地址与服务商一致，必要时改用 993 端口的 SSL 连接';
    if (/Too many|throttl|rate limit|exceed/i.test(text))
        return '邮件服务器限流：请把轮询间隔调大一些再试';
    return text === '' ? '邮件操作失败' : '邮件操作失败：' + text.slice(0, 160);
}
/** 错误文本里可能带账号信息，回给浏览器前先把授权码抹掉。 */
export function redactSecrets(text, password) {
    if (password !== '' && password.length >= 4)
        return text.split(password).join('***');
    return text;
}
/** RFC5322 里可能出现的时区缩写与数字时区，Date.parse 认不全，这里补一层。 */
export function parseMailDate(value, fallback = new Date()) {
    if (value instanceof Date && Number.isFinite(value.getTime()))
        return value.toISOString();
    if (typeof value !== 'string' || value === '')
        return fallback.toISOString();
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed))
        return new Date(parsed).toISOString();
    return fallback.toISOString();
}
/** 正文摘要：压掉空白与引用行，截到 140 字，够用户认出是哪封邮件。 */
export function snippetOf(text, limit = 140) {
    const lines = text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '' && !line.startsWith('>'));
    return lines.join(' ').replace(/\s+/g, ' ').slice(0, limit);
}
/** 收件箱里被判定为「新到」的邮件最多留这么多 UID，避免一次拉爆。 */
function newest(uids, limit) {
    return [...uids].sort((a, b) => a - b).slice(-Math.max(1, limit));
}
export class MailClient {
    options;
    constructor(options) {
        this.options = options;
    }
    /** 建连接；调用方负责 close。 */
    async connect(config, signal) {
        if (!mailConfigured(config))
            throw new Error('邮件连接还没配置完整：需要邮箱账号、授权码与 IMAP 主机');
        const client = new ImapFlow({
            host: config.imapHost,
            port: config.imapPort,
            secure: config.imapSecure,
            auth: { user: config.user, pass: config.password },
            logger: false,
            emitLogs: false,
            connectionTimeout: this.options.connectionTimeout ?? 20000,
            greetingTimeout: this.options.connectionTimeout ?? 20000,
            socketTimeout: 60000,
        });
        const abort = () => { try {
            client.close();
        }
        catch { /* 已断开 */ } };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            await client.connect();
            return client;
        }
        catch (error) {
            signal?.removeEventListener('abort', abort);
            try {
                client.close();
            }
            catch { /* 连不上就没有可关的连接 */ }
            throw new Error(friendlyMailError(error, config.password));
        }
    }
    /** 用一份草稿配置试连，不落盘、不读信。 */
    async testConnection(draft, signal) {
        const client = await this.connect(draft, signal);
        try {
            const lock = await client.getMailboxLock(draft.inboxFolder, { readOnly: true });
            try {
                const exists = client.mailbox !== false ? client.mailbox.exists : 0;
                return { ok: true, detail: '连接成功：收件箱「' + draft.inboxFolder + '」共 ' + exists + ' 封邮件' };
            }
            finally {
                lock.release();
            }
        }
        catch (error) {
            throw new Error(friendlyMailError(error, draft.password));
        }
        finally {
            await client.logout().catch(() => { });
        }
    }
    /**
     * 列出最近 days 天的信封，UID 从新到旧。
     * 只取信封，正文交给 fetchContents，可按大小先筛掉大邮件。
     */
    async listRecent(days, limit, signal) {
        const config = this.options.config();
        const client = await this.connect(config, signal);
        try {
            const lock = await client.getMailboxLock(config.inboxFolder, { readOnly: true });
            try {
                const uidValidity = Number(client.mailbox !== false ? client.mailbox.uidValidity : 0) || 0;
                const since = new Date(Date.now() - Math.max(1, days) * 86400000);
                const uids = await client.search({ since }, { uid: true });
                if (!Array.isArray(uids) || uids.length === 0)
                    return { uidValidity, messages: [] };
                const wanted = newest(uids, limit);
                const messages = [];
                for await (const message of client.fetch(wanted.join(','), { envelope: true, size: true }, { uid: true })) {
                    const envelope = envelopeOf(message, uidValidity);
                    if (envelope !== null)
                        messages.push(envelope);
                }
                return { uidValidity, messages: messages.sort((a, b) => b.uid - a.uid) };
            }
            finally {
                lock.release();
            }
        }
        finally {
            await client.logout().catch(() => { });
        }
    }
    /**
     * 列出比游标新的邮件。maxUid = 0 时只回 uidValidity 与当前最大 UID（建基线用）。
     * IMAP 的 `N:*` 必然包含最后一封，需再按 maxUid 过滤。
     */
    async listSince(maxUid, limit, signal) {
        const config = this.options.config();
        const client = await this.connect(config, signal);
        try {
            const lock = await client.getMailboxLock(config.inboxFolder, { readOnly: true });
            try {
                const uidValidity = Number(client.mailbox !== false ? client.mailbox.uidValidity : 0) || 0;
                const currentMax = Number(client.mailbox !== false ? (client.mailbox.uidNext ?? 0) - 1 : 0) || 0;
                if (maxUid <= 0)
                    return { uidValidity, messages: [], maxUid: currentMax };
                const found = await client.search({ uid: (maxUid + 1) + ':*' }, { uid: true });
                const fresh = (Array.isArray(found) ? found : []).filter(uid => uid > maxUid);
                if (fresh.length === 0)
                    return { uidValidity, messages: [], maxUid: currentMax };
                const wanted = newest(fresh, limit);
                const messages = [];
                for await (const message of client.fetch(wanted.join(','), { envelope: true, size: true }, { uid: true })) {
                    const envelope = envelopeOf(message, uidValidity);
                    if (envelope !== null)
                        messages.push(envelope);
                }
                return { uidValidity, messages: messages.sort((a, b) => a.uid - b.uid), maxUid: currentMax };
            }
            finally {
                lock.release();
            }
        }
        finally {
            await client.logout().catch(() => { });
        }
    }
    /**
     * 批量取正文。单次操作共用一条连接；单封失败只跳过该封。
     * @returns 内容与失败/跳过原因，按 uid
     */
    async fetchContents(messages, signal) {
        const config = this.options.config();
        const contents = [];
        const failures = [];
        if (messages.length === 0)
            return { contents, failures };
        const client = await this.connect(config, signal);
        try {
            const lock = await client.getMailboxLock(config.inboxFolder, { readOnly: true });
            try {
                for (const envelope of messages) {
                    if (signal?.aborted === true)
                        break;
                    if (envelope.size > MAIL_MAX_SOURCE_BYTES) {
                        failures.push({ uid: envelope.uid, reason: '邮件体积 ' + Math.round(envelope.size / 1024) + ' KiB，超过单封上限，已跳过' });
                        continue;
                    }
                    try {
                        // source: true → imapflow 用 BODY.PEEK[]，不会把邮件标成已读
                        const fetched = await client.fetchOne(String(envelope.uid), { source: true }, { uid: true });
                        if (fetched === false || fetched === undefined || fetched.source === undefined) {
                            failures.push({ uid: envelope.uid, reason: '服务器没有返回该邮件的内容' });
                            continue;
                        }
                        contents.push(await parseSource(envelope, fetched.source));
                    }
                    catch (error) {
                        failures.push({ uid: envelope.uid, reason: friendlyMailError(error, config.password) });
                    }
                }
            }
            finally {
                lock.release();
            }
        }
        finally {
            await client.logout().catch(() => { });
        }
        return { contents, failures };
    }
}
/** fetch 响应 → 信封字段。缺 UID 的响应说明服务器不配合，直接丢。 */
export function envelopeOf(message, uidValidity) {
    const uid = Number(message?.uid);
    if (!Number.isFinite(uid) || uid <= 0)
        return null;
    const envelope = message?.envelope ?? {};
    const from = Array.isArray(envelope.from) && envelope.from.length > 0
        ? String(envelope.from[0]?.name ?? '') !== ''
            ? String(envelope.from[0].name) + ' <' + String(envelope.from[0].address ?? '') + '>'
            : String(envelope.from[0]?.address ?? '')
        : '';
    return {
        uid,
        uidValidity,
        date: parseMailDate(envelope.date ?? (message?.internalDate ?? null)),
        from: from.replace(/\s+/g, ' ').trim().slice(0, 200),
        subject: String(envelope.subject ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240),
        size: Number(message?.size ?? 0) || 0,
    };
}
/** 原始邮件 → 正文与 .ics。解析失败时退化成「没有正文」，仍可能从附件里拿到日程。 */
export async function parseSource(envelope, source) {
    const parsed = await simpleParser(source);
    const text = (parsed.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAIL_BODY_LIMIT);
    const ics = [];
    for (const attachment of parsed.attachments ?? []) {
        const name = String(attachment.filename ?? '').toLowerCase();
        const type = String(attachment.contentType ?? '').toLowerCase();
        if (!name.endsWith('.ics') && !type.includes('text/calendar'))
            continue;
        if (attachment.content === undefined || attachment.content === null)
            continue;
        const buffer = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content);
        if (buffer.length > MAIL_MAX_ICS_BYTES)
            continue;
        const value = buffer.toString('utf8');
        if (value.trim() !== '')
            ics.push(value);
    }
    return {
        ...envelope,
        text,
        ics,
        snippet: snippetOf(parsed.text ?? ''),
        ...(text === '' && ics.length === 0 ? { skipped: '邮件没有可读的正文，也没有 .ics 附件' } : {}),
    };
}
