/**
 * 宿主 settings 服务的两代接口判定。
 *
 * 插件只消费宿主设置服务，不自建配置迁移通道：
 *   - 0.1.7 起：宿主把 entry 的 Config 投影成表单，插件不再注册命名空间，
 *     读写都按 entry id 走（describe / mutate / replace）。
 *   - 0.1.6 及更早：插件在加载阶段注册自己的命名空间。
 * 两边都拿不到服务时，调用方退化为插件自己的兜底文件，而不是抛。
 *
 * @module dsh-calendar-pro/host-settings
 */
/**
 * 取宿主 settings 服务：优先 `ctx.get`（不必声明 inject），退回属性访问。
 * 两边都拿不到就返回 undefined —— 调用方据此退化，而不是抛。
 */
export function settingsProviderOf(ctx) {
    let provider;
    try {
        provider = typeof ctx?.get === 'function' ? ctx.get('settings') : undefined;
    }
    catch {
        provider = undefined;
    }
    if (provider === undefined || provider === null) {
        try {
            provider = ctx?.settings;
        }
        catch {
            provider = undefined;
        }
    }
    return provider === undefined || provider === null ? undefined : provider;
}
/** 0.1.6 及更早：插件在加载阶段注册自己的命名空间。 */
export function isLegacyProvider(provider) {
    return provider !== undefined && typeof provider.register === 'function' && typeof provider.replace === 'function';
}
/**
 * 0.1.7 起：宿主把 entry 的 Config 投影成表单，插件不再注册，
 * 读写都按 entry id 走（describe / update / replace）。
 */
export function isFormsProvider(provider) {
    return provider !== undefined && typeof provider.register !== 'function'
        && typeof provider.describe === 'function' && typeof provider.replace === 'function'
        && typeof provider.update === 'function';
}
/** 本实例在 profile 里的 entry id；拿不到时用组合包补丁里的行 id。 */
export function entryIdOf(ctx, fallback) {
    const id = ctx?.fiber?.entry?.options?.id;
    return typeof id === 'string' && id !== '' ? id : fallback;
}
