import { type CalendarConfig } from './config.js';
import { type CalendarSettingsValue } from './settings.js';
import type { CalendarEvent } from './ical.js';
import type { AvailabilityInput, AvailabilityResult } from './availability.js';
/** 面板与浏览器说话的同源路由；带 -pro 后缀，避免与原插件注册同一条路由。 */
export declare const SETTINGS_ROUTE = "/_dsh/dsh-calendar-pro/settings";
/** Host 头裁决：undefined = 放行，否则给出拒绝原因。 */
export declare function hostVerdict(host: unknown): string | undefined;
/** 写操作裁决：undefined = 放行，否则给出状态码与原因。 */
export declare function postVerdict(headers: Record<string, unknown>): {
    status: number;
    message: string;
} | undefined;
/** 面板需要的服务面；测试里可以塞假的进来。 */
export interface CalendarServiceLike {
    availability?(input: AvailabilityInput, signal?: AbortSignal): Promise<AvailabilityResult>;
    get?(uid: string, signal?: AbortSignal): Promise<CalendarEvent>;
    list(start: string, end: string, options?: unknown, signal?: AbortSignal): Promise<CalendarEvent[]>;
    create(fields: unknown, signal?: AbortSignal): Promise<CalendarEvent>;
    update(uid: string, changes: unknown, signal?: AbortSignal, scope?: 'series'): Promise<CalendarEvent>;
    delete(uid: string, signal?: AbortSignal, scope?: 'series'): Promise<{
        uid: string;
        href: string;
    }>;
}
/** 面板用于读写 settings 命名空间的最小面（index.ts 在 settings 服务到位后接上）。 */
export interface CalendarSettingsFace {
    /** 'settings' = 宿主命名空间；'file' = 插件自己的兜底文件。 */
    kind?: 'settings' | 'file';
    read(): Record<string, unknown>;
    descriptor(): {
        revision?: number;
        user?: Record<string, unknown>;
    } | undefined;
    replace(value: Record<string, unknown>, revision: number): Promise<void>;
}
/**
 * 由宿主 settings provider 与 scope 组出面板的读写面。
 * 注册不在这里：宿主 register 会调用 ctx.effect，必须在插件加载的同步阶段完成。
 */
export declare function settingsFaceOf(provider: any, scope: any, ns?: string): CalendarSettingsFace;
/** 面板要读写的连接字段。空串 = 保持不变，null = 明确清除。 */
export declare const CONNECTION_KEYS: readonly ["provider", "caldavUrl", "username", "password", "host", "user", "calendar", "calendarId", "authMethod", "clientId", "clientSecret", "refreshToken", "tokenUrl", "proxyUrl"];
/**
 * 会落盘的键：连接字段与数据源选择。
 * backend 必须在内，否则 mergeConnection 会把它过滤掉，setBackend 成功但读回 null。
 */
export declare const WRITABLE_KEYS: readonly ["provider", "caldavUrl", "username", "password", "host", "user", "calendar", "calendarId", "authMethod", "clientId", "clientSecret", "refreshToken", "tokenUrl", "proxyUrl", "backend"];
/**
 * 0.1.7 宿主的读写面：数据取自本 entry 配置，不再有独立命名空间文档。
 * 与 settingsFaceOf 的差异：read 直接投影活配置；写用 mutate 逐字段 set/unset，
 * 清空才能真的清掉（replace 会重置整段字段）。宿主无 mutate 时退回 replace。
 * @param provider 宿主 settings 服务
 * @param entryId 本实例在 profile 里的 entry id，表单以它为 ns
 * @param read 读当前生效的连接字段
 */
export declare function hostFormsFaceOf(provider: any, entryId: string, read: () => Record<string, unknown>): CalendarSettingsFace;
export interface CalendarSettingsBackendOptions {
    /** 静态配置，或一个 getter（面板保存后工具应当立刻用上新配置）。 */
    config?: CalendarConfig | null | (() => CalendarConfig);
    /** 测试用：替换真实 CalDAV 客户端（收到的是当前/拟议配置）。 */
    serviceFactory?: (config: CalendarConfig) => CalendarServiceLike;
    /** 测试用：替换「保存前的连接测试」。 */
    probeFactory?: (config: CalendarConfig) => Promise<{
        count: number;
        sample: string[];
    }>;
    env?: NodeJS.ProcessEnv;
    settings?: CalendarSettingsFace;
    /** 宿主 ctx：用来懒接入 settings 服务（不赌子 fiber 的时序）。 */
    ctx?: any;
    /** settings 值变化时回调（index.ts 用它把新配置喂给工具层）。 */
    onSettings?: (value: Record<string, unknown>) => void;
    /** 注册命名空间时的 base 层（来自 cordis.patch.yml 的配置）。 */
    settingsBase?: Partial<CalendarSettingsValue>;
    /** 为什么没接上宿主 settings（面板要把它显示出来，而不是一句「不可用」）。 */
    settingsReason?: string;
    /** 表单在 describe() 里的 ns：老宿主为插件命名空间，0.1.7 起为 entry id。 */
    settingsNs?: string;
}
/** 把「已存值 + 草稿」合并成要落盘的一版：草稿里缺席的键保留原值。 */
export declare function mergeConnection(stored: Record<string, unknown>, draft: Record<string, unknown>): Record<string, unknown>;
/**
 * 浏览器端后端：面板动作翻译成 CalDAV 调用。
 * 配置缺失不抛错，status 回 configured:false，面板据此渲染引导态。
 */
export declare class CalendarSettingsBackend {
    private readonly options;
    private cachedKey;
    private cachedService;
    private settings;
    constructor(options?: CalendarSettingsBackendOptions);
    /** settings 服务到位后接上（传 undefined 摘掉）—— 面板据此从只读变成可保存。 */
    attachSettings(face: CalendarSettingsFace | undefined): void;
    /**
     * 兜底接入：注册由 index.ts 在同步阶段完成。这里只在未接上时借用既有注册，
     * 供重复 apply 的第二个实例读写（读走 describe()，写走 provider.replace）。
     */
    private ensureSettings;
    /**
     * 当前生效配置：entry 配置叠加面板写入 settings 的字段。
     * 面板自己也合并一遍，避免「显示的连接」与「工具用的连接」两个来源。
     */
    private configOf;
    /** Internal getter shared with the authenticated import carrier. Never sent to the browser. */
    currentConfig(): CalendarConfig;
    /** 切换数据源并落盘。切到远程前先验证，避免切过去后满屏读取失败。 */
    private commitBackend;
    /** 惰性解析配置；凭据/端点变化即重建（闭包内比较，不落盘不记日志）。 */
    private service;
    /**
     * 连接摘要：非敏感字段照实返回，密码只回有没有。
     * 未配置时 configured:false + reason，面板据此渲染引导态。
     */
    connection(): Record<string, unknown>;
    /** 兼容旧动作名：status 就是连接摘要。 */
    status(): Record<string, unknown>;
    /**
     * 草稿 → 拟议配置：先与已存值合并，再叠加到当前生效配置。
     * 连接测试与保存共用此路径，两者看到的配置一致。
     */
    private proposed;
    /** 真连一次：拿拟议配置列一下未来 30 天，能列出来就算通。 */
    private probe;
    private responseJson;
    /** 路由入口。GET = 读状态，POST = 动作（list/create/update/delete）。 */
    handle(req: any, res: any): Promise<void>;
    /** 动作分发。每个动作自己校验参数，错误信息面向用户（中文，面板直接显示）。 */
    private dispatch;
}
/** 把日历面板挂到宿主 webserver：ctx.inject(['webServer']) + effect，卸载即摘掉路由。 */
export declare function installCalendarSettingsWeb(ctx: any, backend: CalendarSettingsBackend): void;
