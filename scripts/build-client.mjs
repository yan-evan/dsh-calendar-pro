import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const normalize = value => value.replace(/\r\n/g, '\n')
const kit = normalize(readFileSync(join(root, 'templates/workbench-ui.js'), 'utf8'))
let client = normalize(readFileSync(join(root, 'templates/client.js'), 'utf8'))
if (client.includes('__ENGINE__')) {
  const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
  if (!['dsh-hyperframes', 'dsh-remotion'].includes(name)) throw new Error('Unknown media engine package')
  client = client.replaceAll('__ENGINE__', name.slice(4))
}
const directory = join(root, 'templates/panels')
const parts = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => normalize(readFileSync(join(directory, name), 'utf8'))).join('\n') : ''
// 法定节假日 / 调休数据只维护 JSON，构建期注入；公告未发布的年份 JSON 里就是没有，不猜。
const holidayFile = join(root, 'templates/data/holidays.json')
const holidays = existsSync(holidayFile) ? JSON.parse(readFileSync(holidayFile, 'utf8')) : { schema: 1, years: {}, sources: [] }
if (!holidays.years || Object.keys(holidays.years).length === 0) throw new Error('templates/data/holidays.json is missing or has no years')
// 当前包版本随构建注入，前端据此判断 npm 上是否有更新；改 package.json 版本必须重跑 build。
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const injected = 'const CALENDAR_HOLIDAYS = ' + JSON.stringify(holidays) + ';\n' +
  'const CALENDAR_VERSION = ' + JSON.stringify(version) + ';\n' + parts
const marker = 'const W = createWorkbenchUI(React);'
if (!client.includes(marker)) throw new Error('Workbench source marker missing')
client = client.replace(marker, marker + '\n' + injected)
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/client.js'), '// Generated from templates/client.js, templates/panels/, templates/data/holidays.json and templates/workbench-ui.js. Edit the sources.\n(function () {\n' + kit + '\n' + client + '\n})();\n')
