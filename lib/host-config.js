/**
 * Harness 0.1.7 起可编辑字段住在 profile，插件拿到的是活引用。
 *
 * 1. 用 schemastery 声明 entry Config：字段标 .volatile() 即时生效；凭据标 role('secret')，
 *    不经设置接口回到浏览器。
 * 2. liveConfig 把活引用摊平成普通值：老宿主给字面量，新宿主给 { get() }。
 * @module dsh-calendar-pro/host-config
 */
import z from '@deepseek-ai/schemastery';
/**
 * Entry Config 形状，与 CalendarSettingsSchema 一一对应，但无默认值：
 * 「没填」保持 undefined，否则默认值会盖掉 cordis.patch.yml 与 provider 预设。
 */
export const Config = z.object({
    provider: z.string().volatile(),
    /** 数据源选择：local = 本地日历，caldav = 远程。取值合法性由 resolveBackendKind 校验。 */
    backend: z.string().volatile(),
    caldavUrl: z.string().volatile(),
    username: z.string().volatile(),
    password: z.string().role('secret').volatile(),
    host: z.string().volatile(),
    user: z.string().volatile(),
    calendar: z.string().volatile(),
    calendarId: z.string().volatile(),
    authMethod: z.string().volatile(),
    clientId: z.string().volatile(),
    clientSecret: z.string().role('secret').volatile(),
    refreshToken: z.string().role('secret').volatile(),
    tokenUrl: z.string().volatile(),
    proxyUrl: z.string().volatile(),
});
/** 活引用视图；同时接受老宿主与直接调用方给的普通值。 */
export function liveConfig(config) {
    return new Proxy(config, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            return value !== null && typeof value === 'object' && typeof value.get === 'function'
                ? value.get()
                : value;
        },
    });
}
