import { AggregateBackend } from './aggregate.js';
import { CalendarService } from './caldav.js';
import { calendarNameOf, resolveBackendKind, resolveCalendarTargets, resolveConfig } from './config.js';
import { LocalBackend } from './local-backend.js';
import { calendarFile } from './store.js';
/**
 * 按配置构造后端。
 * backend 未设置时返回本地后端：读操作返回空数组，写操作在首次新建时创建数据文件。
 * backend 为 caldav 但账号不全时，resolveCalendarTargets 抛中文指引错误，不静默回退。
 */
export function createBackend(config, env = process.env) {
    if (resolveBackendKind(config) === 'caldav')
        return createCaldavBackend(config, env);
    return createLocalBackend();
}
/**
 * 显式构造远程后端；未配置会抛带指引的中文错误（迁移前必须先连上）。
 * 连接多本时返回聚合后端：读跨日历，写按 uid 路由到所属日历、缺省写第一本。
 */
export function createCaldavBackend(config, env = process.env) {
    const targets = resolveCalendarTargets(config, env);
    const slices = targets.map(({ ref, config: resolved }) => ({
        id: ref.url,
        name: ref.name ?? calendarNameOf(ref.url),
        backend: new CalendarService(resolved),
    }));
    return new AggregateBackend(slices);
}
/**
 * 只针对默认（第一本）日历的后端：导入、迁移、导出 ICS 的写入端用它。
 * 多日历的目标选择留到后续版本，这里保持「一个明确的集合」这一旧语义。
 */
export function createPrimaryCaldavBackend(config, env = process.env) {
    const targets = resolveCalendarTargets(config, env);
    const first = targets[0];
    if (first === undefined) {
        // 理论上 resolveCalendarTargets 已保证非空；留一条明确的兜底，避免非空断言。
        return new CalendarService(resolveConfig(config, env));
    }
    return new CalendarService(first.config);
}
/** 显式构造本地后端；迁移的目标/来源都可能用它，与当前生效的 backend 无关。 */
export function createLocalBackend(env = process.env) {
    return new LocalBackend(calendarFile(env));
}
