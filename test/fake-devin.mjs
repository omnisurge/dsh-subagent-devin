#!/usr/bin/env node
/**
 * 假 Devin ACP 后端：只实现本插件用到的那部分 ndjson JSON-RPC。
 *
 * 场景由环境变量 FAKE_SCENARIO 选择（不匹配凭据擦除规则，能穿过 childEnvironment）：
 *   success      正常回答（默认）
 *   authfail     prompt 时返回 -32000「需要登录」
 *   permission   先发 session/request_permission，再把收到的答复写进回答文本
 *   exitmid      prompt 时直接退出（模拟后端崩溃）
 *   slow         prompt 时挂住不答（模拟超时/取消）
 *   setcfg       对 session/set_config_option 记下值并以 success 回答
 * 收到的 argv 里的 --model 会体现在 session/new 的 configOptions.model.currentValue 上。
 */
const scenario = process.env.FAKE_SCENARIO ?? 'success';
const argv = process.argv.slice(2);

// CLI 面（非 ACP）：给探测提供一个确定的账号与凭据文件位置。
if (argv[0] === 'auth') {
  process.stdout.write([
    'Logged in (via Devin).',
    '',
    'Credentials:',
    '  File:              /nonexistent/fake-devin-credentials.toml',
    '',
    'User:',
    '  Name:              Fake Account',
    '  Email:             fake@example.invalid',
    '',
  ].join('\n'));
  process.exit(0);
}
if (argv[0] === 'models') {
  process.stdout.write(JSON.stringify({ models: [] }));
  process.exit(0);
}
const modelIndex = argv.indexOf('--model');
const requestedModel = modelIndex >= 0 ? argv[modelIndex + 1] : undefined;

let buffer = '';
let sessionId = 'session-fake';
let authenticated = false;
const pending = new Map();
let nextRequestId = 1;
const received = [];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function request(method, params) {
  const id = nextRequestId++;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve) => pending.set(id, resolve));
}

function chunk(text) {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
  });
}

async function handle(message) {
  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
    return;
  }
  const { method, id, params } = message;
  received.push({ method, params });

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: 1,
        authMethods: [{ id: 'devin-browser', name: 'Log in with browser' }],
        agentInfo: { name: 'fake-devin', version: '0.0.0-test' },
      });
      return;
    case 'authenticate': {
      // 与实测一致：合成/无效密钥在此被拒，且不启动浏览器。
      if (scenario === 'authfail') {
        replyError(id, -32603, 'invalid api key');
        return;
      }
      authenticated = true;
      reply(id, {});
      return;
    }
    case 'session/new': {
      const model = requestedModel ?? 'swe-2-flash-medium';
      reply(id, {
        sessionId,
        configOptions: {
          model: {
            currentValue: scenario === 'setcfg' ? 'swe-2-flash-medium' : model,
            // 未认证时后端不给出可用模型（实测行为）。
            options: authenticated
              ? [
                { value: 'swe-2-flash-medium', name: 'SWE-2 Flash Medium' },
                { value: 'swe-1-6-slow', name: 'SWE-1.6 Slow' },
              ]
              : [],
          },
        },
      });
      return;
    }
    case 'session/set_config_option':
      globalThis.__setConfigCalls = [...(globalThis.__setConfigCalls ?? []), params];
      if (scenario === 'setcfg') {
        reply(id, { configOptions: { model: { currentValue: params.value, options: [] } } });
      } else {
        replyError(id, -32601, 'set_config_option is not supported by this fake');
      }
      return;
    case 'session/prompt': {
      if (scenario === 'authfail') {
        replyError(id, -32000, 'Please log in to use Devin. Use `/login` to authenticate again.');
        return;
      }
      if (scenario === 'exitmid') {
        process.exit(3);
      }
      if (scenario === 'slow') {
        // 不答复：由调用方的取消/超时路径收场。
        return;
      }
      if (scenario === 'permission') {
        const answer = await request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: 'call-1', title: 'Edit file' },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        });
        chunk(`outcome=${answer.result?.outcome?.outcome ?? 'none'}:${answer.result?.outcome?.optionId ?? '-'}`);
        reply(id, { stopReason: 'end_turn' });
        return;
      }
      chunk('o');
      chunk('k');
      reply(id, { stopReason: 'end_turn' });
      return;
    }
    case 'session/cancel':
      // 通知，无 id
      return;
    default:
      if (id !== undefined && id !== null) replyError(id, -32601, `unsupported: ${method}`);
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  buffer += data;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === '') continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    void handle(message);
  }
});
// stdin 关闭即退出，模拟协作式收场。
process.stdin.on('end', () => process.exit(0));
