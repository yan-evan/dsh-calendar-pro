#!/usr/bin/env node
/**
 * 换取 Google refresh token。Google 的 CalDAV 只认 OAuth，refresh token 需一次浏览器授权。
 * Desktop app 客户端仅允许 http://127.0.0.1 回调，脚本起一次性本地服务器收 code 再换 token。
 *
 * 用法：
 *   node scripts/google-oauth.mjs --client-id <id> --client-secret <secret>
 *   或环境变量 DSH_CALENDAR_CLIENT_ID / DSH_CALENDAR_CLIENT_SECRET
 * 可选：--scope calendar|calendar.readonly  --port <n>  --no-open  --timeout <秒>  --token-url <url>（仅测试）
 */
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const SCOPE_FULL = 'https://www.googleapis.com/auth/calendar'
export const SCOPE_READONLY = 'https://www.googleapis.com/auth/calendar.readonly'

/** 拼授权地址：access_type=offline + prompt=consent 才会每次都发 refresh token。 */
/** PKCE：桌面客户端也支持，给授权码加一层绑定（S256）。 */
export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * 自检 clientId：控制台列表里显示的是截断值（150465783795-65g8…），
 * 整串粘贴 Google 只会返回 400 页，这里提前拦住。
 */
/** 去掉粘贴带上的引号与首尾空白。 */
export function cleanValue(value) {
  return String(value ?? '').trim().replace(/^["']+/, '').replace(/["']+$/, '').trim()
}

export function validateClientId(clientId) {
  const trimmed = cleanValue(clientId)
  // 把文档里的示例文字当成真值敲进来，是最常见的一种「不是 bug 的报错」——直接点名。
  if (/[\u4e00-\u9fff]/.test(trimmed) || /你的|完整|clientid/i.test(trimmed)) {
    throw new Error('这串看起来是文档里的示例文字（' + trimmed + '），不是真的 clientId：请在 Google Cloud 控制台点客户端右侧的复制按钮，取那串以 .apps.googleusercontent.com 结尾的 ID')
  }
  if (trimmed === '') throw new Error('clientId 为空：用 --client-id 传入，或设 DSH_CALENDAR_CLIENT_ID')
  if (trimmed.includes('…') || trimmed.includes('...')) {
    throw new Error('clientId 里带了省略号（' + trimmed.slice(0, 30) + '）：那是控制台列表的截断显示，请点右侧复制按钮取完整 ID')
  }
  if (!/^[0-9]+-[0-9a-z_]+\.apps\.googleusercontent\.com$/i.test(trimmed)) {
    throw new Error('clientId 形状不对：应形如 123456789012-abc123.apps.googleusercontent.com，当前是 ' + trimmed.slice(0, 32) + '（长度 ' + trimmed.length + '）')
  }
  return trimmed
}

/**
 * 预检授权地址：参数错误时 Google 返回 400 错误页，合法时返回同意页（200/302）。
 * 网络不通返回 undefined，不因此中断流程。
 */
export async function checkAuthUrl(url, fetchImpl = fetch) {
  try {
    const init = { redirect: 'manual', headers: { 'user-agent': 'dsh-calendar-oauth/1.0' } }
    // 预检不阻塞主流程：超时（网络慢 / 被墙）视同通过。
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(4000)
    const response = await fetchImpl(url, init)
    if (response.status === 200 || response.status === 302 || response.status === 303) return undefined
    const body = await response.text().catch(() => '')
    const title = /<title>([^<]*)<\/title>/i.exec(body)
    const detail = title === null ? body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : title[1].trim()
    return 'HTTP ' + response.status + (detail === '' ? '' : '：' + detail)
  } catch (error) {
    return undefined
  }
}

export function buildAuthUrl(options) {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: options.scope,
    access_type: 'offline',
    prompt: 'consent',
  })
  if (typeof options.codeChallenge === 'string' && options.codeChallenge !== '') {
    params.set('code_challenge', options.codeChallenge)
    params.set('code_challenge_method', 'S256')
  }
  return AUTH_URL + '?' + params.toString()
}

/** 用 code 换 token。失败时把 Google 的原话带出来（它比任何包装都清楚）。 */
export async function exchangeCode(options) {
  const body = new URLSearchParams({
    code: options.code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUri,
    grant_type: 'authorization_code',
  })
  if (typeof options.codeVerifier === 'string' && options.codeVerifier !== '') body.set('code_verifier', options.codeVerifier)
  const response = await fetch(options.tokenUrl ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status !== 200 || typeof payload.refresh_token !== 'string' || payload.refresh_token === '') {
    const detail = typeof payload.error_description === 'string' ? payload.error_description : JSON.stringify(payload)
    throw new Error('换取 refresh token 失败（HTTP ' + response.status + '）：' + detail)
  }
  return payload
}

/** 参数解析：命令行优先，其次环境变量。 */
export function parseArgs(argv, env = process.env) {
  const out = {
    clientId: env.DSH_CALENDAR_CLIENT_ID ?? '',
    clientSecret: env.DSH_CALENDAR_CLIENT_SECRET ?? '',
    scope: SCOPE_FULL,
    port: 0,
    open: true,
    timeoutSeconds: 300,
    tokenUrl: undefined,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => { i += 1; return argv[i] }
    if (arg === '--client-id') out.clientId = next() ?? ''
    else if (arg === '--client-secret') out.clientSecret = next() ?? ''
    else if (arg === '--scope') out.scope = (next() ?? 'calendar') === 'calendar.readonly' ? SCOPE_READONLY : SCOPE_FULL
    else if (arg === '--port') out.port = Number(next() ?? 0) || 0
    else if (arg === '--no-open') out.open = false
    else if (arg === '--timeout') out.timeoutSeconds = Number(next() ?? 300) || 300
    else if (arg === '--token-url') out.tokenUrl = next()
    else if (arg === '--help' || arg === '-h') out.help = true
  }
  return out
}

/**
 * 打开浏览器。
 *
 * Windows 上不要用 `cmd /c start <url>`：授权 URL 里全是 `&`，cmd 会当作命令分隔符，
 * 浏览器只收到第一段，Google 报 `Required parameter is missing: response_type`。
 * rundll32 直接接收整串参数，不经过 shell 解析。
 */
export function browserCommand(platform, url) {
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
  if (platform === 'darwin') return { command: 'open', args: [url] }
  return { command: 'xdg-open', args: [url] }
}

/** 打开浏览器；失败返回 false（调用方只把它当便利，不当作流程的必要环节）。 */
export function openBrowser(url, spawnImpl = spawn, platform = process.platform) {
  try {
    const spec = browserCommand(platform, url)
    spawnImpl(spec.command, spec.args, { stdio: 'ignore', detached: true }).unref()
    return true
  } catch (error) {
    return false
  }
}

const PAGE_OK = '<meta charset="utf-8"><title>dsh-calendar</title><body style="font-family:system-ui;padding:40px">'
  + '<h2>授权成功 ✅</h2><p>可以关掉这个页面，回到终端复制 refresh token。</p>'
const PAGE_FAIL = '<meta charset="utf-8"><title>dsh-calendar</title><body style="font-family:system-ui;padding:40px">'
  + '<h2>授权失败 ❌</h2><p>回到终端看错误信息。</p>'

/** 起本地回调、等 code、换 token。 */
export async function runFlow(options) {
  let resolveCode
  let rejectCode
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (code === null && error === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('waiting for /?code=...')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(error === null ? PAGE_OK : PAGE_FAIL)
    if (error !== null) rejectCode(new Error('授权被拒绝：' + error))
    else resolveCode(decodeURIComponent(code))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port
  const redirectUri = 'http://127.0.0.1:' + port + '/'
  // 回调端口一旦起来就必须收掉：预检失败、用户拒绝、超时都要走同一个 finally，
  // 否则进程会挂在一个没人管的监听上（测试里表现为「永远不结束」）。
  let timer
  try {
    const pkce = pkcePair()
    const authUrl = buildAuthUrl({ clientId: options.clientId, redirectUri, scope: options.scope, codeChallenge: pkce.challenge })
    // 打开浏览器前先校验授权地址，非法地址直接报错，不再落到浏览器的 400 页。
    const rejected = await checkAuthUrl(authUrl, options.fetchImpl)
    if (rejected !== undefined) {
      throw new Error('Google 拒绝了授权地址（' + rejected + '）。常见原因：clientId 是列表里的截断显示、客户端类型不是「桌面应用」、或 URL 在终端里被换行截断；也可能是该客户端所属项目没配 OAuth 同意屏。')
    }
    console.log('')
    console.log('1) 用你的 Google 账号打开下面这个链接授权：')
    console.log('   ' + authUrl)
    console.log('')
    console.log('（浏览器没自动打开就复制上面整行 —— 从终端复制不会被 shell 解析，粘贴到地址栏即可）')
    console.log('')
    console.log('2) 等待回调中（最多 ' + options.timeoutSeconds + ' 秒）…')
    if (options.open === true) openBrowser(authUrl)
    timer = setTimeout(() => rejectCode(new Error('等待超时：没有收到授权回调')), options.timeoutSeconds * 1000)
    const code = await codePromise
    const payload = await exchangeCode({ code, clientId: options.clientId, clientSecret: options.clientSecret, redirectUri, codeVerifier: pkce.verifier, tokenUrl: options.tokenUrl })
    return { refreshToken: payload.refresh_token, scope: payload.scope, accessToken: payload.access_token }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    server.close()
  }
}

/** 交互式补全缺失的凭据：直接粘贴即可（不显示在屏幕上是不可能的，secret 也不敏感到这个程度）。 */
async function fillMissing(options) {
  if (options.help === true) return options
  if (options.clientId !== '' && options.clientSecret !== '') return options
  const readline = await import('node:readline/promises')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    if (options.clientId === '') {
      console.log('')
      console.log('先在 Google Cloud 控制台打开那个「桌面设备」客户端：https://console.cloud.google.com/apis/credentials')
      console.log('把「客户端 ID」（以 .apps.googleusercontent.com 结尾的那串）整段粘进来，回车：')
      options.clientId = validateClientId(await rl.question('clientId > '))
    }
    if (options.clientSecret === '') {
      console.log('')
      console.log('再点进那个客户端 → 左侧「概览」→「客户端密钥」，复制（一般以 GOCSPX- 开头）粘进来，回车：')
      options.clientSecret = cleanValue(await rl.question('clientSecret > '))
    }
    return options
  } finally {
    rl.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    console.log('用法：node scripts/google-oauth.mjs --client-id <id> --client-secret <secret>')
    console.log('可选：--scope calendar|calendar.readonly  --port <n>  --no-open  --timeout <秒>')
    return
  }
  // 命令行里给了就先用（并做自检）；没给就交互式问 —— 直接敲命令即可，不用记参数。
  fillMissing(options).then((filled) => {
    filled.clientId = validateClientId(filled.clientId)
    filled.clientSecret = cleanValue(filled.clientSecret)
    if (filled.clientSecret === '') throw new Error('clientSecret 为空：点进客户端 →「概览」→「客户端密钥」复制（一般以 GOCSPX- 开头）')
    return runFlow(filled)
  }).then((result) => {
    console.log('')
    console.log('✅ 拿到 refresh token：')
    console.log('   ' + result.refreshToken)
    console.log('')
    console.log('把它连同 clientId / clientSecret 填进面板的「连接设置」（provider 选 Google，calendarId 填你的 Gmail 地址）。')
    console.log('提示：OAuth 同意屏还停在「测试」状态时 refresh token 只有 7 天有效，到「OAuth 同意屏幕」点「发布应用」即可长期有效。')
  }).catch((error) => {
    console.error('❌ ' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
