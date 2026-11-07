/** iCloud 日历发现：用假应答覆盖解析、过滤、认证错误，绝不发真实网络请求。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverIcloudCalendars } from '../lib/discover-icloud.js'

const PRINCIPAL_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/</d:href>
    <d:propstat><d:prop>
      <d:current-user-principal><d:href>/11657411925/principal/</d:href></d:current-user-principal>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`

const CALENDARS_XML = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/11657411925/calendars/home/</D:href>
    <D:propstat><D:prop><D:displayname>Home</D:displayname>
      <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/11657411925/calendars/work/</D:href>
    <D:propstat><D:prop><D:displayname>工作</D:displayname>
      <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/11657411925/calendars/inbox/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/><C:schedule-inbox/></D:resourcetype>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/11657411925/calendars/notification/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
    </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
</D:multistatus>`

/** 按请求顺序返回应答，并把请求记下来供断言。 */
function fakeFetch(...responses) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (next === undefined) throw new Error('unexpected request')
    return typeof next === 'number' ? { ok: false, status: next, text: async () => '' } : { ok: true, status: 207, text: async () => next }
  }
  return { calls, impl }
}

test('两步 PROPFIND 列出日历：ID、名称、完整 URL 都对，伪集合被排除', async () => {
  const { calls, impl } = fakeFetch(PRINCIPAL_XML, CALENDARS_XML)
  const list = await discoverIcloudCalendars({
    username: 'me@icloud.com', password: 'app-pass', fetchImpl: impl,
  })
  assert.equal(list.length, 2, 'inbox / notification 不该出现')
  assert.deepEqual(list[0], {
    name: 'Home', url: 'https://caldav.icloud.com/11657411925/calendars/home/',
  })
  assert.equal(list[1].name, '工作')
  assert.ok(list[1].url.endsWith('/'), '集合 URL 结尾的 / 不能丢')

  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /\.well-known\/caldav$/)
  assert.equal(calls[0].init.headers.Depth, '0')
  assert.equal(calls[0].init.method, 'PROPFIND')
  assert.match(calls[1].url, /\/11657411925\/calendars\/$/)
  assert.equal(calls[1].init.headers.Depth, '1')
  assert.equal(calls[1].init.headers.Authorization,
    'Basic ' + Buffer.from('me@icloud.com:app-pass').toString('base64'))
  assert.equal(JSON.stringify(list).includes('app-pass'), false, '结果不能带凭据')
})

test('401 给出可操作的中文提示，不回显密码', async () => {
  const { impl } = fakeFetch(401)
  await assert.rejects(
    () => discoverIcloudCalendars({ username: 'me@icloud.com', password: 'wrong', fetchImpl: impl }),
    (error) => /认证失败/.test(error.message) && /App 专用密码/.test(error.message) && !/wrong/.test(error.message),
  )
})

test('账号或密码为空时先拦住，不发请求', async () => {
  const { calls, impl } = fakeFetch(PRINCIPAL_XML)
  await assert.rejects(
    () => discoverIcloudCalendars({ username: '', password: 'x', fetchImpl: impl }),
    /先填 Apple ID/,
  )
  assert.equal(calls.length, 0)
})

test('应答里没有账号数字 ID 时明确报错', async () => {
  const { impl } = fakeFetch('<d:multistatus xmlns:d="DAV:"></d:multistatus>')
  await assert.rejects(
    () => discoverIcloudCalendars({ username: 'me@icloud.com', password: 'p', fetchImpl: impl }),
    /没读到 iCloud 账号 ID/,
  )
})

test('日历列表为空时报错，而不是返回空数组让人以为成功', async () => {
  const { impl } = fakeFetch(PRINCIPAL_XML, '<D:multistatus xmlns:D="DAV:"></D:multistatus>')
  await assert.rejects(
    () => discoverIcloudCalendars({ username: 'me@icloud.com', password: 'p', fetchImpl: impl }),
    /没发现可用的日历集合/,
  )
})
