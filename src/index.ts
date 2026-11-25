/**
 * dsh-calendar-pro 插件入口（Node 侧，配置来自 cordis.patch.yml）。
 *
 * apply(ctx, config) 把七个日历工具注册进宿主工具表：calendar_list / create /
 * update / delete / search / health / find_time。数据源默认本地日历，切到 CalDAV
 * 才需要连接配置。
 */

import { resolveConfig, type CalendarConfig } from './config.js'
import { buildCalendarTools, type CalendarToolDefinition } from './tools.js'
import { CalendarSettingsSchema, SETTINGS_NAMESPACE, toCalendarConfig, toSettingsBase, validateSettingsValue, type CalendarSettingsValue } from './settings.js'
import { CalendarSettingsBackend, installCalendarSettingsWeb, hostFormsFaceOf, settingsFaceOf, type CalendarSettingsFace } from './web.js'
import { connectionFile, readConnectionFile, writeConnectionFile } from './store.js'
import { Config as ConfigSchema, liveConfig } from './host-config.js'
import { CalendarImportBackend, installCalendarImport } from './import-web.js'
import { entryIdOf, isFormsProvider, isLegacyProvider, settingsProviderOf } from './host-settings.js'
import { MailBackend } from './mail/backend.js'
import { installMailWeb } from './mail/web.js'
import type { LlmRoute, LlmStreamFace } from './mail/extract.js'

/** 宿主用 entry 的 Config 生成设置表单：0.1.7 起这就是「注册设置项」的方式。 */
export const Config = ConfigSchema
export type Config = CalendarConfig

/**
 * 显式声明 ctx.tools 注入，否则宿主会抛 cannot get property without inject。
 * name 只作为诊断树里的 fiber 名，不是 service key。
 */
export const name = 'dsh-calendar-pro'
export const inject = ['tools', 'settings']

/** 组合包补丁里那一行的 id；拿不到 fiber 时用它兜底。 */
const ENTRY_ID = 'calendar-pro'

/** 插件所需的最小 ctx 面（社区插件不依赖宿主内部类型）。 */
export interface CalendarPluginContext {
  tools: { register(definition: CalendarToolDefinition): () => void }
  on?(event: string, listener: () => void): () => void
  /** Cordis 的标准副作用入口；注册类操作挂进去，插件卸载时宿主自动清理。 */
  effect?(callback: () => () => void, label?: string): void
  /** 设置页面板需要挂路由；隔离环境（测试/headless）可以没有。 */
  inject?(services: string[], callback: (ctx: any) => void): void
  /** 0.1.7 的宿主表单按 entry id 寻址，id 从 fiber 上读。 */
  fiber?: { entry?: { options?: { id?: string } } }
  /** settings 服务：能拿到就用，拿不到就退化（见 attachSettings）。 */
  get?(service: string): any
  settings?: any
  logger?: { warn?(message: string): void }
}


/**
 * 同步注册 settings 命名空间并返回读写面。
 *
 * 时机是关键：宿主的 register 内部会 `ctx.effect(...)`，必须在插件加载的**同步阶段**调用 ——
 * 在请求处理里注册会失败，而失败一旦被吞掉，就会在保存时才暴露成「namespace is not registered」。
 * 拿不到服务 / 注册失败都只 warn：面板退化为只读，配置仍可写在 cordis.patch.yml。
 */
/** 兜底：把连接配置存进插件自己的文件（宿主 settings 不可用/注册失败时）。 */
export function fileSettingsFace(file: string = connectionFile()): CalendarSettingsFace {
  return {
    kind: 'file',
    read: () => readConnectionFile(file).value,
    descriptor: () => ({ revision: readConnectionFile(file).revision }),
    replace: async (value: Record<string, unknown>): Promise<void> => {
      const current = readConnectionFile(file)
      writeConnectionFile({ revision: current.revision + 1, value }, file)
    },
  }
}

/**
 * 接上配置存储，按宿主版本依次降级：
 *   0.1.7+  entry 配置直接投影成表单，读=活配置，写=按 entry id 逐字段 set/unset；
 *   0.1.6-  同步阶段 settings.register；注册失败但 describe() 已有本段时按重复 apply 处理，
 *           借用既有注册；
 *   都不可用 → 插件自己的兜底文件。
 * 返回 reason 供面板说明降级原因。
 * @returns 读写面、describe() 里的 ns、退化原因
 */
export function attachSettings(ctx: CalendarPluginContext, cfg: CalendarConfig): { face: CalendarSettingsFace; reason?: string; ns: string } {
  const provider = settingsProviderOf(ctx)
  if (isFormsProvider(provider)) {
    const entryId = entryIdOf(ctx, ENTRY_ID)
    return {
      ns: entryId,
      face: hostFormsFaceOf(
        provider,
        entryId,
        () => toSettingsBase(cfg) as Record<string, unknown>,
      ),
    }
  }
  const usable = isLegacyProvider(provider)
  if (usable !== true) {
    const reason = provider === undefined ? '插件未注入宿主 settings 服务' : '宿主 settings 服务既不能注册也不提供表单'
    console.warn('dsh-calendar-pro: ' + reason + '，连接配置改存插件自己的文件：' + connectionFile())
    return { face: fileSettingsFace(), reason, ns: SETTINGS_NAMESPACE }
  }
  let scope: any
  let failure: string | undefined
  try {
    scope = provider.register(SETTINGS_NAMESPACE, CalendarSettingsSchema, {
      base: toSettingsBase(cfg),
      applies: 'live',
      validate: (value: unknown) => validateSettingsValue(value as Partial<CalendarSettingsValue>),
    })
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  const known = (typeof provider.describe === 'function' ? provider.describe() ?? [] : []).some((row: any) => row !== undefined && row !== null && row.ns === SETTINGS_NAMESPACE)
  if (failure !== undefined && known === true) {
    // 已被注册（重复 apply 的第二个实例）：不注册，搭既有注册的车。
    console.warn('dsh-calendar-pro:settings 命名空间注册失败（' + failure + '），改为搭既有注册')
    return { face: settingsFaceOf(provider, undefined), ns: SETTINGS_NAMESPACE }
  }
  if (failure !== undefined) {
    // 注册失败且没人注册过：写进去也会报 namespace is not registered，直接换兜底文件。
    const reason = 'settings 命名空间注册失败：' + failure
    console.warn('dsh-calendar-pro: ' + reason + '，连接配置改存插件自己的文件：' + connectionFile())
    return { face: fileSettingsFace(), reason, ns: SETTINGS_NAMESPACE }
  }
  return { face: settingsFaceOf(provider, scope), ns: SETTINGS_NAMESPACE }
}
/**
 * 插件入口：惰性解析配置，注册七个日历工具。
 * @param ctx 宿主上下文（至少含 tools.register）
 * @param config 插件配置，可缺省
 */
export function apply(ctx: CalendarPluginContext, config?: CalendarConfig | null): void {
  // 0.1.7 的宿主把 volatile 字段交成引用；摊平之后老宿主的字面量配置走同一条路。
  const cfg = liveConfig(config ?? {})
  try {
    resolveConfig(cfg)
  } catch (error) {
    console.warn('dsh-calendar-pro: ' + (error instanceof Error ? error.message : String(error)))
  }
  // 面板自渲染，宿主不按 schema 生成页面。settings 已在插件依赖中声明，
  // 工具配置与面板共用同一个设置服务。
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['settings'], (settingsCtx: any) => {
        if (typeof settingsCtx?.settings?.configure !== 'function') return
        settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
      })
    } catch (error) {
      console.warn('dsh-calendar-pro:设置页策略未登记：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  // 工具与面板拿到 getter：面板改完配置，下一次调用即生效。
  const attached = attachSettings(ctx, cfg)
  const configOf = (): CalendarConfig => ({ ...cfg, ...toCalendarConfig(attached.face.read() as Partial<CalendarSettingsValue> | undefined, null) })

  // ctx.tools.register 内部已用调用方 ctx 的 effect 登记反注册，不要再包一层；
  // 只有没有 ctx.effect 的旧宿主才需要自行收集 disposer。
  const disposers: Array<() => void> = []
  for (const definition of buildCalendarTools(configOf)) {
    const dispose = ctx.tools.register(definition)
    if (typeof ctx.effect !== 'function') disposers.push(dispose)
  }

  // 路由挂上即用：settings 由 backend 在首个请求懒接入，不依赖子 fiber 时序。
  const backend = new CalendarSettingsBackend({
    config: configOf,
    ctx,
    settings: attached.face,
    settingsBase: toSettingsBase(cfg),
    settingsNs: attached.ns,
    ...(attached.reason !== undefined ? { settingsReason: attached.reason } : {}),
  })
  try {
    installCalendarSettingsWeb(ctx, backend)
    installCalendarImport(ctx, new CalendarImportBackend({ config: () => backend.currentConfig() }))
  } catch (error) {
    console.warn('dsh-calendar-pro:面板路由未挂载：' + (error instanceof Error ? error.message : String(error)))
  }

  // 邮件模块走独立路由与独立文件，全部挂在自己的 effect 里，不影响日历连接。
  try {
    installMailModule(ctx)
  } catch (error) {
    console.warn('dsh-calendar-pro:邮件日程识别未启用：' + (error instanceof Error ? error.message : String(error)))
  }

  if (disposers.length > 0 && typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const dispose of disposers) dispose()
    })
  }
}


/**
 * 邮件日程识别模块的装配点：挂路由、懒接模型、起轮询。
 * 全部走局部 inject，顶层仍只有 tools / settings；宿主缺哪个服务都只是降级。
 * 轮询固定 15 秒一跳、累计够 pollSeconds 才真跑，面板改间隔下一次即生效。
 */
export function installMailModule(ctx: CalendarPluginContext): MailBackend {
  let host: any = null
  const llmService = (): LlmStreamFace | null => {
    if (host?.llm !== undefined && host.llm !== null) return host.llm as LlmStreamFace
    try {
      return (typeof ctx.get === 'function' ? ctx.get('llm') ?? null : null) as LlmStreamFace | null
    } catch (error) {
      return null
    }
  }
  const routeOf = (): LlmRoute | null => {
    try {
      const selection = host?.agentDefaultModel?.currentSelection?.()
      if (selection !== undefined && selection !== null
        && typeof selection.provider === 'string' && typeof selection.model === 'string') {
        return { provider: selection.provider, model: selection.model }
      }
    } catch (error) { /* 没有默认模型就没有路由 */ }
    return null
  }
  const mail = new MailBackend({ llm: () => ({ llm: llmService(), route: routeOf() }) })

  installMailWeb(ctx, mail)

  if (typeof ctx.inject !== 'function') return mail
  try {
    ctx.inject(['llm'], (llmCtx: any) => { host = llmCtx })
  } catch (error) {
    console.warn('dsh-calendar-pro:模型服务不可用，邮件只识别 .ics 附件')
  }
  try {
    ctx.inject(['timer'], (timerCtx: any) => {
      // 宿主没有 timer 服务就不起轮询：设置页照常能测连、能回扫，只是没有「新邮件自动识别」。
      if (timerCtx === null || timerCtx === undefined) return
      // 宿主有两种形态：ctx.inject(['timer'], t => t.timer) 或直接给服务本体，都认。
      const timer = timerCtx.timer !== null && timerCtx.timer !== undefined ? timerCtx.timer : timerCtx
      if (timer === null || timer === undefined || typeof timer.interval !== 'function') return
      const run = (): (() => void) => {
        let last = 0
        let running = false
        const tick = (): void => {
          if (running) return
          const config = mail.config()
          if (!config.enabled) return
          const now = Date.now()
          if (last !== 0 && now - last < config.pollSeconds * 1000) return
          last = now
          running = true
          void mail.poll().catch(() => { /* 失败已写进 status.lastError */ }).finally(() => { running = false })
        }
        const handle = timer.interval(tick, 15000)
        return () => { if (typeof handle === 'function') handle() }
      }
      if (typeof timerCtx.effect === 'function') timerCtx.effect(run, 'dsh-calendar-pro: mail poller')
      else run()
    })
  } catch (error) {
    // 定时器属于可选能力：拿不到就只少了自动轮询，不该在宿主日志里留一条退化告警。
  }
  return mail
}

export * from './parameters.js'
export * from './config.js'
export * from './ical.js'
export * from './backend.js'
export * from './aggregate.js'
export * from './caldav.js'
export * from './tools.js'
export * from './web.js'
export * from './settings.js'
export * from './store.js'
export * from './host-settings.js'
export * from './import-ical.js'
export * from './import-web.js'
export { liveConfig } from './host-config.js'
export * from './mail/types.js'
export * from './mail/extract.js'
export * from './mail/store.js'
export * from './mail/client.js'
export * from './mail/backend.js'
export * from './mail/web.js'
