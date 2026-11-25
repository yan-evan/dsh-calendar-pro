/**
 * 面板「连接设置」写入宿主 settings 命名空间（settings.yaml）。
 *
 * cordis.patch.yml 是基座：settings 里没设过的字段由它兜底，老用户的 YAML 配置不会失效
 * （toCalendarConfig 只投影用户真正设过的字段）。密码走 role(secret)，不进日志与导出。
 */
import z from 'schemastery'
import { CALENDAR_PROVIDERS, parseCalendarList, type CalendarAuthMethod, type CalendarConfig, type CalendarProvider } from './config.js'

/** 本插件独占的 settings 命名空间；带 -pro 后缀，不与原插件的 dsh-calendar 段抢位置。 */
export const SETTINGS_NAMESPACE = 'dsh-calendar-pro'

/**
 * 面板表单形状。空串表示「没设置」，YAML 配置与面板写入可共存。
 */
export const CalendarSettingsSchema = z.object({
  /** 数据源：local / caldav；空串表示「还没选」，面板据此显示首启页。 */
  backend: z.string().default(''),
  provider: z.string().default(''),
  caldavUrl: z.string().default(''),
  username: z.string().default(''),
  password: z.string().role('secret').default(''),
  host: z.string().default(''),
  user: z.string().default(''),
  calendar: z.string().default(''),
  calendarId: z.string().default(''),
  authMethod: z.string().default(''),
  clientId: z.string().default(''),
  clientSecret: z.string().role('secret').default(''),
  refreshToken: z.string().role('secret').default(''),
  tokenUrl: z.string().default(''),
  proxyUrl: z.string().default(''),
  /**
   * 同一账户下的多本日历（JSON 数组字符串）。
   * 存字符串而不是对象数组：entry 配置、settings、兜底文件三条落盘路径都按扁平字符串处理，
   * 凭据不会跟着数组走到 settings 描述符里。
   */
  calendarList: z.string().default(''),
})

export interface CalendarSettingsValue {
  backend: string
  provider: string
  caldavUrl: string
  username: string
  password: string
  host: string
  user: string
  calendar: string
  calendarId: string
  authMethod: string
  clientId: string
  clientSecret: string
  refreshToken: string
  tokenUrl: string
  proxyUrl: string
  calendarList: string
}

const TEXT_KEYS: readonly (keyof CalendarSettingsValue)[] = [
  'backend', 'provider', 'caldavUrl', 'username', 'password', 'host', 'user', 'calendar',
  'calendarId', 'authMethod', 'clientId', 'clientSecret', 'refreshToken', 'tokenUrl', 'proxyUrl',
  'calendarList',
]

/** 把一行 cordis.patch.yml 的配置投影成 schema 的 base（只带有值的字段）。 */
export function toSettingsBase(config: CalendarConfig | undefined): Partial<CalendarSettingsValue> {
  const out: Partial<CalendarSettingsValue> = {}
  const cfg = (config ?? {}) as Record<string, unknown>
  for (const key of TEXT_KEYS) {
    const value = cfg[key as string]
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return out
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * settings 值 → CalendarConfig。
 * user 记录用户真正改过的键，只有它列出的字段会被投影，schema 默认值不会擦掉
 * cordis.patch.yml 里的配置。传 null 表示按草稿全量投影（保存与测试连接）。
 */
export function toCalendarConfig(value: Partial<CalendarSettingsValue> | undefined, user?: Partial<CalendarSettingsValue> | null): CalendarConfig {
  const draft = (value ?? {}) as Partial<CalendarSettingsValue>
  const has = (key: keyof CalendarSettingsValue): boolean => user === null || (user !== undefined && user[key] !== undefined)
  const out: Record<string, unknown> = {}
  for (const key of TEXT_KEYS) {
    if (!has(key)) continue
    const raw = draft[key]
    if (!isSet(raw) || raw === '') continue
    out[key] = raw
  }
  return out as CalendarConfig
}

/** 连接测试用的「拟议配置」：草稿全量投影，不经过已存值。 */
export function draftToConfig(draft: Partial<CalendarSettingsValue> | undefined): CalendarConfig {
  return toCalendarConfig(draft, null)
}

function describe(value: unknown): string {
  if (typeof value === 'string') return '"' + value + '"'
  if (value === undefined) return 'undefined'
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}

/**
 * 写入前的温和校验：结构错误立即抛（中文，面板直接显示），不完整配置放行，
 * 地址拼装留给 resolveConfig。
 */
export function validateSettingsValue(value: Partial<CalendarSettingsValue> | undefined): void {
  const draft = (value ?? {}) as Partial<CalendarSettingsValue>
  const backend = typeof draft.backend === 'string' ? draft.backend : ''
  if (backend !== '' && backend !== 'local' && backend !== 'caldav') {
    throw new Error('数据源只能是 local 或 caldav，收到 ' + describe(backend))
  }
  const provider = typeof draft.provider === 'string' ? draft.provider : ''
  if (provider !== '' && !(CALENDAR_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error('未知的日历服务商 ' + describe(provider) + '，可选：' + CALENDAR_PROVIDERS.join(' / '))
  }
  const authMethod = typeof draft.authMethod === 'string' ? draft.authMethod : ''
  if (authMethod !== '' && authMethod !== 'oauth' && authMethod !== 'basic') {
    throw new Error('认证方式只能是 oauth 或 basic，收到 ' + describe(authMethod))
  }
  if (provider === 'google' && authMethod === 'basic') {
    throw new Error('Google 不接受 Basic（应用专用密码）：请把认证方式设为 oauth 并填 clientId / clientSecret / refreshToken')
  }
  const url = typeof draft.caldavUrl === 'string' ? draft.caldavUrl.trim() : ''
  if (url !== '' && !/^https?:\/\//i.test(url)) {
    throw new Error('日历集合 URL 必须以 http:// 或 https:// 开头，收到 ' + describe(url))
  }
  // calendarList 是 JSON 字符串：结构问题在保存前就拦住，面板可以直接显示；
  // 条目级问题（某条地址写坏）由 parseCalendarList 跳过，不整体失败。
  const listed = parseCalendarList((draft as { calendarList?: unknown }).calendarList)
  const tokenUrl = typeof draft.tokenUrl === 'string' ? draft.tokenUrl.trim() : ''
  if (tokenUrl !== '' && !/^https?:\/\//i.test(tokenUrl)) {
    throw new Error('令牌地址必须以 http:// 或 https:// 开头，收到 ' + describe(tokenUrl))
  }
  const proxyUrl = typeof draft.proxyUrl === 'string' ? draft.proxyUrl.trim() : ''
  if (proxyUrl !== '' && !/^https?:\/\//i.test(proxyUrl)) {
    throw new Error('代理地址必须以 http:// 或 https:// 开头，收到 ' + describe(proxyUrl))
  }
  if (provider === 'google') {
    if ((draft.calendarId ?? '') === '') throw new Error('Google 需要日历 ID（通常是你的邮箱地址）')
    if ((draft.clientId ?? '') === '') throw new Error('Google 需要 clientId')
    if ((draft.clientSecret ?? '') === '' || (draft.refreshToken ?? '') === '') {
      throw new Error('Google 需要 clientSecret 与 refreshToken：两者都由 OAuth 换来，缺一不可')
    }
  }
  if (provider === 'nextcloud') {
    if ((draft.host ?? '') === '') throw new Error('Nextcloud 需要 host（如 https://cloud.example.com）')
    if ((draft.user ?? '') === '') throw new Error('Nextcloud 需要 user')
    if ((draft.calendar ?? '') === '') throw new Error('Nextcloud 需要 calendar（日历名，如 personal）')
  }
  if ((provider === 'icloud' || provider === 'custom') && url === '' && listed.length === 0) {
    throw new Error((provider === 'icloud' ? 'iCloud' : '自建 CalDAV') + '需要完整的日历集合 URL（caldavUrl 或 calendarList 至少一项）')
  }
}

export type { CalendarAuthMethod, CalendarProvider }
