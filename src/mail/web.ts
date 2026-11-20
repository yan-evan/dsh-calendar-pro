/**
 * 邮件日程面板的同源路由：`/_dsh/dsh-calendar-pro/mail`。
 *
 * 沿用设置路由的四层校验（回环地址、Host、JSON + Origin、不回显凭证），
 * 另加自定义头 `X-DSH-Calendar-Pro-Mail: 1`：跨源页面无法在预检之外伪造该头，
 * 写操作多一层 CSRF 防护，日志里也能区分读邮件状态与改日历。
 * @module dsh-calendar-pro/mail/web
 */

import { readJsonBody } from '../http-body.js'
import { hostVerdict, postVerdict } from '../web.js'
import type { MailBackend } from './backend.js'

export const MAIL_ROUTE = '/_dsh/dsh-calendar-pro/mail'

/** 写操作的来源标记；面板的 mailApi() 必带。 */
export const MAIL_HEADER = 'x-dsh-calendar-pro-mail'

const LOCAL_REMOTES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function respond(res: any, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  }
  if (typeof res.end === 'function') res.end(text)
}

/** 把 MailBackend 包成一个 http handler；所有门禁都在这里，动作本身不关心 http。 */
export function mailHandler(backend: MailBackend): (req: any, res: any) => Promise<void> {
  return async (req: any, res: any): Promise<void> => {
    const remote = String(req.socket?.remoteAddress ?? '')
    if (!LOCAL_REMOTES.has(remote)) {
      respond(res, 403, { ok: false, error: { code: 'forbidden', message: 'dsh-calendar-pro mail route is localhost-only' } })
      return
    }
    const headers = (req.headers ?? {}) as Record<string, unknown>
    const host = hostVerdict(headers.host)
    if (host !== undefined) {
      respond(res, 403, { ok: false, error: { code: 'forbidden', message: host } })
      return
    }
    if (headers[MAIL_HEADER] === undefined) {
      respond(res, 403, { ok: false, error: { code: 'forbidden', message: 'missing ' + MAIL_HEADER + ' header' } })
      return
    }
    if (req.method !== 'POST') {
      respond(res, 200, { ok: true, value: backend.status() })
      return
    }
    const post = postVerdict(headers)
    if (post !== undefined) {
      respond(res, post.status, {
        ok: false,
        error: { code: post.status === 415 ? 'unsupported-media-type' : 'forbidden', message: post.message },
      })
      return
    }
    const controller = new AbortController()
    const disconnect = (): void => { if (!res.writableEnded) controller.abort(new Error('请求已中断')) }
    res.once?.('close', disconnect)
    try {
      const body = await readJsonBody(req)
      const action = body !== null && typeof body === 'object' && typeof (body as Record<string, unknown>).action === 'string'
        ? String((body as Record<string, unknown>).action)
        : ''
      const value = await backend.dispatch(action, body as Record<string, unknown>, controller.signal)
      respond(res, 200, { ok: true, value })
    } catch (error) {
      if (res.destroyed) return
      respond(res, 400, { ok: false, error: { code: 'rejected', message: error instanceof Error ? error.message : String(error) } })
    } finally {
      res.off?.('close', disconnect)
    }
  }
}

/** 把邮件路由挂到宿主 webserver；插件卸载时随 effect 一起摘掉。 */
export function installMailWeb(ctx: any, backend: MailBackend): void {
  ctx.inject(['webServer'], (webCtx: any) => {
    webCtx.effect(() => {
      return webCtx.webServer.register({
        kind: 'exact',
        path: MAIL_ROUTE,
        handler: mailHandler(backend),
      })
    }, 'dsh-calendar-pro: mail route')
  })
}
