import { CalendarService } from './caldav.js';
import { resolveBackendKind, resolveConfig } from './config.js';
import { LocalBackend } from './local-backend.js';
/**
 * 按配置构造后端。
 *
 * `backend` 未设置（首启、用户还没选）时返回本地后端：此时本地日历是空的，
 * 读操作返回空集、写操作会在用户第一次新建日程时惰性创建数据文件。
 * 选中的是 caldav 却没配好账号，由 resolveConfig 抛出带指引的中文错误 —— 不静默回退。
 */
export function createBackend(config, env = process.env) {
    if (resolveBackendKind(config) === 'caldav')
        return createCaldavBackend(config, env);
    return createLocalBackend();
}
/** 显式构造远程后端；未配置会抛带指引的中文错误（迁移前必须先连上）。 */
export function createCaldavBackend(config, env = process.env) {
    return new CalendarService(resolveConfig(config, env));
}
/** 显式构造本地后端；迁移的目标/来源都可能用它，与当前生效的 backend 无关。 */
export function createLocalBackend() {
    return new LocalBackend();
}
