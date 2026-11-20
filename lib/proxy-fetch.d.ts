/**
 * 构造把所有请求路由到 proxyUrl 的 fetch，供 tsdav 注入。
 * @param proxyUrl 如 http://127.0.0.1:7890
 */
export declare function createProxyFetch(proxyUrl: string): typeof globalThis.fetch;
