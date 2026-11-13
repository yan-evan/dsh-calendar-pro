import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname } from 'node:path'
import { runInNewContext } from 'node:vm'

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8')

test('browser bundle activates and registers native main, sidebar and settings', () => {
  const pkg = JSON.parse(read('package.json'))
  let definition, client, active='en'
  const react={createElement:(type,props,...children)=>({type,props,children}),useEffect(){}}
  runInNewContext(read('lib/client.js'),{
    window:{__ModuleLoader__:{load(entry){definition=entry;client=entry.factory(name=>{
      if(name==='react')return react
      throw new Error('Unexpected eager UI dependency: '+name)
    })}}}
  })
  assert.equal(definition.id,pkg.name)
  const registrations=[]
  const locale={getSnapshot:()=>({active})}
  client.apply({locale,get:()=>locale,effect(fn,label){if(label?.endsWith(': locale'))return fn()},slots:{inject(_name,fn){fn()},register(meta,component){registrations.push({meta,component});return ()=>{}}}})
  const main=registrations.find(row=>row.meta.name==='main')
  const sidebar=registrations.find(row=>row.meta.name==='sidebar.panellist')
  const settings=registrations.find(row=>row.meta.name==='settings.section')
  assert.ok(main);assert.ok(sidebar);assert.ok(settings)
  assert.equal(main.meta.key,sidebar.meta.id)
  assert.equal(main.meta.inject().workbench,true)
  assert.equal(typeof main.component,'function')
  assert.equal(typeof settings.component,'function')
  const en=sidebar.meta.label();assert.ok(en);assert.doesNotMatch(en,/[\u3400-\u9fff]/)
  active='zh';assert.ok(sidebar.meta.label())
  // 两个入口分工：侧栏只有日历，设置页只有日历来源 / 经期 / ICS 三块。
  assert.equal(main.component.name,'CalendarSection')
  assert.equal(settings.component.name,'SettingsSection')
  assert.equal(settings.meta.id,pkg.name)
})

test('上游的检查更新 / 自动更新组件已整体移除，构建链不再经过上游包装脚本', () => {
  const pkg = JSON.parse(read('package.json'))
  const client = read('lib/client.js')
  const node = read('src/index.ts')
  // 上游更新组件会在构建期给每个字面量 h(W.Page, …) 追加页脚；那套别名与守卫必须一起消失。
  for (const forbidden of ['__stardustUpdatesInlinePage', '__stardustUpdatesGuard', 'WorkbenchPage',
    'UpdatesSection', 'calendar-updates', 'registerUpdates', '版本与更新', '@stardustlc/dsh-updates']) {
    assert.equal(client.includes(forbidden), false, '浏览器产物里还留着 ' + forbidden)
  }
  assert.match(client, /function SettingsSection\(/)
  assert.match(client, /h\(W\.Page,\{workbench:props\.workbench/,'侧栏页直接渲染，不需要别名绕开注入')
  assert.equal(node.includes('registerUpdates'), false)
  assert.equal(existsSync(new URL('../scripts/build-updates.mjs', import.meta.url)), false)
  assert.equal(pkg.scripts.build.includes('build-updates'), false)
  assert.equal('@stardustlc/dsh-updates' in (pkg.dependencies ?? {}), false)
  assert.equal('@stardustlc/dsh-updates' in (pkg.devDependencies ?? {}), false)
})

test('清单与双端产物符合宿主真实契约（按 DSH 源码核对，不按旧版 skill 文档）', async () => {
  const pkg = JSON.parse(read('package.json'))
  const patch = read('cordis.patch.yml')
  const clientBundle = read('lib/client.js')
  // Node 半身：main/types/Config 与组合包补丁
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.types, 'lib/index.d.ts')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(patch, /- id: calendar-pro/)
  assert.match(patch, /name: 'dsh-calendar-pro'/)
  const { apply, Config, name } = await import(new URL('../lib/index.js', import.meta.url))
  assert.equal(typeof apply, 'function')
  assert.equal(name, pkg.name, 'fiber 诊断名用包名，避免与其它日历插件混淆')
  assert.equal(typeof Config['~standard']?.validate, 'function', 'Cordis 用 ~standard.validate 校验 Config')
  // 浏览器半身：exports["./client"] + lazy ModuleLoader factory + 单文件无 Node 依赖
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0)
  assert.match(clientBundle, new RegExp('window\\.__ModuleLoader__\\.load\\(\\{ id: "' + pkg.name + '", factory:'))
  assert.equal(/\bimport\s*\(/.test(clientBundle), false, '不允许动态 import')
  assert.equal(/from\s+['"]node:|require\(\s*['"]node:/.test(clientBundle), false, '浏览器产物不能依赖 Node 内置模块')
  // dshx.contributes 是旧文档里的虚构字段，当前宿主零解析；写上去只是死元数据。
  assert.equal('dshx' in pkg, false)
})

test('发布白名单里没有写死的凭据、令牌或运行时数据', () => {
  const pkg = JSON.parse(read('package.json'))
  const allow = pkg.files
  assert.ok(Array.isArray(allow) && allow.length > 0, 'files 必须是白名单，不要改成黑名单')
  // 测试夹具里有假密码，但整个 test/ 不该进发布包；运行时数据也不该被带走。
  for (const forbidden of ['test', '.env', 'connection.json', 'calendar.json', '.workbuddy', '.git']) {
    assert.equal(allow.includes(forbidden), false, '不该发布 ' + forbidden)
  }
  // 对外文档已整体删除待重写：白名单里不能挂着 docs 目录，否则旧文档会跟着发布。
  assert.equal(allow.includes('docs'), false, 'docs/ 整体进白名单会把旧文档一起打包')
  assert.equal(allow.includes('LICENSE'), true, 'LICENSE 必须随包发布')
  const secrets = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /\bGOCSPX-[0-9A-Za-z_-]{10,}/,
    /\bsk-[0-9A-Za-z]{20,}/,
    /\bgh[pousr]_[0-9A-Za-z]{20,}/,
    /\bnpm_[0-9A-Za-z]{30,}/,
    /\bBearer [A-Za-z0-9._-]{24,}/,
    /\bBasic [A-Za-z0-9+/=]{20,}/,
  ]
  const binary = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.ico'])
  const visited = new Set()
  const scan = (target) => {
    const abs = fileURLToPath(new URL('../' + target, import.meta.url))
    if (visited.has(abs) || !existsSync(abs)) return
    visited.add(abs)
    if (!statSync(abs).isDirectory()) {
      if (binary.has(extname(abs))) return
      const text = readFileSync(abs, 'utf8')
      for (const pattern of secrets) {
        assert.equal(pattern.test(text), false, target + ' 里疑似写死了凭据：' + pattern)
      }
      return
    }
    for (const name of readdirSync(abs)) scan(target.replace(/\/$/, '') + '/' + name)
  }
  for (const entry of allow) scan(entry)
  assert.ok(visited.size > 20, '应扫到发布包里的实际文件')
})
