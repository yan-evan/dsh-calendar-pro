/**
 * 邮件路由门禁：只收回环地址、Host 校验、来源头、JSON POST、请求体上限，另加一条成功正例。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mailHandler, MAIL_HEADER, MAIL_ROUTE } from '../lib/index.js'

/** 造一个最小 req：能 async 迭代出 body，socket 可控。 */
function makeReq(options = {}) {
  const body = options.body === undefined ? '' : options.body
  const chunks = body === '' ? [] : [Buffer.from(body, 'utf8')]
  return {
    method: options.method ?? 'POST',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...(options.headers ?? {}) },
    socket: { remoteAddress: options.remote ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeRes() {
  const state = { status: null, headers: null, body: null }
  return {
    state,
    writeHead(status, headers) { state.status = status; state.headers = headers },
    end(text) { state.body = JSON.parse(text) },
  }
}

/** 只记请求的假后端，避免真去碰 IMAP。 */
function fakeBackend() {
  const calls = []
  return {
    calls,
    status: () => ({ configured: false, counts: { pending: 0, new: 0, created: 0, ignored: 0, failed: 0 } }),
    dispatch: async (action, body) => { calls.push([action, body]); return { echo: action } },
  }
}

test('非回环地址一律 403（局域网里的别的机器不能借你的邮箱）', async () => {
  const res = makeRes()
  await mailHandler(fakeBackend())(makeReq({ remote: '192.168.1.20', headers: { [MAIL_HEADER]: '1' } }), res)
  assert.equal(res.state.status, 403)
  assert.equal(res.state.body.ok, false)
})

test('Host 不对（DNS rebinding）403', async () => {
  const res = makeRes()
  await mailHandler(fakeBackend())(makeReq({ headers: { host: 'evil.example.com', [MAIL_HEADER]: '1' } }), res)
  assert.equal(res.state.status, 403)
})

test('缺来源头 403：跨源页面伪造不了这个头', async () => {
  const res = makeRes()
  await mailHandler(fakeBackend())(makeReq({ body: JSON.stringify({ action: 'status' }) }), res)
  assert.equal(res.state.status, 403)
  assert.match(String(res.state.body.error.message), /header/)
})

test('GET 只回状态，不落任何动作', async () => {
  const backend = fakeBackend()
  const res = makeRes()
  await mailHandler(backend)(makeReq({ method: 'GET', headers: { [MAIL_HEADER]: '1' } }), res)
  assert.equal(res.state.status, 200)
  assert.equal(res.state.body.ok, true)
  assert.equal(backend.calls.length, 0, 'GET 不该触发任何动作')
})

test('带齐门禁后动作落到 backend，回 {ok:true,value} 信封', async () => {
  const backend = fakeBackend()
  const res = makeRes()
  await mailHandler(backend)(makeReq({ headers: { [MAIL_HEADER]: '1' }, body: JSON.stringify({ action: 'candidates' }) }), res)
  assert.equal(res.state.status, 200)
  assert.deepEqual(res.state.body, { ok: true, value: { echo: 'candidates' } })
  assert.deepEqual(backend.calls, [['candidates', { action: 'candidates' }]], 'body 原样交给 backend，动作名由它自己取')
  assert.equal(res.state.headers['cache-control'], 'no-store', '状态与候选都可能带邮件片段，不能进缓存')
})

test('非 JSON 与超大请求体被挡在动作之前', async () => {
  const backend = fakeBackend()
  const bad = makeRes()
  await mailHandler(backend)(makeReq({ headers: { [MAIL_HEADER]: '1' }, body: 'not json' }), bad)
  assert.equal(bad.state.status, 400)
  assert.equal(backend.calls.length, 0, '坏请求不该进 backend')

  const huge = makeRes()
  const big = JSON.stringify({ action: 'status', pad: 'x'.repeat(300 * 1024) })
  await mailHandler(backend)(makeReq({ headers: { [MAIL_HEADER]: '1' }, body: big }), huge)
  assert.equal(huge.state.status, 400)
  assert.match(String(huge.state.body.error.message), /过大/)
})

test('backend 抛错时回 ok:false，不把异常漏成 500 栈', async () => {
  const res = makeRes()
  const backend = { status: () => ({}), dispatch: async () => { throw new Error('请先填写邮箱账号') } }
  await mailHandler(backend)(makeReq({ headers: { [MAIL_HEADER]: '1' }, body: JSON.stringify({ action: 'saveConfig' }) }), res)
  assert.equal(res.state.body.ok, false)
  assert.equal(res.state.body.error.message, '请先填写邮箱账号')
})

test('路由常量与客户端约定一致（拼错就是整条链路 404）', () => {
  assert.equal(MAIL_ROUTE, '/_dsh/dsh-calendar-pro/mail')
  assert.equal(MAIL_HEADER, 'x-dsh-calendar-pro-mail')
})
