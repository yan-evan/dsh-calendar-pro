/**
 * 候选库状态机：重扫不翻回 pending、忽略整封连带同封多条、淘汰优先丢已处理条目。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearNewFlags,
  countCandidates,
  mailCandidatesFile,
  mailConfigFile,
  mergeCandidates,
  pruneCandidates,
  readMailState,
  updateCandidate,
  MAIL_KEEP_DAYS,
} from '../lib/index.js'

const NOW = Date.parse('2026-11-19T02:00:00Z')

/** 造一条候选：id 唯一化靠 uid + index。 */
function candidate(overrides = {}) {
  const uid = overrides.uid ?? 11
  const index = overrides.index ?? 0
  return {
    id: 'id-' + uid + '-' + index,
    account: 'me@example.com',
    folder: 'INBOX',
    uid,
    uidValidity: 7,
    summary: '季度评审会',
    start: '2026-12-01T06:00:00Z',
    end: '2026-12-01T07:00:00Z',
    allDay: false,
    location: '',
    description: '',
    confidence: 0.8,
    source: 'llm',
    state: 'pending',
    isNew: true,
    mail: { from: 'boss@example.com', subject: '评审会', date: '2026-11-18T02:00:00Z', snippet: '12 月 1 日开会' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

test('重扫同一封邮件：已忽略 / 已建日程的条目不翻回待确认，只刷新展示字段', () => {
  const created = candidate({ index: 0, state: 'created', isNew: false, calendarUid: 'cal-1', summary: '旧标题' })
  const ignored = candidate({ index: 1, state: 'ignored', isNew: false })
  const fresh = candidate({ index: 2 })
  const incoming = [
    candidate({ index: 0, summary: '新标题', state: 'pending', isNew: true }),
    candidate({ index: 1, state: 'pending', isNew: true }),
    candidate({ index: 2, state: 'pending', isNew: true }),
  ]
  const merged = mergeCandidates([created, ignored], incoming, NOW + 1000)
  const byId = Object.fromEntries(merged.items.map((item) => [item.id, item]))
  assert.equal(byId['id-11-0'].state, 'created', '已建日程不能被重扫覆盖')
  assert.equal(byId['id-11-0'].calendarUid, 'cal-1')
  assert.equal(byId['id-11-0'].summary, '新标题', '展示字段要跟着刷新')
  assert.equal(byId['id-11-1'].state, 'ignored', '已忽略不能被重扫覆盖')
  assert.equal(byId['id-11-2'].state, 'pending')
  assert.equal(byId['id-11-2'].isNew, true, '新条目标成新的，界面才会提示')
  assert.equal(merged.added.length, 1, '只有真正新的那条算「本次新增」')
  assert.equal(merged.items.length, 3)
})

test('counts：new 只数「待确认 + 未看过」，其他状态各归各的', () => {
  const items = [
    candidate({ index: 0 }),
    candidate({ index: 1, isNew: false }),
    candidate({ index: 2, state: 'created', isNew: false }),
    candidate({ index: 3, state: 'ignored', isNew: false }),
    candidate({ index: 4, state: 'failed' }),
  ]
  assert.deepEqual(countCandidates(items), { pending: 2, new: 1, created: 1, ignored: 1, failed: 1 })
})

test('打开清单后角标清零：isNew 全部落下，待办本身留着', () => {
  const items = [candidate({ index: 0 }), candidate({ index: 1 }), candidate({ index: 2, state: 'created' })]
  const cleared = clearNewFlags(items, NOW + 500)
  assert.equal(countCandidates(cleared).new, 0)
  assert.equal(countCandidates(cleared).pending, 2, '清零不等于处理')
  assert.ok(cleared.every((item) => item.updatedAt >= NOW))
})

test('淘汰：待确认与失败的永不清，旧的已处理条目按天数与条数上限收走', () => {
  const ancient = NOW - (MAIL_KEEP_DAYS + 5) * 24 * 3600 * 1000
  // 淘汰看的是 updatedAt（老数据只有 createdAt 时兜底），所以两条都要摆旧。
  const stale = { createdAt: ancient, updatedAt: ancient }
  const items = [
    candidate({ index: 0, ...stale }),
    candidate({ index: 1, state: 'created', ...stale }),
    candidate({ index: 2, state: 'ignored', ...stale }),
    candidate({ index: 3, state: 'failed', ...stale }),
    candidate({ index: 4, createdAt: NOW - 3600 * 1000 }),
  ]
  const pruned = pruneCandidates(items, NOW)
  const ids = pruned.map((item) => item.id)
  assert.ok(ids.includes('id-11-0'), '待确认的要留')
  assert.ok(ids.includes('id-11-3'), '失败可重试的也要留')
  assert.equal(ids.includes('id-11-1'), false, '过期且已建的可以清')
  assert.equal(ids.includes('id-11-2'), false, '过期且已忽略的可以清')

  const many = Array.from({ length: 600 }, (_, index) => candidate({
    index,
    state: 'created',
    createdAt: NOW - index * 60000,
    updatedAt: NOW - index * 60000,
  }))
  assert.ok(pruneCandidates(many, NOW).length <= 500, '已处理条目有总量上限')
})

test('状态文件坏了也不崩：读回空库，写配置不留明文到候选文件里', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-calendar-mail-store-'))
  try {
    const stateFile = join(dir, 'mail-candidates.json')
    writeFileSync(stateFile, '{ 这不是 JSON', 'utf8')
    const state = readMailState(stateFile)
    assert.equal(state.candidates.length, 0)
    assert.deepEqual(state.cursors, {})
    assert.equal(mailConfigFile({ DSH_HOME: dir }).endsWith(join('dsh-calendar-pro', 'mail.json')), true)
    assert.equal(mailCandidatesFile({ DSH_HOME: dir }).endsWith(join('dsh-calendar-pro', 'mail-candidates.json')), true)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateCandidate 找不到 id 时原样返回（并发删除不算错误）', () => {
  const items = [candidate({ index: 0 }), candidate({ index: 1 })]
  const after = updateCandidate(items, 'id-11-9', { state: 'ignored', isNew: false }, NOW + 1000)
  assert.equal(after.length, 2)
  assert.equal(after[0].state, 'pending')
  assert.equal(after[0].updatedAt, NOW)
})
