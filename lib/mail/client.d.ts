/**
 * 只读 IMAP 访问层：把收件箱最近 N 天或某个 UID 之后的邮件取成结构化对象
 * （信封字段 + 纯文本正文 + .ics 附件）。不发信，不改邮件状态。
 *
 * 不把邮件标为已读：取正文用 `source: true`（imapflow 走 BODY.PEEK[]），
 * 邮箱以 readOnly 打开。IMAP 连接按操作建立、用完即断，避免被服务端限流。
 * 错误文案指向账号密码、主机地址、服务端未开 IMAP 三种常见原因。
 * @module dsh-calendar-pro/mail/client
 */
import { type StoredMailConfig } from './types.js';
/** 单封邮件原始大小上限：超过就跳过并记录原因，不把 20 MB 附件拉下来。 */
export declare const MAIL_MAX_SOURCE_BYTES: number;
/** .ics 附件大小上限，与日历导入的 256 KiB 对齐。 */
export declare const MAIL_MAX_ICS_BYTES: number;
/** 一封邮件的信封字段（不含正文）。 */
export interface MailEnvelope {
    uid: number;
    uidValidity: number;
    /** 邮件头里的发送时间。RFC5322 解析失败时回落到服务器内部时间。 */
    date: string;
    from: string;
    subject: string;
    /** 原始大小（字节），用于决定要不要真的下载。 */
    size: number;
}
/** 一封邮件的内容：正文文本 + 可直接解析的 .ics 文本。 */
export interface MailContent extends MailEnvelope {
    text: string;
    ics: string[];
    /** 正文摘要片段，供 UI 展示来源；不含全文。 */
    snippet: string;
    /** 跳过原因（源码过大等）；有值时识别层只用 .ics，没有就整封忽略。 */
    skipped?: string;
}
/** 列出邮件的结果：带上 uidValidity，游标才能判断邮箱是否被重建过。 */
export interface MailListResult {
    uidValidity: number;
    messages: MailEnvelope[];
}
export interface MailClientOptions {
    /** 取当前配置；每次操作现取，用户改了配置不必重连。 */
    config: () => StoredMailConfig;
    /** 连接超时（毫秒），测试里可以调小。 */
    connectionTimeout?: number;
}
/** 面向用户的连接错误：把底层错误归并成三类可操作的原因。 */
export declare function friendlyMailError(error: unknown, password?: string): string;
/** 错误文本里可能带账号信息，回给浏览器前先把授权码抹掉。 */
export declare function redactSecrets(text: string, password: string): string;
/** RFC5322 里可能出现的时区缩写与数字时区，Date.parse 认不全，这里补一层。 */
export declare function parseMailDate(value: unknown, fallback?: Date): string;
/** 正文摘要：压掉空白与引用行，截到 140 字，够用户认出是哪封邮件。 */
export declare function snippetOf(text: string, limit?: number): string;
export declare class MailClient {
    private readonly options;
    constructor(options: MailClientOptions);
    /** 建连接；调用方负责 close。 */
    private connect;
    /** 用一份草稿配置试连，不落盘、不读信。 */
    testConnection(draft: StoredMailConfig, signal?: AbortSignal): Promise<{
        ok: true;
        detail: string;
    }>;
    /**
     * 列出最近 days 天的信封，UID 从新到旧。
     * 只取信封，正文交给 fetchContents，可按大小先筛掉大邮件。
     */
    listRecent(days: number, limit: number, signal?: AbortSignal): Promise<MailListResult>;
    /**
     * 列出比游标新的邮件。maxUid = 0 时只回 uidValidity 与当前最大 UID（建基线用）。
     * IMAP 的 `N:*` 必然包含最后一封，需再按 maxUid 过滤。
     */
    listSince(maxUid: number, limit: number, signal?: AbortSignal): Promise<MailListResult & {
        maxUid: number;
    }>;
    /**
     * 批量取正文。单次操作共用一条连接；单封失败只跳过该封。
     * @returns 内容与失败/跳过原因，按 uid
     */
    fetchContents(messages: readonly MailEnvelope[], signal?: AbortSignal): Promise<{
        contents: MailContent[];
        failures: Array<{
            uid: number;
            reason: string;
        }>;
    }>;
}
/** fetch 响应 → 信封字段。缺 UID 的响应说明服务器不配合，直接丢。 */
export declare function envelopeOf(message: any, uidValidity: number): MailEnvelope | null;
/** 原始邮件 → 正文与 .ics。解析失败时退化成「没有正文」，仍可能从附件里拿到日程。 */
export declare function parseSource(envelope: MailEnvelope, source: Buffer): Promise<MailContent>;
