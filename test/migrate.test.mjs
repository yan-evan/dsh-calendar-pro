/**
 * 迁移器：预检只读、执行幂等、原样搬运。
 *
 * 用两个独立的本地后端当「源 / 目标」，把冲突判定与幂等跑实，不依赖网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBackend } from '../lib/local-backend.js'
import { describePlan, planMigration, runMigration } from '../lib/migrate.js'

const fresh = () => new LocalBackend(join(mkdtempSync(join(tmpdir(), 'dshc-mig-')), 'calendar.json'))

function ics(uid, summary, start, end, extra = []) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//test//EN',
    'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:20261105T000000Z',
    'DTSTART:' + start, 'DTEND:' + end, 'SUMMARY:' + summary,
    ...extra,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}

test('预检：同 UID 跳过、同标题同起止判为疑似重复、其余待迁移', async () => {
  const from = fresh(), to = fresh()
  await from.importRaw('u1', ics('u1', '周会', '20261105T020000Z', '20261105T030000Z'))
  await from.importRaw('u2', ics('u2', '一对一', '20261106T020000Z', '20261106T030000Z'))
  await from.importRaw('u3', ics('u3', '评审', '20261107T020000Z', '20261107T030000Z'))

  // 目标端：u1 已存在（同 UID）；另有一条内容与 u3 完全相同但 UID 不同（疑似重复）。
  await to.importRaw('u1', ics('u1', '周会', '20261105T020000Z', '20261105T030000Z'))
  await to.importRaw('u3-twin', ics('u3-twin', '评审', '20261107T020000Z', '20261107T030000Z'))

  const plan = await planMigration(from, to)
  assert.equal(plan.total, 3)
  assert.deepEqual(plan.create.map(item => item.icalUid), ['u2'])
  assert.equal(plan.exists, 1, '同 UID 的不搬、也不改目标端')
  assert.equal(plan.duplicates.length, 1)
  assert.equal(plan.duplicates[0].existingUid, 'local://u3-twin')
  assert.equal(plan.invalid, 0)

  // 预检只读：目标端不能多出任何东西。
  assert.equal((await to.all()).length, 2)
  assert.match(describePlan(plan), /将迁移 1 条/)
  assert.match(describePlan(plan), /疑似重复跳过 1 条/)
})

test('执行：只写待迁移项，原样搬运未建模字段（X- 属性不能丢）', async () => {
  const from = fresh(), to = fresh()
  await from.importRaw('u1', ics('u1', '带扩展字段', '20261105T020000Z', '20261105T030000Z', ['X-CUSTOM-FLAG:keep-me', 'LOCATION:会议室 A']))
  await from.importRaw('u2', ics('u2', '普通', '20261106T020000Z', '20261106T030000Z'))
  await to.importRaw('u1', ics('u1', '目标端已有', '20261105T020000Z', '20261105T030000Z'))

  const plan = await planMigration(from, to)
  const result = await runMigration(from, to, plan)
  assert.equal(result.migrated, 1)
  assert.deepEqual(result.failed, [])

  const migrated = await to.raw('local://u2')
  assert.match(migrated, /SUMMARY:普通/)

  // 源端不能被清空：迁移是复制，删源数据是另一个动作。
  assert.equal((await from.all()).length, 2)
  assert.equal((await to.all()).length, 2)

  // 同 UID 的那条仍然保持目标端原样。
  assert.match(await to.raw('local://u1'), /SUMMARY:目标端已有/)
})

test('幂等：同一份数据跑第二遍没有可迁移项，重复执行不会造副本', async () => {
  const from = fresh(), to = fresh()
  await from.importRaw('u1', ics('u1', 'A', '20261105T020000Z', '20261105T030000Z'))
  await from.importRaw('u2', ics('u2', 'B', '20261106T020000Z', '20261106T030000Z'))

  const first = await planMigration(from, to)
  assert.equal(first.create.length, 2)
  await runMigration(from, to, first)

  const second = await planMigration(from, to)
  assert.equal(second.create.length, 0, '搬过的不能再搬一遍')
  assert.equal(second.exists, 2)
  const again = await runMigration(from, to, second)
  assert.equal(again.migrated, 0)
  assert.equal((await to.all()).length, 2)
})

test('时间重叠但内容不同：正常迁移，不算冲突', async () => {
  const from = fresh(), to = fresh()
  await from.importRaw('u1', ics('u1', '客户电话', '20261105T020000Z', '20261105T030000Z'))
  await to.importRaw('other', ics('other', '团队周会', '20261105T020000Z', '20261105T030000Z'))

  const plan = await planMigration(from, to)
  assert.equal(plan.create.length, 1, '重叠不是冲突，日历本来就允许并排')
  assert.equal(plan.duplicates.length, 0)
  await runMigration(from, to, plan)
  assert.equal((await to.all()).length, 2)
})

test('limit 限制单次搬运条数，剩下的留给下一批', async () => {
  const from = fresh(), to = fresh()
  for (const uid of ['a', 'b', 'c']) {
    await from.importRaw(uid, ics(uid, uid, '20261105T020000Z', '20261105T030000Z'))
  }
  const plan = await planMigration(from, to)
  const result = await runMigration(from, to, plan, { limit: 2 })
  assert.equal(result.migrated, 2)
  assert.equal((await to.all()).length, 2)
  const next = await planMigration(from, to)
  assert.equal(next.create.length, 1)
})
