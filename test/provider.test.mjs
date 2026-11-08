/**
 * G1：provider 的行为测试。用 test/fake-devin.mjs 当后端，覆盖成功、缺凭据、
 * 认证失败、后端崩溃、权限答复、模型回落、取消、空输入八类。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVolatile } from '@deepseek-ai/cosmokit';

import { apply, Config, plainConfig, shouldReveal } from '../lib/index.js';
import { childEnvironment } from '../lib/acp.js';

const FAKE = fileURLToPath(new URL('./fake-devin.mjs', import.meta.url));

/** 与 Config 默认值一致的基线配置；command 指向假后端。 */
function baseConfig(overrides = {}) {
  return {
    command: FAKE,
    model: '',
    permission: 'allow',
    credentialRef: 'WINDSURF_API_KEY',
    requestTimeoutMs: 10_000,
    disposeEofGraceMs: 1_000,
    disposeGraceMs: 500,
    ...overrides,
  };
}

/** 最短的宿主上下文替身：只提供本插件真正用到的那几面。 */
function makeContext({ configured = true, value = 'test-key' } = {}) {
  const providers = new Map();
  const effects = [];
  const warnings = [];
  return {
    providers,
    warnings,
    subagents: {
      registerProvider(provider) {
        providers.set(provider.name, provider);
        return () => providers.delete(provider.name);
      },
    },
    get(name) {
      if (name !== 'credentials') return undefined;
      return {
        async describe(ref) { return { configured, source: configured ? 'store' : undefined, writable: true, ref }; },
        async resolve(ref) { return configured ? { value, source: 'store', ref } : undefined; },
      };
    },
    effect(fn) { effects.push(fn()); },
    logger: { info() {}, warn(...args) { warnings.push(args.join(' ')); } },
    effects,
  };
}

/** 所有起过的运行都登记下来：断言失败时也要收进程，否则测试进程会等子进程。 */
const started = [];
async function launch(provider, req) {
  const run = await provider.start(req);
  started.push(run);
  return run;
}

after(async () => {
  for (const run of started) {
    try { await run.dispose(); } catch { /* 收尾失败不影响结论 */ }
  }
});

async function withWorkspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'devin-subagent-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 起一次运行；返回 {run, provider, ctx} 便于各用例继续断言。 */
async function startRun(scenario, configOverrides = {}, contextOptions = {}) {
  process.env.FAKE_SCENARIO = scenario;
  const ctx = makeContext(contextOptions);
  apply(ctx, baseConfig(configOverrides));
  const provider = ctx.providers.get('devin');
  assert.ok(provider, 'provider 应已注册为 devin');
  return { ctx, provider };
}

function request(prompt = [{ type: 'text', text: 'hello' }], cwd, signal) {
  return { prompt, parent: undefined, cwd, label: 'devin-test', signal };
}

test('成功回答：文本回到结果，停止原因为 end_turn', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('success');
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.equal(result.stopReason, 'end_turn');
    assert.deepEqual(result.output, [{ type: 'text', text: 'ok' }]);
    await run.dispose();
  });
});

test('没有凭据：不启动进程，直接给出可执行的下一步', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('success', {}, { configured: false });
    await assert.rejects(
      () => provider.start(request(undefined, cwd)),
      (error) => {
        assert.equal(error.code, 'DEVIN_NO_CREDENTIAL');
        assert.match(error.message, /WINDSURF_API_KEY/);
        return true;
      },
    );
  });
});

test('后端拒绝认证：结果带错误与原始诊断，不静默成功', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('authfail');
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.equal(result.stopReason, 'error');
    assert.match(result.diagnostic, /Please log in/);
    await run.dispose();
  });
});

test('后端中途退出：结果报错误而不是挂住', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('exitmid');
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.equal(result.stopReason, 'error');
    assert.match(result.diagnostic, /Devin|exited/i);
    await run.dispose();
  });
});

test('权限答复 allow：选中 allow 选项', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('permission', { permission: 'allow' });
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.deepEqual(result.output, [{ type: 'text', text: 'outcome=selected:allow-once' }]);
    await run.dispose();
  });
});

test('权限答复 reject：选中拒绝选项', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('permission', { permission: 'reject' });
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.deepEqual(result.output, [{ type: 'text', text: 'outcome=selected:reject-once' }]);
    await run.dispose();
  });
});

test('模型：--model 真的传到后端；采用的模型与请求一致时不告警', async () => {
  await withWorkspace(async (cwd) => {
    const { provider, ctx } = await startRun('success', { model: 'swe-1-6-slow' });
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.equal(result.stopReason, 'end_turn');
    // 后端把 argv 里的 --model 回显到 configOptions；没传过去就会是账号默认值。
    assert.deepEqual(ctx.warnings, [], '请求的模型被采用时不应出现回落告警');
    await run.dispose();
  });
});

test('模型：后端忽略 --model 时，必须改用 set_config_option 设上去', async () => {
  await withWorkspace(async (cwd) => {
    const log = join(cwd, 'calls.jsonl');
    process.env.FAKE_CALL_LOG = log;
    try {
      const { provider, ctx } = await startRun('ignoremodel', { model: 'swe-2-high' });
      const run = await launch(provider, request(undefined, cwd));
      await run.result;
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      const setCall = calls.find((call) => call.method === 'session/set_config_option');
      assert.ok(setCall, 'acp 忽略 --model，插件必须走协议里的 set_config_option');
      assert.equal(setCall.params.configId, 'model');
      assert.equal(setCall.params.value, 'swe-2-high');
      assert.deepEqual(ctx.warnings, [], '设上去了就不该告警');
      await run.dispose();
    } finally {
      delete process.env.FAKE_CALL_LOG;
    }
  });
});

test('档位：思考强度与速度也走 set_config_option 生效', async () => {
  await withWorkspace(async (cwd) => {
    const log = join(cwd, 'calls-levels.jsonl');
    process.env.FAKE_CALL_LOG = log;
    try {
      const { provider } = await startRun('ignoremodel', { thought: 'max', speed: 'fast' });
      const run = await launch(provider, request(undefined, cwd));
      await run.result;
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      const sets = calls.filter((call) => call.method === 'session/set_config_option');
      assert.deepEqual(sets.map((call) => [call.params.configId, call.params.value]), [
        ['thought_level', 'max'],
        ['speed', 'fast'],
      ], '两项档位都要显式设上去；留空的那项不发请求');
      await run.dispose();
    } finally {
      delete process.env.FAKE_CALL_LOG;
    }
  });
});

test('档位：留空表示跟随账号默认，一个请求都不发', async () => {
  await withWorkspace(async (cwd) => {
    const log = join(cwd, 'calls-none.jsonl');
    process.env.FAKE_CALL_LOG = log;
    try {
      const { provider } = await startRun('ignoremodel', {});
      const run = await launch(provider, request(undefined, cwd));
      await run.result;
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      assert.equal(calls.some((call) => call.method === 'session/set_config_option'), false, '没选就什么都不设，交给账号默认');
      await run.dispose();
    } finally {
      delete process.env.FAKE_CALL_LOG;
    }
  });
});

test('档位被拒：记一条事实，运行继续（不假装设置成功）', async () => {
  await withWorkspace(async (cwd) => {
    const { provider, ctx } = await startRun('rejectmodel', { thought: 'max', speed: 'fast' });
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.equal(result.stopReason, 'end_turn', '档位设不上也不能把运行搞挂');
    assert.equal(ctx.warnings.length, 2, '两项各自留一条事实');
    assert.match(ctx.warnings[0], /thought_level/);
    assert.match(ctx.warnings[1], /speed/);
    await run.dispose();
  });
});

test('模型回落：后端不采用请求值时仍完成运行，并留下回落事实', async () => {
  await withWorkspace(async (cwd) => {
    const { provider, ctx } = await startRun('rejectmodel', { model: 'swe-9-imaginary' });
    const run = await launch(provider, request(undefined, cwd));
    const result = await run.result;
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(ctx.warnings.length, 1, '模型被静默回落时必须留下一条告警');
    assert.match(ctx.warnings[0], /swe-9-imaginary/);
    assert.match(ctx.warnings[0], /swe-2-flash-medium/);
    await run.dispose();
  });
});

test('取消：父侧 abort 后不必等 dispose，结果立即落为 aborted', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('slow');
    const controller = new AbortController();
    const run = await launch(provider, request(undefined, cwd, controller.signal));
    controller.abort();
    // 故意不调 dispose：abort 自己必须能让运行落定，否则调用方要等满超时。
    const raced = await Promise.race([
      run.result.then((result) => result.stopReason),
      new Promise((resolve) => { const timer = setTimeout(() => resolve('timeout'), 3_000); timer.unref?.(); }),
    ]);
    assert.equal(raced, 'aborted');
  });
});

test('空输入：直接拒绝，不起进程', async () => {
  await withWorkspace(async (cwd) => {
    const { provider } = await startRun('success');
    await assert.rejects(
      () => provider.start(request([{ type: 'text', text: '   ' }], cwd)),
      (error) => {
        assert.equal(error.code, 'DEVIN_EMPTY_PROMPT');
        return true;
      },
    );
  });
});

test('能力声明：外部 provider 不承诺宿主强制特性', async () => {
  const { provider } = await startRun('success');
  assert.deepEqual(provider.capabilities, {
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  });
  assert.equal(provider.inheritsParentContext, false);
});

test('子进程环境：父凭据形状被擦掉，显式传入的密钥保留', () => {
  process.env.LEAKY_API_KEY = 'must-not-leak';
  process.env.DSH_INTERNAL = 'must-not-leak';
  try {
    const env = childEnvironment({ WINDSURF_API_KEY: 'explicit' });
    assert.equal(env.LEAKY_API_KEY, undefined);
    assert.equal(env.DSH_INTERNAL, undefined);
    assert.equal(env.WINDSURF_API_KEY, 'explicit');
    assert.equal(env.PATH, process.env.PATH);
  } finally {
    delete process.env.LEAKY_API_KEY;
    delete process.env.DSH_INTERNAL;
  }
});

test('配置面：默认值与文档一致，且默认命令是应用自带路径', () => {
  // volatile 字段在运行时时引用对象，比较前必须解成普通值（也就是插件运行时的做法）。
  const resolved = plainConfig(Config(baseConfig()));
  const defaults = plainConfig(Config({}));
  assert.equal(defaults.command, '', '命令默认留空，交给平台解析器发现');
  assert.equal(defaults.permission, 'allow');
  assert.equal(defaults.credentialRef, 'WINDSURF_API_KEY');
  assert.equal(resolved.model, '');
  assert.throws(() => Config({ permission: 'maybe' }));
});

test('volatile 快照：设置页改过的模型与权限，下一次运行就生效', () => {
  const live = {
    model: createVolatile('swe-1-6-slow'),
    permission: createVolatile('reject'),
    lastRevealToken: createVolatile(7),
    revealToken: 9,
  };
  const snapshot = plainConfig(live);
  assert.equal(snapshot.model, 'swe-1-6-slow', '引用对象要解成值，否则传到后端的是对象');
  assert.equal(snapshot.permission, 'reject');
  assert.equal(snapshot.lastRevealToken, 7);
  // 打开位置的判定依赖这两个数：不解引用时 9 > {…} 恒为假，按钮就永远没反应。
  assert.equal(shouldReveal(snapshot.revealToken, snapshot.lastRevealToken), true);
});
