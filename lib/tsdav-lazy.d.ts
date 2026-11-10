/**
 * tsdav 懒加载：插件激活时不加载 CalDAV 依赖链。
 *
 * 宿主在运行中安装/升级插件时，包管理器重写 node_modules 的瞬间模块图可能是半成品，
 * 静态 import 会让整个插件「启用失败」且失败被进程缓存，只能重启恢复。
 * 改为首次真正连接 CalDAV 时才动态加载：默认的本地日历模式与插件激活永远不受影响。
 *
 * @module dsh-calendar-pro/tsdav-lazy
 */
/** 只声明实际用到的两个函数，避开 tsdav 类型文件里 default 导出的形状差异。 */
type TsdavModule = {
    createDAVClient: typeof import('tsdav').createDAVClient;
    getOauthHeaders: typeof import('tsdav').getOauthHeaders;
};
export declare function loadTsdav(): Promise<TsdavModule>;
export {};
