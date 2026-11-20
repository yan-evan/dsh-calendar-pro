/**
 * 邮件日程的落盘层：配置（含授权码）与候选库，都在 `$DSH_HOME/data/dsh-calendar-pro/` 下，
 * 沿用 store.js 的 0600 原子写。
 *
 * 配置与候选分两个文件，各自独立重写。候选库只存展示与建日程需要的字段，不存正文。
 * 状态机在写入时收敛，重扫幂等。
 * @module dsh-calendar-pro/mail/store
 */
import { type MailCandidate, type StoredMailConfig } from './types.js';
/** 轮询游标：按「账号 + 文件夹」各记一份，uidValidity 变了说明邮箱重建过。 */
export interface MailCursor {
    uidValidity: number;
    maxUid: number;
}
export interface MailState {
    schemaVersion: 1;
    candidates: MailCandidate[];
    cursors: Record<string, MailCursor>;
    /** 已处理过的邮件（mailKey → 处理时间）。重扫/轮询据此跳过，避免重复花模型钱。 */
    processed: Record<string, number>;
    lastPollAt?: string;
    lastError?: string;
    /** 上一次回扫的统计：扫了几封、读成功几封、跳过几封、新增几条。界面据此解释「为什么没识别到」。 */
    lastScan?: MailLastScan;
}
export interface MailLastScan {
    at: string;
    days: number;
    scanned: number;
    readable: number;
    skipped: number;
    added: number;
    failed: number;
}
export declare function mailConfigFile(env?: NodeJS.ProcessEnv): string;
export declare function mailCandidatesFile(env?: NodeJS.ProcessEnv): string;
export interface StoredMailFile {
    schemaVersion: 1;
    config: StoredMailConfig;
}
/** 读配置：坏文件、缺字段、手改成怪形状都退化成一份可用的默认配置。 */
export declare function readMailConfig(file?: string): StoredMailConfig;
export declare function writeMailConfig(config: StoredMailConfig, file?: string): void;
/** 读候选库：逐条清洗，丢弃形状坏掉的条目，不让一条脏数据拖垮整份文件。 */
export declare function readMailState(file?: string): MailState;
export declare function writeMailState(state: MailState, file?: string): void;
/** 游标键：账号 + 文件夹。账号里可能有特殊字符，用 NUL 分隔最稳。 */
export declare function cursorKeyOf(account: string, folder: string): string;
/**
 * 合并新识别结果：同 id 保留原状态（created / ignored 不会被重扫翻回 pending），
 * 只有新 id 以 pending + isNew 入库。
 * @returns 合并后的库与本次新增条数
 */
export declare function mergeCandidates(existing: readonly MailCandidate[], incoming: readonly MailCandidate[], now: number): {
    items: MailCandidate[];
    added: MailCandidate[];
};
/** 按状态改条目；找不到就原样返回（并发删除不算错误）。 */
export declare function updateCandidate(items: readonly MailCandidate[], id: string, patch: Partial<MailCandidate>, now: number): MailCandidate[];
/** 用户看过清单后清掉「新」标记，角标才会归零。 */
export declare function clearNewFlags(items: readonly MailCandidate[], now: number): MailCandidate[];
/**
 * 淘汰：超过上限时先丢最旧的 created / ignored，pending 始终保留；
 * 另按保留天数清理已处理条目。
 */
export declare function pruneCandidates(items: readonly MailCandidate[], now: number, limit?: number, keepDays?: number): MailCandidate[];
