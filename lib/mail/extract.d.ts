/**
 * 邮件 → 日程的抽取层。
 *
 * 两条路径：.ics 附件直接解析，不再问模型；正文走模型，输出经白名单校验后入库。
 *
 * 正文是不可信输入，提示词把内容包进 <email> 边界，system 声明其中只是数据；
 * 输出只取 summary / start / end / allDay / location / description / confidence，
 * 时间必须可 Date.parse 且带时区，长度与条数均有上限。模型结果只是候选，
 * 落盘后由用户确认才会成为日历事件。
 * @module dsh-calendar-pro/mail/extract
 */
import { type MailCandidateSource } from './types.js';
/** 单封邮件最多认几条日程：再多基本说明这封不是日程邮件。 */
export declare const MAIL_EVENTS_PER_MESSAGE = 5;
/** 抽取结果（还没有身份与状态，入库时才补）。 */
export interface ExtractedSchedule {
    summary: string;
    start: string;
    end: string;
    allDay: boolean;
    location: string;
    description: string;
    confidence: number;
    source: MailCandidateSource;
}
/** 宿主 llm 服务的最小面：插件只用到 stream。 */
export interface LlmStreamFace {
    stream(options: {
        provider: string;
        model: string;
        messages: Array<{
            role: 'user' | 'assistant' | 'system';
            content: Array<{
                type: 'text';
                text: string;
            }>;
        }>;
        signal?: AbortSignal;
        sessionId?: string;
    }): AsyncIterable<{
        type?: string;
        index?: number;
        text?: string;
        reason?: string;
    }>;
}
/** 当前默认模型的路由。拿不到就没有 LLM 可用，只走 .ics。 */
export interface LlmRoute {
    provider: string;
    model: string;
}
/** 抽取所需的输入：已解析好的邮件内容 + 时区上下文。 */
export interface ExtractInput {
    from: string;
    subject: string;
    /** 邮件发送时间（ISO），相对时间的锚点。 */
    date: string;
    text: string;
    ics: string[];
}
export interface ExtractOptions {
    llm?: LlmStreamFace | null;
    route?: LlmRoute | null;
    /** 用户关掉「交给模型」时置 false：只剩 .ics 一条路。 */
    useLlm: boolean;
    /** IANA 时区，默认取运行环境。 */
    timeZone?: string;
    /** 时区偏移，如 +08:00；缺省按 timeZone 现算。 */
    offset?: string;
    signal?: AbortSignal;
    /** 判定「过去日程」的基准，默认现在。 */
    now?: number;
}
/** 某时刻在某时区的偏移，形如 +08:00。用 Intl 现算，夏令时也能对上。 */
export declare function offsetOf(date: Date, timeZone: string): string;
/** 运行环境的 IANA 时区；取不到就 UTC。 */
export declare function systemTimeZone(): string;
/** 全天 vs 定时：date-only 一律按全天。 */
interface ParsedTime {
    start: string;
    end?: string;
    allDay: boolean;
}
/**
 * 把模型输出的各种时间写法收敛成 ISO：`2026-11-20 10:00`、`2026年11月20日 10:00`，
 * 以及把区间塞进 start 的 `2026-11-20 10:00-11:00`。这些以前会被整条丢弃。
 */
export declare function parseTimeValue(value: string, fallbackOffset: string): ParsedTime | null;
/**
 * 解析 .ics 附件：逐个 VEVENT 跑现有解析器，保留各自时区。
 * METHOD:CANCEL / STATUS:CANCELLED 直接丢弃。
 */
export declare function extractIcsEvents(icsText: string, now?: number): ExtractedSchedule[];
/** 抽取任务里 system 与 user 两段提示词。抽出来单独放，方便测试断言与审阅。 */
export declare function buildExtractPrompt(input: ExtractInput, options: {
    timeZone: string;
    offset: string;
    now: number;
}): {
    system: string;
    user: string;
};
/** 模型输出 → JSON。容忍代码块围栏与前后废话；解析不出来就当没有日程。 */
export declare function parseLlmJson(raw: string): unknown;
/**
 * 模型 JSON → 候选日程。任何字段不合法即丢弃该条，不猜时间。
 * @returns 通过的日程与被丢弃的条数
 */
export declare function normalizeLlmEvents(raw: unknown, options: {
    offset: string;
    now: number;
}): {
    schedules: ExtractedSchedule[];
    dropped: number;
};
/** 流式响应 → 纯文本。只在 finish 正常结束时返回；被打断的内容不完整，不用。 */
export declare function collectStreamText(stream: AsyncIterable<{
    type?: string;
    text?: string;
    reason?: string;
}>): Promise<string>;
export declare function extractSchedules(input: ExtractInput, options: ExtractOptions): Promise<{
    schedules: ExtractedSchedule[];
    llmError?: string;
}>;
export {};
