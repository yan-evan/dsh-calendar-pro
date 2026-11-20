/**
 * tsdav 懒加载：插件激活时不加载 CalDAV 依赖链。
 *
 * 宿主运行中安装或升级插件时，node_modules 重写期间模块图可能不完整；
 * 静态 import 会让插件启用失败且失败被进程缓存，只能重启。
 * 改为首次连接 CalDAV 时动态加载，本地日历模式与激活流程不受影响。
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
