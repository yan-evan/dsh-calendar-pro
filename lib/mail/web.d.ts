/**
 * 邮件日程面板的同源路由：`/_dsh/dsh-calendar-pro/mail`。
 *
 * 沿用设置路由的四层校验（回环地址、Host、JSON + Origin、不回显凭证），
 * 另加自定义头 `X-DSH-Calendar-Pro-Mail: 1`：跨源页面无法在预检之外伪造该头，
 * 写操作多一层 CSRF 防护，日志里也能区分读邮件状态与改日历。
 * @module dsh-calendar-pro/mail/web
 */
import type { MailBackend } from './backend.js';
export declare const MAIL_ROUTE = "/_dsh/dsh-calendar-pro/mail";
/** 写操作的来源标记；面板的 mailApi() 必带。 */
export declare const MAIL_HEADER = "x-dsh-calendar-pro-mail";
/** 把 MailBackend 包成一个 http handler；所有门禁都在这里，动作本身不关心 http。 */
export declare function mailHandler(backend: MailBackend): (req: any, res: any) => Promise<void>;
/** 把邮件路由挂到宿主 webserver；插件卸载时随 effect 一起摘掉。 */
export declare function installMailWeb(ctx: any, backend: MailBackend): void;
