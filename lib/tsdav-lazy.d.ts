/**
 * tsdav 懒加载：插件激活时不加载 CalDAV 依赖链。
 *
 * 宿主运行中安装或升级插件时，node_modules 重写期间模块图可能不完整；
 * 静态 import 会让插件启用失败且失败被进程缓存，只能重启。
 * 改为首次连接 CalDAV 时动态加载，本地日历模式与激活流程不受影响。
 * @module dsh-calendar-pro/tsdav-lazy
 */
/** 只声明实际用到的两个函数，避开 tsdav 类型文件里 default 导出的形状差异。 */
type TsdavModule = {
    createDAVClient: typeof import('tsdav').createDAVClient;
    getOauthHeaders: typeof import('tsdav').getOauthHeaders;
};
export declare function loadTsdav(): Promise<TsdavModule>;
export {};
