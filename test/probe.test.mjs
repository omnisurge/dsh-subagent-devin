/**
 * 探测（设置页「重新检查连接」的数据来源）的行为测试。
 * 三个事实必须成立：认证后能拿到模型、认证失败不伪装成功、起不来给可读原因。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { probeDevin } from '../lib/probe.js';

const FAKE = fileURLToPath(new URL('./fake-devin.mjs', import.meta.url));

test('探测：认证成功后拿到账号可用模型，且全程不发 prompt', async () => {
  process.env.FAKE_SCENARIO = 'success';
  const result = await probeDevin({ command: FAKE, apiKey: 'test-key' });
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.error, '');
  assert.deepEqual(result.models.map((model) => model.value), ['swe-2-flash-medium', 'swe-1-6-slow']);
  assert.deepEqual(result.models.map((model) => model.name), ['SWE-2 Flash Medium', 'SWE-1.6 Slow']);
  assert.equal(result.current, 'swe-2-flash-medium');
  assert.equal(result.account, 'Fake Account', '账号名应从 CLI 的本地状态读出来');
  assert.match(result.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('探测：认证被拒时如实说明，不把空列表当成功', async () => {
  process.env.FAKE_SCENARIO = 'authfail';
  const result = await probeDevin({ command: FAKE, apiKey: 'not-a-key' });
  assert.equal(result.ok, true, '进程起来了就算检查到了后端');
  assert.equal(result.authenticated, false);
  assert.deepEqual(result.models, [], '认证失败时后端不提供模型列表');
  assert.equal(result.reason, 'auth-failed', '给原因码，不给成品句子');
  assert.match(result.error, /invalid api key/, '原始诊断另存，供开发者排查');
});

test('探测：可执行文件不存在时给出可读原因，而不是抛栈', async () => {
  const result = await probeDevin({ command: '/nonexistent/devin-binary', apiKey: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'cli-not-runnable');
  assert.match(result.error, /ENOENT|spawn/i);
});
