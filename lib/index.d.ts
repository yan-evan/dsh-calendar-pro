/**
 * dsh-calendar-pro 插件入口（Node 侧，配置来自 cordis.patch.yml）。
 *
 * apply(ctx, config) 把七个日历工具注册进宿主工具表：calendar_list / create /
 * update / delete / search / health / find_time。数据源默认本地日历，切到 CalDAV
 * 才需要连接配置。
 */
import { type CalendarConfig } from './config.js';
import { type CalendarToolDefinition } from './tools.js';
import { type CalendarSettingsFace } from './web.js';
import { MailBackend } from './mail/backend.js';
/** 宿主用 entry 的 Config 生成设置表单：0.1.7 起这就是「注册设置项」的方式。 */
export declare const Config: import("@deepseek-ai/schemastery").default;
export type Config = CalendarConfig;
/**
 * 显式声明 ctx.tools 注入，否则宿主会抛 cannot get property without inject。
 * name 只作为诊断树里的 fiber 名，不是 service key。
 */
export declare const name = "dsh-calendar-pro";
export declare const inject: string[];
/** 插件所需的最小 ctx 面（社区插件不依赖宿主内部类型）。 */
export interface CalendarPluginContext {
    tools: {
        register(definition: CalendarToolDefinition): () => void;
    };
    on?(event: string, listener: () => void): () => void;
    /** Cordis 的标准副作用入口；注册类操作挂进去，插件卸载时宿主自动清理。 */
    effect?(callback: () => () => void, label?: string): void;
    /** 设置页面板需要挂路由；隔离环境（测试/headless）可以没有。 */
    inject?(services: string[], callback: (ctx: any) => void): void;
    /** 0.1.7 的宿主表单按 entry id 寻址，id 从 fiber 上读。 */
    fiber?: {
        entry?: {
            options?: {
                id?: string;
            };
        };
    };
    /** settings 服务：能拿到就用，拿不到就退化（见 attachSettings）。 */
    get?(service: string): any;
    settings?: any;
    logger?: {
        warn?(message: string): void;
    };
}
/**
 * 同步注册 settings 命名空间并返回读写面。
 *
 * 时机是关键：宿主的 register 内部会 `ctx.effect(...)`，必须在插件加载的**同步阶段**调用 ——
 * 在请求处理里注册会失败，而失败一旦被吞掉，就会在保存时才暴露成「namespace is not registered」。
 * 拿不到服务 / 注册失败都只 warn：面板退化为只读，配置仍可写在 cordis.patch.yml。
 */
/** 兜底：把连接配置存进插件自己的文件（宿主 settings 不可用/注册失败时）。 */
export declare function fileSettingsFace(file?: string): CalendarSettingsFace;
/**
 * 接上配置存储，按宿主版本依次降级：
 *   0.1.7+  entry 配置直接投影成表单，读=活配置，写=按 entry id 逐字段 set/unset；
 *   0.1.6-  同步阶段 settings.register；注册失败但 describe() 已有本段时按重复 apply 处理，
 *           借用既有注册；
 *   都不可用 → 插件自己的兜底文件。
 * 返回 reason 供面板说明降级原因。
 * @returns 读写面、describe() 里的 ns、退化原因
 */
export declare function attachSettings(ctx: CalendarPluginContext, cfg: CalendarConfig): {
    face: CalendarSettingsFace;
    reason?: string;
    ns: string;
};
/**
 * 插件入口：惰性解析配置，注册七个日历工具。
 * @param ctx 宿主上下文（至少含 tools.register）
 * @param config 插件配置，可缺省
 */
export declare function apply(ctx: CalendarPluginContext, config?: CalendarConfig | null): void;
/**
 * 邮件日程识别模块的装配点：挂路由、懒接模型、起轮询。
 * 全部走局部 inject，顶层仍只有 tools / settings；宿主缺哪个服务都只是降级。
 * 轮询固定 15 秒一跳、累计够 pollSeconds 才真跑，面板改间隔下一次即生效。
 */
export declare function installMailModule(ctx: CalendarPluginContext): MailBackend;
export * from './parameters.js';
export * from './config.js';
export * from './ical.js';
export * from './backend.js';
export * from './aggregate.js';
export * from './caldav.js';
export * from './tools.js';
export * from './web.js';
export * from './settings.js';
export * from './store.js';
export * from './host-settings.js';
export * from './import-ical.js';
export * from './import-web.js';
export { liveConfig } from './host-config.js';
export * from './mail/types.js';
export * from './mail/extract.js';
export * from './mail/store.js';
export * from './mail/client.js';
export * from './mail/backend.js';
export * from './mail/web.js';
