import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MailBackend } from '../lib/index.js'
import { readMailState, readMailConfig } from '../lib/index.js'

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-calendar-mail-'))
  return {
    dir,
    configFile: join(dir, 'mail.json'),
    stateFile: join(dir, 'mail-candidates.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** 假 IMAP 客户端：只回测试脚本里事先摆好的邮件。 */
class FakeClient {
  constructor(messages) {
    this.messages = messages
    this.calls = []
  }
  async testConnection() { return { ok: true, detail: '连接成功' } }
  async listRecent(days, limit) {
    this.calls.push(['listRecent', days, limit])
    return { uidValidity: 7, messages: this.messages.map(m => ({ ...m, uidValidity: 7 })) }
  }
  async listSince(maxUid, limit) {
    this.calls.push(['listSince', maxUid, limit])
    const fresh = this.messages.filter(m => m.uid > maxUid)
    const currentMax = Math.max(0, ...this.messages.map(m => m.uid))
    return { uidValidity: 7, messages: fresh.map(m => ({ ...m, uidValidity: 7 })), maxUid: currentMax }
  }
  async fetchContents(messages) {
    return { contents: messages.map(m => ({ ...m, text: m.text ?? '', ics: m.ics ?? [], snippet: (m.text ?? '').slice(0, 80) })), failures: [] }
  }
}

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//test//EN',
  'BEGIN:VEVENT',
  'UID:ics-meeting-1',
  'SUMMARY:季度评审会',
  'DTSTART:20261201T060000Z',
  'DTEND:20261201T070000Z',
  'LOCATION:3 楼会议室',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

function fakeLlm(json) {
  return {
    stream() {
      return (async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '```json\n' + json + '\n```' }
        yield { type: 'finish', reason: 'stop' }
      })()
    },
  }
}

const LLM_JSON = JSON.stringify({
  events: [{
    summary: '和产品对齐需求',
    start: '2026-12-03T15:00:00+08:00',
    end: '2026-12-03T16:00:00+08:00',
    allDay: false,
    location: '线上',
    description: '评审 PRD',
    confidence: 0.8,
  }],
})

function backendFor(space, messages, llmRoute = { provider: 'p', model: 'm' }) {
  const client = new FakeClient(messages)
  const backend = new MailBackend({
    configFile: space.configFile,
    stateFile: space.stateFile,
    client,
    now: () => Date.parse('2026-11-19T02:00:00Z'),
    llm: () => ({ llm: fakeLlm(LLM_JSON), route: llmRoute }),
  })
  return { backend, client }
}

async function configure(backend) {
  return backend.dispatch('saveConfig', { config: { provider: 'qq', user: 'me@qq.com', password: 'auth-code', enroll: true } })
}

test('未配置时 status 如实报告且绝不回显授权码', async () => {
  const space = workspace()
  try {
    const { backend } = backendFor(space, [])
    const status = await backend.dispatch('status', {})
    assert.equal(status.configured, false)
    assert.equal(status.hasPassword, false)
    assert.equal(JSON.stringify(status).includes('auth-code'), false)
  } finally {
    space.cleanup()
  }
})

test('saveConfig 按预设补主机，空授权码保留原值', async () => {
  const space = workspace()
  try {
    const { backend } = backendFor(space, [])
    await backend.dispatch('saveConfig', { config: { provider: '163', user: 'me@163.com', password: 'p1' } })
    const first = readMailConfig(space.configFile)
    assert.equal(first.imapHost, 'imap.163.com')
    assert.equal(first.imapPort, 993)
    await backend.dispatch('saveConfig', { config: { user: 'me@163.com', password: '' } })
    const second = readMailConfig(space.configFile)
    assert.equal(second.password, 'p1')
    assert.equal(second.imapHost, 'imap.163.com')
  } finally {
    space.cleanup()
  }
})

test('首次回扫：.ics 走精确解析、正文走模型，一封多日程各自入库', async () => {
  const space = workspace()
  try {
    const { backend } = backendFor(space, [
      { uid: 11, date: '2026-11-18T09:00:00Z', from: 'a@x.com', subject: '评审会邀请', size: 4096, ics: [ICS] },
      { uid: 12, date: '2026-11-19T01:00:00Z', from: 'b@x.com', subject: '需求对齐', size: 2048, text: '下周四下午三点开个会' },
    ])
    await configure(backend)
    const started = await backend.dispatch('analyzeStart', { days: 7 })
    assert.equal(started.job.running, true)
    // 等后台任务收敛
    for (let i = 0; i < 200 && backend.status().job.running; i += 1) await new Promise(r => setTimeout(r, 10))
    const view = await backend.dispatch('candidates', {})
    assert.equal(view.items.length, 2)
    const ics = view.items.find(item => item.source === 'ics')
    assert.equal(ics.summary, '季度评审会')
    assert.equal(ics.allDay, false)
    assert.equal(new Date(ics.start).toISOString(), '2026-12-01T06:00:00.000Z')
    const llm = view.items.find(item => item.source === 'llm')
    assert.equal(llm.summary, '和产品对齐需求')
    assert.equal(llm.state, 'pending')
    assert.equal(llm.isNew, true)
    assert.equal(view.counts.pending, 2)
    assert.equal(view.counts.new, 2)
    assert.equal(readMailConfig(space.configFile).analyzedAt !== undefined, true)
  } finally {
    space.cleanup()
  }
})

test('重复回扫不会重复入库，也不会重复花模型调用', async () => {
  const space = workspace()
  try {
    const tracked = { calls: 0, streamCalls: 0 }
    const llm = {
      stream() {
        tracked.streamCalls += 1
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: LLM_JSON }
          yield { type: 'finish', reason: 'stop' }
        })()
      },
    }
    const client = new FakeClient([{ uid: 21, date: '2026-11-18T09:00:00Z', from: 'a@x.com', subject: '评审会', size: 4096, ics: [ICS] }])
    const backend = new MailBackend({
      configFile: space.configFile,
      stateFile: space.stateFile,
      client,
      now: () => Date.parse('2026-11-19T02:00:00Z'),
      llm: () => {
        tracked.calls += 1
        return { llm, route: { provider: 'p', model: 'm' } }
      },
    })
    await configure(backend)
    await backend.dispatch('analyzeStart', {})
    for (let i = 0; i < 200 && backend.status().job.running; i += 1) await new Promise(r => setTimeout(r, 10))
    await backend.dispatch('analyzeStart', {})
    for (let i = 0; i < 200 && backend.status().job.running; i += 1) await new Promise(r => setTimeout(r, 10))
    const view = await backend.dispatch('candidates', {})
    assert.equal(view.items.length, 1)
    assert.equal(readMailState(space.stateFile).processed !== undefined, true)
    assert.equal(tracked.streamCalls, 0, '这封有 .ics，本来就不该问模型')
    assert.equal(tracked.calls > 0, true)
  } finally {
    space.cleanup()
  }
})

test('markCreated 只能成功一次，重复调用会被拒绝', async () => {
  const space = workspace()
  try {
    const { backend } = backendFor(space, [
      { uid: 31, date: '2026-11-19T01:00:00Z', from: 'b@x.com', subject: '需求对齐', size: 2048, text: 'x' },
    ])
    await configure(backend)
    await backend.dispatch('analyzeStart', {})
    for (let i = 0; i < 200 && backend.status().job.running; i += 1) await new Promise(r => setTimeout(r, 10))
    const view = await backend.dispatch('candidates', {})
    const id = view.items[0].id
    const created = await backend.dispatch('markCreated', { id, calendarUid: 'ev-1' })
    assert.equal(created.items[0].state, 'created')
    assert.equal(created.items[0].calendarUid, 'ev-1')
    await assert.rejects(() => backend.dispatch('markCreated', { id, calendarUid: 'ev-2' }), /已经处理过/)
    await assert.rejects(() => backend.dispatch('markCreated', { id: '', calendarUid: 'x' }), /缺少待办 id/)
  } finally {
    space.cleanup()
  }
})

test('第一次轮询只建基线，第二次才把新邮件变成候选', async () => {
  const space = workspace()
  try {
    const messages = [{ uid: 41, date: '2026-11-18T09:00:00Z', from: 'a@x.com', subject: '旧邮件', size: 1024, ics: [ICS] }]
    const { backend, client } = backendFor(space, messages)
    await configure(backend)
    const first = await backend.poll()
    assert.equal(first.baseline, true)
    assert.equal(first.newCount, 0)
    const view1 = await backend.dispatch('candidates', {})
    assert.equal(view1.items.length, 0)

    messages.push({ uid: 42, date: '2026-11-19T01:00:00Z', from: 'b@x.com', subject: '新邀请', size: 2048, text: '明天上午十点开会' })
    const second = await backend.poll()
    assert.equal(second.newCount, 1)
    const view2 = await backend.dispatch('candidates', {})
    assert.equal(view2.items.length, 1)
    assert.equal(view2.items[0].isNew, true)
    assert.equal(view2.items[0].state, 'pending')
    assert.equal(client.calls.filter(c => c[0] === 'listSince').length, 2)
  } finally {
    space.cleanup()
  }
})

test('关掉模型开关时只认 .ics，正文邮件不进候选', async () => {
  const space = workspace()
  try {
    const { backend } = backendFor(space, [
      { uid: 51, date: '2026-11-19T01:00:00Z', from: 'b@x.com', subject: '纯正文', size: 1024, text: '周三下午两点开会' },
    ])
    await backend.dispatch('saveConfig', { config: { provider: 'qq', user: 'me@qq.com', password: 'p', useLlm: false } })
    await backend.dispatch('analyzeStart', {})
    for (let i = 0; i < 200 && backend.status().job.running; i += 1) await new Promise(r => setTimeout(r, 10))
    const view = await backend.dispatch('candidates', {})
    assert.equal(view.items.length, 0)
  } finally {
    space.cleanup()
  }
})

test('clearNew 把角标清零但保留待办本身', async () => {
  const space = workspace()
  try {
    const { backend } = backendFor(space, [
      { uid: 61, date: '2026-11-19T01:00:00Z', from: 'b@x.com', subject: '需求对齐', size: 1024, text: 'x' },
    ])
    await configure(backend)
    await backend.dispatch('analyzeStart', {})
    for (let i = 0; i < 200 && backend.status().job.running; i += 1) await new Promise(r => setTimeout(r, 10))
    const cleared = await backend.dispatch('clearNew', {})
    assert.equal(cleared.counts.new, 0)
    assert.equal(cleared.counts.pending, 1)
  } finally {
    space.cleanup()
  }
})

test('坏配置文件不会让后端起不来', async () => {
  const space = workspace()
  try {
    writeFileSync(space.configFile, '{ not json', 'utf8')
    const { backend } = backendFor(space, [])
    const status = await backend.dispatch('status', {})
    assert.equal(status.configured, false)
    assert.equal(status.provider, 'qq')
  } finally {
    space.cleanup()
  }
})

/** 等后台回扫收敛，避免用固定 sleep 造成偶发。 */
async function settle(backend) {
  for (let i = 0; i < 200 && backend.status().job.running; i += 1) await new Promise(r => setTimeout(r, 10))
}

test('模型答非 JSON 时留一条「待重试」候选，并把模型原话写进原因', async () => {
  const space = workspace()
  try {
    const client = new FakeClient([{ uid: 61, date: '2026-11-19T01:00:00Z', from: 'a@x.com', subject: '会议邀请', size: 2048, text: '明天碰一下，具体时间再约' }])
    const backend = new MailBackend({
      configFile: space.configFile,
      stateFile: space.stateFile,
      client,
      now: () => Date.parse('2026-11-19T02:00:00Z'),
      llm: () => ({ llm: fakeLlm('抱歉，我无法判断这封邮件'), route: { provider: 'p', model: 'm' } }),
    })
    await configure(backend)
    await backend.dispatch('analyzeStart', { days: 7 })
    await settle(backend)
    const view = await backend.dispatch('candidates', {})
    assert.equal(view.items.length, 1)
    assert.equal(view.items[0].state, 'failed')
    assert.ok(String(view.items[0].reason).includes('JSON'))
    const state = readMailState(space.stateFile)
    assert.equal(Object.keys(state.processed).length, 0, '识别失败不该记为已处理，否则永远没有第二次机会')
    assert.equal(state.lastScan.failed, 1)
  } finally {
    space.cleanup()
  }
})

test('再次点「重新分析」会强制重扫已处理过的邮件，成功后清掉失败占位', async () => {
  const space = workspace()
  try {
    let reply = '这不是 JSON'
    const messages = [{ uid: 62, date: '2026-11-19T01:00:00Z', from: 'a@x.com', subject: '评审邀请', size: 2048, text: '回头再定会议时间' }]
    const client = new FakeClient(messages)
    const backend = new MailBackend({
      configFile: space.configFile,
      stateFile: space.stateFile,
      client,
      now: () => Date.parse('2026-11-19T02:00:00Z'),
      llm: () => ({ llm: fakeLlm(reply), route: { provider: 'p', model: 'm' } }),
    })
    await configure(backend)
    await backend.dispatch('analyzeStart', { days: 7 })
    await settle(backend)
    assert.equal((await backend.dispatch('candidates', {})).items[0].state, 'failed')

    messages[0].text = '会议主题：征信变量管理系统项目详设评审\n会议时间：2026-11-20 10:00-11:00'
    reply = JSON.stringify({ events: [{ summary: '征信变量管理系统项目详设评审', start: '2026-11-20 10:00', end: '2026-11-20 11:00', allDay: false, location: '线上', confidence: 0.9 }] })
    await backend.dispatch('analyzeStart', { days: 7, force: true })
    await settle(backend)
    const view = await backend.dispatch('candidates', {})
    assert.equal(view.items.length, 1)
    assert.equal(view.items[0].state, 'pending')
    assert.equal(view.items[0].start, '2026-11-20T10:00+08:00')
    const state = readMailState(space.stateFile)
    assert.equal(Object.keys(state.processed).length, 1, '成功后应记为已处理')
  } finally {
    space.cleanup()
  }
})

test('轮询识别失败也会留下待重试候选，而不是悄悄吞掉', async () => {
  const space = workspace()
  try {
    const messages = []
    const client = new FakeClient(messages)
    const backend = new MailBackend({
      configFile: space.configFile,
      stateFile: space.stateFile,
      client,
      now: () => Date.parse('2026-11-19T02:00:00Z'),
      llm: () => ({ llm: fakeLlm('不是 JSON'), route: { provider: 'p', model: 'm' } }),
    })
    await configure(backend)
    await backend.poll()
    messages.push({ uid: 71, date: '2026-11-19T01:00:00Z', from: 'b@x.com', subject: '会议通知', size: 2048, text: '回头再定时间' })
    const polled = await backend.poll()
    assert.equal(polled.newCount, 0)
    const view = await backend.dispatch('candidates', {})
    assert.equal(view.items.length, 1)
    assert.equal(view.items[0].state, 'failed')
  } finally {
    space.cleanup()
  }
})
