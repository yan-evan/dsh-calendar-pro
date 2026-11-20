import { CalendarService } from './caldav.js';
import { resolveBackendKind, resolveConfig } from './config.js';
import { LocalBackend } from './local-backend.js';
/**
 * 按配置构造后端。
 * backend 未设置时返回本地后端：读操作返回空数组，写操作在首次新建时创建数据文件。
 * backend 为 caldav 但账号不全时，resolveConfig 抛中文指引错误，不静默回退。
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
