/**
 * 入口分工 + 经期记录的静态契约。
 *
 * 这一层测的是「东西该在哪个页面」，渲染测试测不到：把导入面板从侧栏搬到设置页，
 * 组件本身完全正常，只有读源码/构建产物才知道按钮是不是又长回去了。
 * 另外核对中英文案成对 —— 只写一半时界面上会直接冒出中文或空字符串。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** 切出一个顶层函数体：从它自己到下一个顶层 function 定义为止。 */
function bodyOf(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.notEqual(start, -1, name + ' 不见了')
  const next = source.indexOf('\n        function ', start + 10)
  assert.notEqual(next, -1, name + ' 后面没有顶层函数，切片不可靠，本测试要跟着改')
  return source.slice(start, next)
}

test('导入只在设置页：侧栏日历与浮层都不再挂导入面板', () => {
  for (const file of ['templates/client.js', 'lib/client.js']) {
    const source = read(file)
    const panel = bodyOf(source, 'CalendarPanel')
    assert.equal(panel.includes('IcsImportPanel'), false, file + '：CalendarPanel 里还留着导入面板')
    assert.equal(panel.includes('importOpen'), false, file + '：导入浮层状态没删干净')
    // 整个 bundle 只允许一处渲染点，就在设置页。浮层/工具条各加一个按钮都会让这条挂掉。
    const renders = source.match(/h\(IcsImportPanel,/g) ?? []
    assert.equal(renders.length, 1, file + '：导入面板只该在设置页渲染一次（实际 ' + renders.length + '）')
    const launcher = bodyOf(source, 'Launcher')
    assert.equal(launcher.includes('IcsImportPanel'), false, file + '：悬浮面板里不该有导入')
  }
})

test('设置页这一节：经期记录在前、常驻导入面板在后，导入成功后让日历缓存失效', () => {
  for (const file of ['templates/client.js', 'lib/client.js']) {
    const source = read(file)
    const settings = bodyOf(source, 'SettingsSection')
    const order = ['h(CycleSettings,', 'h(IcsImportPanel,']
    assert.equal(settings.indexOf(order[0]) >= 0, true, file + '：设置页缺经期记录')
    assert.equal(settings.indexOf(order[0]) < settings.indexOf(order[1]), true, file + '：经期记录要排在导入前面（普通用户先看到它）')
    // 常驻面板没有「关闭」这回事：embedded 让面板收起关闭按钮、把「去连接」换成一句提示。
    assert.match(settings, /embedded: true/, file + '：设置页里的导入面板必须标成常驻')
    assert.match(settings, /onImported: invalidateCalendarData/, file + '：导入成功后要让日历的跨会话缓存失效')
    assert.match(bodyOf(source, 'IcsImportPanel'), /props\.embedded === true \? null : h\(Btn/, file + '：常驻时不该画关闭按钮')
  }
})

test('日历面板订阅经期配置：设置页一保存，已挂载的日历立刻重画', () => {
  for (const file of ['templates/client.js', 'lib/client.js']) {
    const source = read(file)
    const panel = bodyOf(source, 'CalendarPanel')
    assert.match(panel, /useState\(getCycleConfig\)/, file + '：日历要以模块级配置起手，不能每次进页面都是空的')
    assert.match(panel, /subscribeCycle\(setCycle\)/, file + '：不订阅就收不到设置页的保存')
    // 经期横线只出现在月 / 周（日期网格）视图，议程视图不画。
    const passes = panel.match(/,\s*cycle\s*[},]/g) ?? []
    assert.equal(passes.length, 2, file + '：只该有月、周两处传 cycle（实际 ' + passes.length + ' 处）')
    const agenda = bodyOf(source, 'AgendaView')
    assert.equal(agenda.includes('cycle'), false, file + '：议程视图不该再碰经期配置')
  }
  const source = read('templates/client.js')
  assert.equal((source.match(/cycleInfoOf\(cycle, /g) ?? []).length, 2, '月 / 周各判一次')
  assert.equal((source.match(/className: "dshc-period-mark"/g) ?? []).length, 2)
})

test('经期设置只有「保存 / 清除记录」两个动作：没有启用开关，反馈做在按钮上', () => {
  const source = read('templates/client.js')
  const settings = bodyOf(source, 'CycleSettings')
  assert.equal(settings.includes('Chk'), false, '不该再有「在日历上标出预计经期」这类开关')
  assert.equal(settings.includes('cycle.next'), false, '「下次预计日期」那一行已经删掉')
  assert.equal(settings.includes('cycle.invalid'), false, '不再有「请填写有效日期」这类文字提示')
  // 反馈：按钮自己变成「已保存」/「已清除」并锁 2 秒，到点自己恢复；同一时刻只亮一个。
  assert.match(settings, /t\(flash === "saved" \? "cycle\.saved" : "cycle\.save"\)/)
  assert.match(settings, /t\(flash === "cleared" \? "cycle\.cleared" : "cycle\.clear"\)/)
  assert.match(settings, /disabled: flash === "saved"/)
  assert.match(settings, /disabled: flash === "cleared"/)
  assert.match(settings, /setTimeout\([\s\S]{0,120}2000\)/)
  // 清除后三个输入框一起变空：不能只清日期，留着上次的 28 / 5。
  assert.match(source, /const EMPTY_CYCLE_DRAFT = \{ lastStart: "", cycleLength: "", periodLength: "" \}/)
  assert.equal((settings.match(/setDraft\(Object\.assign\(\{\}, EMPTY_CYCLE_DRAFT\)\)/g) ?? []).length, 2, '清除与「保存空表单」都要清空')
})

test('经期与导入相关的中英文案成对，不留半截', () => {
  const source = read('lib/client.js')
  if (!source.includes('return module.exports;')) throw new Error('client.js 装载契约变了，本测试的注入点要跟着改')
  let client
  runInNewContext(source.replace('return module.exports;', 'module.exports.probe = { UI }; return module.exports;'), {
    window: { __ModuleLoader__: { load({ factory }) { client = factory(() => ({})) } } },
  })
  const { zh, en } = client.probe.UI
  // 全量对齐：任何一条只写一门的文案，都会在另一种语言下露出原文或空白。
  const missing = Object.keys(zh).filter(key => !(key in en)).concat(Object.keys(en).filter(key => !(key in zh)))
  assert.deepEqual(missing, [], '中英文案不一致：' + missing.join(', '))
  for (const key of ['cycle.title', 'cycle.intro', 'cycle.lastStart', 'cycle.cycleLength', 'cycle.periodLength',
    'cycle.save', 'cycle.clear', 'cycle.saved', 'cycle.cleared', 'cycle.mark', 'import.file', 'import.noFile',
    'import.connectionHint', 'section.settingsSubtitle']) {
    assert.equal(typeof zh[key], 'string', '缺中文：' + key)
    assert.equal(typeof en[key], 'string', '缺英文：' + key)
    assert.doesNotMatch(en[key], /[\u3400-\u9fff]/, '英文文案里混进了中文：' + key)
  }
  // 功能说明 + 隐私声明 + 免责合并成一段，两件事都不能丢。
  assert.match(zh['cycle.intro'], /本机/)
  assert.match(zh['cycle.intro'], /备忘/)
  assert.match(en['cycle.intro'], /browser only/i)
  assert.match(en['cycle.intro'], /reminder only/i)
  // 「已保存」现在只是按钮上的短反馈，不该再带长尾巴。
  assert.equal(zh['cycle.saved'].length <= 6, true, '按钮文字要短：' + zh['cycle.saved'])
})

test('客户端发出的每个设置路由动作，服务端都有对应分支（防「未知动作」）', () => {
  const client = read('templates/client.js')
  const server = read('src/web.ts')
  // 客户端：api("xxx", …) —— 只统计走设置路由的调用（导入面板用的是 importApi，另算）。
  const called = new Set([...client.matchAll(/\bapi\(\s*"([a-zA-Z]+)"/g)].map(match => match[1]))
  // 服务端：action === 'xxx' 的比较分支。
  const handled = new Set([...server.matchAll(/action\s*===\s*'([a-zA-Z]+)'/g)].map(match => match[1]))
  assert.equal(called.size > 0, true, '至少解析到一些调用')
  const missing = [...called].filter(name => !handled.has(name))
  assert.deepEqual(missing, [], '这些动作客户端会发、服务端却没有分支：' + missing.join(', '))
  // 反过来也检查一下：服务端多出来的分支不算错（可能是工具调用用的），但确有导出/切换这两个新动作。
  assert.equal(handled.has('exportIcs'), true)
  assert.equal(handled.has('switchBackend'), true)
})

test('客户端与服务端的导入专用头一致，设置页卡片不铺深色底', () => {
  const client = read('templates/client.js')
  const server = read('src/import-web.ts')
  // 包名改成 -pro 时客户端漏改头，导致「预览与检查」403「请从日历导入面板操作」。
  assert.match(client, /"X-DSH-Calendar-Pro-Import": "1"/)
  assert.match(server, /x-dsh-calendar-pro-import/)
  assert.equal(/X-DSH-Calendar-Import": "1"/.test(client), false, '旧头不该再出现在客户端')
  // 深色模式：设置页三块卡片继承宿主页面底色，不能硬写 layer-1（会显得更暗）。
  assert.match(client, /\.dshc-settings \.dshc-source,\.dshc-settings \.dshc-cycle,\.dshc-settings \.dshc-import\{background:transparent\}/)
  // 真正发暗的是 W.Page 根节点 .dshw（自带 --w-bg），它也得透明。
  assert.match(client, /\.calendar-settings\.dshw,\.calendar-settings\{background:transparent\}/)
})

test('发布物里不再描述上游更新功能，也不再指向上游仓库', () => {
  // README 已重写并进发布白名单，与清单、补丁、产物一起扫。
  // 例外：README 的「## 鸣谢」节刻意声明 fork 来源（上游 v0.14.3），属于归属声明，
  // 允许出现上游仓库名；但更新功能的描述仍然全网禁止。
  const files = ['README.md', 'package.json', 'cordis.patch.yml', 'lib/client.js', 'lib/index.js']
  const forbidden = ['@stardustlc/dsh-updates', '版本与更新', 'Plugin updates',
    '自动检查默认开启', '检查更新、自动更新']
  for (const file of files) {
    const source = read(file)
    for (const word of forbidden) {
      assert.equal(source.includes(word), false, file + ' 里还留着 ' + word)
    }
  }
  const readme = read('README.md')
  const ackStart = readme.indexOf('## 鸣谢')
  const ackEnd = readme.indexOf('## License')
  assert.ok(ackStart > 0 && ackEnd > ackStart, 'README 要有「## 鸣谢」和「## License」节')
  const outsideAck = readme.slice(0, ackStart)
  assert.equal(outsideAck.includes('STARDUSTLC666'), false, '上游仓库名只能出现在鸣谢节里')
  assert.match(readme.slice(ackStart, ackEnd), /v0\.14\.3/, '鸣谢要写明基于上游哪个版本开发')
})

test('README 首屏居中（vLLM 式 HTML），正文纯 Markdown', () => {
  const readme = read('README.md')
  const sep = readme.indexOf('\n---\n')
  assert.ok(sep > 0, 'README 要有首屏与正文的分隔线 ---')
  const hero = readme.slice(0, sep)
  const body = readme.slice(sep)
  // 首屏：居中 logo（picture 双主题）→ h3 一句话 → 居中徽章 → 居中导航
  assert.match(hero, /<p align="center">\s*<picture>/, '首屏 logo 要用居中的 <picture>')
  assert.match(hero, /media="\(prefers-color-scheme: dark\)" srcset="(?:\/assets\/)?logo_with_name_dark\.svg"/, 'logo 要有深色主题版')
  assert.match(hero, /<img alt="dsh-calendar-pro" src="(?:\/assets\/)?logo_with_name\.svg"/, 'logo 浅色版路径')
  assert.match(hero, /<h3 align="center">/, '首屏要有居中的一句话总结')
  assert.equal((hero.match(/<p align="center">/g) ?? []).length, 3, '首屏恰好三块居中：logo / 徽章 / 导航')
  // 正文（分隔线之后）保持纯 Markdown，谁再写 HTML 进来拦下
  for (const tag of ['<p', '<h1', '<h2', '<h3', '<img', '<a href', '<div', '<br', '<picture']) {
    assert.equal(body.includes(tag), false, 'README 正文不该有 HTML 标签 ' + tag)
  }
  // README 引用的图片必须都在发布白名单里，否则 npm 页面全是死链
  const pkg = JSON.parse(read('package.json'))
  for (const asset of readme.match(/src(?:set)?="(?!https?:\/\/)([^"]+)"/g) ?? []) {
    const name = asset.match(/"([^"]+)"/)[1].replace(/^\//, '')
    assert.ok(pkg.files.includes(name), 'README 引用的 ' + name + ' 要在 files 白名单里')
  }
})

test('页脚固定在底部：内容区吃掉剩余高度，刷新线不占布局', () => {
  const client = read('templates/client.js')
  const workbench = read('templates/panels/workbench.js')
  // 统计 / 来源 / 拖拽提示这一行不参与 flex 压缩，高度留一行，避免内容变化挤动。
  assert.match(client, /\.dshc-footer\{margin-top:12px;flex:0 0 auto;min-height:16px/)
  // 加载态、首启页、空态都填满剩余空间，页脚才不会跳到半空中。
  assert.match(client, /\.dshc-loading\{min-height:240px;flex:1/)
  assert.match(client, /\.dshc-start\{[^}]*flex:1/)
  assert.match(client, /\.dshc-empty\{[^}]*flex:1/)
  // 后台刷新进度线是零高度浮层，出现/消失不推着页脚动。
  assert.match(client, /\.dshc-refresh\{position:relative;height:0/)
  assert.match(workbench, /\.calendar-workbench \.dshc-footer\{flex:0 0 auto;min-height:16px\}/)
  assert.match(workbench, /\.calendar-workbench \.dshc-loading,\.calendar-workbench \.dshc-start\{flex:1\}/)
})

test('空闲时段面板与日历视图互斥，且面板自己滚动（候选不被裁掉）', () => {
  const client = read('templates/client.js')
  const availability = read('templates/panels/availability.js')
  // 两者平级时，视图的 flex:1 会把面板挤扁、候选只剩两行 —— 打开面板就不渲染视图。
  assert.match(client, /availabilityOpen \? null : body\(\)/)
  assert.match(client, /availabilityOpen \? h\(AvailabilityPanel,/)
  // 工作台里面板吃满剩余高度并自己滚动，页脚仍固定在底部。
  assert.match(availability, /\.calendar-workbench \.calendar-availability\{flex:1;min-height:0;overflow:auto/)
  // 候选列表要标明总数，避免误以为只显示了部分。
  assert.match(availability, /result\.count\+text\(' 个候选/)
})

test('README / MANUAL 引用的本地文件都存在，且都在发布白名单里', () => {
  // npm 页面只会带上 files 白名单里的文件；引用了却没进包就是死链。
  const pkg = JSON.parse(read('package.json'))
  for (const doc of ['README.md', 'MANUAL.md']) {
    const text = read(doc)
    for (const match of text.matchAll(/\]\((?!https?:\/\/|#|mailto:)([^)]+)\)/g)) {
      const target = match[1].split('#')[0]
      if (target === '') continue
      assert.ok(
        existsSync(new URL('../' + target, import.meta.url)),
        doc + ' 指向的 ' + target + ' 不存在',
      )
      // npm 的 files 允许写目录（会带上目录下所有文件），所以目录条目也算覆盖。
      const covered = pkg.files.some((entry) => target === entry || target.startsWith(entry + '/'))
      assert.ok(covered, doc + ' 引用的 ' + target + ' 要进 files 白名单')
    }
  }
})

test('浮层只做快速查看：不放连接设置与找空闲入口', () => {
  // 同一个功能在侧栏叫「日历连接」、在浮层叫「连接设置」，两套名字 + 两套流程。
  // 浮层的定位是"随时看一眼日程"，配置类操作一律回侧栏做。
  const client = read('templates/client.js')
  const start = client.indexOf('const toolbar = compact ?')
  assert.ok(start > 0, '浮层工具条不见了')
  const end = client.indexOf("])) : h('div'", start)
  const compactToolbar = client.slice(start, end)
  assert.equal(/key: "conn"/.test(compactToolbar), false, '浮层工具条不该有连接入口')
  assert.equal(/key: ?['"]availability['"]/.test(compactToolbar), false, '浮层工具条不该有找空闲')
  assert.match(compactToolbar, /action\.new/, '新建要保留：记一条也算快速操作')
  assert.match(client, /"panel\.compactHint"/, '未配置时给一句指引，而不是放一个按钮')
})

test('浮层一屏布局：定高 + 月视图 6 行等分 + 日程条定高', () => {
  // 上一版只抄了「6 行等分」，没抄工作台配套的 flex 链和 chip 定高：
  // dowgrid 被一起 flex:1 拉高、日程条溢出格子压叠 —— 翻页就看着像乱码。
  const c = read('templates/client.js')
  assert.match(c, /\.dshc-float\{[^}]*height:640px[^}]*overflow:hidden/, '浮层固定高度且外层不滚')
  assert.match(c, /\.dshc-float \.dshc-root\{[^}]*display:flex/, 'root 到 view 的 flex 链要完整')
  assert.match(c, /\.dshc-float \.dshc-dowgrid\{flex:0 0 auto\}/, '星期头不能被拉高')
  assert.match(c, /\.dshc-float \.dshc-monthgrid\{[^}]*repeat\(6,minmax\(0,1fr\)\)/, '月视图固定 6 行等分')
  assert.match(c, /\.dshc-float \.dshc-chip\{[^}]*height:15px/, '日程条固定高度，放不下的收成 +N')
  assert.match(c, /\.dshc-float \.dshc-week\{[^}]*flex:1/, '周视图跟随剩余高度，不写死 520')
})

test('页脚日程数按当前视图统计，过去的日程也要算进去', () => {
  // 以前只数「今天之后」的，翻到过去的月份会出现「屏幕 3 条、页脚 0 条」。
  const c = read('templates/client.js')
  assert.match(c, /t\("count\.events", \{ n: shownEvents\.length \}\)/, '页脚要用当前视图的事件数')
  assert.match(c, /const shownEvents = visibleEvents/, '统计源必须是视图里实际渲染的事件')
  assert.equal(/const upcoming = useMemo/.test(c), false, '别再按「今天之后」过滤')
})

test('iCloud 说明必须走 CalDAV 发现，不能让人去网页设置里找地址', () => {
  // Apple 没有公开的 iCloud 日历 CalDAV 设置页：网页端既无左下角齿轮，也看不到集合 URL。
  // 数字 ID + 日历 ID 只能由 PROPFIND 发现（或交给智能体跑）。
  const c = read('templates/client.js')
  const m = read('MANUAL.md')
  for (const doc of [c, m]) {
    assert.equal(/左下角齿轮/.test(doc), false, '不该再让人去网页版找齿轮')
    assert.equal(/网页版日历设置里复制|日历设置，找到.*CalDAV 地址/.test(doc), false, '网页版不提供 CalDAV 地址')
  }
  // 手册面向终端用户：协议名、源码路径、命令行都不该出现
  assert.equal(/PROPFIND|\.well-known|src\//.test(m), false, '手册里不要有协议/源码/命令行细节')
  assert.match(m, /自动发现日历/, '手册要以自动发现按钮为主流程')
  const web = read('src/web.ts')
  assert.match(web, /action === 'discoverIcloud'/, '后端要有发现动作')
  const client = read('templates/client.js')
  assert.match(client, /api\("discoverIcloud"/, '前端要调用发现动作')
  assert.match(client, /"conn\.discover":/, '发现按钮要有文案')
  assert.match(client, /"conn\.discoverStale":/, '旧服务端要有可操作的重启提示')
  // 发现区块必须藏在折叠步骤里，不是常驻在表单最下面
  const detailsPos = client.indexOf('h("details", { className: "dshc-steps" }')
  const discoverPos = client.indexOf('className: "dshc-discover"')
  assert.ok(detailsPos > 0 && discoverPos > detailsPos, '发现区块要在「怎么拿到这些值」的 details 内')
  // 步骤顺序：先填账号密码，最后才自动发现
  const steps = /"steps\.icloud": \[([^\]]*)\]/.exec(client)
  assert.ok(steps, 'iCloud 分步说明要在')
  assert.ok(steps[1].indexOf('账号填') < steps[1].indexOf('自动发现'), '顺序：1 生成密码 → 2 填凭据 → 3 自动发现')
  // 发现结果并入 caldavUrl 下拉，不再另起清单撑高表单
  assert.equal(/dshc-discover-list/.test(client), false, '日历清单不该再作为独立列表渲染')
  assert.match(client, /const asSelect = key === "caldavUrl"/, '发现后 URL 字段要变下拉')
  assert.match(client, /"conn\.discoverFound":/, '要有「已找到 N 本」的提示')
  assert.match(client, /"conn\.manualUrl":/, '要保留手动填写入口')
})

test('删除确认规则、经期提示与导入限制都要对得上代码', () => {
  // 三条守卫：① 删除确认只覆盖重复日程系列，批量删除必须先列清单确认；
  // ② 经期第 N 天用格内浮层（原生 title 挂 16×2px 细线上悬停不到）；
  // ③ 手册里的数字逐条对后端常量。
  const tools = read('src/tools.ts')
  assert.match(tools, /批量删除/, 'calendar_delete 说明必须写清批量删除要先列清单确认')

  const client = read('templates/client.js')
  assert.match(client, /className: "dshc-period-tip"/, '经期第 N 天要用格内即时浮层，别再靠原生 title')
  assert.match(client, /\.dshc-cell:hover \.dshc-period-tip/, '浮层要在 hover 时立刻显示')

  const manual = read('MANUAL.md')
  assert.equal(/安全约束|不要理解成|代码层面|硬拦截|当前设计/.test(manual), false,
    '手册不要写实现约束、免责声明这类给评审看的内容')

  // 手册里的限制不是估的，逐条对后端常量
  const ical = read('src/import-ical.ts')
  const web = read('src/import-web.ts')
  assert.match(ical, /ICS_LIMIT = 256 \* 1024/)
  assert.match(ical, /groups\.size > 100/)
  assert.match(ical, /events\.length > 1000/)
  assert.match(web, /body\.selected\.length > 20/)
  assert.match(web, /15 \* 60 \* 1000/)
  assert.match(web, /snapshot\.uids\.has\(row\.uid\)/, '已存在 UID 跳过')
})

test('手册面向用户：智能体放首章，不含开发者口吻', () => {
  const m = read('MANUAL.md')
  const firstChapter = m.indexOf('## 1.')
  assert.ok(firstChapter > 0)
  assert.match(m.slice(firstChapter, firstChapter + 120), /用智能体管理日程/, '第一章必须是智能体')
  assert.ok(m.indexOf('## 1. 用智能体') < m.indexOf('## 3. 连接日历'), '智能体讲完再讲连接')
  // 用户手册不该出现给开发者看的元话语
  for (const phrase of ['本手册按', '功能概览见', '数据层面', '持久化说明', '后端强制']) {
    assert.equal(m.includes(phrase), false, '不该出现：' + phrase)
  }
})

test('英文文档与中文版互相链接，且都进发布白名单', () => {
  const pkg = JSON.parse(read('package.json'))
  const pairs = [
    ['README.md', 'README.en.md'],
    ['MANUAL.md', 'MANUAL.en.md'],
    ['CHANGELOG.md', 'CHANGELOG.en.md'],
  ]
  for (const [zh, en] of pairs) {
    assert.ok(pkg.files.includes(zh), zh + ' 要在 files 白名单')
    assert.ok(pkg.files.includes(en), en + ' 要在 files 白名单')
    assert.ok(read(zh).includes(en), zh + ' 要有英文版链接')
    assert.ok(read(en).includes(zh), en + ' 要有中文版链接')
  }
  // 正文里三份文档互相引用
  for (const doc of ['README.md', 'MANUAL.md', 'CHANGELOG.md',
                     'README.en.md', 'MANUAL.en.md', 'CHANGELOG.en.md']) {
    const text = read(doc)
    const links = ['README', 'MANUAL', 'CHANGELOG'].filter((k) => text.includes(k + '.md') || text.includes(k + '.en.md'))
    assert.ok(links.length >= 2, doc + ' 要链接到另外的文档，当前：' + links.join(','))
  }
  // 英文手册的图片引用与中文版一致
  const zhManual = read('MANUAL.md'), enManual = read('MANUAL.en.md')
  const imgs = (t) => [...t.matchAll(/!\[[^\]]*\]\((assets\/screenshots\/[^)]+)\)/g)].map((m) => m[1])
  assert.deepEqual(imgs(enManual).sort(), imgs(zhManual).sort(), '英文手册要用同一批截图')
})

test('MIT 证书同时保留上游与本项目版权声明', () => {
  const license = read('LICENSE')
  assert.match(license, /^MIT License/m)
  assert.match(license, /Copyright \(c\) 2026 stardustlc/, '上游版权声明必须保留')
  assert.match(license, /Copyright \(c\) 2026 yan-evan/, '本项目衍生作品要有自己的署名')
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/, 'MIT 正文要完整')
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.license, 'MIT', 'license 字段与 LICENSE 一致')
  assert.equal(pkg.author, 'yan-evan', 'author 与证书署名一致')
})

test('切回日历不误显示未配置：configured 初始值也要认本地日历', () => {
  // 后端对本地日历仍回 configured:false（没有 CalDAV 凭据）。组件重挂载时若命中
  // CONN_CACHE 就不会重新 fetch，初始值漏判 backend=local 会固化成「还没配置账号」引导页。
  const c = read('templates/client.js')
  const init = /const \[configured, setConfigured\] = useState\(\(\) => \([\s\S]{0,320}?\)\);/.exec(c)
  assert.ok(init, 'configured 的 useState 初始化要存在')
  assert.match(init[0], /backend === "local"/, '初始值必须与 fetch 后的判定一致')
  assert.match(c, /setConfigured\(value \? \(value\.backend === "local"/, 'fetch 后的判定要保留本地日历分支')
})

test('主页顶部条：Star 外链 + 每日一次只读更新提醒', () => {
  const c = read('templates/client.js')
  const web = read('src/web.ts')
  const build = read('scripts/build-client.mjs')
  assert.match(build, /CALENDAR_VERSION/, '包版本要由构建注入')
  assert.match(web, /action === 'checkUpdate'/, '后端要有只读检测动作')
  assert.match(web, /AbortSignal\.timeout/, '外部请求要有超时')
  for (const k of ['STAR_URL', 'UPDATE_STORAGE_KEY', 'isNewerVersion', 'CalendarTopBar']) {
    assert.ok(c.includes(k), '前端缺少 ' + k)
  }
  assert.match(c, /compact === true \? null : h\(CalendarTopBar/, '浮层不能加顶部条')
  assert.match(c, /rel: "noreferrer"/, '外链要带 noreferrer')
  for (const k of ['top.subtitle', 'top.star', 'top.update', 'top.dismiss']) {
    assert.ok(c.includes('"' + k + '":'), '缺少文案 ' + k)
  }
  // 不注入插件详情页插槽（不做官方 slot 标签）
  assert.equal(/plugins\.detail\./.test(c), false, '不注入插件详情页插槽')
  // 只读：不得出现安装 / 更新包的代码
  assert.equal(/plugin\s+--profile|npm install|pnpm add/.test(c), false, '插件不得自行安装包')
  // Star 并进副标题，不单独占一行
  assert.match(c, /subtitle:h\('span',\{className:'dshc-page-subtitle'\}/, 'Star 要并入副标题')
  assert.equal(/h\(CalendarTopBar[^\n]*\),\s*h\("a"[^\n]*dshc-star/.test(c), false, '顶部条里不能再放 Star')
  assert.equal(/CALENDAR_MOCK_LATEST|DSHC_MOCK_UPDATE/.test(c + build), false, '不要演示假版本号的构建开关')
  // /plugins 是宿主静态资源路由而非页面路由，不能作为跳转目标
  assert.equal(/PLUGINS_PAGE_URL|href: ['"]\/plugins/.test(c), false, '不能留 /plugins 死链')
  assert.equal(/dshc-update-btn|copyGuide|updateGuide|top\.copied/.test(c), false, '横幅只做提示，不要跳转/复制/更新动作')
  // 横幅只有一行文案 + 关闭按钮；剪贴板在别处（复制 uid）合法使用，故仅在函数体内断言
  const barStart = c.indexOf('function CalendarTopBar(')
  assert.ok(barStart > 0, '要有 CalendarTopBar')
  const bar = c.slice(barStart, barStart + 1800)
  assert.equal(/navigator\.clipboard|clipboard|writeText/.test(bar), false, '横幅不要剪贴板动作')
  assert.equal(/href:/.test(bar), false, '横幅不要外链/跳转')
  assert.match(c, /\.dshc-star\{font-size:inherit/, 'Star 链接字号要跟随副标题')
  // 先填账号密码再自动发现 URL，字段顺序必须与流程一致
  assert.match(c, /icloud: \["username", "password", "caldavUrl", "proxyUrl"\]/, 'iCloud 字段顺序：账号/密码在前，URL 在后')
  // 其余服务商顺序原样保留
  assert.match(c, /google: \["calendarId", "clientId", "clientSecret", "refreshToken", "tokenUrl", "proxyUrl"\]/, 'google 字段顺序不应被改动')
  assert.match(c, /nextcloud: \["host", "user", "username", "calendar", "password", "proxyUrl"\]/, 'nextcloud 字段顺序不应被改动')
  assert.match(c, /custom: \["caldavUrl", "username", "password", "proxyUrl"\]/, 'custom 字段顺序不应被改动')
})

test('tsdav 必须懒加载：激活链不得静态依赖 CalDAV 包', async () => {
  // 宿主在运行中装/升级插件时，node_modules 重写瞬间模块图可能是半成品，
  // 静态 import 会让整个插件「启用失败」且被进程缓存。tsdav 只许动态 import。
  for (const file of ['src/caldav.ts', 'src/oauth.ts']) {
    const source = read(file)
    assert.equal(/^import \{[^}]*\} from 'tsdav'/m.test(source), false, file + ' 不得静态导入 tsdav 运行时（import type 可以）')
  }
  assert.match(read('src/tsdav-lazy.ts'), /import\('tsdav'\)/, '懒加载器要在')
  // 构建产物同样只允许动态引用
  const index = read('lib/index.js')
  assert.equal(/from 'tsdav'|require\('tsdav'\)/.test(index), false, 'lib/index.js 激活链不得静态引用 tsdav')
  // 实测：在子进程里用解析钩子把 tsdav 拦下（等价于依赖残缺），入口仍要能导入。
  // 独立进程，不碰磁盘、不影响并行的其他测试文件。
  const { spawnSync } = await import('node:child_process')
  const entry = new URL('../lib/index.js', import.meta.url).href
  const probe = "import { registerHooks } from 'node:module';" +
    "registerHooks({ resolve(specifier, context, nextResolve) {" +
    "  if (specifier === 'tsdav') return { url: 'node:blocked', shortCircuit: true };" +
    "  return nextResolve(specifier, context)" +
    "} });" +
    "import(" + JSON.stringify(entry) + ").then((m) => {" +
    "  process.exit(typeof m.apply === 'function' ? 0 : 1)" +
    "}).catch((e) => { console.error(e && e.message); process.exit(2) })"
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' })
  assert.equal(result.status, 0, 'tsdav 缺失时插件入口仍要能导入，实际：' + result.stderr.trim())
})
