/**
 * 邮件日程识别的公共词汇：邮箱配置与服务商预设、候选日程、状态机与去重键。
 *
 * 纯类型与纯函数，不做 IO、不连 IMAP，测试可离线跑。
 * 界面文案在客户端，这里只做校验与规范化。
 * @module dsh-calendar-pro/mail/types
 */
/** 支持的邮箱服务商预设；custom 表示用户自己填 IMAP 主机。 */
export type MailProvider = 'qq' | '163' | 'gmail' | 'outlook' | 'icloud' | 'custom';
export declare const MAIL_PROVIDERS: readonly MailProvider[];
/** 预设只覆盖 IMAP 连接参数：识别只用读信，不发信，因此不需要 SMTP。 */
export interface MailPreset {
    label: string;
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
}
export declare const MAIL_PRESETS: Record<Exclude<MailProvider, 'custom'>, MailPreset>;
/** 首次回扫可选的天数；收窄到这四档，避免用户填出一个「扫 365 天」的账单。 */
export declare const MAIL_ANALYZE_DAYS: readonly [1, 3, 7, 30];
export type MailAnalyzeDays = (typeof MAIL_ANALYZE_DAYS)[number];
/** 单次回扫最多读多少封，防止一次把几年邮件全拉给模型。 */
export declare const MAIL_SCAN_LIMIT = 50;
/** 增量轮询单次最多处理多少封新邮件。 */
export declare const MAIL_POLL_LIMIT = 10;
/** 正文送进模型前的截断长度（字符）。 */
export declare const MAIL_BODY_LIMIT = 4000;
/** 候选条目在库里的最大数量；超出按「最旧的非 pending」先淘汰。 */
export declare const MAIL_CANDIDATE_LIMIT = 500;
/** 已处理（created / ignored）条目保留天数。 */
export declare const MAIL_KEEP_DAYS = 90;
export interface MailConfig {
    /** 总开关：关掉后不轮询、不识别，已有候选仍可查看。 */
    enabled: boolean;
    provider: MailProvider;
    /** 登录账号（通常是完整邮箱地址）。 */
    user: string;
    /** 授权码 / 应用专用密码；只存本机 0600 文件，永不回显给浏览器。 */
    password: string;
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    /** 收件箱文件夹名；多数服务商是 INBOX。 */
    inboxFolder: string;
    /** 首次回扫的默认天数。 */
    analyzeDays: MailAnalyzeDays;
    /** 增量轮询间隔（秒），30–3600。 */
    pollSeconds: number;
    /** 是否允许把正文交给当前默认模型；关掉后只认 .ics 附件。 */
    useLlm: boolean;
}
/** 配置落盘时的形状：多一个「是否做过首次回扫」的标记。 */
export interface StoredMailConfig extends MailConfig {
    /** 首次回扫完成时间；undefined 表示还没扫过，界面据此弹「要不要现在分析」。 */
    analyzedAt?: string;
}
/** 表单草稿：空串表示「保持原值」，与日历连接表单同一套约定。 */
export interface MailConfigDraft {
    enabled?: boolean;
    provider?: string;
    user?: string;
    password?: string;
    imapHost?: string;
    imapPort?: number;
    imapSecure?: boolean;
    inboxFolder?: string;
    analyzeDays?: number;
    pollSeconds?: number;
    useLlm?: boolean;
}
export declare const DEFAULT_MAIL_CONFIG: StoredMailConfig;
/** 字符串清洗：去首尾空白，删掉换行与控制字符（配置会被带进协议命令，绝不能带 CRLF）。 */
export declare function cleanText(value: unknown, max?: number): string;
export declare function isMailProvider(value: unknown): value is MailProvider;
export declare function isAnalyzeDays(value: unknown): value is MailAnalyzeDays;
/** 端口收窄到 1–65535；非法回默认。 */
export declare function normalizePort(value: unknown, fallback: number): number;
/** 轮询间隔收窄到 30–3600 秒。 */
export declare function normalizePollSeconds(value: unknown, fallback?: number): number;
/**
 * 任意输入 → 形状正确的配置。
 * 只做规范化不抛错：本地文件可能被手改坏，单个坏字段不该让模块起不来。
 * 能否连通由 testConnection 判断。
 */
export declare function normalizeMailConfig(raw: unknown): StoredMailConfig;
/**
 * 草稿叠加到已存配置：缺席或空串保留原值，null 清空可清空字段。
 * 密码空串表示不修改——用户看不到已存授权码，不能被一次保存擦掉。
 */
export declare function applyMailDraft(base: StoredMailConfig, draft: MailConfigDraft): StoredMailConfig;
/** 能不能连：账号、密码、主机三者齐了才算配置完成。 */
export declare function mailConfigured(config: StoredMailConfig): boolean;
/** 面向浏览器的配置视图：密码只回「有没有」，其余照实。 */
export declare function mailConfigView(config: StoredMailConfig): Record<string, unknown>;
/** 候选状态：待处理、已建日程、用户忽略、识别失败（可重试）。 */
export type MailCandidateState = 'pending' | 'created' | 'ignored' | 'failed';
/** 识别来源：.ics 附件精确解析，或模型抽取。 */
export type MailCandidateSource = 'ics' | 'llm';
/** 候选来自哪封邮件：只保留展示需要的字段，不存正文。 */
export interface MailCandidateMail {
    from: string;
    subject: string;
    /** 邮件头里的发送时间（ISO）。 */
    date: string;
    /** 正文摘要片段，供用户判断来源；不含全文。 */
    snippet: string;
}
/** 一条「邮件里的日程」候选，也是 UI 与后端的唯一数据形状。 */
export interface MailCandidate {
    /** 去重键：账号 + 文件夹 + uidValidity + uid + 该邮件内的序号。 */
    id: string;
    account: string;
    folder: string;
    uid: number;
    uidValidity: number;
    summary: string;
    /** 定时事件为带偏移的 ISO；全天事件为 YYYY-MM-DD。 */
    start: string;
    end: string;
    allDay: boolean;
    location: string;
    description: string;
    confidence: number;
    source: MailCandidateSource;
    state: MailCandidateState;
    /** 增量识别出来、用户还没看过的新条目。 */
    isNew: boolean;
    calendarUid?: string;
    /** failed 的原因（已做过用户可读化）。 */
    reason?: string;
    mail: MailCandidateMail;
    createdAt: number;
    updatedAt: number;
}
/** 计数：界面角标与状态行都用它。 */
export interface MailCandidateCounts {
    pending: number;
    new: number;
    created: number;
    ignored: number;
    failed: number;
}
export declare function countCandidates(items: readonly MailCandidate[]): MailCandidateCounts;
/** 去重键。序号让「一封邮件里的第 N 条日程」各自稳定，重扫也不会重复入库。 */
export declare function candidateIdOf(input: {
    account: string;
    folder: string;
    uidValidity: number;
    uid: number;
    index: number;
}): string;
/** 邮件本身的稳定键：用于「忽略整封邮件」和轮询游标。 */
export declare function mailKeyOf(account: string, folder: string, uidValidity: number, uid: number): string;
/** 时间是否可用：全天 YYYY-MM-DD，或带时区偏移 / Z 的 ISO。抽出来的空值一律丢弃。 */
export declare function isUsableTime(value: unknown): value is string;
