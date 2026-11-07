/** $DSH_HOME/data/dsh-calendar-pro/connection.json（DSH_HOME 缺省 ~/.dsh）。 */
export declare function connectionFile(env?: NodeJS.ProcessEnv): string;
/** $DSH_HOME/data/dsh-calendar-pro/calendar.json：本地日历的唯一数据文件。 */
export declare function calendarFile(env?: NodeJS.ProcessEnv): string;
/** 读 JSON；不存在、坏文件、类型不对都回落到调用方给的默认值。 */
export declare function readJsonFile<T>(file: string, fallback: T): T;
/** 先写临时文件再改名：中途失败不会留下半份数据；权限收到 0600。 */
export declare function writeJsonAtomic(file: string, value: unknown): void;
export interface StoredConnection {
    revision: number;
    value: Record<string, unknown>;
}
/** 读兜底文件；不存在、坏了、被改成非对象都当「没有配置」处理（面板会显示引导态）。 */
export declare function readConnectionFile(file?: string): StoredConnection;
/** 先写临时文件再改名：中途失败不会留下半份配置。 */
export declare function writeConnectionFile(stored: StoredConnection, file?: string): void;
