/**
 * 邮件日程的编排层：配置 → 读信 → 识别 → 落盘 → 轮询，对外暴露白名单动作给面板。
 *
 * 识别结果先进候选库（pending），用户点「创建」才走日历 create，
 * 模型出错最多多一条待办，不会污染日历。
 * @module dsh-calendar-pro/mail/backend
 */
import { type StoredMailConfig } from './types.js';
import { MailClient } from './client.js';
import { type LlmRoute, type LlmStreamFace } from './extract.js';
/** 一次回扫的进度快照。面板按它画进度条，轮询 period 也不会太长。 */
export interface MailJob {
    running: boolean;
    phase: 'idle' | 'listing' | 'fetching' | 'extracting' | 'done';
    total: number;
    done: number;
    /** 正在处理哪封（主题），供进度条显示。 */
    message: string;
    startedAt: string;
    finishedAt?: string;
    error?: string;
    /** 本次新增多少条候选。 */
    added: number;
}
export interface MailBackendOptions {
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    /** 覆盖配置文件路径（测试用）。 */
    configFile?: string;
    stateFile?: string;
    /** 覆盖 IMAP 客户端（测试用假实现，不真连网）。 */
    client?: MailClient;
    /** 当前默认模型；拿不到就只走 .ics。每次调用现取，用户换模型立即生效。 */
    llm?: () => {
        llm: LlmStreamFace | null;
        route: LlmRoute | null;
    };
}
export declare class MailBackend {
    private readonly options;
    private job;
    /** 同一时刻只允许一个读信操作：回扫和轮询撞在一起会抢连接、也会重复花模型钱。 */
    private busy;
    constructor(options?: MailBackendOptions);
    private now;
    private client;
    config(): StoredMailConfig;
    private readState;
    private writeState;
    private saveConfig;
    /** 面向浏览器的状态：配置视图 + 计数 + 当前任务 + 模型可用性。 */
    status(): Record<string, unknown>;
    /** 动作分发：参数在这里校验，错误文案直接给面板显示。 */
    dispatch(action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
    private requireId;
    /** 从 body 里挑出配置草稿：只认已知字段，类型不对就当没传。 */
    private draftOf;
    /** 启动一次回扫。同一时刻只允许一个，重复点击直接返回当前进度。 */
    private startAnalyze;
    private runAnalyze;
    /**
     * 增量轮询：只取游标之后的新邮件。
     * 首次没有游标时只建基线不识别，避免历史邮件涌进待办。
     */
    poll(signal?: AbortSignal): Promise<{
        newCount: number;
        baseline?: boolean;
        skipped?: string;
    }>;
    /** 一封邮件 → 候选。序号进 id，所以一封多日程各自稳定、重扫幂等。 */
    private identify;
    /** 识别失败的占位候选：不改日历、不占待确认名额，只把原因摆给用户看。 */
    private failedCandidateOf;
    private candidateOf;
}
