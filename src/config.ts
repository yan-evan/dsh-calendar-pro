/**
 * 配置解析：provider 预设 + 手填 URL，调用时惰性解析。
 * 配置缺失不阻止插件加载，只在工具执行时抛带中文指引的错误。
 * @module dsh-calendar-pro/config
 */

/** 支持的 provider 预设。 */
export type CalendarProvider = 'google' | 'icloud' | 'nextcloud' | 'custom'
export type CalendarAuthMethod = 'basic' | 'oauth'
/**
 * 数据源：本地日历或远程 CalDAV，互斥生效。
 * undefined 是合法状态：用户还没选，面板显示首启页，不产生任何数据源。
 */
export type BackendKind = 'local' | 'caldav'

/** 长期 OAuth 凭据；短期 access token 只保留在运行时内存中。 */
export interface CalendarOAuthCredentials {
  tokenUrl: string
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** 插件配置：可在 profile 的 cordis.patch.yml 覆盖 calendar 行的整个 config。 */
export interface CalendarConfig {
  /** 数据源；缺省表示「还没选过」，由面板显示首启页。 */
  backend?: BackendKind
  /** provider 预设；默认 custom。 */
  provider?: CalendarProvider
  /** 完整日历集合 URL；custom / icloud 必填，google / nextcloud 可由此手填覆盖预设。 */
  caldavUrl?: string
  /** Basic 认证账号；OAuth 不要求此字段。 */
  username?: string
  /** Basic 密码；支持 DSH_CALENDAR_PASSWORD。iCloud 请用应用专用密码；Google 不支持 Basic。 */
  password?: string
  /** google 默认 oauth，其他 provider 默认 basic；Google 不允许 basic。 */
  authMethod?: CalendarAuthMethod
  /** OAuth 客户端 ID；也可用 DSH_CALENDAR_CLIENT_ID。 */
  clientId?: string
  /** OAuth 客户端密钥；推荐用 DSH_CALENDAR_CLIENT_SECRET。 */
  clientSecret?: string
  /** OAuth 离线授权的刷新令牌；推荐用 DSH_CALENDAR_REFRESH_TOKEN。 */
  refreshToken?: string
  /** OAuth 令牌端点；Google 自动使用官方端点，其他 provider 的 OAuth 必填。 */
  tokenUrl?: string
  /** google：日历 ID（通常是你的邮箱地址）。 */
  calendarId?: string
  /** nextcloud：主机，如 https://cloud.example.com。 */
  host?: string
  /** nextcloud：用户名。 */
  user?: string
  /** nextcloud：日历名。 */
  calendar?: string
  /**
   * 同一账户下的多本日历（JSON 数组字符串），形如
   * `[{"url":"https://caldav.icloud.com/123/calendars/home/","name":"家庭"}]`。
   *
   * 用字符串而不是对象数组，是为了让「entry 配置 / settings / 兜底文件」三条落盘路径
   * 都按扁平字符串处理：嵌套对象数组在各代宿主的读写面上没有保证，凭据也不该跟着数组走。
   * 缺省（或解析为空）时只用 caldavUrl 指的那一本，行为与旧版本完全一致。
   */
  calendarList?: string
  /**
   * HTTP 代理地址，如 http://127.0.0.1:7890。只作用于本插件的请求；能直连时留空。
   */
  proxyUrl?: string
}

/** 同一账户下的一本日历集合。 */
export interface CalendarRef {
  /** 规范化后的集合 URL（保留末尾斜杠、去掉查询串与片段）。 */
  url: string
  /** 展示名；缺省时由 URL 推导，见 calendarNameOf。 */
  name?: string
}

/** 一个读取目标：某本日历 + 解析完成的凭据。 */
export interface CalendarTarget {
  ref: CalendarRef
  config: ResolvedConfig
}

/** 一次能连接的最大日历数；超过多半是配置写错了，也避免把工具调用拖成几十个请求。 */
export const MAX_CALENDARS = 16

/** 解析完成、可直接建客户端的配置。 */
export interface ResolvedConfig {
  provider: CalendarProvider
  caldavUrl: string
  username: string
  password: string
  oauth?: CalendarOAuthCredentials
  proxyUrl: string
}

/** 预设端点常量。 */
export const GOOGLE_CALDAV_PREFIX = 'https://apidata.googleusercontent.com/caldav/v2/'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com'
export const NEXTCLOUD_PATH = '/remote.php/dav/calendars/'

/** 配置错误：带中文指引，模型和用户都能读。 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export const CALENDAR_PROVIDERS: readonly CalendarProvider[] = ['google', 'icloud', 'nextcloud', 'custom']

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeProvider(value: unknown): CalendarProvider {
  if (value === undefined || value === null || value === '') return 'custom'
  if (typeof value === 'string' && (CALENDAR_PROVIDERS as readonly string[]).includes(value)) {
    return value as CalendarProvider
  }
  throw new ConfigError(
    'dsh-calendar-pro 的 provider 取值不合法：只支持 google / icloud / nextcloud / custom。' +
    '请在 profile 的 cordis.patch.yml 覆盖 calendar 行的 provider 并重启。',
  )
}

/**
 * 生效的数据源，优先级从高到低：
 * 1. 显式 backend（面板选中或 YAML 手写）；
 * 2. 旧配置里已有 CalDAV 端点或凭据，视为 caldav，升级后不会被首启页拦住；
 * 3. 都没有 → undefined。
 * 这里不能默认 local，否则「首次进入」与「已有本地日历」无法区分。
 */
export function resolveBackendKind(config: CalendarConfig | undefined): BackendKind | undefined {
  const explicit = config?.backend
  if (explicit === 'local' || explicit === 'caldav') return explicit
  if (explicit !== undefined && explicit !== null && (explicit as unknown) !== '') {
    throw new ConfigError(
      'dsh-calendar-pro 的 backend 只支持 local / caldav，收到 ' + JSON.stringify(explicit) + '。',
    )
  }
  const record = (config ?? {}) as Record<string, unknown>
  for (const key of ['caldavUrl', 'host', 'calendarId', 'username', 'refreshToken', 'calendarList'] as const) {
    if (nonEmpty(record[key]) !== undefined) return 'caldav'
  }
  return undefined
}

/**
 * 解析为可用的 caldavUrl + 凭证；缺失时抛 ConfigError（中文指引）。
 * @param config 插件 config，可能为 undefined
 * @param env 环境变量来源，测试可注入
 */
export function resolveConfig(config: CalendarConfig | undefined, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const provider = normalizeProvider(config?.provider)
  const credentials = resolveCredentials(config, env)
  const caldavUrl = declaredCollectionUrl(config ?? {}, provider)
  if (credentials.oauth !== undefined) validateOAuthUrl(caldavUrl, 'caldavUrl')
  return { provider, caldavUrl, ...credentials, proxyUrl: nonEmpty(config?.proxyUrl) ?? '' }
}

/**
 * 单集合 URL：优先 caldavUrl，其次 calendarList 的第一本，最后按 provider 预设拼装。
 * 迁移、导入、导出与空闲查询都还需要「一本」的具体地址，统一从这里取，语义固定为「默认日历」。
 */
function declaredCollectionUrl(config: CalendarConfig, provider: CalendarProvider): string {
  const explicit = nonEmpty(config.caldavUrl)
  if (explicit !== undefined) return explicit
  const listed = parseCalendarList(config.calendarList)
  if (listed.length > 0) return listed[0]!.url
  return buildCaldavUrl(config, provider)
}

/** 默认日历的集合地址（不解析凭据）：自检与提示文案用它，避免为了报地址先要求账号。 */
export function resolveCollectionUrl(config: CalendarConfig | undefined): string {
  return declaredCollectionUrl(config ?? {}, normalizeProvider(config?.provider))
}

/** Google 必须使用 OAuth；其他 provider 不会被环境中的 Google 凭据切换认证方式。 */
export function resolveAuthMethod(config: CalendarConfig | undefined): CalendarAuthMethod {
  const provider = normalizeProvider(config?.provider)
  const method = config?.authMethod ?? (provider === 'google' ? 'oauth' : 'basic')
  if (method !== 'basic' && method !== 'oauth') {
    throw new ConfigError('dsh-calendar-pro 的 authMethod 只支持 basic / oauth。')
  }
  if (provider === 'google' && method !== 'oauth') {
    throw new ConfigError('Google CalDAV 仅支持 OAuth 2.0，不接受 Basic 或应用专用密码；请配置 clientId、clientSecret、refreshToken。')
  }
  return method
}

/** OAuth 凭据与 Bearer token 仅允许发往无 URL 内嵌凭据的 HTTPS 端点。 */
export function validateOAuthUrl(value: string, field: string): void {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && url.username === '' && url.password === '' && url.search === '' && url.hash === '') return
  } catch {
    // 不回显 URL，避免错误配置把凭据带入日志。
  }
  throw new ConfigError('dsh-calendar-pro 的 OAuth ' + field + ' 必须是有效的 HTTPS 地址，且不能包含账号、密码、查询参数或片段。')
}

/** 独立解析认证，供离线健康检查复用；不会发起网络请求或回显凭据。 */
export function resolveCredentials(
  config: CalendarConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Pick<ResolvedConfig, 'username' | 'password' | 'oauth'> {
  if (resolveAuthMethod(config) === 'oauth') {
    const clientId = nonEmpty(config?.clientId) ?? nonEmpty(env.DSH_CALENDAR_CLIENT_ID)
    const clientSecret = nonEmpty(config?.clientSecret) ?? nonEmpty(env.DSH_CALENDAR_CLIENT_SECRET)
    const refreshToken = nonEmpty(config?.refreshToken) ?? nonEmpty(env.DSH_CALENDAR_REFRESH_TOKEN)
    const tokenUrl = nonEmpty(config?.tokenUrl) ?? nonEmpty(env.DSH_CALENDAR_TOKEN_URL)
      ?? (config?.provider === 'google' ? GOOGLE_TOKEN_URL : undefined)
    const missing = [
      [clientId, 'clientId / DSH_CALENDAR_CLIENT_ID'],
      [clientSecret, 'clientSecret / DSH_CALENDAR_CLIENT_SECRET'],
      [refreshToken, 'refreshToken / DSH_CALENDAR_REFRESH_TOKEN'],
      [tokenUrl, 'tokenUrl / DSH_CALENDAR_TOKEN_URL'],
    ].filter(([value]) => value === undefined).map(([, field]) => field)
    if (clientId === undefined || clientSecret === undefined || refreshToken === undefined || tokenUrl === undefined) {
      throw new ConfigError('dsh-calendar-pro 的 OAuth 凭据不完整：请配置 ' + missing.join('、') +
        '，然后重启。Google CalDAV 仅支持 OAuth 2.0，应用专用密码无法替代刷新令牌。')
    }
    validateOAuthUrl(tokenUrl, 'tokenUrl')
    return { username: nonEmpty(config?.username) ?? '', password: '', oauth: { tokenUrl, clientId, clientSecret, refreshToken } }
  }
  const username = nonEmpty(config?.username)
  const password = nonEmpty(config?.password) ?? nonEmpty(env.DSH_CALENDAR_PASSWORD)

  if (username === undefined) {
    throw new ConfigError(
      '日历账号未填写：请在日历的“连接设置”中填写“账号”（iCloud 使用 Apple ID 邮箱），然后重新测试连接。',
    )
  }
  if (password === undefined) {
    throw new ConfigError(
      '日历密码未填写：请在“连接设置”中填写“密码 / 应用专用密码”，然后重新测试连接。iCloud 需要应用专用密码。',
    )
  }

  return { username, password }
}

/** 依据 provider 预设或手填字段拼出日历集合 URL。 */
export function buildCaldavUrl(config: CalendarConfig, provider: CalendarProvider): string {
  const explicit = nonEmpty(config.caldavUrl)
  if (explicit !== undefined) return explicit

  if (provider === 'google') {
    const calendarId = nonEmpty(config.calendarId)
    if (calendarId === undefined) {
      throw new ConfigError(
        'dsh-calendar-pro 的 provider=google 需要 calendarId（日历 ID，通常是你的邮箱地址）：' +
        '请在 profile 的 cordis.patch.yml 覆盖 calendar 行的 calendarId 并重启。',
      )
    }
    return GOOGLE_CALDAV_PREFIX + encodeURIComponent(calendarId) + '/events'
  }

  if (provider === 'nextcloud') {
    const host = nonEmpty(config.host)
    const user = nonEmpty(config.user)
    const calendar = nonEmpty(config.calendar)
    if (host === undefined || user === undefined || calendar === undefined) {
      throw new ConfigError(
        'dsh-calendar-pro 的 provider=nextcloud 需要 host、user、calendar 三个字段：' +
        '请在 profile 的 cordis.patch.yml 覆盖 calendar 行并重启。',
      )
    }
    return trimTrailingSlash(host) + NEXTCLOUD_PATH + encodeURIComponent(user) + '/' + encodeURIComponent(calendar) + '/'
  }

  if (provider === 'icloud') {
    throw new ConfigError(
      'dsh-calendar-pro 的 provider=icloud 需要完整日历集合 URL：请在 icloud.com 的日历设置里找到具体日历的 CalDAV 地址，' +
      '填入 profile 的 cordis.patch.yml 覆盖 calendar 行的 caldavUrl（形如 ' + ICLOUD_CALDAV_URL + '/<用户ID>/calendars/<日历ID>/）后重启。',
    )
  }

  throw new ConfigError(
    'dsh-calendar-pro 未配置 caldavUrl：provider=custom 时需提供完整日历集合 URL，' +
    '请在 profile 的 cordis.patch.yml 覆盖 calendar 行的 caldavUrl 并重启。',
  )
}

/**
 * 集合 URL 规范化：只接受 http(s)，不接受内嵌账号密码或片段；查询串一并丢掉。
 * 返回 undefined 表示这条不是可用的日历地址。
 */
export function normalizeCollectionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (url.username !== '' || url.password !== '' || url.hash !== '') return undefined
  url.search = ''
  return url.href
}

/** 展示名缺省值：取 URL 最后一段路径（解码后）；取不到就用主机名。 */
export function calendarNameOf(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter((segment) => segment !== '')
    const last = segments.at(-1)
    return last === undefined ? parsed.hostname : decodeURIComponent(last)
  } catch {
    return url
  }
}

/**
 * 解析 calendarList：同时接受 JSON 字符串与数组（YAML 手写、面板保存两种来源）。
 *
 * 条目级问题跳过而不是整体失败：一条写坏的地址不该让其余日历也连不上。
 * 但整份内容不是 JSON / 不是数组时抛 ConfigError——那是用户能照着改的结构错误。
 */
export function parseCalendarList(raw: unknown): CalendarRef[] {
  if (raw === undefined || raw === null || raw === '') return []
  let value: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text === '') return []
    try {
      value = JSON.parse(text)
    } catch {
      throw new ConfigError('dsh-calendar-pro 的 calendarList 不是合法 JSON：应为 [{"url":"https://…","name":"家庭"}] 形式的数组。')
    }
  }
  if (!Array.isArray(value)) {
    throw new ConfigError('dsh-calendar-pro 的 calendarList 必须是数组：每项是日历集合 URL 或 {"url":…,"name":…}。')
  }
  const out: CalendarRef[] = []
  let declared = 0
  for (const item of value) {
    let rawUrl: unknown
    let rawName: unknown
    if (typeof item === 'string') rawUrl = item
    else if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      rawUrl = (item as Record<string, unknown>).url
      rawName = (item as Record<string, unknown>).name
    } else continue
    declared += 1
    const url = normalizeCollectionUrl(rawUrl)
    if (url === undefined) continue
    if (out.some((ref) => ref.url === url)) continue
    const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim().slice(0, 40) : undefined
    out.push(name === undefined ? { url } : { url, name })
    if (out.length >= MAX_CALENDARS) break
  }
  if (out.length === 0 && declared > 0) {
    throw new ConfigError('dsh-calendar-pro 的 calendarList 里没有有效的日历集合 URL：需以 http:// 或 https:// 开头，且不含账号、密码与查询参数。')
  }
  return out
}

/**
 * 声明了哪些日历；一本都没有时抛中文指引。
 * calendarList 为空时退化成「caldavUrl 那一本」，旧配置不需要任何迁移动作。
 */
export function resolveCalendars(config: CalendarConfig | undefined): CalendarRef[] {
  const listed = parseCalendarList(config?.calendarList)
  if (listed.length > 0) return listed
  const provider = normalizeProvider(config?.provider)
  const url = buildCaldavUrl(config ?? {}, provider)
  const normalized = normalizeCollectionUrl(url) ?? url
  // Google 的集合路径固定以 /events 结尾，用它当日历名没有信息量，改用 calendarId（邮箱）。
  const name = provider === 'google' ? nonEmpty(config?.calendarId) : calendarNameOf(url)
  return name === undefined ? [{ url: normalized }] : [{ url: normalized, name }]
}

/** 面板展示用：任何解析错误都收成空列表，由调用方决定怎么提示。 */
export function availableCalendars(config: CalendarConfig | undefined): CalendarRef[] {
  try {
    return resolveCalendars(config)
  } catch {
    return []
  }
}

/**
 * 多日历目标：凭据解析一次、共用，集合 URL 各自一份。
 * OAuth 场景逐条校验 URL（令牌会发往这些端点），不合法立即抛错，绝不带到请求里。
 */
export function resolveCalendarTargets(config: CalendarConfig | undefined, env: NodeJS.ProcessEnv = process.env): CalendarTarget[] {
  // 先解析凭据再解析地址：缺账号时先给「填 username/密码」的指引，与旧版错误优先级一致。
  const credentials = resolveCredentials(config, env)
  const refs = resolveCalendars(config)
  const provider = normalizeProvider(config?.provider)
  const proxyUrl = nonEmpty(config?.proxyUrl) ?? ''
  return refs.map((ref) => {
    if (credentials.oauth !== undefined) validateOAuthUrl(ref.url, 'caldavUrl')
    return { ref, config: { provider, caldavUrl: ref.url, ...credentials, proxyUrl } }
  })
}
