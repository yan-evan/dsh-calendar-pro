/**
 * 邮件日程识别的公共词汇：邮箱配置与服务商预设、候选日程、状态机与去重键。
 *
 * 纯类型与纯函数，不做 IO、不连 IMAP，测试可离线跑。
 * 界面文案在客户端，这里只做校验与规范化。
 * @module dsh-calendar-pro/mail/types
 */
import { createHash } from 'node:crypto';
export const MAIL_PROVIDERS = ['qq', '163', 'gmail', 'outlook', 'icloud', 'custom'];
export const MAIL_PRESETS = {
    qq: { label: 'QQ 邮箱', imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true },
    '163': { label: '网易 163 邮箱', imapHost: 'imap.163.com', imapPort: 993, imapSecure: true },
    gmail: { label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true },
    outlook: { label: 'Outlook', imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true },
    icloud: { label: 'iCloud 邮箱', imapHost: 'imap.mail.me.com', imapPort: 993, imapSecure: true },
};
/** 首次回扫可选的天数；收窄到这四档，避免用户填出一个「扫 365 天」的账单。 */
export const MAIL_ANALYZE_DAYS = [1, 3, 7, 30];
/** 单次回扫最多读多少封，防止一次把几年邮件全拉给模型。 */
export const MAIL_SCAN_LIMIT = 50;
/** 增量轮询单次最多处理多少封新邮件。 */
export const MAIL_POLL_LIMIT = 10;
/** 正文送进模型前的截断长度（字符）。 */
export const MAIL_BODY_LIMIT = 4000;
/** 候选条目在库里的最大数量；超出按「最旧的非 pending」先淘汰。 */
export const MAIL_CANDIDATE_LIMIT = 500;
/** 已处理（created / ignored）条目保留天数。 */
export const MAIL_KEEP_DAYS = 90;
export const DEFAULT_MAIL_CONFIG = {
    enabled: true,
    provider: 'qq',
    user: '',
    password: '',
    imapHost: MAIL_PRESETS.qq.imapHost,
    imapPort: MAIL_PRESETS.qq.imapPort,
    imapSecure: MAIL_PRESETS.qq.imapSecure,
    inboxFolder: 'INBOX',
    analyzeDays: 7,
    pollSeconds: 60,
    useLlm: true,
};
const PROVIDER_SET = new Set(MAIL_PROVIDERS);
/** 字符串清洗：去首尾空白，删掉换行与控制字符（配置会被带进协议命令，绝不能带 CRLF）。 */
export function cleanText(value, max = 200) {
    if (typeof value !== 'string')
        return '';
    return value.replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
export function isMailProvider(value) {
    return typeof value === 'string' && PROVIDER_SET.has(value);
}
export function isAnalyzeDays(value) {
    return typeof value === 'number' && MAIL_ANALYZE_DAYS.includes(value);
}
/** 端口收窄到 1–65535；非法回默认。 */
export function normalizePort(value, fallback) {
    const port = typeof value === 'number' ? Math.trunc(value) : Number.NaN;
    return Number.isFinite(port) && port >= 1 && port <= 65535 ? port : fallback;
}
/** 轮询间隔收窄到 30–3600 秒。 */
export function normalizePollSeconds(value, fallback = 60) {
    const seconds = typeof value === 'number' ? Math.trunc(value) : Number.NaN;
    if (!Number.isFinite(seconds))
        return fallback;
    return Math.min(3600, Math.max(30, seconds));
}
/**
 * 任意输入 → 形状正确的配置。
 * 只做规范化不抛错：本地文件可能被手改坏，单个坏字段不该让模块起不来。
 * 能否连通由 testConnection 判断。
 */
export function normalizeMailConfig(raw) {
    const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const provider = isMailProvider(source.provider) ? source.provider : DEFAULT_MAIL_CONFIG.provider;
    const preset = provider === 'custom' ? undefined : MAIL_PRESETS[provider];
    const host = cleanText(source.imapHost, 200) || preset?.imapHost || '';
    const port = normalizePort(source.imapPort, preset?.imapPort ?? 993);
    const secure = typeof source.imapSecure === 'boolean' ? source.imapSecure : (preset?.imapSecure ?? true);
    const analyzedAt = typeof source.analyzedAt === 'string' && source.analyzedAt !== '' ? source.analyzedAt : undefined;
    return {
        enabled: source.enabled !== false,
        provider,
        user: cleanText(source.user, 320),
        password: typeof source.password === 'string' ? source.password.slice(0, 512) : '',
        imapHost: host,
        imapPort: port,
        imapSecure: secure,
        inboxFolder: cleanText(source.inboxFolder, 200) || 'INBOX',
        analyzeDays: isAnalyzeDays(source.analyzeDays) ? source.analyzeDays : DEFAULT_MAIL_CONFIG.analyzeDays,
        pollSeconds: normalizePollSeconds(source.pollSeconds, DEFAULT_MAIL_CONFIG.pollSeconds),
        useLlm: source.useLlm !== false,
        ...(analyzedAt !== undefined ? { analyzedAt } : {}),
    };
}
/**
 * 草稿叠加到已存配置：缺席或空串保留原值，null 清空可清空字段。
 * 密码空串表示不修改——用户看不到已存授权码，不能被一次保存擦掉。
 */
export function applyMailDraft(base, draft) {
    const next = { ...base };
    if (typeof draft.enabled === 'boolean')
        next.enabled = draft.enabled;
    if (draft.provider !== undefined && isMailProvider(draft.provider))
        next.provider = draft.provider;
    if (typeof draft.user === 'string' && draft.user !== '')
        next.user = cleanText(draft.user, 320);
    if (typeof draft.password === 'string' && draft.password !== '')
        next.password = draft.password.slice(0, 512);
    if (typeof draft.imapHost === 'string' && draft.imapHost !== '')
        next.imapHost = cleanText(draft.imapHost, 200);
    if (draft.imapPort !== undefined)
        next.imapPort = normalizePort(draft.imapPort, next.imapPort);
    if (typeof draft.imapSecure === 'boolean')
        next.imapSecure = draft.imapSecure;
    if (typeof draft.inboxFolder === 'string' && draft.inboxFolder !== '')
        next.inboxFolder = cleanText(draft.inboxFolder, 200);
    if (isAnalyzeDays(draft.analyzeDays))
        next.analyzeDays = draft.analyzeDays;
    if (draft.pollSeconds !== undefined)
        next.pollSeconds = normalizePollSeconds(draft.pollSeconds, next.pollSeconds);
    if (typeof draft.useLlm === 'boolean')
        next.useLlm = draft.useLlm;
    // 服务商换了但主机没改：跟预设走，别把上次的 host 留在新 provider 上。
    if (draft.provider !== undefined && isMailProvider(draft.provider) && draft.provider !== 'custom'
        && (draft.imapHost === undefined || draft.imapHost === '') && draft.imapPort === undefined) {
        const preset = MAIL_PRESETS[draft.provider];
        next.imapHost = preset.imapHost;
        next.imapPort = preset.imapPort;
        next.imapSecure = preset.imapSecure;
    }
    return next;
}
/** 能不能连：账号、密码、主机三者齐了才算配置完成。 */
export function mailConfigured(config) {
    return config.user !== '' && config.password !== '' && config.imapHost !== '';
}
/** 面向浏览器的配置视图：密码只回「有没有」，其余照实。 */
export function mailConfigView(config) {
    return {
        enabled: config.enabled,
        provider: config.provider,
        user: config.user,
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        imapSecure: config.imapSecure,
        inboxFolder: config.inboxFolder,
        analyzeDays: config.analyzeDays,
        pollSeconds: config.pollSeconds,
        useLlm: config.useLlm,
        hasPassword: config.password !== '',
        analyzedAt: config.analyzedAt ?? null,
    };
}
export function countCandidates(items) {
    const counts = { pending: 0, new: 0, created: 0, ignored: 0, failed: 0 };
    for (const item of items) {
        counts[item.state] += 1;
        if (item.isNew && item.state === 'pending')
            counts.new += 1;
    }
    return counts;
}
/** 去重键。序号让「一封邮件里的第 N 条日程」各自稳定，重扫也不会重复入库。 */
export function candidateIdOf(input) {
    return createHash('sha256')
        .update(JSON.stringify(['mail-schedule', input.account, input.folder, input.uidValidity, input.uid, input.index]))
        .digest('hex');
}
/** 邮件本身的稳定键：用于「忽略整封邮件」和轮询游标。 */
export function mailKeyOf(account, folder, uidValidity, uid) {
    return createHash('sha256').update(JSON.stringify(['mail-message', account, folder, uidValidity, uid])).digest('hex');
}
/** 时间是否可用：全天 YYYY-MM-DD，或带时区偏移 / Z 的 ISO。抽出来的空值一律丢弃。 */
export function isUsableTime(value) {
    if (typeof value !== 'string' || value === '')
        return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return Date.parse(value + 'T00:00:00Z') !== Number.NaN;
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|(?:[+-]\d{2}:\d{2}))$/.test(value)
        && Number.isFinite(Date.parse(value));
}
