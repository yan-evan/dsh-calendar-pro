/**
 * 数据源迁移：把一端的事件**原样**搬到另一端（本地 ⇄ CalDAV）。
 *
 * 只做一次性、手动、幂等的手动搬运，**不做持续同步** —— 双写一旦失败或离线，
 * 两份数据立刻不一致，接着就要解决冲突，复杂度不成比例。
 *
 * 冲突策略（已与用户确认）：
 *   · 同 UID 已存在     → 跳过，绝不改目标端内容（别人可能已经改过那条）；
 *   · 同标题 + 同起止    → 判为「疑似重复」，默认跳过并列出来给用户看；
 *   · 时间重叠但内容不同 → 正常搬运，日历本来就允许重叠，这不算冲突；
 *   · 缺少 iCal UID     → 跳过并计数（没有 UID 就没法判断是不是同一条）。
 */
import type { CalendarBackend } from './backend.js';
import type { BackendKind } from './config.js';
export interface MigrateItem {
    /** 源端的资源标识（拿原文用）。 */
    uid: string;
    /** iCal UID：目标端去重的键。 */
    icalUid: string;
    summary: string;
    start: string;
    end: string;
}
export interface MigrateDuplicate extends MigrateItem {
    /** 目标端那条「看起来是同一件事」的日程。 */
    existingUid: string;
}
export interface MigratePlan {
    from: BackendKind;
    to: BackendKind;
    /** 源端资源总数。 */
    total: number;
    /** 将新建的。 */
    create: MigrateItem[];
    /** 同 UID 已存在、跳过的条数。 */
    exists: number;
    /** 疑似重复、默认跳过的。 */
    duplicates: MigrateDuplicate[];
    /** 缺 iCal UID、无法判定、跳过的条数。 */
    invalid: number;
}
export interface MigrateResult {
    migrated: number;
    failed: Array<{
        uid: string;
        summary: string;
        message: string;
    }>;
}
/** 只读预检：不写任何东西，把三类情况数清楚，交给用户决定要不要继续。 */
export declare function planMigration(from: CalendarBackend, to: CalendarBackend, signal?: AbortSignal): Promise<MigratePlan>;
/**
 * 执行迁移：只搬预检里判为「将新建」的那些，**逐条原样搬运**（`raw()` 取原文，
 * 不走解析再拼装，否则 ATTENDEE / EXDATE 这类没建模的字段会丢）。
 *
 * @param limit 单次最多搬多少条；超出部分让用户分批执行（避免一个请求挂太久）。
 */
export declare function runMigration(from: CalendarBackend, to: CalendarBackend, plan: MigratePlan, options?: {
    limit?: number;
}, signal?: AbortSignal): Promise<MigrateResult>;
/** 给面板用的一句话摘要，避免前端各自拼文案拼错。 */
export declare function describePlan(plan: MigratePlan): string;
