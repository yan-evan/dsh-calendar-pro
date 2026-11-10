/**
 * tsdav 懒加载：插件激活时不加载 CalDAV 依赖链。
 *
 * 宿主在运行中安装/升级插件时，包管理器重写 node_modules 的瞬间模块图可能是半成品，
 * 静态 import 会让整个插件「启用失败」且失败被进程缓存，只能重启恢复。
 * 改为首次真正连接 CalDAV 时才动态加载：默认的本地日历模式与插件激活永远不受影响。
 *
 * @module dsh-calendar-pro/tsdav-lazy
 */
let cached;
export function loadTsdav() {
    if (cached === undefined) {
        cached = import('tsdav').catch((error) => {
            // 失败不缓存，下次连接可以重试。
            cached = undefined;
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error('CalDAV 组件加载失败（' + detail + '）。请完全退出 DSH 后重新打开；若反复出现，请重新安装 dsh-calendar-pro。');
        });
    }
    return cached;
}
