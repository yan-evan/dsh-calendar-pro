/**
 * 面板的网页后端：日历读写、导入导出、数据源切换，共用一条同源 POST 路由。
 *
 * 该路由能读全部日程并改写它们，校验四层：remoteAddress 为回环地址、
 * Host 为 localhost、写操作要求 application/json 且校验 Origin、响应不回显凭证。
 * 本层无状态，每次请求都问 CalDAV 服务器。
 */
import { createBackend, createCaldavBackend, createLocalBackend } from './backend.js'
import { readJsonBody } from './http-body.js'
import { describePlan, planMigration, runMigration } from './migrate.js'
import { EXPORT_LIMITS, exportFilename, mergeCalendars } from './export-ics.js'
import { resolveBackendKind, resolveConfig, type CalendarConfig } from './config.js'
import { SETTINGS_NAMESPACE, draftToConfig, validateSettingsValue, type CalendarSettingsValue } from './settings.js'
import { CalendarService } from './caldav.js'
import { discoverIcloudCalendars } from './discover-icloud.js'
import { asRecord, assertIsoTime, assertTimeRange, isoNoMillis, optionalString, sortEvents } from './tools.js'
import type { CalendarEvent } from './ical.js'
import type { AvailabilityInput, AvailabilityResult } from './availability.js'

/** 面板与浏览器说话的同源路由；带 -pro 后缀，避免与原插件注册同一条路由。 */
export const SETTINGS_ROUTE = '/_dsh/dsh-calendar-pro/settings'

/** 回环主机名白名单；带端口会被拆掉，IPv6 字面量保留方括号。 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Host 头裁决：undefined = 放行，否则给出拒绝原因。 */
export function hostVerdict(host: unknown): string | undefined {
  if (typeof host !== 'string' || host.trim() === '') return undefined
  const text = host.trim().toLowerCase()
  const name = text.startsWith('[') ? text.slice(0, text.indexOf(']') + 1) : text.split(':')[0]!
  return LOCAL_HOSTNAMES.has(name) ? undefined : `host "${host}" is not a localhost name`
}

/** 写操作裁决：undefined = 放行，否则给出状态码与原因。 */
export function postVerdict(headers: Record<string, unknown>): { status: number; message: string } | undefined {
  const contentType = String(headers['content-type'] ?? '')
  if (!contentType.toLowerCase().includes('application/json')) {
    return { status: 415, message: 'dsh-calendar-pro settings route accepts application/json only' }
  }
  const origin = headers.origin
  if (typeof origin === 'string' && origin.trim() !== '') {
    const text = origin.trim()
    // 沙箱 iframe 会发 Origin: null，这种请求一律拒绝。
    if (text === 'null') {
      return { status: 403, message: 'origin "null" is not allowed to write dsh-calendar-pro events' }
    }
    let url: URL | undefined
    try {
      url = new URL(text)
    } catch {
      url = undefined
    }
    // 只拦外部网页。桌面宿主的 dsh-app:// 与本地 http(s) 放行；跨源请求仍被
    // application/json 预检挡住，本路由不返回 CORS 头。
    if (url !== undefined && (url.protocol === 'http:' || url.protocol === 'https:')
      && !LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
      return { status: 403, message: `origin "${origin}" is not allowed to write dsh-calendar-pro events` }
    }
  }
  // 不按 sec-fetch-site 拒绝：dsh-app:// 到 127.0.0.1 会被标成 cross-site，
  // 按它拒绝会让应用内写操作全部 403。
  return undefined
}

/** 面板需要的服务面；测试里可以塞假的进来。 */
export interface CalendarServiceLike {
  availability?(input: AvailabilityInput, signal?: AbortSignal): Promise<AvailabilityResult>
  get?(uid: string, signal?: AbortSignal): Promise<CalendarEvent>
  list(start: string, end: string, options?: unknown, signal?: AbortSignal): Promise<CalendarEvent[]>
  create(fields: unknown, signal?: AbortSignal): Promise<CalendarEvent>
  update(uid: string, changes: unknown, signal?: AbortSignal, scope?: 'series'): Promise<CalendarEvent>
  delete(uid: string, signal?: AbortSignal, scope?: 'series'): Promise<{ uid: string; href: string }>
}

/** 面板用于读写 settings 命名空间的最小面（index.ts 在 settings 服务到位后接上）。 */
export interface CalendarSettingsFace {
  /** 'settings' = 宿主命名空间；'file' = 插件自己的兜底文件。 */
  kind?: 'settings' | 'file'
  read(): Record<string, unknown>
  descriptor(): { revision?: number; user?: Record<string, unknown> } | undefined
  replace(value: Record<string, unknown>, revision: number): Promise<void>
}

/**
 * 由宿主 settings provider 与 scope 组出面板的读写面。
 * 注册不在这里：宿主 register 会调用 ctx.effect，必须在插件加载的同步阶段完成。
 */
export function settingsFaceOf(provider: any, scope: any, ns: string = SETTINGS_NAMESPACE): CalendarSettingsFace {
  const findRow = (): any => (typeof provider.describe === 'function' ? provider.describe() ?? [] : [])
    .find((row: any) => row !== undefined && row !== null && row.ns === ns)
  return {
    kind: 'settings',
    read: (): Record<string, unknown> => {
      if (scope !== undefined && scope !== null && typeof scope.get === 'function') {
        const value = scope.get()
        if (value !== undefined && value !== null) return value as Record<string, unknown>
      }
      const row = findRow()
      const value = row === undefined ? undefined : (row.value ?? row.user)
      return (value ?? {}) as Record<string, unknown>
    },
    descriptor: () => findRow(),
    replace: async (value: Record<string, unknown>, revision: number): Promise<void> => {
      await provider.replace(ns, value, revision)
    },
  }
}

/** 面板要读写的连接字段。空串 = 保持不变，null = 明确清除。 */
export const CONNECTION_KEYS = ['provider', 'caldavUrl', 'username', 'password', 'host', 'user', 'calendar', 'calendarId', 'authMethod', 'clientId', 'clientSecret', 'refreshToken', 'tokenUrl', 'proxyUrl'] as const

/**
 * 会落盘的键：连接字段与数据源选择。
 * backend 必须在内，否则 mergeConnection 会把它过滤掉，setBackend 成功但读回 null。
 */
export const WRITABLE_KEYS = [...CONNECTION_KEYS, 'backend'] as const

/**
 * 0.1.7 宿主的读写面：数据取自本 entry 配置，不再有独立命名空间文档。
 * 与 settingsFaceOf 的差异：read 直接投影活配置；写用 mutate 逐字段 set/unset，
 * 清空才能真的清掉（replace 会重置整段字段）。宿主无 mutate 时退回 replace。
 * @param provider 宿主 settings 服务
 * @param entryId 本实例在 profile 里的 entry id，表单以它为 ns
 * @param read 读当前生效的连接字段
 */
export function hostFormsFaceOf(
  provider: any,
  entryId: string,
  read: () => Record<string, unknown>,
): CalendarSettingsFace {
  const findRow = (): any => (typeof provider.describe === 'function' ? provider.describe() ?? [] : [])
    .find((row: any) => row !== undefined && row !== null && row.ns === entryId)
  return {
    kind: 'settings',
    read,
    descriptor: () => findRow(),
    replace: async (value: Record<string, unknown>, revision: number): Promise<void> => {
      if (typeof provider.mutate === 'function') {
        const ops = WRITABLE_KEYS.map(key => Object.hasOwn(value, key)
          ? { op: 'set' as const, path: [key as string], value: value[key as string] }
          : { op: 'unset' as const, path: [key as string] })
        await provider.mutate(entryId, ops, revision)
        return
      }
      await provider.replace(entryId, { ...value }, revision)
    },
  }
}

export interface CalendarSettingsBackendOptions {
  /** 静态配置，或一个 getter（面板保存后工具应当立刻用上新配置）。 */
  config?: CalendarConfig | null | (() => CalendarConfig)
  /** 测试用：替换真实 CalDAV 客户端（收到的是当前/拟议配置）。 */
  serviceFactory?: (config: CalendarConfig) => CalendarServiceLike
  /** 测试用：替换「保存前的连接测试」。 */
  probeFactory?: (config: CalendarConfig) => Promise<{ count: number; sample: string[] }>
  env?: NodeJS.ProcessEnv
  settings?: CalendarSettingsFace
  /** 宿主 ctx：用来懒接入 settings 服务（不赌子 fiber 的时序）。 */
  ctx?: any
  /** settings 值变化时回调（index.ts 用它把新配置喂给工具层）。 */
  onSettings?: (value: Record<string, unknown>) => void
  /** 注册命名空间时的 base 层（来自 cordis.patch.yml 的配置）。 */
  settingsBase?: Partial<CalendarSettingsValue>
  /** 为什么没接上宿主 settings（面板要把它显示出来，而不是一句「不可用」）。 */
  settingsReason?: string
  /** 表单在 describe() 里的 ns：老宿主为插件命名空间，0.1.7 起为 entry id。 */
  settingsNs?: string
}

/** 把「已存值 + 草稿」合并成要落盘的一版：草稿里缺席的键保留原值。 */
export function mergeConnection(stored: Record<string, unknown>, draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of WRITABLE_KEYS) {
    const value = stored[key]
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  for (const key of WRITABLE_KEYS) {
    if (!(key in draft)) continue
    const value = draft[key]
    if (value === null) { delete out[key]; continue }
    if (typeof value !== 'string') continue
    if (value === '') continue
    out[key] = value
  }
  return out
}

/**
 * 浏览器端后端：面板动作翻译成 CalDAV 调用。
 * 配置缺失不抛错，status 回 configured:false，面板据此渲染引导态。
 */
export class CalendarSettingsBackend {
  private cachedKey: string | undefined
  private cachedService: CalendarServiceLike | undefined
  private settings: CalendarSettingsFace | undefined

  constructor(private readonly options: CalendarSettingsBackendOptions = {}) {
    this.settings = options.settings
  }

  /** settings 服务到位后接上（传 undefined 摘掉）—— 面板据此从只读变成可保存。 */
  attachSettings(face: CalendarSettingsFace | undefined): void {
    this.settings = face
  }

/**
 * 兜底接入：注册由 index.ts 在同步阶段完成。这里只在未接上时借用既有注册，
 * 供重复 apply 的第二个实例读写（读走 describe()，写走 provider.replace）。
 */
  private ensureSettings(): void {
    if (this.settings !== undefined) return
    const ctx = this.options.ctx
    if (ctx === undefined || ctx === null) return
    let provider: any
    try { provider = typeof ctx.get === 'function' ? ctx.get('settings') : undefined } catch (error) { provider = undefined }
    if (provider === undefined || provider === null) {
      try { provider = ctx.settings } catch (error) { provider = undefined }
    }
    if (provider === undefined || provider === null || typeof provider.replace !== 'function') return
    // 描述符里有本命名空间才说明接得上，否则写入无效。
    const ns = this.options.settingsNs ?? SETTINGS_NAMESPACE
    const known = (typeof provider.describe === 'function' ? provider.describe() ?? [] : []).some((row: any) => row !== undefined && row !== null && row.ns === ns)
    if (known !== true) return
    this.attachSettings(settingsFaceOf(provider, undefined, ns))
  }


/**
 * 当前生效配置：entry 配置叠加面板写入 settings 的字段。
 * 面板自己也合并一遍，避免「显示的连接」与「工具用的连接」两个来源。
 */
  private configOf(): CalendarConfig {
    this.ensureSettings()
    const source = this.options.config
    const base = (typeof source === 'function' ? source() : source) ?? {}
    const stored = this.settings?.read?.()
    if (stored === undefined || stored === null) return base
    return { ...base, ...draftToConfig(stored as Partial<CalendarSettingsValue>) }
  }

  /** Internal getter shared with the authenticated import carrier. Never sent to the browser. */
  currentConfig(): CalendarConfig { return this.configOf() }

/** 切换数据源并落盘。切到远程前先验证，避免切过去后满屏读取失败。 */
  private async commitBackend(value: 'local' | 'caldav'): Promise<void> {
    const face = this.settings
    if (face === undefined) {
      throw new Error('当前宿主的 settings 服务不可用：请在 profile 的 cordis.patch.yml 里配置 dsh-calendar-pro 后重启')
    }
    if (value === 'caldav') resolveConfig(this.configOf(), this.options.env ?? process.env)
    const merged = mergeConnection(((face.read?.() ?? {}) as Record<string, unknown>), { backend: value })
    await face.replace(merged, face.descriptor()?.revision ?? 0)
    try { this.options.onSettings?.(merged) } catch (error) { /* 宿主回调失败不影响本次切换 */ }
    this.cachedService = undefined
    this.cachedKey = undefined
  }

  /** 惰性解析配置；凭据/端点变化即重建（闭包内比较，不落盘不记日志）。 */
  private service(): CalendarServiceLike {
    const current = this.configOf()
    if (this.options.serviceFactory !== undefined) return this.options.serviceFactory(current)
    const caldav = resolveBackendKind(current) === 'caldav'
    // 本地后端无状态，按 kind 复用；caldav 按完整解析结果比较，凭据变了不复用旧 token。
    const key = caldav ? 'caldav|' + JSON.stringify(resolveConfig(current, this.options.env ?? process.env)) : 'local'
    if (this.cachedService === undefined || this.cachedKey !== key) {
      this.cachedService = createBackend(current, this.options.env ?? process.env) as unknown as CalendarServiceLike
      this.cachedKey = key
    }
    return this.cachedService
  }

/**
 * 连接摘要：非敏感字段照实返回，密码只回有没有。
 * 未配置时 configured:false + reason，面板据此渲染引导态。
 */
  connection(): Record<string, unknown> {
    const stored = ((this.settings?.read?.() ?? {}) as Record<string, unknown>)
    const effective = this.configOf()
    const descriptor = this.settings?.descriptor?.()
    let configured = false
    let reason: string | undefined
    try {
      resolveConfig(effective, this.options.env ?? process.env)
      configured = true
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    const text = (key: string): string => {
      const value = stored[key]
      if (typeof value === 'string' && value !== '') return value
      const resolved = (effective as Record<string, unknown>)[key]
      return typeof resolved === 'string' ? resolved : ''
    }
    const env = this.options.env ?? process.env
    const hasCredential = (key: string, envKey: string): boolean =>
      text(key).trim() !== '' || (typeof env[envKey] === 'string' && env[envKey]!.trim() !== '')
    return {
      /** 数据源；null = 用户还没选过（面板显示首启页）。 */
      backend: resolveBackendKind(effective) ?? null,
      configured,
      ...(reason !== undefined ? { reason } : {}),
      settingsAvailable: this.settings !== undefined,
      ...(this.settings?.kind !== undefined ? { settingsKind: this.settings.kind } : {}),
      ...(this.options.settingsReason !== undefined ? { settingsReason: this.options.settingsReason } : {}),
      revision: descriptor?.revision ?? 0,
      provider: text('provider'),
      caldavUrl: text('caldavUrl'),
      username: text('username'),
      host: text('host'),
      user: text('user'),
      calendar: text('calendar'),
      calendarId: text('calendarId'),
      authMethod: text('authMethod'),
      clientId: text('clientId'),
      tokenUrl: text('tokenUrl'),
      proxyUrl: text('proxyUrl'),
      hasPassword: hasCredential('password', 'DSH_CALENDAR_PASSWORD'),
      hasClientSecret: hasCredential('clientSecret', 'DSH_CALENDAR_CLIENT_SECRET'),
      hasRefreshToken: hasCredential('refreshToken', 'DSH_CALENDAR_REFRESH_TOKEN'),
    }
  }

  /** 兼容旧动作名：status 就是连接摘要。 */
  status(): Record<string, unknown> {
    return this.connection()
  }

/**
 * 草稿 → 拟议配置：先与已存值合并，再叠加到当前生效配置。
 * 连接测试与保存共用此路径，两者看到的配置一致。
 */
  private proposed(draft: Record<string, unknown>): { stored: Record<string, unknown>; config: CalendarConfig } {
    const storedValue = ((this.settings?.read?.() ?? {}) as Record<string, unknown>)
    const stored = mergeConnection(storedValue, draft)
    return { stored, config: { ...this.configOf(), ...draftToConfig(stored as Partial<CalendarSettingsValue>) } }
  }

  /** 真连一次：拿拟议配置列一下未来 30 天，能列出来就算通。 */
  private async probe(config: CalendarConfig): Promise<{ count: number; sample: string[] }> {
    if (this.options.probeFactory !== undefined) return await this.options.probeFactory(config)
    const service = this.options.serviceFactory !== undefined
      ? this.options.serviceFactory(config)
      : (new CalendarService(resolveConfig(config, this.options.env ?? process.env)) as unknown as CalendarServiceLike)
    const now = new Date()
    const events = await service.list(isoNoMillis(now.toISOString()), isoNoMillis(new Date(now.getTime() + 30 * 86400000).toISOString()), { expand: false, maxOccurrences: 5 })
    return { count: events.length, sample: events.slice(0, 3).map((event) => event.summary) }
  }

  private responseJson(res: any, status: number, payload: unknown): void {
    const text = JSON.stringify(payload)
    if (typeof res.writeHead === 'function') {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    }
    if (typeof res.end === 'function') res.end(text)
  }

  /** 路由入口。GET = 读状态，POST = 动作（list/create/update/delete）。 */
  async handle(req: any, res: any): Promise<void> {
    // 每次请求前试一次：settings 服务晚到、或上一个实例刚卸载，都能在这一刻补上。
    this.ensureSettings()
    const remote = String(req.socket?.remoteAddress ?? '')
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      this.responseJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'dsh-calendar-pro settings route is localhost-only' } })
      return
    }
    const headers = (req.headers ?? {}) as Record<string, unknown>
    const host = hostVerdict(headers.host)
    if (host !== undefined) {
      this.responseJson(res, 403, { ok: false, error: { code: 'forbidden', message: host } })
      return
    }
    if (req.method !== 'POST') {
      this.responseJson(res, 200, { ok: true, value: this.status() })
      return
    }
    const post = postVerdict(headers)
    if (post !== undefined) {
      this.responseJson(res, post.status, {
        ok: false,
        error: { code: post.status === 415 ? 'unsupported-media-type' : 'forbidden', message: post.message },
      })
      return
    }
    const requestController = new AbortController()
    const disconnect = () => { if (!res.writableEnded) requestController.abort(new Error('空闲查询已取消')) }
    res.once?.('close', disconnect)
    try {
      const body = await readJsonBody(req)
      const value = await this.dispatch(asRecord(body), requestController.signal)
      this.responseJson(res, 200, { ok: true, value })
    } catch (error) {
      if (res.destroyed) return
      const message = error instanceof Error ? error.message : String(error)
      this.responseJson(res, 400, { ok: false, error: { code: 'rejected', message } })
    } finally { res.off?.('close', disconnect) }
  }

  /** 动作分发。每个动作自己校验参数，错误信息面向用户（中文，面板直接显示）。 */
  private async dispatch(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const action = typeof body.action === 'string' ? body.action : ''
    if (action === 'status' || action === 'connection') return this.connection()
    // 只读查 npm 上的最新版本；网络异常一律返回 null，前端静默不打扰用户。
    if (action === 'checkUpdate') {
      try {
        const response = await fetch('https://registry.npmjs.org/dsh-calendar-pro/latest', {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        })
        if (!response.ok) return { latest: null }
        const data = await response.json() as { version?: unknown }
        return { latest: typeof data.version === 'string' ? data.version : null }
      } catch {
        return { latest: null }
      }
    }
    if (action === 'testConnection') {
      const { config } = this.proposed(connectionDraft(body))
      const probe = await this.probe(config)
      return { ok: true, ...probe, connection: this.connection() }
    }
    if (action === 'saveConnection') {
      const { stored, config } = this.proposed(connectionDraft(body))
      // 校验的是「落盘后的形状」：只有它同时覆盖了 YAML 兜底与面板新填的字段。
      validateSettingsValue(stored as Partial<CalendarSettingsValue>)
      // 默认先测再存：连不上的地址不写入 settings
      const probe = body.test === false ? undefined : await this.probe(config)
      const face = this.settings
      if (face === undefined) {
        throw new Error('当前宿主的 settings 服务不可用：请在 profile 的 cordis.patch.yml 里配置 dsh-calendar-pro 后重启')
      }
      // 保存并启用一律切到 caldav：本地文件仍在原处，可随时切回或迁移。
      const committed = { ...stored, backend: 'caldav' as const }
      await face.replace(committed, face.descriptor()?.revision ?? 0)
      try { this.options.onSettings?.(committed) } catch (error) { /* 同上 */ }
      this.cachedService = undefined
      this.cachedKey = undefined
      return { saved: true, ...(probe !== undefined ? { probe } : {}), connection: this.connection() }
    }
    // iCloud 发现：只读协议查询，凭据仅用于本次 Basic 认证，绝不写进配置。
    if (action === 'discoverIcloud') {
      const username = optionalString(body, 'username') ?? ''
      const password = optionalString(body, 'password') ?? ''
      const proxyUrl = optionalString(body, 'proxyUrl')
      const calendars = await discoverIcloudCalendars({
        username,
        password,
        ...(proxyUrl !== undefined ? { proxyUrl } : {}),
      })
      return { calendars }
    }
    if (action === 'setBackend') {
      const value = requireString(body, 'backend', '缺少 backend 取值')
      if (value !== 'local' && value !== 'caldav') throw new Error('backend 只支持 local / caldav，收到 ' + value)
      await this.commitBackend(value)
      return { backend: value, connection: this.connection() }
    }
    // 一键切换数据源：把当前源复制到另一边，成功后切换；失败一条都不切，避免两端不一致。
    if (action === 'switchBackend') {
      const current = resolveBackendKind(this.configOf()) ?? 'local'
      const target = current === 'local' ? 'caldav' : 'local'
      const env = this.options.env ?? process.env
      const fromBackend = current === 'local' ? createLocalBackend() : createCaldavBackend(this.configOf(), env)
      const toBackend = target === 'local' ? createLocalBackend() : createCaldavBackend(this.configOf(), env)
      const plan = await planMigration(fromBackend, toBackend, signal)
      const result = plan.create.length > 0
        ? await runMigration(fromBackend, toBackend, plan, { limit: 500 }, signal)
        : { migrated: 0, failed: [] as Array<{ uid: string; summary: string; message: string }> }
      const skipped = { exists: plan.exists, duplicates: plan.duplicates.length, invalid: plan.invalid }
      if (result.failed.length > 0) {
        throw new Error('切换已中止：' + result.failed.length + ' 条复制失败，当前仍使用' +
          (current === 'local' ? '本地日历' : '远程日历') + '。请检查连接后重试。')
      }
      await this.commitBackend(target)
      return { backend: target, migrated: result.migrated, skipped, connection: this.connection() }
    }
    // 导出当前日历为 .ics：文本级合并，保留未建模字段（ATTENDEE / EXDATE / X-）。
    if (action === 'exportIcs') {
      const backend = createBackend(this.configOf(), this.options.env ?? process.env)
      // 一次取全部原文；逐条取在远程日历上会变成 N+1 次请求，导出必然超时。
      const sources = await backend.rawAll(signal)
      if (sources.length > EXPORT_LIMITS.maxEvents) {
        throw new Error('当前日历有 ' + sources.length + ' 条日程，超过导出上限 ' + EXPORT_LIMITS.maxEvents + ' 条。')
      }
      const merged = mergeCalendars(sources)
      if (Buffer.byteLength(merged.data) > EXPORT_LIMITS.maxBytes) {
        throw new Error('导出内容超过 10 MiB，请先拆分日历。')
      }
      return { filename: exportFilename(), data: merged.data, count: merged.count }
    }
    // 迁移：预检只读，执行才写。两端后端同时持有（本地 + 远程），与当前生效的 backend 无关。
    if (action === 'migratePlan' || action === 'migrateRun') {
      const current = resolveBackendKind(this.configOf()) ?? 'local'
      const target = optionalString(body, 'to') ?? (current === 'local' ? 'caldav' : 'local')
      if (target !== 'local' && target !== 'caldav') throw new Error('迁移目标只支持 local / caldav，收到 ' + target)
      if (target === current) throw new Error('源与目标是同一个数据源，无需迁移。')
      const env = this.options.env ?? process.env
      const fromBackend = current === 'local' ? createLocalBackend() : createCaldavBackend(this.configOf(), env)
      const toBackend = target === 'local' ? createLocalBackend() : createCaldavBackend(this.configOf(), env)
      const plan = await planMigration(fromBackend, toBackend, signal)
      if (action === 'migratePlan') return { plan, summary: describePlan(plan) }
      const result = await runMigration(fromBackend, toBackend, plan, { limit: clampInt(body.limit, 200, 1, 500) }, signal)
      // 搬完才切数据源：中途失败仍留在原来源，判据与 switchBackend 一致。
      if (result.failed.length > 0) {
        throw new Error('迁移已中止：' + result.failed.length + ' 条复制失败，当前仍使用' +
          (current === 'local' ? '本地日历' : '远程日历') + '。请检查连接后重试。')
      }
      if (result.migrated > 0) await this.commitBackend(target)
      return { plan, result, summary: describePlan(plan), backend: target, connection: this.connection() }
    }
    if (action === 'list') {
      const now = new Date()
      const start = optionalString(body, 'start') ?? isoNoMillis(now.toISOString())
      const end = optionalString(body, 'end') ?? isoNoMillis(new Date(now.getTime() + 7 * 86400000).toISOString())
      assertIsoTime(start, 'start')
      assertIsoTime(end, 'end')
      assertTimeRange(start, end)
      const events = sortEvents(await this.service().list(start, end, {
        expand: body.expand !== false,
        maxOccurrences: clampInt(body.maxOccurrences, 200, 1, 500),
      }))
      return { count: events.length, start, end, events }
    }
    if (action === 'availability') {
      const service = this.service()
      if (!service.availability) throw new Error('当前日历连接不支持完整的空闲查询，请更新插件')
      return service.availability(body as unknown as AvailabilityInput, signal)
    }
    if (action === 'create') {
      const fields = eventFields(body, true)
      return { event: await this.service().create(fields) }
    }
    if (action === 'event') {
      const service = this.service()
      if (!service.get) throw new Error('当前日历连接不支持读取系列原始事件')
      return { event: await service.get(requireString(body, 'uid', '缺少事件 uid')) }
    }
    if (action === 'update') {
      const uid = requireString(body, 'uid', '缺少要修改的事件 uid')
      return { event: await this.service().update(uid, eventFields(body, false), undefined, body.scope === 'series' ? 'series' : undefined) }
    }
    if (action === 'delete') {
      const uid = requireString(body, 'uid', '缺少要删除的事件 uid')
      return await this.service().delete(uid, undefined, body.scope === 'series' ? 'series' : undefined)
    }
    throw new Error('未知动作：' + (action === '' ? '(空)' : action))
  }
}

/** 从请求体里挑出连接字段：只认 CONNECTION_KEYS，字符串原样、null 表示清除。 */
function connectionDraft(body: Record<string, unknown>): Record<string, unknown> {
  const draft: Record<string, unknown> = {}
  for (const key of CONNECTION_KEYS) {
    if (!(key in body)) continue
    const value = body[key]
    if (value === null || typeof value === 'string') draft[key] = value
  }
  return draft
}

function requireString(body: Record<string, unknown>, key: string, message: string): string {
  const value = optionalString(body, key)
  if (value === undefined || value === '') throw new Error(message)
  return value
}

/** 把面板/工具传来的字段整理成 EventFields；create 时 summary/start/end 必填。 */
function eventFields(body: Record<string, unknown>, requireAll: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  const summary = optionalString(body, 'summary')
  if (summary !== undefined) {
    if (summary === '') throw new Error('标题不能为空')
    fields.summary = summary
  } else if (requireAll) {
    throw new Error('缺少标题（summary）')
  }
  for (const key of ['start', 'end']) {
    const value = optionalString(body, key)
    if (value !== undefined) {
      assertIsoTime(value, key)
      fields[key] = value
    } else if (requireAll) {
      throw new Error('缺少' + (key === 'start' ? '开始时间' : '结束时间'))
    }
  }
  if (typeof fields.start === 'string' && typeof fields.end === 'string') assertTimeRange(fields.start, fields.end)
  for (const key of ['description', 'location', 'rrule']) {
    const value = body[key]
    if (typeof value === 'string') fields[key] = value
  }
  if (typeof body.allDay === 'boolean') fields.allDay = body.allDay
  return fields
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** 把日历面板挂到宿主 webserver：ctx.inject(['webServer']) + effect，卸载即摘掉路由。 */
export function installCalendarSettingsWeb(ctx: any, backend: CalendarSettingsBackend): void {
  ctx.inject(['webServer'], (webCtx: any) => {
    webCtx.effect(() => {
      return webCtx.webServer.register({
        kind: 'exact',
        path: SETTINGS_ROUTE,
        handler: (req: any, res: any) => backend.handle(req, res),
      })
    }, 'dsh-calendar-pro: web routes')
  })
}
