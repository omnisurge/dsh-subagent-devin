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

/**
 * 极简 hooks 运行时：状态、回调与副作用都按调用顺序占槽位。
 *
 * **依赖数组要当真**：真 React 只在依赖变化时才重跑 effect。如果这里每次渲染都跑，
 * 「页面自己轮询」这类机制就永远测不出来——上一版正是这样让「页面不自动刷新」的变异
 * 仍然全绿。所以这里做和 React 一样的浅比较，并保证 useCallback 在依赖不变时返回同一个函数。
 */
function createRuntime() {
  const hooks = [];
  let cursor = 0;
  let pending = [];

  const sameDeps = (left, right) => {
    if (left === undefined || right === undefined) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => Object.is(item, right[index]));
  };

  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const index = cursor;
      cursor += 1;
      if (hooks[index] === undefined || hooks[index].kind !== 'state') {
        hooks[index] = { kind: 'state', value: initial };
      }
      const slot = hooks[index];
      const set = (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; };
      return [slot.value, set];
    },
    useCallback: (fn, deps) => {
      const index = cursor;
      cursor += 1;
      const slot = hooks[index];
      if (slot === undefined || slot.kind !== 'callback' || !sameDeps(slot.deps, deps)) {
        hooks[index] = { kind: 'callback', value: fn, deps };
      }
      return hooks[index].value;
    },
    useEffect: (fn, deps) => {
      const index = cursor;
      cursor += 1;
      const slot = hooks[index];
      if (slot !== undefined && slot.kind === 'effect' && sameDeps(slot.deps, deps)) return;
      hooks[index] = { kind: 'effect', deps };
      pending.push(fn);
    },
  };
  return {
    React,
    beginRender() { cursor = 0; pending = []; },
    runEffects() { const batch = pending; pending = []; for (const fn of batch) fn(); },
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
  const clipboard = [];
  const intervals = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { definition = value; } } },
    navigator: { clipboard: { writeText: async (text) => { clipboard.push(text); } } },
    console,
    setTimeout,
    clearTimeout,
    // 页面用一个 2 秒的轮询等探测结果；这里只记录回调，由测试自己拨表。
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
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
  const render = () => {
    runtime.beginRender();
    let tree = Page({ t, ctx, close: () => {} });
    // 注册的是包装组件（(props) => h(Page, ...)），这里把内层组件展开再断言。
    if (tree !== null && typeof tree === 'object' && typeof tree.type === 'function') {
      tree = tree.type(tree.props);
    }
    runtime.runEffects();
    return { tree, runtime };
  };
  render.clipboard = clipboard;
  /** 拨一次表：触发页面注册的后台刷新。 */
  render.tick = async () => {
    for (const fn of intervals) fn();
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return render;
}

const settingsStub = (value) => ({
  describe: async () => ({ namespaces: [{ ns: 'include:subagent-devin', revision: 3, value }] }),
  update: async () => ok(undefined),
});
const credentialsStub = (configured) => ({
  describe: async () => ({ WINDSURF_API_KEY: { configured } }),
  set: async () => {},
  unset: async () => {},
});


/** 官方 Remote 的返回信封：`{ok:true, value}`；业务失败是 `{ok:false, error}`。 */
function ok(value) {
  return { ok: true, value };
}

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
  assert.match(text, /\/x\/devin/, '命令块要显示真实路径，短名在这台机器上跑不起来');
  assert.match(text, /auth login/);
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

test('渲染冒烟：命令块显示的文字与复制按钮复制的内容完全一致', async () => {
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? credentialsStub(false)
      : (key === 'remote.settings' ? settingsStub({
        credentialRef: 'WINDSURF_API_KEY',
        probe: { reason: 'cli-not-logged-in', command: '/Applications/Devin.app/x/devin' },
      }) : undefined)),
  };
  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { tree } = render();

  const findCopyButton = (node) => {
    if (node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findCopyButton(child);
        if (found !== null) return found;
      }
      return null;
    }
    if (node.type === 'button' && textOf(node.children ?? []).trim() === '复制') return node;
    for (const child of node.children ?? []) {
      const found = findCopyButton(child);
      if (found !== null) return found;
    }
    return null;
  };
  const button = findCopyButton(tree);
  assert.ok(button, '应该有「复制」按钮');
  button.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 5));

  const codeNode = (function walk(node) {
    if (node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) { const found = walk(child); if (found !== null) return found; }
      return null;
    }
    if (node.type === 'code') return node;
    for (const child of node.children ?? []) { const found = walk(child); if (found !== null) return found; }
    return null;
  })(tree);

  assert.equal(render.clipboard.length, 1);
  assert.equal(render.clipboard[0], textOf(codeNode).trim(), '复制的内容必须与屏幕上显示的一字不差');
  assert.match(render.clipboard[0], /^"\/Applications\/Devin\.app\/x\/devin" auth login$/);
});

test('渲染冒烟：探测结果在页面打开之后才落地时，页面会自己刷新过来', async () => {
  // 真机现场：页面挂载时探测还没跑完（要起子进程、握手，通常 3~10 秒），
  // 页面如果不自己刷新，就会永远停在那一瞬间的快照上，看着像所有设置都没生效。
  let value = { credentialRef: 'WINDSURF_API_KEY', probe: {} };
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? { describe: async () => ok({ WINDSURF_API_KEY: { configured: true } }), set: async () => {}, unset: async () => {} }
      : (key === 'remote.settings'
        ? {
          describe: async () => ({ namespaces: [{ ns: 'include:subagent-devin', revision: 1, value }] }),
          update: async () => ok(undefined),
        }
        : undefined)),
  };

  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.match(textOf(render().tree), /检测中/, '还没探测完时应说“检测中”，而不是冒充“未连接”');

  // 探测写完了：换成已连接的数据，拨一次表（模拟 2 秒后页面自己重读）
  value = {
    credentialRef: 'WINDSURF_API_KEY',
    model: '',
    permission: 'allow',
    probe: {
      ok: true,
      authenticated: true,
      at: '2026-11-07T11:41:33.443Z',
      account: 'Example Account',
      source: 'cli',
      keyPrefix: 'devin-',
      command: '/x/devin',
      models: [{ value: 'swe-2-flash-medium', name: 'SWE-2 Flash Medium' }],
      current: 'swe-2-flash-medium',
    },
  };
  await render.tick();
  const text = textOf(render().tree);
  assert.match(text, /已连接/, '后落地的探测结果要能自己显示出来，不用用户手动点');
  assert.match(text, /Example Account/);
});

test('渲染冒烟：探测还没回来的那几秒，页面明说在检查，而不是显示未连接', async () => {
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? { describe: async () => ok({ WINDSURF_API_KEY: { configured: false } }), set: async () => {}, unset: async () => {} }
      : (key === 'remote.settings'
        ? {
          describe: async () => ({ namespaces: [{ ns: 'include:subagent-devin', revision: 1, value: { credentialRef: 'WINDSURF_API_KEY' } }] }),
          update: async () => ok(undefined),
        }
        : undefined)),
  };
  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const text = textOf(render().tree);
  assert.match(text, /检测中/, '要有“正在检查”的可见回执');
  assert.match(text, /正在检查本机 Devin 的登录状态与密钥/);
  assert.equal(/未连接/.test(text), false, '还没查完就不能说未连接');
});

test('渲染冒烟：命名空间 id 不按预期时，靠“值里有 probe”认出来', async () => {
  // 官方 describe 返回的是只含 volatile 字段的表单视图，ns 来自行 id。
  // 行 id 与安装方式有关，所以认不靠名字，而靠这个界面自己的形状指纹。
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? { describe: async () => ok({ WINDSURF_API_KEY: { configured: true } }), set: async () => {}, unset: async () => {} }
      : (key === 'remote.settings'
        ? {
          describe: async () => ({
            namespaces: [
              { ns: 'some-other-plugin', revision: 1, value: { greeting: 'hi' } },
              {
                ns: 'unexpected-name-for-ours',
                revision: 7,
                value: { probe: { at: '2026-11-07T13:00:35.608Z', ok: true, authenticated: true, account: 'Example Account', models: [], current: 'swe-2-flash-medium', command: '/x/devin', keyPrefix: 'devin-' } },
              },
            ],
          }),
          update: async () => ok(undefined),
        }
        : undefined)),
  };
  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const text = textOf(render().tree);
  assert.match(text, /已连接/, '认出来了就该正常显示');
  assert.equal(/找不到保存它的设置/.test(text), false);
  assert.match(text, /Example Account/);
});

test('渲染冒烟：真找不到时，把实际看到的命名空间列出来', async () => {
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? { describe: async () => ok({ WINDSURF_API_KEY: { configured: false } }), set: async () => {}, unset: async () => {} }
      : (key === 'remote.settings'
        ? {
          describe: async () => ({ namespaces: [{ ns: 'alpha-plugin', revision: 1, value: {} }, { ns: 'beta-plugin', revision: 2, value: {} }] }),
          update: async () => ok(undefined),
        }
        : undefined)),
  };
  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const text = textOf(render().tree);
  assert.match(text, /找不到保存它的设置/, '要明确说找不到');
  assert.match(text, /alpha-plugin/, '要把看到的命名空间列出来，便于定位');
  assert.match(text, /beta-plugin/);
});

test('渲染冒烟：Host 明确拒绝时显示它的原话，而不是含糊说“找不到”', async () => {
  const ctx = {
    get: (key) => (key === 'remote.credentials'
      ? { describe: async () => ok({ WINDSURF_API_KEY: { configured: false } }), set: async () => ok(undefined), unset: async () => ok(undefined) }
      : {
        describe: async () => ({ ok: false, error: { message: 'this deployment does not mount a settings provider' } }),
        update: async () => ok(undefined),
      }),
  };
  const render = await loadPage(ctx);
  render();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const text = textOf(render().tree);
  assert.match(text, /this deployment does not mount a settings provider/, 'Host 的原话要透给用户');
  assert.equal(/找不到保存它的设置/.test(text), false, '这是读取失败，不是“没有那一行”');
});
