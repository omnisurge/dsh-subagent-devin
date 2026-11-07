/**
 * 设置页的最小渲染冒烟测试。
 *
 * 没有浏览器也没有 React 依赖，所以这里用一套极小的 hooks 运行时把组件渲成
 * 一棵普通对象树，只断言「渲染不抛异常」和「关键文案出现」。
 * 它不能替代真实客户端验收（G4/G5），但能挡住最常见的「语法过、一渲染就崩」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/** 极简 hooks 运行时：状态按调用顺序存在数组里，重渲染复用同一份。 */
function createRuntime() {
  let states = [];
  let cursor = 0;
  let effects = [];
  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const index = cursor;
      cursor += 1;
      if (!(index in states)) states[index] = initial;
      const set = (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      };
      return [states[index], set];
    },
    useEffect: (fn) => { effects.push(fn); },
    useCallback: (fn) => fn,
  };
  return {
    React,
    beginRender() { cursor = 0; effects = []; },
    runEffects() { const pending = effects; effects = []; for (const fn of pending) fn(); },
  };
}

/** 把渲染树拍平成文本，便于断言。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  // 输入框的文案在 props 里（placeholder/value），也要算进可见文本。
  const own = [node.props?.placeholder, node.props?.value]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(' ');
  return `${own} ${textOf(node.children ?? [])}`;
}

/** 载入页面组件：走真实的 __ModuleLoader__ 入口，不绕过注册契约。 */
async function loadPage(ctx) {
  const source = await readFile(SOURCE, 'utf8');
  let definition;
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { definition = value; } } },
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.ok(definition, '客户端文件必须通过 __ModuleLoader__.load 注册');
  assert.equal(definition.id, '@omnisurge/dsh-subagent-devin');

  const runtime = createRuntime();
  const plugin = definition.factory((id) => {
    assert.equal(id, 'react', `不该 require 其它模块：${id}`);
    return runtime.React;
  });

  let Page;
  const slotCtx = {
    locale: undefined,
    effect: (fn) => { fn(); },
    slots: {
      inject: (key, fn) => { assert.equal(key, 'settings.section'); fn(); },
      register: (meta, component) => {
        assert.equal(meta.id, 'devin-subagent');
        assert.equal(meta.order, 25);
        Page = component;
        return () => {};
      },
    },
    // 页面通过 apply 作用域的 ctx 读取 remote，这里把测试桩转发进去。
    get: (key) => ctx.get(key),
  };
  plugin.apply(slotCtx);
  assert.ok(Page, '必须注册一个设置页组件');

  const t = (key) => key; // 注册时包装层会用插件自己的词典覆盖它
  return () => {
    runtime.beginRender();
    let tree = Page({ t, ctx, close: () => {} });
    // 注册的是包装组件（(props) => h(Page, ...)），这里把内层组件展开再断言。
    if (tree !== null && typeof tree === 'object' && typeof tree.type === 'function') {
      tree = tree.type(tree.props);
    }
    runtime.runEffects();
    return { tree, runtime };
  };
}

const settingsStub = (value) => ({
  describe: async () => ({ namespaces: [{ ns: 'include:subagent-devin', revision: 3, value }] }),
  update: async () => {},
});
const credentialsStub = (configured) => ({
  describe: async () => ({ WINDSURF_API_KEY: { configured } }),
  set: async () => {},
  unset: async () => {},
});

test('渲染冒烟：拿不到 remote 时给出可读状态，而不是崩', async () => {
  const render = await loadPage({ get: () => undefined });
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { tree } = render();
  assert.match(textOf(tree), /这个界面暂时连不上应用主进程/);
});

test('渲染冒烟：未登录态给出两条路、命令块和输入框', async () => {
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? credentialsStub(false)
      : (key === 'remote.settings' ? settingsStub({ credentialRef: 'WINDSURF_API_KEY', probe: { reason: 'cli-not-logged-in', at: '2026-11-07T05:00:00.000Z', command: '/x/devin' } }) : undefined)),
  };
  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { tree } = render();
  const text = textOf(tree);
  assert.match(text, /未连接/);
  assert.match(text, /方式一/);
  assert.match(text, /devin auth login/);
  assert.match(text, /方式二/);
  assert.match(text, /粘贴 devin- 开头的密钥/);
  assert.match(text, /本机 Devin 还没有登录/, '原因码要翻成人话');
  assert.match(text, /打开凭据文件位置/);
});

test('渲染冒烟：已连接态显示账号、模型数与密钥行，且不再展示登录命令', async () => {
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? credentialsStub(true)
      : (key === 'remote.settings' ? settingsStub({
        credentialRef: 'WINDSURF_API_KEY',
        model: '',
        permission: 'allow',
        probe: {
          at: '2026-11-07T05:20:00.000Z',
          account: 'Example Account',
          source: 'cli',
          command: '/x/devin',
          keyPrefix: 'devin-',
          ok: true,
          authenticated: true,
          current: 'swe-2-flash-medium',
          models: [{ value: 'swe-2-flash-medium', name: 'SWE-2 Flash Medium' }],
          reason: '',
          error: '',
        },
      }) : undefined)),
  };
  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { tree } = render();
  const text = textOf(tree);
  assert.match(text, /已连接/);
  assert.match(text, /Example Account/);
  assert.match(text, /1 个可用模型/);
  assert.match(text, /devin-…/);
  assert.match(text, /替换密钥/);
  assert.equal(/devin auth login/.test(text), false, '已连接后不再展示登录命令');
});
