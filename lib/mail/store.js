/**
 * 邮件日程的落盘层：配置（含授权码）与候选库，都在 `$DSH_HOME/data/dsh-calendar-pro/` 下，
 * 沿用 store.js 的 0600 原子写。
 *
 * 配置与候选分两个文件，各自独立重写。候选库只存展示与建日程需要的字段，不存正文。
 * 状态机在写入时收敛，重扫幂等。
 * @module dsh-calendar-pro/mail/store
 */
import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic, dataDirOf } from '../store.js';
import { DEFAULT_MAIL_CONFIG, MAIL_CANDIDATE_LIMIT, MAIL_KEEP_DAYS, normalizeMailConfig, } from './types.js';
function emptyState() {
    return { schemaVersion: 1, candidates: [], cursors: {}, processed: {} };
}
export function mailConfigFile(env = process.env) {
    return join(dataDirOf(env), 'mail.json');
}
export function mailCandidatesFile(env = process.env) {
    return join(dataDirOf(env), 'mail-candidates.json');
}
/** 读配置：坏文件、缺字段、手改成怪形状都退化成一份可用的默认配置。 */
export function readMailConfig(file = mailConfigFile()) {
    const raw = readJsonFile(file, { schemaVersion: 1, config: DEFAULT_MAIL_CONFIG });
    return normalizeMailConfig(raw?.config);
}
export function writeMailConfig(config, file = mailConfigFile()) {
    writeJsonAtomic(file, { schemaVersion: 1, config });
}
/** 读候选库：逐条清洗，丢弃形状坏掉的条目，不让一条脏数据拖垮整份文件。 */
export function readMailState(file = mailCandidatesFile()) {
    const raw = readJsonFile(file, emptyState());
    const items = [];
    const source = Array.isArray(raw?.candidates) ? raw.candidates : [];
    for (const entry of source) {
        if (entry === null || typeof entry !== 'object')
            continue;
        const item = entry;
        if (typeof item.id !== 'string' || item.id === '')
            continue;
        if (typeof item.summary !== 'string' || typeof item.start !== 'string')
            continue;
        const state = item.state === 'created' || item.state === 'ignored' || item.state === 'failed' ? item.state : 'pending';
        items.push({
            id: item.id,
            account: typeof item.account === 'string' ? item.account : '',
            folder: typeof item.folder === 'string' ? item.folder : 'INBOX',
            uid: typeof item.uid === 'number' ? item.uid : 0,
            uidValidity: typeof item.uidValidity === 'number' ? item.uidValidity : 0,
            summary: item.summary,
            start: item.start,
            end: typeof item.end === 'string' && item.end !== '' ? item.end : item.start,
            allDay: item.allDay === true,
            location: typeof item.location === 'string' ? item.location : '',
            description: typeof item.description === 'string' ? item.description : '',
            confidence: typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? Math.min(1, Math.max(0, item.confidence)) : 0,
            source: item.source === 'ics' ? 'ics' : 'llm',
            state,
            isNew: item.isNew === true && state === 'pending',
            ...(typeof item.calendarUid === 'string' && item.calendarUid !== '' ? { calendarUid: item.calendarUid } : {}),
            ...(typeof item.reason === 'string' && item.reason !== '' ? { reason: item.reason } : {}),
            mail: {
                from: typeof item.mail?.from === 'string' ? item.mail.from : '',
                subject: typeof item.mail?.subject === 'string' ? item.mail.subject : '',
                date: typeof item.mail?.date === 'string' ? item.mail.date : '',
                snippet: typeof item.mail?.snippet === 'string' ? item.mail.snippet : '',
            },
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
            updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        });
    }
    const cursors = {};
    const rawCursors = raw?.cursors !== null && typeof raw?.cursors === 'object' ? raw.cursors : {};
    for (const [key, value] of Object.entries(rawCursors)) {
        if (value === null || typeof value !== 'object')
            continue;
        const cursor = value;
        if (typeof cursor.maxUid !== 'number' || !Number.isFinite(cursor.maxUid))
            continue;
        cursors[key] = { uidValidity: typeof cursor.uidValidity === 'number' ? cursor.uidValidity : 0, maxUid: Math.trunc(cursor.maxUid) };
    }
    const processed = {};
    const rawProcessed = raw?.processed !== null && typeof raw?.processed === 'object' ? raw.processed : {};
    for (const [key, value] of Object.entries(rawProcessed)) {
        if (typeof value === 'number' && Number.isFinite(value))
            processed[key] = value;
    }
    return {
        schemaVersion: 1,
        candidates: items,
        cursors,
        processed,
        ...(typeof raw?.lastPollAt === 'string' ? { lastPollAt: raw.lastPollAt } : {}),
        ...(typeof raw?.lastError === 'string' && raw.lastError !== '' ? { lastError: raw.lastError } : {}),
        ...(isLastScan(raw?.lastScan) ? { lastScan: raw.lastScan } : {}),
    };
}
/** 落盘的数据可能被手改过，逐字段校验，坏字段整块丢弃。 */
function isLastScan(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const scan = value;
    if (typeof scan.at !== 'string')
        return false;
    for (const key of ['days', 'scanned', 'readable', 'skipped', 'added', 'failed']) {
        if (typeof scan[key] !== 'number' || !Number.isFinite(scan[key]))
            return false;
    }
    return true;
}
export function writeMailState(state, file = mailCandidatesFile()) {
    writeJsonAtomic(file, state);
}
/** 游标键：账号 + 文件夹。账号里可能有特殊字符，用 NUL 分隔最稳。 */
export function cursorKeyOf(account, folder) {
    return account + '\u0000' + folder;
}
/**
 * 合并新识别结果：同 id 保留原状态（created / ignored 不会被重扫翻回 pending），
 * 只有新 id 以 pending + isNew 入库。
 * @returns 合并后的库与本次新增条数
 */
export function mergeCandidates(existing, incoming, now) {
    const byId = new Map();
    for (const item of existing)
        byId.set(item.id, item);
    const added = [];
    for (const candidate of incoming) {
        const previous = byId.get(candidate.id);
        if (previous !== undefined) {
            // 已存在的条目只刷新「可变的展示字段」，状态与「已建日程」标记一律保留。
            byId.set(candidate.id, {
                ...previous,
                summary: candidate.summary,
                start: candidate.start,
                end: candidate.end,
                allDay: candidate.allDay,
                location: candidate.location,
                description: candidate.description,
                confidence: candidate.confidence,
                mail: candidate.mail,
                updatedAt: now,
            });
            continue;
        }
        // 只有「待确认」的新条目才带 isNew（用来弹提示）；识别失败的新条目保留 failed 状态，
        // 否则它会被当成一条正常的待办，用户既看不到原因也点不了「创建日程」。
        const isPending = candidate.state === 'pending';
        const fresh = { ...candidate, isNew: isPending, createdAt: now, updatedAt: now };
        byId.set(fresh.id, fresh);
        added.push(fresh);
    }
    return { items: [...byId.values()], added };
}
/** 按状态改条目；找不到就原样返回（并发删除不算错误）。 */
export function updateCandidate(items, id, patch, now) {
    return items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: now } : item);
}
/** 用户看过清单后清掉「新」标记，角标才会归零。 */
export function clearNewFlags(items, now) {
    return items.map((item) => item.isNew ? { ...item, isNew: false, updatedAt: now } : item);
}
/**
 * 淘汰：超过上限时先丢最旧的 created / ignored，pending 始终保留；
 * 另按保留天数清理已处理条目。
 */
export function pruneCandidates(items, now, limit = MAIL_CANDIDATE_LIMIT, keepDays = MAIL_KEEP_DAYS) {
    const horizon = now - keepDays * 86400000;
    const kept = items.filter((item) => {
        if (item.state === 'pending' || item.state === 'failed')
            return true;
        return (item.updatedAt || item.createdAt) >= horizon;
    });
    if (kept.length <= limit)
        return kept;
    const closable = kept
        .filter(item => item.state !== 'pending' && item.state !== 'failed')
        .sort((a, b) => (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt));
    let excess = kept.length - limit;
    const dropped = new Set();
    for (const item of closable) {
        if (excess <= 0)
            break;
        dropped.add(item.id);
        excess -= 1;
    }
    return kept.filter(item => !dropped.has(item.id));
}
