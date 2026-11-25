/**
 * 数据源迁移：把一端的事件原样搬到另一端（本地 ⇄ CalDAV），一次性、手动、幂等。
 *
 * 不做持续同步：双写失败或离线会让两份数据立即不一致。
 * 冲突策略：同 UID 已存在跳过，不改目标端内容；同标题且同起止判为疑似重复，
 * 默认跳过并列出；时间重叠但内容不同照常搬；缺 UID 跳过并计数。
 */
import type { CalendarBackend } from './backend.js';
import type { BackendKind } from './config.js';
import type { CalendarEvent } from './ical.js';
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
/** 「看起来是同一件事」的判据：标题（去空白、忽略大小写）+ 起止时间完全一致。 */
export declare function shapeOf(event: CalendarEvent): string;
/** 只读预检：不写任何东西，把三类情况数清楚，交给用户决定要不要继续。 */
export declare function planMigration(from: CalendarBackend, to: CalendarBackend, signal?: AbortSignal): Promise<MigratePlan>;
/**
 * 执行迁移：只搬预检判为将新建的条目，逐条原样搬运（raw() 取原文。
 * 解析再拼装会丢掉 ATTENDEE / EXDATE 这类未建模字段）。
 * @param limit 单次最多搬多少条，超出部分分批执行
 */
export declare function runMigration(from: CalendarBackend, to: CalendarBackend, plan: MigratePlan, options?: {
    limit?: number;
}, signal?: AbortSignal): Promise<MigrateResult>;
/** 给面板用的一句话摘要，避免前端各自拼文案拼错。 */
export declare function describePlan(plan: MigratePlan): string;
