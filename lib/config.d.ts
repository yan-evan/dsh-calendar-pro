/**
 * 配置解析：provider 预设 + 手填 URL，调用时惰性解析。
 * 配置缺失不阻止插件加载，只在工具执行时抛带中文指引的错误。
 * @module dsh-calendar-pro/config
 */
/** 支持的 provider 预设。 */
export type CalendarProvider = 'google' | 'icloud' | 'nextcloud' | 'custom';
export type CalendarAuthMethod = 'basic' | 'oauth';
/**
 * 数据源：本地日历或远程 CalDAV，互斥生效。
 * undefined 是合法状态：用户还没选，面板显示首启页，不产生任何数据源。
 */
export type BackendKind = 'local' | 'caldav';
/** 长期 OAuth 凭据；短期 access token 只保留在运行时内存中。 */
export interface CalendarOAuthCredentials {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}
/** 插件配置：可在 profile 的 cordis.patch.yml 覆盖 calendar 行的整个 config。 */
export interface CalendarConfig {
    /** 数据源；缺省表示「还没选过」，由面板显示首启页。 */
    backend?: BackendKind;
    /** provider 预设；默认 custom。 */
    provider?: CalendarProvider;
    /** 完整日历集合 URL；custom / icloud 必填，google / nextcloud 可由此手填覆盖预设。 */
    caldavUrl?: string;
    /** Basic 认证账号；OAuth 不要求此字段。 */
    username?: string;
    /** Basic 密码；支持 DSH_CALENDAR_PASSWORD。iCloud 请用应用专用密码；Google 不支持 Basic。 */
    password?: string;
    /** google 默认 oauth，其他 provider 默认 basic；Google 不允许 basic。 */
    authMethod?: CalendarAuthMethod;
    /** OAuth 客户端 ID；也可用 DSH_CALENDAR_CLIENT_ID。 */
    clientId?: string;
    /** OAuth 客户端密钥；推荐用 DSH_CALENDAR_CLIENT_SECRET。 */
    clientSecret?: string;
    /** OAuth 离线授权的刷新令牌；推荐用 DSH_CALENDAR_REFRESH_TOKEN。 */
    refreshToken?: string;
    /** OAuth 令牌端点；Google 自动使用官方端点，其他 provider 的 OAuth 必填。 */
    tokenUrl?: string;
    /** google：日历 ID（通常是你的邮箱地址）。 */
    calendarId?: string;
    /** nextcloud：主机，如 https://cloud.example.com。 */
    host?: string;
    /** nextcloud：用户名。 */
    user?: string;
    /** nextcloud：日历名。 */
    calendar?: string;
    /**
     * 同一账户下的多本日历（JSON 数组字符串），形如
     * `[{"url":"https://caldav.icloud.com/123/calendars/home/","name":"家庭"}]`。
     *
     * 用字符串而不是对象数组，是为了让「entry 配置 / settings / 兜底文件」三条落盘路径
     * 都按扁平字符串处理：嵌套对象数组在各代宿主的读写面上没有保证，凭据也不该跟着数组走。
     * 缺省（或解析为空）时只用 caldavUrl 指的那一本，行为与旧版本完全一致。
     */
    calendarList?: string;
    /**
     * HTTP 代理地址，如 http://127.0.0.1:7890。只作用于本插件的请求；能直连时留空。
     */
    proxyUrl?: string;
}
/** 同一账户下的一本日历集合。 */
export interface CalendarRef {
    /** 规范化后的集合 URL（保留末尾斜杠、去掉查询串与片段）。 */
    url: string;
    /** 展示名；缺省时由 URL 推导，见 calendarNameOf。 */
    name?: string;
}
/** 一个读取目标：某本日历 + 解析完成的凭据。 */
export interface CalendarTarget {
    ref: CalendarRef;
    config: ResolvedConfig;
}
/** 一次能连接的最大日历数；超过多半是配置写错了，也避免把工具调用拖成几十个请求。 */
export declare const MAX_CALENDARS = 16;
/** 解析完成、可直接建客户端的配置。 */
export interface ResolvedConfig {
    provider: CalendarProvider;
    caldavUrl: string;
    username: string;
    password: string;
    oauth?: CalendarOAuthCredentials;
    proxyUrl: string;
}
/** 预设端点常量。 */
export declare const GOOGLE_CALDAV_PREFIX = "https://apidata.googleusercontent.com/caldav/v2/";
export declare const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export declare const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";
export declare const NEXTCLOUD_PATH = "/remote.php/dav/calendars/";
/** 配置错误：带中文指引，模型和用户都能读。 */
export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare const CALENDAR_PROVIDERS: readonly CalendarProvider[];
/**
 * 生效的数据源，优先级从高到低：
 * 1. 显式 backend（面板选中或 YAML 手写）；
 * 2. 旧配置里已有 CalDAV 端点或凭据，视为 caldav，升级后不会被首启页拦住；
 * 3. 都没有 → undefined。
 * 这里不能默认 local，否则「首次进入」与「已有本地日历」无法区分。
 */
export declare function resolveBackendKind(config: CalendarConfig | undefined): BackendKind | undefined;
/**
 * 解析为可用的 caldavUrl + 凭证；缺失时抛 ConfigError（中文指引）。
 * @param config 插件 config，可能为 undefined
 * @param env 环境变量来源，测试可注入
 */
export declare function resolveConfig(config: CalendarConfig | undefined, env?: NodeJS.ProcessEnv): ResolvedConfig;
/** 默认日历的集合地址（不解析凭据）：自检与提示文案用它，避免为了报地址先要求账号。 */
export declare function resolveCollectionUrl(config: CalendarConfig | undefined): string;
/** Google 必须使用 OAuth；其他 provider 不会被环境中的 Google 凭据切换认证方式。 */
export declare function resolveAuthMethod(config: CalendarConfig | undefined): CalendarAuthMethod;
/** OAuth 凭据与 Bearer token 仅允许发往无 URL 内嵌凭据的 HTTPS 端点。 */
export declare function validateOAuthUrl(value: string, field: string): void;
/** 独立解析认证，供离线健康检查复用；不会发起网络请求或回显凭据。 */
export declare function resolveCredentials(config: CalendarConfig | undefined, env?: NodeJS.ProcessEnv): Pick<ResolvedConfig, 'username' | 'password' | 'oauth'>;
/** 依据 provider 预设或手填字段拼出日历集合 URL。 */
export declare function buildCaldavUrl(config: CalendarConfig, provider: CalendarProvider): string;
/**
 * 集合 URL 规范化：只接受 http(s)，不接受内嵌账号密码或片段；查询串一并丢掉。
 * 返回 undefined 表示这条不是可用的日历地址。
 */
export declare function normalizeCollectionUrl(value: unknown): string | undefined;
/** 展示名缺省值：取 URL 最后一段路径（解码后）；取不到就用主机名。 */
export declare function calendarNameOf(url: string): string;
/**
 * 解析 calendarList：同时接受 JSON 字符串与数组（YAML 手写、面板保存两种来源）。
 *
 * 条目级问题跳过而不是整体失败：一条写坏的地址不该让其余日历也连不上。
 * 但整份内容不是 JSON / 不是数组时抛 ConfigError——那是用户能照着改的结构错误。
 */
export declare function parseCalendarList(raw: unknown): CalendarRef[];
/**
 * 声明了哪些日历；一本都没有时抛中文指引。
 * calendarList 为空时退化成「caldavUrl 那一本」，旧配置不需要任何迁移动作。
 */
export declare function resolveCalendars(config: CalendarConfig | undefined): CalendarRef[];
/** 面板展示用：任何解析错误都收成空列表，由调用方决定怎么提示。 */
export declare function availableCalendars(config: CalendarConfig | undefined): CalendarRef[];
/**
 * 多日历目标：凭据解析一次、共用，集合 URL 各自一份。
 * OAuth 场景逐条校验 URL（令牌会发往这些端点），不合法立即抛错，绝不带到请求里。
 */
export declare function resolveCalendarTargets(config: CalendarConfig | undefined, env?: NodeJS.ProcessEnv): CalendarTarget[];
