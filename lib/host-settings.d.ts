/**
 * 宿主 settings 服务两代接口的判定。
 *
 * 0.1.7+：entry Config 由宿主投影成表单，读写按 entry id 走（describe / mutate / replace）；
 * 0.1.6-：插件在加载阶段注册自己的命名空间。
 * 都拿不到时调用方退化到兜底文件，不抛错。
 * @module dsh-calendar-pro/host-settings
 */
/**
 * 取宿主 settings 服务：先 ctx.get，退回属性访问。
 * 都拿不到返回 undefined，调用方据此退化。
 */
export declare function settingsProviderOf(ctx: any): any | undefined;
/** 0.1.6 及更早：插件在加载阶段注册自己的命名空间。 */
export declare function isLegacyProvider(provider: any): boolean;
/**
 * 0.1.7+：宿主把 entry Config 投影成表单，插件不注册命名空间，
 * 读写按 entry id 走（describe / update / replace）。
 */
export declare function isFormsProvider(provider: any): boolean;
/** 本实例在 profile 里的 entry id；拿不到时用组合包补丁里的行 id。 */
export declare function entryIdOf(ctx: any, fallback: string): string;
