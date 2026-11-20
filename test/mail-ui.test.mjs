/**
 * 邮件面板界面契约：中英词条对齐、清单渲染出「创建 / 忽略」、设置卡片能填能存。
 * 用 jsdom + 真 React 运行。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const EXPOSE = 'module.exports.__internals = {'
  + ' __components: { MailTodoDialog, MailSettingsCard, MailArrivalToast, MailAnalyzeDialog },'
  + ' __mail: { mailCandidateToDraft, mailWhenText, mailToolbarLabel, mailDayOptions, MAIL_PROVIDER_PRESETS },'
  + ' __ui: UI };'
if (!SOURCE.includes('return module.exports;')) throw new Error('client.js 装载契约变了，本测试的注入点要跟着改')
const PATCHED = SOURCE.replace('return module.exports;', EXPOSE + '\nreturn module.exports;')

const CANDIDATE = {
  id: 'cand-1',
  account: 'me@example.com',
  folder: 'INBOX',
  uid: 12,
  uidValidity: 7,
  summary: '季度评审会',
  start: '2026-12-01T06:00:00Z',
  end: '2026-12-01T07:00:00Z',
  allDay: false,
  location: '3 楼会议室',
  description: '评审 Q4 指标',
  confidence: 0.4,
  source: 'llm',
  state: 'pending',
  isNew: true,
  mail: { from: 'boss@example.com', subject: 'Q4 评审', date: '2026-11-18T02:00:00Z', snippet: '12 月 1 日上午 10 点，3 楼会议室' },
  createdAt: 0,
  updatedAt: 0,
}

/** 每个用例一套干净 jsdom + 真 React；fetch 全走桩，绝不真连 IMAP。 */
async function setup(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
  const win = dom.window
  const calls = []
  win.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : null
    calls.push({ url: String(url), body })
    const value = options.handler ? options.handler(body) : { items: [CANDIDATE], counts: { pending: 1, new: 1, created: 0, ignored: 0, failed: 0 } }
    return { ok: true, status: 200, json: async () => ({ ok: true, value }) }
  }
  globalThis.fetch = win.fetch
  win.AbortSignal.timeout = () => undefined
  globalThis.window = win
  globalThis.document = win.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const react = await import('react')
  const reactDomClient = await import('react-dom/client')
  let captured = null
  win.__ModuleLoader__ = {
    load: (registration) => {
      captured = registration.factory((name) => {
        if (name === 'react') return react
        if (name === 'react-dom/client') return reactDomClient
        if (name === 'react/jsx-runtime') return {}
        throw new Error('unexpected require: ' + name)
      })
    },
  }
  new Function('window', 'document', PATCHED)(win, win.document, win.navigator)
  return { dom, win, react, reactDomClient, internals: captured.__internals, calls }
}

async function render(react, reactDomClient, element) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = reactDomClient.createRoot(container)
  await react.act(async () => { root.render(element) })
  return { container, root }
}

const flush = async (react, ms = 30) => {
  await react.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

test('中英词条一一对齐：少一条就会在界面上冒出 mail.xxx', async () => {
  const { internals } = await setup()
  const zh = new Set(Object.keys(internals.__ui.zh).filter((key) => key.startsWith('mail.')))
  const en = new Set(Object.keys(internals.__ui.en).filter((key) => key.startsWith('mail.')))
  assert.deepEqual([...zh].filter((key) => !en.has(key)), [], '这些词条只有中文：' + [...zh].filter((key) => !en.has(key)).join(', '))
  assert.deepEqual([...en].filter((key) => !zh.has(key)), [], '这些词条只有英文：' + [...en].filter((key) => !zh.has(key)).join(', '))
  assert.ok(zh.size >= 30, '邮件面板的词条量明显少于预期（' + zh.size + ' 条）')
  // 占位符要对得上，否则英文里会留下字面 {n}
  for (const key of zh) {
    const placeholders = (text) => (String(text).match(/\{\w+\}/g) ?? []).sort().join(',')
    assert.equal(placeholders(internals.__ui.zh[key]), placeholders(internals.__ui.en[key]), '占位符不一致：' + key)
  }
})

test('候选 → 草稿：时间按本地时区、来源邮件写进描述、带上待办 id 以便回写', async () => {
  const { internals } = await setup()
  const draft = internals.__mail.mailCandidateToDraft(CANDIDATE)
  assert.equal(draft.summary, '季度评审会')
  assert.equal(draft.uid, undefined, '来自邮件的草稿是新日程，不能带 uid')
  assert.equal(draft.mailTodoId, 'cand-1', '没有这个 id，建完就无法回写候选状态')
  assert.equal(draft.allDay, false)
  assert.match(draft.startTime, /^\d{2}:\d{2}$/)
  assert.match(draft.endTime, /^\d{2}:\d{2}$/)
  assert.equal(draft.date.length, 10)
  assert.match(draft.description, /Q4 评审|boss@example\.com/, '正文要写清来源邮件')
})

test('待确认清单：渲染出标题、时间、来源、逐条处理按钮与低置信提示', async () => {
  const { react, reactDomClient, internals } = await setup()
  const { container, root } = await render(react, reactDomClient, react.createElement(internals.__components.MailTodoDialog, {
    onClose() {}, onPick() {}, onCounts() {},
  }))
  try {
    await flush(react)
    assert.match(container.textContent, /季度评审会/, '候选标题要出现在清单里')
    assert.match(container.textContent, /12 月 1 日|12月1日|12\/1/, '时间要给用户看，实际渲染：' + container.textContent.slice(0, 120))
    assert.match(container.textContent, /boss@example\.com/, '来源邮件不能省')
    assert.equal(container.querySelectorAll('.dshc-todo-card').length, 1)
    const buttons = [...container.querySelectorAll('button')].map((node) => node.textContent)
    assert.ok(buttons.includes('创建日程'), '缺「创建日程」：' + buttons.join('/'))
    assert.ok(buttons.includes('忽略'), '缺「忽略」：' + buttons.join('/'))
    assert.equal(buttons.includes('忽略整封邮件'), false, '整封邮件级的忽略按钮已移除：' + buttons.join('/'))
    assert.match(container.textContent, /把握不大/, 'confidence 低于 0.6 时要提示核对')
  } finally { await react.act(async () => { root.unmount() }) }
})

test('未配置邮箱的空清单给出去设置页的指引，而不是一句「没有日程」', async () => {
  const { react, reactDomClient, internals } = await setup({
    handler: (body) => (body.action === 'candidates'
      ? { items: [], counts: { pending: 0, new: 0, created: 0, ignored: 0, failed: 0 } }
      : { configured: false, analyzedAt: null, counts: { pending: 0, new: 0, created: 0, ignored: 0, failed: 0 } }),
  })
  const { container, root } = await render(react, reactDomClient, react.createElement(internals.__components.MailTodoDialog, { onClose() {}, onPick() {}, onCounts() {} }))
  try {
    await flush(react)
    assert.match(container.textContent, /设置/, '没配邮箱要指到设置页，实际：' + container.textContent)
  } finally { await react.act(async () => { root.unmount() }) }
})

test('点「创建日程」只回调候选，不在弹窗里偷偷落盘', async () => {
  const { react, reactDomClient, internals, calls } = await setup()
  const picked = []
  const { container, root } = await render(react, reactDomClient, react.createElement(internals.__components.MailTodoDialog, {
    onClose() {}, onPick: (item) => picked.push(item), onCounts() {},
  }))
  try {
    await flush(react)
    const create = [...container.querySelectorAll('button')].find((node) => node.textContent === '创建日程')
    await react.act(async () => { create.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    assert.equal(picked.length, 1)
    assert.equal(picked[0].id, 'cand-1')
    assert.equal(calls.some((call) => call.body && call.body.action === 'create'), false, '弹窗不该自己建日程')
  } finally { await react.act(async () => { root.unmount() }) }
})

test('设置卡片：换服务商自动填主机、保存后若没回扫过就弹分析对话框', async () => {
  const status = {
    configured: false, enabled: false, provider: 'qq', user: '', imapHost: 'imap.qq.com', imapPort: 993,
    imapSecure: true, inboxFolder: 'INBOX', analyzeDays: 7, pollSeconds: 60, useLlm: true, hasPassword: false,
    analyzedAt: null, llmAvailable: false, counts: { pending: 0, new: 0, created: 0, ignored: 0, failed: 0 },
  }
  const { react, reactDomClient, internals, calls } = await setup({
    handler: (body) => (body.action === 'saveConfig' ? { ...status, configured: true, enabled: true, user: 'me@example.com' } : { ...status, counts: {} }),
  })
  const { container, root } = await render(react, reactDomClient, react.createElement(internals.__components.MailSettingsCard, {}))
  try {
    await flush(react)
    assert.match(container.textContent, /邮件日程识别/, '设置卡片要有标题')
    const selects = container.querySelectorAll('select')
    assert.ok(selects.length >= 2, '服务商与天数各一个下拉')
    await react.act(async () => {
      selects[0].value = 'gmail'
      selects[0].dispatchEvent(new window.Event('change', { bubbles: true }))
    })
    await flush(react)
    const hostInput = [...container.querySelectorAll('input')].find((node) => node.value === 'imap.gmail.com')
    assert.notEqual(hostInput, undefined, '换到 Gmail 要自动填 imap.gmail.com')
    // 填账号 + 授权码后保存
    const textInputs = [...container.querySelectorAll('input')].filter((node) => node.type === 'email' || node.type === 'password')
    await react.act(async () => {
      for (const node of textInputs) {
        node.value = node.type === 'password' ? 'app-pass' : 'me@example.com'
        node.dispatchEvent(new window.Event('input', { bubbles: true }))
      }
    })
    await flush(react)
    const save = [...container.querySelectorAll('button')].find((node) => node.textContent === '保存')
    assert.notEqual(save, undefined, '要有保存按钮')
    await react.act(async () => { save.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await flush(react, 60)
    assert.ok(calls.some((call) => call.body && call.body.action === 'saveConfig'), '保存要发 saveConfig')
    assert.match(container.textContent, /分析|回扫/, '保存成功且没回扫过，应引导去做首次回扫')
  } finally { await react.act(async () => { root.unmount() }) }
  void internals
})

test('新邮件提示条：说清「还没进日历」，两个按钮都在', async () => {
  const { react, reactDomClient, internals } = await setup()
  const { container, root } = await render(react, reactDomClient, react.createElement(internals.__components.MailArrivalToast, {
    count: 2, onOpen() {}, onClose() {},
  }))
  try {
    assert.match(container.textContent, /2/, '条数要出现')
    assert.match(container.textContent, /确认|日历/, '提示要说明还要用户确认')
    const buttons = [...container.querySelectorAll('button')].map((node) => node.textContent)
    assert.equal(buttons.length, 2, '查看 + 稍后：' + buttons.join('/'))
  } finally { await react.act(async () => { root.unmount() }) }
})

test('工具条文案：没待办就是纯入口，有 pending 带条数', async () => {
  const { internals } = await setup()
  assert.equal(internals.__mail.mailToolbarLabel(null), '邮件日程')
  assert.equal(internals.__mail.mailToolbarLabel({ pending: 0, new: 0 }), '邮件日程')
  assert.equal(internals.__mail.mailToolbarLabel({ pending: 3 }), '邮件日程 3')
})
