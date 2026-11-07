export interface DiscoveredCalendar {
    name: string;
    url: string;
}
export interface DiscoverOptions {
    username: string;
    password: string;
    proxyUrl?: string;
    /** 测试注入：不填时用真实 fetch（或代理 fetch）。 */
    fetchImpl?: typeof globalThis.fetch;
    timeoutMs?: number;
}
/** 返回可选日历列表；凭据不落盘，调用方负责把选中的 url 填进连接表单。 */
export declare function discoverIcloudCalendars(options: DiscoverOptions): Promise<DiscoveredCalendar[]>;
