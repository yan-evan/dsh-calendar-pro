/**
 * 真 DOM 行为测试：jsdom + 真 React 渲染周视图，然后派发 pointer / click / keydown。
 *
 * 为什么要有这一层：纯函数测试与源码正则都测不到下面这些 ——
 *   · 组件渲染时会不会直接抛（曾把 useEffect 依赖数组写在 const data 之前，TDZ 崩掉整个面板）；
 *   · 点事件块会不会冒泡到日列的「新建日程」；
 *   · 一次拖动到底发了几次请求、Esc 有没有取消；
 *   · 组件卸载后 window 上有没有留下监听器（残留的 pointerup 会替用户改期）；
 *   · 浮层面板里横向换天是否真的生效（列矩形必须用视口坐标）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EXPOSE = 'module.exports.__internals = { __components: { WeekView, MonthView, AgendaView, CalendarPanel, Launcher, ConnectionForm, AvailabilityPanel, CycleSettings, IcsImportPanel, SourceSettings, CalendarLoader }, __data: { useCalendarData, DATA_CACHE }, __layer: { registerLayerEscape } };';
if (!SOURCE.includes('return module.exports;')) throw new Error('client.js 装载契约变了，本测试的注入点要跟着改');
const PATCHED = SOURCE.replace('return module.exports;', EXPOSE + '\nreturn module.exports;');

/** 每个测试一套干净的 jsdom + 真 React；顺手给 window 的监听器记账。 */
async function setup(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const win = dom.window;
  const listenerLog = [];
  const origAdd = win.addEventListener.bind(win);
  const origRemove = win.removeEventListener.bind(win);
  win.addEventListener = (type, fn, opts) => { listenerLog.push(['add', type, fn && fn.name ? fn.name : '(anon)']); return origAdd(type, fn, opts); };
  win.removeEventListener = (type, fn, opts) => { listenerLog.push(['remove', type, fn && fn.name ? fn.name : '(anon)']); return origRemove(type, fn, opts); };
  const apiCalls = [];
  win.fetch = async (url, init) => {
    apiCalls.push({ url: String(url), body: init && init.body ? JSON.parse(String(init.body)) : null });
    if (options.connection !== undefined && apiCalls.at(-1).body?.action === 'connection') {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: options.connection }) };
    }
    if (options.notConfigured === true && apiCalls.at(-1).body?.action === 'connection') {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { configured: false } }) };
    }
    if (options.connectionError !== undefined && apiCalls.at(-1).body?.action === 'testConnection') {
      return { ok: true, status: 200, json: async () => ({ ok: false, error: { message: options.connectionError } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { count: 0, start: '', end: '', events: [] } }) };
  };
  // 插件里的 api() 走模块作用域的 fetch（Node 下就是 globalThis.fetch），每个用例都换成自己的 stub。
  globalThis.fetch = win.fetch;
  win.AbortSignal.timeout = () => undefined;
  globalThis.window = win;
  globalThis.document = win.document;
  // Node 24 的 globalThis.navigator 是只读 getter，得用 defineProperty 覆盖。
  try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }); } catch (error) { /* 覆盖不了也无妨：这些测试不碰 navigator */ }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const react = await import('react');
  const reactDomClient = await import('react-dom/client');
  const reactDom = await import('react-dom');
  let captured = null;
  win.__ModuleLoader__ = {
    load: (registration) => {
      captured = registration.factory((name) => {
        if (name === 'react') return react;
        if (name === 'react-dom/client') return reactDomClient;
        if (name === '@deepseek-ai/dsh-client-ui-primitives' && options.primitives === true) {
          return { Modal: makeFakeModal(react, reactDom) };
        }
        if (name === 'react/jsx-runtime') return {};
        throw new Error('unexpected require: ' + name);
      });
    },
  };
  new Function('window', 'document', 'navigator', PATCHED)(win, win.document, win.navigator);
  return { dom, win, react, reactDomClient, components: captured.__internals.__components, data: captured.__internals.__data, layer: captured.__internals.__layer, listenerLog, apiCalls };
}

/** 模拟宿主 PRIM.Modal：portal 到 body，自带的 Esc 监听在 document 冒泡阶段（与 0.1.6-alpha.2 一致）。 */
function makeFakeModal(react, reactDom) {
  function FakeModal(props) {
    if (props.open !== true) return null;
    react.useEffect(() => {
      const onKey = (event) => { if (event.key === 'Escape' && event.isComposing !== true) props.onClose(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [props.open, props.onClose]);
    return reactDom.createPortal(
      react.createElement('div', { className: 'fake-host-modal', role: 'dialog' }, [props.title, props.children, props.footer]),
      document.body
    );
  }
  return FakeModal;
}

/** 造一个 pointer 事件：jsdom 没有 PointerEvent，用 MouseEvent 补上我们的实现要读的字段。 */
function pointerEvent(win, type, options = {}) {
  const event = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: options.x || 0, clientY: options.y || 0 });
  Object.defineProperty(event, 'pointerId', { value: options.pointerId === undefined ? 1 : options.pointerId });
  Object.defineProperty(event, 'buttons', { value: options.buttons === undefined ? 1 : options.buttons });
  return event;
}

/** jsdom 没有布局：给日列与滚动容器塞上「视口坐标」，模拟浮层（left 很大）或设置页。 */
function stubGeometry(container, options = {}) {
  const left = options.left === undefined ? 0 : options.left;
  const width = options.width === undefined ? 100 : options.width;
  const columns = [...container.querySelectorAll('[data-day]')];
  columns.forEach((column, index) => {
    const rect = { left: left + index * width, right: left + (index + 1) * width, top: 0, bottom: 500, width, height: 500, x: left + index * width, y: 0 };
    column.getBoundingClientRect = () => rect;
  });
  const scroller = container.querySelector('.dshc-week');
  if (scroller !== null) {
    scroller.getBoundingClientRect = () => ({ left, right: left + 7 * width, top: 0, bottom: 500, width: 7 * width, height: 500, x: left, y: 0 });
  }
  return { columns, scroller, left, width };
}

/** 一个单次日程：2026-09-19（周六）10:00–11:00，本地墙钟。 */
function sampleEvent(overrides = {}) {
  const start = new Date('2026-09-19T10:00:00');
  const end = new Date('2026-09-19T11:00:00');
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return Object.assign({ uid: 'uid-1', summary: '评审会', start: iso(start), end: iso(end), allDay: false }, overrides);
}

async function render(react, reactDomClient, element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = reactDomClient.createRoot(container);
  await react.act(async () => { root.render(element); });
  return { container, root };
}

test('从 Google 切到 iCloud 时测试与保存都改用 Basic，不继承 OAuth', async () => {
  const { react, reactDomClient, components, win, apiCalls } = await setup();
  const { root } = await render(react, reactDomClient, react.createElement(components.ConnectionForm, {
    connection: { provider: 'google', authMethod: 'oauth', settingsAvailable: true, hasClientSecret: true, hasRefreshToken: true },
    onClose() {}, onSaved() {},
  }));
  try {
    const select = win.document.querySelector('select');
    await react.act(async () => { select.value = 'icloud'; select.dispatchEvent(new win.Event('change', { bubbles: true })); });
    for (const label of ['测试连接', '保存并启用']) {
      const button = [...win.document.querySelectorAll('button')].find(node => node.textContent === label);
      assert.ok(button, label);
      await react.act(async () => button.click());
      assert.equal(apiCalls.at(-1).body.authMethod, 'basic', `${label} 必须使用新服务商的认证方式`);
      assert.equal(apiCalls.at(-1).body.provider, 'icloud');
    }
  } finally { await react.act(async () => root.unmount()); }
});

test('连接草稿改动后旧的测试结论立即失效', async () => {
  const { react, reactDomClient, components, win } = await setup({ connectionError: '旧账号连接失败' });
  const { root } = await render(react, reactDomClient, react.createElement(components.ConnectionForm, {
    connection: { provider: 'custom', settingsAvailable: true }, onClose() {}, onSaved() {},
  }));
  try {
    const button = [...win.document.querySelectorAll('button')].find(node => node.textContent === '测试连接');
    await react.act(async () => button.click());
    assert.match(win.document.body.textContent, /旧账号连接失败/);
    const select = win.document.querySelector('select');
    await react.act(async () => { select.value = 'google'; select.dispatchEvent(new win.Event('change', { bubbles: true })); });
    assert.doesNotMatch(win.document.body.textContent, /旧账号连接失败/, '新草稿不能继续显示旧账号的失败结论');
  } finally { await react.act(async () => root.unmount()); }
});

test('周视图能渲染出来（曾经因为 useEffect 依赖数组 TDZ 而每次渲染即崩）', async () => {
  const { react, reactDomClient, components } = await setup();
  const { container } = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'), events: [sampleEvent()], onPick: () => {}, onCreateAt: () => {}, onReschedule: () => {},
  }));
  assert.equal(container.querySelectorAll('.dshc-slot').length, 1, '日程块要画出来');
  assert.equal(container.querySelectorAll('.dshc-daycol').length, 7, '七天都要有列');
});

test('单击事件块：只打开详情，不会顺手弹「新建日程」', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const calls = { pick: 0, create: 0 };
  const { container } = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'),
    events: [sampleEvent()],
    onPick: () => { calls.pick += 1; },
    onCreateAt: () => { calls.create += 1; },
    onReschedule: () => {},
  }));
  const slot = container.querySelector('.dshc-slot');
  await react.act(async () => { slot.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  assert.equal(calls.pick, 1, '点事件应该打开详情');
  assert.equal(calls.create, 0, '不能同时触发日列的「新建」（回归：曾经会把新建表单一起弹出来）');
});

test('拖动改期：只提交一次，落点按视口坐标换算（浮层偏移也算得对）', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const moves = [];
  const { container } = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'),
    events: [sampleEvent()],
    onPick: () => {},
    onCreateAt: () => {},
    onReschedule: (event, range, mode) => { moves.push({ range, mode }); },
  }));
  // 模拟浮层面板：整块网格从视口 x=600 开始
  const geometry = stubGeometry(container, { left: 600, width: 100 });
  const slot = container.querySelector('.dshc-slot');
  // 事件本身 60 分钟，渲染出来的高度就正好是「一小时」在当前窗口里的像素数，
  // 时间轴已经按窗口自适应，不能再写死 44px。
  const hourPx = parseFloat(slot.style.height);
  assert.equal(hourPx > 0, true, '事件块要渲染出高度');
  // 事件在周六（周一为第 0 列，周六 = 第 5 列）：从第 5 列中心拖到第 6 列中心 = 换天 +1
  const startX = geometry.left + 5 * geometry.width + geometry.width / 2;
  await react.act(async () => {
    slot.dispatchEvent(pointerEvent(win, 'pointerdown', { x: startX, y: 200 }));
    const endX = geometry.left + 6 * geometry.width + geometry.width / 2;
    win.dispatchEvent(pointerEvent(win, 'pointermove', { x: endX, y: 200 + hourPx }));   // 右移一列（换天）+ 下移一小时
    win.dispatchEvent(pointerEvent(win, 'pointerup', { x: endX, y: 200 + hourPx }));
  });
  assert.equal(moves.length, 1, '一次拖动只提交一次');
  const start = new Date(moves[0].range.start);
  const end = new Date(moves[0].range.end);
  assert.equal(start.getDate(), 20, '右移一列 = 换到次日');
  assert.equal(start.getHours(), 11, '下移一小时 = 时间加一小时（15 分钟吸附）');
  assert.equal((end - start) / 60000, 60, '时长不变');
});

test('拖动中按 Esc：放回原位，零请求；松手也不再提交', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const moves = [];
  const { container } = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'),
    events: [sampleEvent()],
    onPick: () => {},
    onCreateAt: () => {},
    onReschedule: (event, range) => { moves.push(range); },
  }));
  stubGeometry(container, { left: 0, width: 100 });
  const slot = container.querySelector('.dshc-slot');
  await react.act(async () => {
    slot.dispatchEvent(pointerEvent(win, 'pointerdown', { x: 550, y: 200 }));
    win.dispatchEvent(pointerEvent(win, 'pointermove', { x: 620, y: 300 }));
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    win.dispatchEvent(pointerEvent(win, 'pointerup', { x: 620, y: 300, buttons: 0 }));
  });
  assert.equal(moves.length, 0, 'Esc 取消之后不能落盘');
});

test('卸载后 window 上不留监听器，之后的 pointerup 也不会替用户改期', async () => {
  const { react, reactDomClient, components, win, listenerLog } = await setup();
  const moves = [];
  const { container, root } = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'),
    events: [sampleEvent()],
    onPick: () => {},
    onCreateAt: () => {},
    onReschedule: (event, range) => { moves.push(range); },
  }));
  stubGeometry(container, { left: 0, width: 100 });
  const slot = container.querySelector('.dshc-slot');
  await react.act(async () => {
    slot.dispatchEvent(pointerEvent(win, 'pointerdown', { x: 550, y: 200 }));
    win.dispatchEvent(pointerEvent(win, 'pointermove', { x: 620, y: 300 }));
  });
  await react.act(async () => { root.unmount(); });
  // 只看我们自己注册的那几个（React 19 也会往 window 上挂 click/focus/mouseover… 等委托监听器，别误伤）
  const mine = new Set(['onMove', 'onUp', 'onCancel', 'onKey', 'onBlur']);
  const tally = (op) => listenerLog.filter((e) => e[0] === op && mine.has(e[1])).map((e) => e[1]).sort();
  const addedList = listenerLog.filter((e) => e[0] === 'add').map((e) => e[1] + ':' + e[2]).sort();
  const removedList = listenerLog.filter((e) => e[0] === 'remove').map((e) => e[1] + ':' + e[2]).sort();
  const added = listenerLog.filter((e) => e[0] === 'add' && mine.has(e[2])).length;
  const removed = listenerLog.filter((e) => e[0] === 'remove' && mine.has(e[2])).length;
  const detail = 'add=[' + addedList.join(',') + '] remove=[' + removedList.join(',') + ']';
  assert.equal(added > 0, true, '应该注册过监听器（add=' + added + '）');
  assert.equal(removed >= added, true, '挂载时注册的监听器都要在卸载时摘掉（' + detail + '）');
  win.dispatchEvent(pointerEvent(win, 'pointerup', { x: 620, y: 300, buttons: 0 }));
  assert.equal(moves.length, 0, '卸载后的 pointerup 不能提交改期');
});

test('拖到容器下边缘：rAF 会持续滚动并重算落点', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const { container } = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'),
    events: [sampleEvent()],
    onPick: () => {},
    onCreateAt: () => {},
    onReschedule: () => {},
  }));
  const geometry = stubGeometry(container, { left: 0, width: 100 });
  const slot = container.querySelector('.dshc-slot');
  await react.act(async () => {
    slot.dispatchEvent(pointerEvent(win, 'pointerdown', { x: 550, y: 200 }));
    win.dispatchEvent(pointerEvent(win, 'pointermove', { x: 550, y: 495 }));   // 贴到 500 的下边缘
  });
  await new Promise((resolve) => setTimeout(resolve, 80));                     // 让 rAF 跑几帧
  assert.equal(geometry.scroller.scrollTop > 0, true, '指针停在边缘也要继续滚');
  await react.act(async () => { win.dispatchEvent(pointerEvent(win, 'pointerup', { x: 550, y: 495 })); });
});

test('重复日程：拖动被挡住（不做重锚系列起点的危险写入）', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const moves = [];
  const { container } = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'),
    events: [sampleEvent({ rrule: 'FREQ=WEEKLY;COUNT=4' })],
    onPick: () => {},
    onCreateAt: () => {},
    onReschedule: (event, range) => { moves.push(range); },
  }));
  stubGeometry(container, { left: 0, width: 100 });
  const slot = container.querySelector('.dshc-slot');
  await react.act(async () => {
    slot.dispatchEvent(pointerEvent(win, 'pointerdown', { x: 550, y: 200 }));
    win.dispatchEvent(pointerEvent(win, 'pointermove', { x: 550, y: 244 }));
    win.dispatchEvent(pointerEvent(win, 'pointerup', { x: 550, y: 244 }));
  });
  // WeekView 只负责把落点交给面板；「重复日程不给改」的判断在 CalendarPanel.reschedule 里，
  // 这里断言的是：拖动本身把 range 交上来了，具体拦截由面板那层做（见下面的源码级断言）。
  assert.equal(moves.length, 1);
  const inner = SOURCE.slice(SOURCE.indexOf('const reschedule ='), SOURCE.indexOf('const undoMove'));
  assert.match(inner, /if \(isRecurring\(event\)\) \{\s*notify\(t\("move\.recurringUnsupported"\)\);\s*return;\s*\}/, '面板层必须拦住重复日程');
});

test('Esc 分层关闭：先关新建表单，面板还在；再按一次才关面板', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const { container } = await render(react, reactDomClient, react.createElement(components.Launcher, {}));
  await react.act(async () => { container.querySelector('.dshc-fab').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  assert.notEqual(container.querySelector('.dshc-float'), null, '点浮标后日历面板要打开');
  const newButton = [...container.querySelectorAll('button')].find((b) => /新建日程|New event/.test(b.textContent || ''));
  assert.notEqual(newButton, undefined, '工具栏要有「新建日程」');
  await react.act(async () => { newButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  assert.notEqual(container.querySelector('.dshc-modalwrap'), null, '新建表单要打开（jsdom 无宿主 Modal，走自绘兜底）');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dshc-modalwrap'), null, 'Esc 第一下先关表单');
  assert.notEqual(container.querySelector('.dshc-float'), null, '不能顺手把日历面板关掉（回归：0.8.1 会一起关）');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dshc-float'), null, '没有浮层时 Esc 仍然关面板');
});

test('回归：遮罩级 token 不再被当淡色底（today 列 / 格子 hover 曾整块发黑）', () => {
  const mask3Lines = SOURCE.split('\n').filter((line) => line.includes('--dsw-alias-bg-mask-3'));
  assert.equal(mask3Lines.length, 2, 'mask-3 只该留给遮罩（overlay + modalwrap），现在 ' + mask3Lines.length + ' 处');
  assert.ok(mask3Lines.every((line) => /dshc-overlay|dshc-modalwrap/.test(line)), '除遮罩外不得再用 mask-3 当淡色底');
  // today 列用的是 background-color：不能覆盖掉小时线的 background-image。
  assert.match(SOURCE, /\.dshc-daycol\.today\{background(?:-color)?:color-mix\(/);
  assert.match(SOURCE, /\.dshc-cell:hover\{background:color-mix\(/);
});

test('Esc 分层关闭：详情抽屉也只关自己一层（不关面板、不抢宿主）', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const todayEvent = sampleEvent({ uid: 'uid-today', summary: '今天的事', start: iso(start), end: iso(end) });
  win.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    const value = body.action === 'connection'
      ? { configured: true, provider: 'custom', caldavUrl: 'https://example.test/dav', username: 'u' }
      : { count: 1, start: '', end: '', events: [todayEvent] };
    return { ok: true, status: 200, json: async () => ({ ok: true, value }) };
  };
  // 插件里的 api() 走的是模块作用域的 fetch（测试里即 globalThis.fetch），不是 jsdom 的 win.fetch。
  globalThis.fetch = win.fetch;
  const { container } = await render(react, reactDomClient, react.createElement(components.Launcher, {}));
  await react.act(async () => { container.querySelector('.dshc-fab').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  let chip = null;
  for (let i = 0; i < 40 && chip === null; i++) {
    await react.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    chip = container.querySelector('.dshc-chip');
  }
  assert.notEqual(chip, null, '月视图要渲染出事件芯片');
  await react.act(async () => { chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  assert.notEqual(container.querySelector('.dshc-overlay'), null, '点芯片要打开详情抽屉');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dshc-overlay'), null, 'Esc 先关详情抽屉');
  assert.notEqual(container.querySelector('.dshc-float'), null, '面板要留着');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dshc-float'), null, '没有浮层时 Esc 仍然关面板');
});

test('Esc 层栈：一次只关最上层 / 宿主 Portal 不抢 / IME 不关', async () => {
  const { win, layer } = await setup();
  const calls = [];
  const rootA = win.document.createElement('div');
  rootA.className = 'dshc-root';
  win.document.body.appendChild(rootA);
  const rootB = win.document.createElement('div');
  rootB.className = 'dshc-root';
  win.document.body.appendChild(rootB);
  const offA = layer.registerLayerEscape(rootA, () => calls.push('A'));
  const offB = layer.registerLayerEscape(rootB, () => calls.push('B'));
  const esc = () => new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

  win.document.body.dispatchEvent(esc());
  assert.deepEqual(calls, ['B'], 'body 上的 Esc 只关最近打开的层');

  const insideA = win.document.createElement('button');
  rootA.appendChild(insideA);
  insideA.dispatchEvent(esc());
  assert.deepEqual(calls, ['B', 'A'], '焦点在哪个面板就关哪个面板的层');

  const hostDialog = win.document.createElement('div');
  hostDialog.setAttribute('role', 'dialog');
  win.document.body.appendChild(hostDialog);
  hostDialog.dispatchEvent(esc());
  assert.deepEqual(calls, ['B', 'A'], '宿主浮层里的 Esc 不抢（它是 role=dialog）');
  hostDialog.remove();   // 宿主弹窗关掉后，Esc 才回到日历层

  const hostPlain = win.document.createElement('button');
  win.document.body.appendChild(hostPlain);
  hostPlain.dispatchEvent(esc());
  assert.deepEqual(calls, ['B', 'A', 'B'], '普通宿主元素上没有浮层：仍然兜底关日历的层');

  const ime = esc();
  Object.defineProperty(ime, 'isComposing', { value: true });
  win.document.body.dispatchEvent(ime);
  assert.deepEqual(calls, ['B', 'A', 'B'], '输入法组合中的 Esc 不关层');

  offA();
  offB();
});

test('宿主 PRIM.Modal 的 Esc 由宿主自己关，日历面板不被顺手关掉', async () => {
  const { react, reactDomClient, components, win } = await setup({ primitives: true });
  const { container } = await render(react, reactDomClient, react.createElement(components.Launcher, {}));
  await react.act(async () => { container.querySelector('.dshc-fab').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  const newButton = [...container.querySelectorAll('button')].find((b) => /新建日程|New event/.test(b.textContent || ''));
  assert.notEqual(newButton, undefined, '工具栏要有「新建日程」');
  await react.act(async () => { newButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  const hostModal = win.document.querySelector('.fake-host-modal');
  assert.notEqual(hostModal, null, '宿主 Modal 要 portal 到 body');
  // Esc 的 target 在宿主 Portal 里：日历层栈必须让行，宿主自己的监听来关。
  await react.act(async () => { hostModal.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(win.document.querySelector('.fake-host-modal'), null, '宿主 Modal 应该自己关掉');
  assert.notEqual(container.querySelector('.dshc-float'), null, '日历面板不能被一起关掉');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dshc-float'), null, '没有浮层时 Esc 仍然关面板');
});

const todayEventFor = (summary, uid) => {
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return sampleEvent({ uid, summary, start: iso(start), end: iso(end) });
};

/** 让 Launcher 面板里有一条今天的日程，并打开详情抽屉。 */
async function openDrawerWithTodayEvent(react, reactDomClient, components, win, event) {
  win.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    const value = body.action === 'connection'
      ? { configured: true, provider: 'custom', caldavUrl: 'https://example.test/dav', username: 'u' }
      : { count: 1, start: '', end: '', events: [event] };
    return { ok: true, status: 200, json: async () => ({ ok: true, value }) };
  };
  globalThis.fetch = win.fetch;
  const { container } = await render(react, reactDomClient, react.createElement(components.Launcher, {}));
  await react.act(async () => { container.querySelector('.dshc-fab').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  let chip = null;
  for (let i = 0; i < 40 && chip === null; i++) {
    await react.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    chip = container.querySelector('.dshc-chip');
  }
  assert.notEqual(chip, null, '月视图要渲染出事件芯片');
  await react.act(async () => { chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  assert.notEqual(container.querySelector('.dshc-overlay'), null, '点芯片要打开详情抽屉');
  return { container, chip };
}

test('F1：宿主高层 Modal 盖在日历抽屉上（焦点还在日历里），Esc 先关宿主、再关抽屉', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const { container } = await openDrawerWithTodayEvent(react, reactDomClient, components, win, todayEventFor('高位浮层', 'uid-f1'));
  // 模拟另一个宿主 Modal 盖上来：它有 role=dialog，且自己监听 document 冒泡的 Esc。
  const foreign = win.document.createElement('div');
  foreign.setAttribute('role', 'dialog');
  foreign.textContent = '宿主高层弹窗';
  win.document.body.appendChild(foreign);
  const closeForeign = (event) => { if (event.key === 'Escape') foreign.remove(); };
  win.document.addEventListener('keydown', closeForeign);
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(win.document.body.contains(foreign), false, 'Esc 要归上层宿主 Modal（它自己关）');
  assert.notEqual(container.querySelector('.dshc-overlay'), null, '日历抽屉不能被抢关');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dshc-overlay'), null, '宿主关掉后，Esc 回到日历层');
  assert.notEqual(container.querySelector('.dshc-float'), null, '面板要留着');
  win.document.removeEventListener('keydown', closeForeign);
});

test('F2：焦点在面板外的普通宿主元素上，Esc 仍然兜底关掉日历浮层', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const { container } = await openDrawerWithTodayEvent(react, reactDomClient, components, win, todayEventFor('普通宿主焦点', 'uid-f2'));
  const hostButton = win.document.createElement('button');
  hostButton.textContent = '宿主按钮';
  win.document.body.appendChild(hostButton);
  hostButton.focus();
  await react.act(async () => { hostButton.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dshc-overlay'), null, '普通宿主元素上的 Esc 也要关掉日历浮层');
  assert.notEqual(container.querySelector('.dshc-float'), null, '面板要留着');
});

test('F3：面板内两层同开，Esc 关最后打开的那层', async () => {
  // 浮层只保留查看与新建，连接入口在侧栏（「日历连接」），所以这里用侧栏面板造两层。
  const { react, reactDomClient, components, win } = await setup({ primitives: true });
  const { container } = await render(react, reactDomClient, react.createElement(components.CalendarPanel, {}));
  const buttonByText = (text) => [...container.querySelectorAll('button')].find((b) => (b.textContent || '').indexOf(text) !== -1);
  const newButton = buttonByText('新建日程');
  assert.notEqual(newButton, undefined, '工具栏要有「新建日程」');
  await react.act(async () => { newButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  const connButton = buttonByText('日历连接');
  assert.notEqual(connButton, undefined, '侧栏要有「日历连接」入口');
  await react.act(async () => { connButton.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  const modalTexts = () => [...win.document.querySelectorAll('.fake-host-modal')].map((m) => m.textContent || '');
  assert.equal(modalTexts().length, 2, '两层都要在');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(modalTexts().length, 1, '第一次 Esc 只关一层');
  assert.equal(/CalDAV 连接设置/.test(modalTexts()[0]), false, '先关的应该是后打开的连接设置');
  await react.act(async () => { win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(modalTexts().length, 0, '第二次 Esc 关掉剩下的新建表单');
});


test('availability candidates only populate a draft, and changing a filter clears stale choices', async () => {
  const { react, reactDomClient, components, win, apiCalls } = await setup();
  const chosen = [];
  globalThis.fetch = async (_url, init) => { apiCalls.push({body:JSON.parse(init.body)});return {ok:true,status:200,json:async()=>({ok:true,value:{count:1,busyEventCount:1,checkedAt:'2026-11-02T08:00:00Z',hasMore:false,slots:[{start:'2026-11-02T09:00:00Z',end:'2026-11-02T10:00:00Z'}]}})}; };
  const { root } = await render(react, reactDomClient, react.createElement(components.AvailabilityPanel,{anchor:new Date('2026-11-02T00:00:00Z'),onBusy(){},onClose(){},onChoose:s=>chosen.push(s)}));
  try {
    await react.act(async()=>win.document.querySelector('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true})));
    const choose=[...win.document.querySelectorAll('button')].find(b=>b.textContent==='用此时段新建');assert.ok(choose);
    await react.act(async()=>choose.click());assert.equal(chosen.length,1);assert.ok(apiCalls.every(c=>c.body.action==='availability'));
    const checkbox=win.document.querySelector('input[type=checkbox]');await react.act(async()=>checkbox.click());
    assert.equal([...win.document.querySelectorAll('button')].some(b=>b.textContent==='用此时段新建'),false);
  } finally { await react.act(async()=>root.unmount()); }
});

test('cancelled availability queries cannot restore late candidates even if a transport ignores abort', async () => {
  const { react, reactDomClient, components, win } = await setup();let resolveResponse;
  globalThis.fetch=()=>new Promise(resolve=>{resolveResponse=resolve});
  const { root }=await render(react,reactDomClient,react.createElement(components.AvailabilityPanel,{anchor:new Date('2026-11-02T00:00:00Z'),onBusy(){},onClose(){},onChoose(){throw Error('No candidate should be selectable')}}));
  try {
    await react.act(async()=>{win.document.querySelector('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve()});
    const cancel=[...win.document.querySelectorAll('button')].find(b=>b.textContent==='取消查询');assert.ok(cancel);await react.act(async()=>cancel.click());
    await react.act(async()=>{resolveResponse({ok:true,status:200,json:async()=>({ok:true,value:{count:1,busyEventCount:0,checkedAt:'2026-11-02T08:00:00Z',slots:[{start:'2026-11-02T09:00:00Z',end:'2026-11-02T10:00:00Z'}]}})});await new Promise(r=>setTimeout(r,0))});
    assert.equal([...win.document.querySelectorAll('button')].some(b=>b.textContent==='用此时段新建'),false);
  } finally { await react.act(async()=>root.unmount()); }
});

test('排版回归：月视图休/班角标不与农历重叠，周/议程农历与「今天」同字号', async () => {
  const { react, reactDomClient, components } = await setup();
  // 2026-10 有国庆放假与调休上班，能同时渲染出「休」「班」。
  const { container, root } = await render(react, reactDomClient, react.createElement(components.MonthView, {
    anchor: new Date(2026, 9, 1), events: [], onPick() {}, onCreateAt() {},
  }));
  try {
    const daynum = container.querySelector('.dshc-daynum');
    assert.notEqual(daynum, null, '日号行要存在');
    assert.notEqual(daynum.querySelector('.dshc-daylead'), null, '日号与角标要成一组靠左');
    const badge = container.querySelector('.dshc-hbadge');
    assert.notEqual(badge, null, '10 月要渲染出休/班角标');
    assert.equal(badge.classList.contains('dshc-inline'), true, '角标不能是绝对定位');
    // 第一个日号行未必是第一个带角标的格子，按角标自己所在的格子取日号行。
    const ownDaynum = badge.closest('.dshc-cell').querySelector('.dshc-daynum');
    assert.notEqual(ownDaynum, null);
    assert.equal(ownDaynum.contains(badge), true, '角标必须在日号行内，压不到右侧农历');
    assert.notEqual(daynum.querySelector('.dshc-lunar'), null, '中文界面要显示农历');
    // 字号：周表头文本 11px、议程 .dshc-sub 12px，农历跟着各容器走。
    assert.match(SOURCE, /\.dshc-dayhead \.dshc-lunar\{font-size:11px/);
    assert.match(SOURCE, /\.dshc-daylabel \.dshc-lunar\{font-size:12px/);
    assert.match(SOURCE, /\.calendar-workbench \.dshc-daylabel \.dshc-lunar\{font-size:12px/);
    assert.equal(/\.calendar-workbench \.dshc-cell \.dshc-hbadge\{top:/.test(SOURCE), false, '工作台里不能再有角标绝对定位覆盖');
  } finally { await react.act(async () => root.unmount()); }
});

test('从别的会话点回日历：先显示上次的内容，不重新拉一遍，也不再闪骨架', async () => {
  const { react, reactDomClient, components, win, apiCalls } = await setup();
  // 今天 10:00 的日程：必须落在当前月，才会在月视图里渲染出芯片。
  const base = new Date();
  base.setHours(10, 0, 0, 0);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const event = sampleEvent({ uid: 'uid-today', summary: '今天的评审', start: iso(base), end: iso(new Date(base.getTime() + 3600000)) });
  win.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    apiCalls.push({ url: String(url), body });
    const value = body.action === 'connection'
      ? { configured: true, provider: 'custom', caldavUrl: 'https://example.test/dav', username: 'u' }
      : { count: 1, start: '', end: '', events: [event] };
    return { ok: true, status: 200, json: async () => ({ ok: true, value }) };
  };
  globalThis.fetch = win.fetch;
  const flush = async () => { await react.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };

  const first = await render(react, reactDomClient, react.createElement(components.CalendarPanel, {}));
  await flush();
  assert.notEqual(first.container.querySelector('.dshc-chip'), null, '首次进入要加载出日程');
  const callsAfterFirst = apiCalls.length;
  assert.equal(callsAfterFirst >= 2, true, '首次进入要拉连接信息与日程（实际 ' + callsAfterFirst + ' 次）');
  await react.act(async () => { first.root.unmount(); });

  // 重新挂载 = 从别的会话点回来：组件全新，只有模块级缓存还在。
  const second = await render(react, reactDomClient, react.createElement(components.CalendarPanel, {}));
  try {
    assert.notEqual(second.container.querySelector('.dshc-chip'), null, '重进页面第一帧就要是完整内容（要来自缓存）');
    assert.equal(second.container.querySelector('.dshc-skel'), null, '重进页面不该再出骨架屏');
    await flush();
    assert.equal(apiCalls.length, callsAfterFirst, '连同连接信息在内都不该再发请求（缓存命中）');
  } finally { await react.act(async () => { second.root.unmount(); }); }
});

test('经期预测：日、周两种网格视图在预计经期的日期下画粉红线，议程不画，清除后一条不留', async () => {
  const { react, reactDomClient, components } = await setup();
  // 上次经期 2026-09-17 开始，28 天一轮、每轮 5 天：17–21 是经期，19 日是第 3 天。
  // 没有「启用」开关：只要日期在，就默认画线。
  const cycle = { lastStart: '2026-09-17', cycleLength: 28, periodLength: 5 };
  const month = await render(react, reactDomClient, react.createElement(components.MonthView, {
    anchor: new Date(2026, 8, 1), events: [], onPick() {}, onCreateAt() {}, cycle,
  }));
  const week = await render(react, reactDomClient, react.createElement(components.WeekView, {
    anchor: new Date('2026-09-19T00:00:00'), events: [], onPick() {}, onCreateAt() {}, onReschedule() {}, cycle,
  }));
  const agenda = await render(react, reactDomClient, react.createElement(components.AgendaView, {
    events: [sampleEvent()], onPick() {}, onCreateAt() {},
  }));
  try {
    const monthMarks = [...month.container.querySelectorAll('.dshc-period-mark')];
    assert.equal(monthMarks.length, 5, '月视图要把 17–21 这 5 天都标出来');
    // 提示已从 2px 细线的原生 title 移到格内即时浮层（原生 title 有延迟且命中区太小）。
    const tips = [...month.container.querySelectorAll('.dshc-period-tip')];
    assert.deepEqual(tips.map(node => node.textContent),
      ['预计经期第 1 天', '预计经期第 2 天', '预计经期第 3 天', '预计经期第 4 天', '预计经期第 5 天']);
    // 横线必须在日号那一组里：绝对定位的元素跑到日号行外会压住农历。
    assert.notEqual(monthMarks[0].closest('.dshc-daylead'), null, '月视图的线要挂在日号行内');
    assert.equal(week.container.querySelectorAll('.dshc-period-mark').length, 4, '本周覆盖 17–20 四天');
    assert.notEqual(week.container.querySelector('.dshc-dayhead .dshc-period-mark'), null, '周视图的线要在表头里');
    // 议程视图不画经期横线（横线仅出现在月 / 周的日期网格）。
    assert.equal(agenda.container.querySelectorAll('.dshc-period-mark').length, 0, '议程视图不画线');
  } finally {
    for (const node of [month, week, agenda]) await react.act(async () => { node.root.unmount(); });
  }

  // 清除记录 = 没有日期：一条都不该出现（不能因为 localStorage 里留着旧值就继续画）。
  const cleared = await render(react, reactDomClient, react.createElement(components.MonthView, {
    anchor: new Date(2026, 8, 1), events: [], onPick() {}, onCreateAt() {},
    cycle: Object.assign({}, cycle, { lastStart: '' }),
  }));
  try {
    assert.equal(cleared.container.querySelectorAll('.dshc-period-mark').length, 0, '清除记录后不画');
  } finally {
    await react.act(async () => { cleared.root.unmount(); });
  }
});

test('经期设置：默认 28 / 5 保存后还是 28 / 5（不是被夹成 15 / 1），保存/清除各锁 2 秒', async () => {
  const { react, reactDomClient, components, win } = await setup();
  win.localStorage.clear();
  const { container, root } = await render(react, reactDomClient, react.createElement(components.CycleSettings, {}));
  const text = () => [...container.querySelectorAll('button')].map(node => node.textContent).join('|');
  const btn = (label) => [...container.querySelectorAll('button')].find(node => node.textContent === label);
  const wait = async (ms) => { await react.act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); };
  const nums = () => [...container.querySelectorAll('input[type=number]')].map(node => node.value);
  const date = () => container.querySelector('input[type=date]');
  // React 受控输入：必须走原型上的 value setter，再派发 input，否则 state 收不到。
  const type = async (node, value) => {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    await react.act(async () => { setter.call(node, value); node.dispatchEvent(new win.Event('input', { bubbles: true })); });
  };
  try {
    // 只有「保存 / 清除记录」两个动作，不再有「在日历上标出预计经期」的复选框。
    assert.equal(container.querySelectorAll('input[type=checkbox]').length, 0, '不该再有启用开关');
    assert.equal(text(), '保存|清除记录');
    const intro = container.querySelector('.dshc-sub').textContent;
    assert.match(intro, /粉红短线/);
    assert.match(intro, /本机/);
    // 默认值是**真实的值**，不是灰字占位（占位会被当成已填好，保存时反而变成下限 15 / 1）。
    assert.deepEqual(nums(), ['28', '5'], '没记录时输入框里就该是 28 与 5');
    assert.equal([...container.querySelectorAll('input[type=number]')].every(node => node.placeholder === ''), true, '不要用 placeholder 假装默认值');

    // 回归：什么都不改，直接填日期保存 → 存下来必须还是 28 / 5。
    await type(date(), '2026-11-01');
    await react.act(async () => { btn('保存').click(); });
    assert.deepEqual(nums(), ['28', '5'], '保存后不能被夹成 15 / 1');
    const saved = JSON.parse(win.localStorage.getItem('dsh-calendar-pro:cycle'));
    assert.equal(saved.cycleLength, 28);
    assert.equal(saved.periodLength, 5);
    assert.equal(btn('已保存').disabled, true, '保存后这 2 秒内不能再点');
    await wait(2100);
    assert.equal(btn('保存').textContent, '保存', '2 秒后按钮自己变回来');

    // 清空数字再保存（空值必须回落到默认，而不是被当成 0 夹到下限）。
    await type(container.querySelectorAll('input[type=number]')[0], '');
    await type(container.querySelectorAll('input[type=number]')[1], '');
    await react.act(async () => { btn('保存').click(); });
    assert.deepEqual(nums(), ['28', '5'], '空输入要回落到默认 28 / 5');
    await wait(2100);

    // 清除：记录删掉、三个输入框全空、按钮变「已清除」并锁 2 秒。
    await react.act(async () => { btn('清除记录').click(); });
    assert.equal(btn('已清除').textContent, '已清除');
    assert.equal(btn('已清除').disabled, true, '清除后这 2 秒内不能再点');
    assert.equal(win.localStorage.getItem('dsh-calendar-pro:cycle'), null, '记录要从本机删掉');
    assert.equal(date().value, '', '开始日期要清空');
    assert.deepEqual(nums(), ['', ''], '周期与持续天数也要清空');
    assert.equal(btn('保存').disabled, false, '同一时刻只锁被点的那一个按钮');
    await wait(2100);
    assert.equal(text(), '保存|清除记录');
  } finally { await react.act(async () => root.unmount()); }
});

test('导入面板的文件选择是中文按钮：原生 input 真藏起来了，未选文件时给中文提示', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const { container, root } = await render(react, reactDomClient, react.createElement(components.IcsImportPanel, {
    embedded: true, onBusy() {}, onClose() {}, onConnection() {}, onImported() {},
  }));
  try {
    const pick = [...container.querySelectorAll('button')].find(node => node.textContent === '选择 ICS 文件');
    assert.ok(pick, '要有中文的「选择 ICS 文件」按钮（原生按钮跟随浏览器语言，英文环境下是英文）');
    const native = container.querySelector('input[type=file]');
    assert.ok(native, '原生 file input 仍然在，用它触发系统选择框');
    // 回归：只写 class 藏不住 —— `.dshc-import input[type=file]` 带元素选择器，权重高于 `.dshc-file-native`，
    // 用户当时看到的仍是英文的 Choose File。现在用行内 display:none，并把那条规则排除掉。
    assert.equal(native.style.display, 'none', '原生控件必须行内隐藏，别指望 class 覆盖');
    assert.match(SOURCE, /\.dshc-import input\[type=file\]:not\(\.dshc-file-native\)/, '通用 file 样式要排除我们的隐藏控件');
    assert.equal(container.textContent.includes('No file selected'), false);
    assert.equal(container.querySelector('.dshc-file-name').textContent, '未选择文件');
    // 点按钮 = 打开系统文件框：jsdom 里断言 click 被转发出去了。
    let clicked = 0;
    native.click = () => { clicked += 1; };
    await react.act(async () => { pick.click(); });
    assert.equal(clicked, 1, '自定义按钮要把 click 转给原生 input');
    assert.equal(win.document.querySelectorAll('button[type=submit]').length, 0, '文件按钮不能顺手提交表单');
  } finally { await react.act(async () => root.unmount()); }
});

test('首启：没选过数据源时只显示两选一，不渲染日历网格，也没有示例入口', async () => {
  const { react, reactDomClient, components, win, apiCalls } = await setup({
    connection: { backend: null, configured: false, settingsAvailable: true, revision: 0 },
  });
  const flush = async () => { await react.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
  const { container, root } = await render(react, reactDomClient, react.createElement(components.CalendarPanel, {}));
  try {
    await flush();
    const picker = container.querySelector('.dshc-start');
    assert.ok(picker, '未选数据源时必须显示首启页');
    const cards = [...picker.querySelectorAll('.dshc-start-card')];
    assert.equal(cards.length, 2, '只有两个选项：本地 / 远程');
    assert.match(picker.textContent, /使用本地日历/);
    assert.match(picker.textContent, /连接远程日历/);
    assert.equal(container.querySelector('.dshc-grid'), null, '首启页不该渲染日历网格');
    assert.equal(container.textContent.includes('查看示例'), false, '示例模式已删除');

    // 点「使用本地日历」：把选择写进设置（backend=local），不是在本地偷偷记一个标记。
    await react.act(async () => { cards[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
    await flush();
    const call = apiCalls.find(item => item.body && item.body.action === 'setBackend');
    assert.ok(call, '要调用 setBackend');
    assert.equal(call.body.backend, 'local');
  } finally { await react.act(async () => root.unmount()); }
});

test('设置页来源段：一个按钮直接切换，文案写明切到哪；远程未连接时禁用', async () => {
  const flush = async (react) => { await react.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };

  // 场景一：当前本地、远程未连接 —— 按钮写明目标，但禁用并给出指引。
  const local = await setup({ connection: { backend: 'local', configured: false, settingsAvailable: true, revision: 2 } });
  const first = await render(local.react, local.reactDomClient, local.react.createElement(local.components.SourceSettings, {}));
  try {
    await flush(local.react);
    assert.match(first.container.textContent, /当前使用：本地日历/);
    const button = [...first.container.querySelectorAll('button')].find(node => /切换到/.test(node.textContent));
    assert.ok(button, '要有一个明确的切换按钮');
    assert.equal(button.textContent, '切换到CalDAV', '按钮自己说明切到哪');
    assert.equal(button.disabled, true, '没连远程就不能切过去');
    assert.match(first.container.textContent, /远程日历还没连接/);
    assert.equal(/检查要迁移的内容|开始迁移/.test(first.container.textContent), false, '不该再有两步式预检');
  } finally { await local.react.act(async () => first.root.unmount()); }

  // 场景二：远程已连接 —— 一键切换，只发一个请求（服务端内部做预检 + 复制 + 切源）。
  const remote = await setup({ connection: { backend: 'local', configured: true, provider: 'icloud', settingsAvailable: true, revision: 3 } });
  const second = await render(remote.react, remote.reactDomClient, remote.react.createElement(remote.components.SourceSettings, {}));
  try {
    await flush(remote.react);
    const button = [...second.container.querySelectorAll('button')].find(node => /切换到/.test(node.textContent));
    assert.equal(button.textContent, '切换到iCloud');
    assert.equal(button.disabled, false);
    await remote.react.act(async () => { button.dispatchEvent(new remote.win.MouseEvent('click', { bubbles: true })); });
    await flush(remote.react);
    const call = remote.apiCalls.find(item => item.body && item.body.action === 'switchBackend');
    assert.ok(call, '要调用 switchBackend');
    assert.equal(remote.apiCalls.some(item => item.body && item.body.action === 'migratePlan'), false, '前端不再先发预检');
  } finally { await remote.react.act(async () => second.root.unmount()); }
});

test('ICS 面板同时是导出入口：按钮触发 exportIcs 并给出条数', async () => {
  const { react, reactDomClient, components, win } = await setup({ connection: { backend: 'local', configured: false, settingsAvailable: true, revision: 1 } });
  // jsdom 没有 createObjectURL：补上桩，便于验证下载路径。
  win.URL.createObjectURL = () => 'blob:stub';
  win.URL.revokeObjectURL = () => { };
  const calls = [];
  const fetchStub = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    calls.push(body);
    if (body.action === 'exportIcs') {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { filename: 'dsh-calendar-20261105.ics', count: 3, data: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { zones: [] } }) };
  };
  win.fetch = fetchStub;
  globalThis.fetch = fetchStub;
  const busyEvents = [];
  const { container, root } = await render(react, reactDomClient, react.createElement(components.IcsImportPanel, {
    embedded: true, onBusy(value) { busyEvents.push(value); }, onClose() {}, onConnection() {}, onImported() {},
  }));
  try {
    assert.match(container.textContent, /ICS 文件/, '标题改成导入 + 导出的容器');
    assert.match(container.textContent, /当前日历（本地日历）/, '导出说明写清导出的是哪一份数据');
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === '导出 ICS 文件');
    assert.ok(button, '要有导出按钮');
    await react.act(async () => { button.click(); });
    await react.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(calls.some(body => body.action === 'exportIcs'), true, '要调用 exportIcs');
    assert.match(container.textContent, /已导出 3 条日程/);
    // 导出是独立动作：不能把导入那套 busy 打开（否则导入按钮一起变灰、文案变成「正在处理…」）。
    assert.equal(busyEvents.some(value => value === true), false, '导出不该让面板进入导入忙碌态');
    const pickButton = [...container.querySelectorAll('button')].find(node => node.textContent === '选择 ICS 文件');
    assert.equal(pickButton.disabled, false, '导出过程中导入按钮不该被禁用');
  } finally { await react.act(async () => root.unmount()); }
});

test('预览结果没有可导入日程时，可以点「取消导入」退出并清空内容', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const preview = { id: 'p1', rows: [], ignored: 0, connectionReady: true, scope: '' };
  const fetchStub = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    if (body.action === 'zones') return { ok: true, status: 200, json: async () => ({ ok: true, value: { zones: [] } }) };
    if (body.action === 'preview') return { ok: true, status: 200, json: async () => ({ ok: true, value: preview }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) };
  };
  win.fetch = fetchStub;
  globalThis.fetch = fetchStub;
  const { container, root } = await render(react, reactDomClient, react.createElement(components.IcsImportPanel, {
    embedded: true, onBusy() {}, onClose() {}, onConnection() {}, onImported() {},
  }));
  try {
    const textarea = container.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
    await react.act(async () => {
      setter.call(textarea, 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
      textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    const previewButton = [...container.querySelectorAll('button')].find(node => node.textContent === '预览与检查');
    assert.ok(previewButton);
    await react.act(async () => { previewButton.click(); });
    await react.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.notEqual(container.querySelector('.dshc-import-rows'), null, '预览结果要显示出来');
    assert.match(container.textContent, /没有可导入的日程/);

    const cancel = [...container.querySelectorAll('button')].find(node => node.textContent === '取消导入');
    assert.ok(cancel, '没有可导入日程时也要有退出入口');
    await react.act(async () => { cancel.click(); });
    assert.equal(container.querySelector('.dshc-import-rows'), null, '取消后结果列表要消失');
    assert.equal(container.querySelector('textarea').value, '', '取消后粘贴内容一并清空');
    assert.equal(container.querySelector('.dshc-file-name').textContent, '未选择文件');
  } finally { await react.act(async () => root.unmount()); }
});

test('切视图：新窗口没有缓存时不显示上一个窗口的日程，只显示加载动画', async () => {
  const { react, reactDomClient, data, win } = await setup();
  const rangeA = { start: '2031-01-01T00:00:00Z', end: '2031-02-01T00:00:00Z' };
  const rangeB = { start: '2031-03-01T00:00:00Z', end: '2031-04-01T00:00:00Z' };
  let resolveB;
  const fetchStub = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    if (body.action === 'list' && body.start === rangeA.start) {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { count: 1, start: '', end: '', events: [{ uid: 'a', summary: '窗口A的日程', start: '2031-01-10T02:00:00Z', end: '2031-01-10T03:00:00Z', allDay: false }] } }) };
    }
    if (body.action === 'list' && body.start === rangeB.start) {
      return new Promise((resolve) => { resolveB = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true, value: { count: 1, start: '', end: '', events: [{ uid: 'b', summary: '窗口B的日程', start: '2031-03-10T02:00:00Z', end: '2031-03-10T03:00:00Z', allDay: false }] } }) }); });
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { count: 0, start: '', end: '', events: [] } }) };
  };
  win.fetch = fetchStub;
  globalThis.fetch = fetchStub;
  const flush = async () => { await react.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
  function Harness({ range }) {
    const state = data.useCalendarData(range, 0);
    return react.createElement('div', { 'data-loading': state.loading ? '1' : '0', 'data-refreshing': state.refreshing ? '1' : '0' },
      state.events === null ? 'LOADING' : state.events.map(event => event.summary).join(','));
  }
  const { container, root } = await render(react, reactDomClient, react.createElement(Harness, { range: rangeA }));
  try {
    await flush();
    assert.match(container.textContent, /窗口A的日程/);
    // 切到完全没有缓存的窗口 B：请求还没回来，绝不能把 A 的内容画出来冒充。
    await react.act(async () => { root.render(react.createElement(Harness, { range: rangeB })); });
    assert.equal(container.textContent.includes('窗口A的日程'), false, '切视图时不该闪出上一个窗口的日程');
    assert.equal(container.querySelector('[data-loading]').getAttribute('data-loading'), '1');
    await react.act(async () => { resolveB(); });
    await flush();
    assert.match(container.textContent, /窗口B的日程/);
  } finally { await react.act(async () => root.unmount()); }
});

test('切回看过的窗口：首帧就是那个窗口的缓存，不闪也不发请求', async () => {
  const { react, reactDomClient, data, win } = await setup();
  const rangeC = { start: '2032-05-01T00:00:00Z', end: '2032-06-01T00:00:00Z' };
  const rangeD = { start: '2032-07-01T00:00:00Z', end: '2032-08-01T00:00:00Z' };
  let calls = 0;
  const event = (uid, summary, start) => ({ uid, summary, start, end: start, allDay: false });
  const fetchStub = async (url, init) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : {};
    if (body.action === 'list') {
      calls += 1;
      const summary = body.start === rangeC.start ? 'C日程' : 'D日程';
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { count: 1, start: '', end: '', events: [event('x', summary, '2032-05-10T02:00:00Z')] } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { count: 0, start: '', end: '', events: [] } }) };
  };
  win.fetch = fetchStub;
  globalThis.fetch = fetchStub;
  const flush = async () => { await react.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
  function Harness({ range }) {
    const state = data.useCalendarData(range, 0);
    return react.createElement('div', null, state.events === null ? 'LOADING' : state.events.map(item => item.summary).join(','));
  }
  const { container, root } = await render(react, reactDomClient, react.createElement(Harness, { range: rangeC }));
  try {
    await flush();
    await react.act(async () => { root.render(react.createElement(Harness, { range: rangeD })); });
    await flush();
    assert.match(container.textContent, /D日程/);
    const before = calls;
    await react.act(async () => { root.render(react.createElement(Harness, { range: rangeC })); });
    assert.match(container.textContent, /C日程/, '切回来第一帧就得是 C 的缓存');
    await flush();
    assert.equal(calls, before, '缓存新鲜就不该再发请求');
  } finally { await react.act(async () => root.unmount()); }
});

test('加载动画：三点环绕 + 文案，不再出现网格骨架', async () => {
  const { react, reactDomClient, components } = await setup();
  const { container, root } = await render(react, reactDomClient, react.createElement(components.CalendarLoader, {}));
  try {
    assert.ok(container.querySelector('.dshc-loading'));
    assert.equal(container.querySelectorAll('.dshc-loading-orbit i').length, 3);
    assert.match(container.textContent, /正在读取日历/);
    assert.equal(container.querySelector('.dshc-skel'), null, '网格骨架已移除');
  } finally { await react.act(async () => root.unmount()); }
});

test('空闲时段面板与日历视图互斥：打开面板时不渲染月/周/议程，候选自己滚动', async () => {
  const { react, reactDomClient, components, win } = await setup({});
  const flush = async () => { await react.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
  const { container, root } = await render(react, reactDomClient, react.createElement(components.CalendarPanel, {}));
  try {
    await flush();
    assert.ok(container.querySelector('.dshc-grid'), '默认是月视图');
    const button = [...container.querySelectorAll('button')].find(node => /找空闲时段/.test(node.textContent));
    assert.ok(button, '工具条上要有「找空闲时段」按钮');
    assert.equal(button.disabled, false, '已配置日历时按钮可点');
    await react.act(async () => { button.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
    await flush();
    assert.ok(container.querySelector('.calendar-availability'), '空闲面板要出现');
    // 两者平级时视图的 flex:1 会把面板挤扁、候选被压到只剩两行 —— 所以打开面板就不渲染视图。
    assert.equal(container.querySelector('.dshc-grid'), null, '打开空闲面板时不该还渲染月视图');
    assert.equal(container.querySelector('.dshc-week'), null, '不该渲染周视图');
    assert.equal(container.querySelector('.dshc-agenda'), null, '不该渲染议程视图');
  } finally { await react.act(async () => root.unmount()); }
});

test('主页顶部条：侧栏有 Star 外链，浮层不渲染', async () => {
  const { react, reactDomClient, components } = await setup();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { latest: '0.1.0' } }) });
  try {
    const side = await render(react, reactDomClient, react.createElement(components.CalendarPanel, {}));
    try {
      const star = side.container.querySelector('a.dshc-star');
      assert.ok(star, '侧栏主页要有 Star 外链');
      assert.equal(star.getAttribute('href'), 'https://github.com/yan-evan/dsh-calendar-pro');
      assert.ok((star.getAttribute('rel') || '').includes('noreferrer'), '外链要带 noreferrer');
      assert.equal(side.container.querySelector('.dshc-update'), null, '同版本不该显示更新横幅');
      assert.equal(side.container.querySelector('.dshc-topline'), null, '平时顶部条完全不占行');
    } finally { await react.act(async () => { side.root.unmount(); }); }

    const float = await render(react, reactDomClient, react.createElement(components.CalendarPanel, { compact: true }));
    try {
      assert.equal(float.container.querySelector('.dshc-topline'), null, '浮层不渲染顶部条');
    } finally { await react.act(async () => { float.root.unmount(); }); }
  } finally { globalThis.fetch = originalFetch; }
});

test('更新横幅：只显示文案，无跳转/复制/更新动作', async () => {
  const { react, reactDomClient, components, win } = await setup();
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const key = 'dsh-calendar-pro:update-check';
  win.localStorage.setItem(key, JSON.stringify({ date: today, latest: '9.9.9', dismissed: false }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: {} }) });
  try {
    const { container, root } = await render(react, reactDomClient, react.createElement(components.CalendarPanel, {}));
    try {
      const banner = container.querySelector('.dshc-update');
      assert.ok(banner, '当天假缓存应触发更新横幅');
      assert.ok(/9\.9\.9/.test(banner.textContent), '要显示新版本号');
      // 当前版本号由构建注入，跟 package.json 对齐即可
      const currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
      assert.ok(banner.textContent.includes(currentVersion), '要显示当前版本号 ' + currentVersion);
      assert.equal(banner.querySelector('a[href="/plugins"]'), null, '不能留无效跳转');
      assert.equal(banner.querySelector('.dshc-update-btn'), null, '不能有复制/更新按钮');
      assert.equal(banner.querySelectorAll('button').length, 1, '只保留一个关闭按钮');
    } finally { await react.act(async () => { root.unmount(); }); }
  } finally {
    globalThis.fetch = originalFetch;
    win.localStorage.removeItem(key);
  }
});
