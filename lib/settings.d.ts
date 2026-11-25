/**
 * 面板「连接设置」写入宿主 settings 命名空间（settings.yaml）。
 *
 * cordis.patch.yml 是基座：settings 里没设过的字段由它兜底，老用户的 YAML 配置不会失效
 * （toCalendarConfig 只投影用户真正设过的字段）。密码走 role(secret)，不进日志与导出。
 */
import z from 'schemastery';
import { type CalendarAuthMethod, type CalendarConfig, type CalendarProvider } from './config.js';
/** 本插件独占的 settings 命名空间；带 -pro 后缀，不与原插件的 dsh-calendar 段抢位置。 */
export declare const SETTINGS_NAMESPACE = "dsh-calendar-pro";
/**
 * 面板表单形状。空串表示「没设置」，YAML 配置与面板写入可共存。
 */
export declare const CalendarSettingsSchema: z<Schemastery.ObjectS<{
    /** 数据源：local / caldav；空串表示「还没选」，面板据此显示首启页。 */
    backend: z<string, string>;
    provider: z<string, string>;
    caldavUrl: z<string, string>;
    username: z<string, string>;
    password: z<string, string>;
    host: z<string, string>;
    user: z<string, string>;
    calendar: z<string, string>;
    calendarId: z<string, string>;
    authMethod: z<string, string>;
    clientId: z<string, string>;
    clientSecret: z<string, string>;
    refreshToken: z<string, string>;
    tokenUrl: z<string, string>;
    proxyUrl: z<string, string>;
    /**
     * 同一账户下的多本日历（JSON 数组字符串）。
     * 存字符串而不是对象数组：entry 配置、settings、兜底文件三条落盘路径都按扁平字符串处理，
     * 凭据不会跟着数组走到 settings 描述符里。
     */
    calendarList: z<string, string>;
}>, Schemastery.ObjectT<{
    /** 数据源：local / caldav；空串表示「还没选」，面板据此显示首启页。 */
    backend: z<string, string>;
    provider: z<string, string>;
    caldavUrl: z<string, string>;
    username: z<string, string>;
    password: z<string, string>;
    host: z<string, string>;
    user: z<string, string>;
    calendar: z<string, string>;
    calendarId: z<string, string>;
    authMethod: z<string, string>;
    clientId: z<string, string>;
    clientSecret: z<string, string>;
    refreshToken: z<string, string>;
    tokenUrl: z<string, string>;
    proxyUrl: z<string, string>;
    /**
     * 同一账户下的多本日历（JSON 数组字符串）。
     * 存字符串而不是对象数组：entry 配置、settings、兜底文件三条落盘路径都按扁平字符串处理，
     * 凭据不会跟着数组走到 settings 描述符里。
     */
    calendarList: z<string, string>;
}>>;
export interface CalendarSettingsValue {
    backend: string;
    provider: string;
    caldavUrl: string;
    username: string;
    password: string;
    host: string;
    user: string;
    calendar: string;
    calendarId: string;
    authMethod: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    tokenUrl: string;
    proxyUrl: string;
    calendarList: string;
}
/** 把一行 cordis.patch.yml 的配置投影成 schema 的 base（只带有值的字段）。 */
export declare function toSettingsBase(config: CalendarConfig | undefined): Partial<CalendarSettingsValue>;
/**
 * settings 值 → CalendarConfig。
 * user 记录用户真正改过的键，只有它列出的字段会被投影，schema 默认值不会擦掉
 * cordis.patch.yml 里的配置。传 null 表示按草稿全量投影（保存与测试连接）。
 */
export declare function toCalendarConfig(value: Partial<CalendarSettingsValue> | undefined, user?: Partial<CalendarSettingsValue> | null): CalendarConfig;
/** 连接测试用的「拟议配置」：草稿全量投影，不经过已存值。 */
export declare function draftToConfig(draft: Partial<CalendarSettingsValue> | undefined): CalendarConfig;
/**
 * 写入前的温和校验：结构错误立即抛（中文，面板直接显示），不完整配置放行，
 * 地址拼装留给 resolveConfig。
 */
export declare function validateSettingsValue(value: Partial<CalendarSettingsValue> | undefined): void;
export type { CalendarAuthMethod, CalendarProvider };
