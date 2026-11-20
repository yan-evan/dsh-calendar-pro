/**
 * 邮件日程的编排层：配置 → 读信 → 识别 → 落盘 → 轮询，对外暴露白名单动作给面板。
 *
 * 识别结果先进候选库（pending），用户点「创建」才走日历 create，
 * 模型出错最多多一条待办，不会污染日历。
 * @module dsh-calendar-pro/mail/backend
 */
import { MAIL_POLL_LIMIT, MAIL_SCAN_LIMIT, applyMailDraft, candidateIdOf, countCandidates, mailConfigured, mailConfigView, mailKeyOf, normalizeMailConfig, } from './types.js';
import { clearNewFlags, cursorKeyOf, mergeCandidates, pruneCandidates, readMailConfig, readMailState, updateCandidate, writeMailConfig, writeMailState, } from './store.js';
import { MailClient, friendlyMailError } from './client.js';
import { extractSchedules, offsetOf, systemTimeZone, } from './extract.js';
function emptyJob() {
    return { running: false, phase: 'idle', total: 0, done: 0, message: '', startedAt: '', added: 0 };
}
function iso(now) {
    return new Date(now).toISOString();
}
const STATES = new Set(['pending', 'created', 'ignored', 'failed']);
export class MailBackend {
    options;
    job = emptyJob();
    /** 同一时刻只允许一个读信操作：回扫和轮询撞在一起会抢连接、也会重复花模型钱。 */
    busy = false;
    constructor(options = {}) {
        this.options = options;
    }
    now() {
        return this.options.now !== undefined ? this.options.now() : Date.now();
    }
    client() {
        if (this.options.client !== undefined)
            return this.options.client;
        return new MailClient({ config: () => this.config() });
    }
    config() {
        return readMailConfig(this.options.configFile);
    }
    readState() {
        return readMailState(this.options.stateFile);
    }
    writeState(state) {
        writeMailState(state, this.options.stateFile);
    }
    saveConfig(config) {
        writeMailConfig(config, this.options.configFile);
    }
    /** 面向浏览器的状态：配置视图 + 计数 + 当前任务 + 模型可用性。 */
    status() {
        const config = this.config();
        const state = this.readState();
        const llm = this.options.llm?.() ?? { llm: null, route: null };
        return {
            ...mailConfigView(config),
            configured: mailConfigured(config),
            llmAvailable: llm.llm !== null && llm.route !== null && config.useLlm,
            counts: countCandidates(state.candidates),
            lastPollAt: state.lastPollAt ?? null,
            lastError: state.lastError ?? null,
            lastScan: state.lastScan ?? null,
            job: this.job,
            limits: { scan: MAIL_SCAN_LIMIT, poll: MAIL_POLL_LIMIT },
        };
    }
    /** 动作分发：参数在这里校验，错误文案直接给面板显示。 */
    async dispatch(action, body, signal) {
        if (action === 'status')
            return this.status();
        if (action === 'testConnection') {
            const draft = normalizeMailConfig({ ...this.config(), ...this.draftOf(body) });
            // 表单里授权码留空表示「保持原值」，所以先用已存配置兜底；补上也不能越过类型校验。
            const merged = draft.password === ''
                ? { ...draft, password: this.config().password }
                : draft;
            if (!mailConfigured(merged))
                throw new Error('请先填写邮箱账号、授权码与 IMAP 主机');
            return await this.client().testConnection(merged, signal);
        }
        if (action === 'saveConfig') {
            const before = this.config();
            const next = applyMailDraft(before, this.draftOf(body));
            if (!mailConfigured(next) && next.enabled)
                throw new Error('请先填写邮箱账号与授权码再启用邮件日程识别');
            if (body.test === true)
                await this.client().testConnection(next, signal);
            // 换了账号或主机：旧候选不再属于同一个来源，清空游标与「已分析」标记。
            const identityChanged = before.user !== next.user || before.imapHost !== next.imapHost || before.inboxFolder !== next.inboxFolder;
            this.saveConfig({ ...next, ...(identityChanged ? { analyzedAt: undefined } : {}) });
            if (identityChanged) {
                const state = this.readState();
                this.writeState({ ...state, cursors: {}, processed: {} });
            }
            return this.status();
        }
        if (action === 'candidates') {
            const state = this.readState();
            const filter = typeof body.state === 'string' && STATES.has(body.state) ? body.state : undefined;
            const items = state.candidates
                .filter(item => filter === undefined || item.state === filter)
                .sort((a, b) => {
                const rank = (item) => item.state === 'pending' ? 0 : item.state === 'failed' ? 1 : 2;
                const diff = rank(a) - rank(b);
                if (diff !== 0)
                    return diff;
                if (a.state === 'pending')
                    return a.start.localeCompare(b.start);
                return b.updatedAt - a.updatedAt;
            });
            return { items, counts: countCandidates(state.candidates) };
        }
        if (action === 'clearNew') {
            const state = this.readState();
            const now = this.now();
            const items = clearNewFlags(state.candidates, now);
            this.writeState({ ...state, candidates: items });
            return { counts: countCandidates(items) };
        }
        if (action === 'dismiss') {
            const id = this.requireId(body);
            const state = this.readState();
            const now = this.now();
            if (!state.candidates.some(item => item.id === id))
                throw new Error('这条待办已经不存在（可能已被清理）');
            const items = updateCandidate(state.candidates, id, { state: 'ignored', isNew: false }, now);
            this.writeState({ ...state, candidates: items });
            return { items, counts: countCandidates(items) };
        }
        if (action === 'markCreated') {
            const id = this.requireId(body);
            const calendarUid = typeof body.calendarUid === 'string' ? body.calendarUid.trim() : '';
            if (calendarUid === '')
                throw new Error('缺少新建日程返回的 uid');
            const state = this.readState();
            const target = state.candidates.find(item => item.id === id);
            if (target === undefined)
                throw new Error('这条待办已经不存在（可能已被清理）');
            // 只有待处理/失败的才能标记为已建，避免「忽略之后又被标记成已建」这种自相矛盾的状态。
            if (target.state !== 'pending' && target.state !== 'failed')
                throw new Error('这条待办已经处理过了（' + target.state + '）');
            const now = this.now();
            const items = updateCandidate(state.candidates, id, { state: 'created', isNew: false, calendarUid }, now);
            this.writeState({ ...state, candidates: items });
            return { items, counts: countCandidates(items) };
        }
        if (action === 'analyzeStart')
            return this.startAnalyze(body);
        if (action === 'analyzeStatus')
            return { job: this.job };
        throw new Error('未知动作：' + (action === '' ? '(空)' : action));
    }
    requireId(body) {
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (id === '')
            throw new Error('缺少待办 id');
        return id;
    }
    /** 从 body 里挑出配置草稿：只认已知字段，类型不对就当没传。 */
    draftOf(body) {
        const raw = body.config !== null && typeof body.config === 'object' ? body.config : body;
        const draft = {};
        if (typeof raw.enabled === 'boolean')
            draft.enabled = raw.enabled;
        if (typeof raw.provider === 'string')
            draft.provider = raw.provider;
        if (typeof raw.user === 'string')
            draft.user = raw.user;
        if (typeof raw.password === 'string')
            draft.password = raw.password;
        if (typeof raw.imapHost === 'string')
            draft.imapHost = raw.imapHost;
        if (typeof raw.imapPort === 'number' || typeof raw.imapPort === 'string')
            draft.imapPort = Number(raw.imapPort);
        if (typeof raw.imapSecure === 'boolean')
            draft.imapSecure = raw.imapSecure;
        if (typeof raw.inboxFolder === 'string')
            draft.inboxFolder = raw.inboxFolder;
        if (typeof raw.analyzeDays === 'number' || typeof raw.analyzeDays === 'string')
            draft.analyzeDays = Number(raw.analyzeDays);
        if (typeof raw.pollSeconds === 'number' || typeof raw.pollSeconds === 'string')
            draft.pollSeconds = Number(raw.pollSeconds);
        if (typeof raw.useLlm === 'boolean')
            draft.useLlm = raw.useLlm;
        return draft;
    }
    /** 启动一次回扫。同一时刻只允许一个，重复点击直接返回当前进度。 */
    startAnalyze(body) {
        if (this.job.running)
            return { job: this.job };
        const config = this.config();
        if (!mailConfigured(config))
            throw new Error('邮件连接还没配置完整：需要邮箱账号、授权码与 IMAP 主机');
        if (this.busy)
            throw new Error('正在检查新邮件，请稍后再试');
        const days = typeof body.days === 'number' && Number.isFinite(body.days) ? Math.trunc(body.days) : config.analyzeDays;
        // 用户主动点「分析 / 重新分析」时一律重扫：否则上次被静默判为「无日程」的邮件永远没有第二次机会。
        const force = body.force !== false;
        this.job = { ...emptyJob(), running: true, phase: 'listing', startedAt: iso(this.now()) };
        void this.runAnalyze(Math.min(30, Math.max(1, days)), force).catch(() => { });
        return { job: this.job };
    }
    async runAnalyze(days, force) {
        const job = this.job;
        this.busy = true;
        try {
            const config = this.config();
            const client = this.client();
            job.phase = 'listing';
            const listed = await client.listRecent(days, MAIL_SCAN_LIMIT);
            const state0 = this.readState();
            const pending = force
                ? listed.messages
                : listed.messages.filter(message => state0.processed[mailKeyOf(config.user, config.inboxFolder, listed.uidValidity, message.uid)] === undefined);
            job.phase = 'fetching';
            job.total = pending.length;
            const { contents, failures } = await client.fetchContents(pending);
            job.phase = 'extracting';
            let state = this.readState();
            let total = 0;
            for (const failure of failures) {
                // 读不出来的邮件不阻塞整批；失败原因留给状态行，用户能看出是哪一封。
                job.message = friendlyMailError(failure.reason, config.password);
            }
            for (const content of contents) {
                try {
                    const { candidates, mailKey, failed } = await this.identify(content, config);
                    const now = this.now();
                    // 识别成功：清掉这封邮件之前的失败占位，再并入新候选。
                    const base = candidates.length > 0 ? dropPlaceholder(state.candidates, content, config) : state.candidates;
                    const merged = mergeCandidates(base, candidates.length > 0 ? candidates : failed === undefined ? [] : [failed], now);
                    state = {
                        ...state,
                        candidates: merged.items,
                        // 失败不记「已处理」：留着让下次重扫能再试一次。
                        processed: failed === undefined ? { ...state.processed, [mailKey]: now } : state.processed,
                    };
                    if (failed !== undefined && candidates.length === 0)
                        job.message = failed.reason ?? job.message;
                    this.writeState(state);
                    // 只有待确认的才算「新增日程」；失败占位不该触发「识别到 N 个日程」的提示。
                    total += merged.added.filter(item => item.state === 'pending').length;
                }
                catch (error) {
                    job.message = error instanceof Error ? error.message : String(error ?? '识别失败');
                }
                finally {
                    job.done += 1;
                }
            }
            // 一次回扫结束：记下时间，界面就不再弹「要不要现在分析」。
            const now = this.now();
            const pruned = pruneCandidates(state.candidates, now);
            this.writeState({
                ...state,
                candidates: pruned,
                lastError: failures.length > 0 ? friendlyMailError(failures[0].reason, config.password) : undefined,
                lastScan: {
                    at: iso(now),
                    days,
                    scanned: listed.messages.length,
                    readable: contents.length,
                    skipped: failures.length,
                    added: total,
                    failed: pruned.filter(item => item.state === 'failed').length,
                },
            });
            job.added = total;
            job.phase = 'done';
            job.finishedAt = iso(now);
            const stored = this.config();
            this.saveConfig({ ...stored, analyzedAt: iso(now) });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error ?? '分析失败');
            job.error = message;
            job.phase = 'done';
            job.finishedAt = iso(this.now());
            const state = this.readState();
            this.writeState({ ...state, lastError: message });
        }
        finally {
            job.running = false;
            this.busy = false;
        }
    }
    /**
     * 增量轮询：只取游标之后的新邮件。
     * 首次没有游标时只建基线不识别，避免历史邮件涌进待办。
     */
    async poll(signal) {
        const config = this.config();
        if (!config.enabled)
            return { newCount: 0, skipped: 'disabled' };
        if (!mailConfigured(config))
            return { newCount: 0, skipped: 'unconfigured' };
        if (this.busy)
            return { newCount: 0, skipped: 'busy' };
        this.busy = true;
        const state0 = this.readState();
        const key = cursorKeyOf(config.user, config.inboxFolder);
        try {
            const client = this.client();
            const cursor = state0.cursors[key];
            if (cursor === undefined) {
                const baseline = await client.listSince(0, 0, signal);
                this.writeState({
                    ...state0,
                    cursors: { ...state0.cursors, [key]: { uidValidity: baseline.uidValidity, maxUid: baseline.maxUid } },
                    lastPollAt: iso(this.now()),
                    lastError: undefined,
                });
                return { newCount: 0, baseline: true };
            }
            const listed = await client.listSince(cursor.maxUid, MAIL_POLL_LIMIT, signal);
            if (listed.uidValidity !== 0 && cursor.uidValidity !== 0 && listed.uidValidity !== cursor.uidValidity) {
                // 邮箱被服务端重建：旧游标失效，重建基线，本轮不识别。
                this.writeState({
                    ...state0,
                    cursors: { ...state0.cursors, [key]: { uidValidity: listed.uidValidity, maxUid: listed.maxUid } },
                    lastPollAt: iso(this.now()),
                });
                return { newCount: 0, baseline: true };
            }
            const fresh = listed.messages.filter(message => !state0.processed[mailKeyOf(config.user, config.inboxFolder, listed.uidValidity, message.uid)]);
            if (fresh.length === 0) {
                this.writeState({
                    ...state0,
                    cursors: { ...state0.cursors, [key]: { uidValidity: listed.uidValidity, maxUid: Math.max(cursor.maxUid, listed.maxUid) } },
                    lastPollAt: iso(this.now()),
                    lastError: undefined,
                });
                return { newCount: 0 };
            }
            const { contents, failures } = await client.fetchContents(fresh, signal);
            let state = state0;
            let added = 0;
            for (const content of contents) {
                if (signal?.aborted === true)
                    break;
                try {
                    const { candidates, mailKey, failed } = await this.identify(content, config);
                    const now = this.now();
                    const base = candidates.length > 0 ? dropPlaceholder(state.candidates, content, config) : state.candidates;
                    const merged = mergeCandidates(base, candidates.length > 0 ? candidates : failed === undefined ? [] : [failed], now);
                    // 轮询仍记录「已处理」：失败条目已经落成待重试候选，用户点「重新分析」可以强制重扫。
                    state = { ...state, candidates: merged.items, processed: { ...state.processed, [mailKey]: now } };
                    if (failed !== undefined && candidates.length === 0)
                        state = { ...state, lastError: failed.reason };
                    added += merged.added.filter(item => item.state === 'pending').length;
                }
                catch (error) {
                    state = { ...state, lastError: error instanceof Error ? error.message : String(error ?? '识别失败') };
                }
            }
            const now = this.now();
            this.writeState({
                ...state,
                candidates: pruneCandidates(state.candidates, now),
                cursors: { ...state.cursors, [key]: { uidValidity: listed.uidValidity, maxUid: Math.max(cursor.maxUid, listed.maxUid) } },
                lastPollAt: iso(now),
                ...(failures.length > 0 ? { lastError: failures[0].reason } : {}),
            });
            return { newCount: added };
        }
        catch (error) {
            const message = friendlyMailError(error, config.password);
            const current = this.readState();
            this.writeState({ ...current, lastPollAt: iso(this.now()), lastError: message });
            throw new Error(message);
        }
        finally {
            this.busy = false;
        }
    }
    /** 一封邮件 → 候选。序号进 id，所以一封多日程各自稳定、重扫幂等。 */
    async identify(content, config) {
        const llm = this.options.llm?.() ?? { llm: null, route: null };
        const result = await extractSchedules({
            from: content.from,
            subject: content.subject,
            date: content.date,
            text: content.text,
            ics: content.ics,
        }, {
            llm: llm.llm,
            route: llm.route,
            useLlm: config.useLlm,
            timeZone: systemTimeZone(),
            offset: offsetOf(new Date(content.date), systemTimeZone()),
            now: this.now(),
        });
        const now = this.now();
        const candidates = result.schedules.map((schedule, index) => this.candidateOf(content, schedule, index, config, now));
        // 模型这一封没给出可用结果时留一条「待重试」占位：让用户在清单里看见它，
        // 而不是像以前那样只留下一个「什么都没有」的空白。
        const failed = result.llmError === undefined || candidates.length > 0
            ? undefined
            : this.failedCandidateOf(content, result.llmError, config, now);
        return { candidates, mailKey: mailKeyOf(config.user, config.inboxFolder, content.uidValidity, content.uid), failed };
    }
    /** 识别失败的占位候选：不改日历、不占待确认名额，只把原因摆给用户看。 */
    failedCandidateOf(content, reason, config, now) {
        const subject = content.subject.trim();
        return {
            id: candidateIdOf({ account: config.user, folder: config.inboxFolder, uidValidity: content.uidValidity, uid: content.uid, index: -1 }),
            account: config.user,
            folder: config.inboxFolder,
            uid: content.uid,
            uidValidity: content.uidValidity,
            summary: subject === '' ? '（未识别）' : subject.slice(0, 120),
            start: '',
            end: '',
            allDay: false,
            location: '',
            description: '',
            confidence: 0,
            source: 'llm',
            state: 'failed',
            isNew: false,
            reason: reason.slice(0, 200),
            mail: {
                from: content.from,
                subject: content.subject,
                date: content.date,
                snippet: 'snippet' in content && typeof content.snippet === 'string' ? content.snippet : '',
            },
            createdAt: now,
            updatedAt: now,
        };
    }
    candidateOf(content, schedule, index, config, now) {
        return {
            id: candidateIdOf({ account: config.user, folder: config.inboxFolder, uidValidity: content.uidValidity, uid: content.uid, index }),
            account: config.user,
            folder: config.inboxFolder,
            uid: content.uid,
            uidValidity: content.uidValidity,
            summary: schedule.summary,
            start: schedule.start,
            end: schedule.end,
            allDay: schedule.allDay,
            location: schedule.location,
            description: schedule.description,
            confidence: schedule.confidence,
            source: schedule.source,
            state: 'pending',
            isNew: false,
            mail: {
                from: content.from,
                subject: content.subject,
                date: content.date,
                snippet: 'snippet' in content && typeof content.snippet === 'string' ? content.snippet : '',
            },
            createdAt: now,
            updatedAt: now,
        };
    }
}
/**
 * 同一封邮件识别成功时清掉它上次留下的失败占位，
 * 否则用户会同时看到「待重试」和同名新候选。
 */
function dropPlaceholder(items, content, config) {
    return items.filter(item => !(item.uid === content.uid
        && item.uidValidity === content.uidValidity
        && item.account === config.user
        && item.folder === config.inboxFolder
        && item.state === 'failed'
        && item.start === ''));
}
