/**
 * Devin 子代理：把 Devin CLI 的 ACP 后端接成 DSH 的一个一次性 subagent provider。
 *
 * 与官方 ACP 后端的差别只有三点，都是实测逼出来的：
 *  1. 每个子进程用凭据服务解析出的 API key 通过环境变量认证（不弹浏览器、不靠 CLI 登录态）；
 *  2. 模型用 `--model` 显式传入，并把会话实际返回的模型记进诊断（写错会被静默回落）；
 *  3. 权限请求按配置直接答复，不经过宿主的审批闸门。
 *
 * 契约依据：docs/specs/devin-subagent.md；决定依据：docs/adr/ADR-001。
 */
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { childEnvironment, openAcpSession } from './acp.js';

/** Devin 桌面应用自带的 CLI；找不到时要求用户显式配置，不猜 PATH。 */
export const DEFAULT_COMMAND =
  '/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin';

/** 外部进程无法兑现宿主强加的启动特性，全部声明为不支持。 */
const NO_CAPABILITIES = Object.freeze({
  agentOptions: false,
  agentPreset: false,
  outputSchema: false,
  depthLimit: false,
});

/** provider 在 ctx.subagents 上的名字；工具行的 `provider` 必须与它一致。 */
const PROVIDER_NAME = 'devin';

export const name = 'subagent-devin';
export const inject = ['subagents'];

export const Config = z.object({
  command: z.string().default(DEFAULT_COMMAND)
    .description('Devin CLI 可执行文件的绝对路径。'),
  model: z.string().default('')
    .description('模型名；留空表示跟随账号默认。写错的名字会被 Devin 静默换成默认模型。'),
  permission: z.union([z.const('allow'), z.const('reject')]).default('allow')
    .description('子代理的权限请求如何答复：allow 直接放行（可改文件），reject 一律拒绝。'),
  credentialRef: z.string().default('WINDSURF_API_KEY')
    .description('保存 Devin API key 的凭据引用名；插件的行配置里只存引用，不存密钥。'),
  requestTimeoutMs: z.natural().default(600000)
    .description('单次子代理运行的上限毫秒数。'),
  disposeEofGraceMs: z.natural().default(6000)
    .description('关闭 stdin 后等待子进程自行退出的宽限毫秒数。'),
  disposeGraceMs: z.natural().default(3000)
    .description('终止信号升级（TERM→KILL）之间的宽限毫秒数。'),
});

/**
 * 把一次请求里的内容块折成一段文本。
 * @param {readonly {type: string, text?: string}[]} prompt
 * @returns {string}
 */
function promptText(prompt) {
  return (prompt ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n');
}

/**
 * 解析凭据引用。没配置时给出可执行的下一步，而不是一个错误码。
 * @returns {Promise<string | undefined>}
 */
async function resolveApiKey(ctx, config) {
  const credentials = ctx.get('credentials');
  if (credentials === undefined) {
    throw Object.assign(new Error('This profile has no credential service, so the Devin API key cannot be read.'), {
      code: 'DEVIN_NO_CREDENTIAL_SERVICE',
    });
  }
  const ref = config.credentialRef;
  const description = await credentials.describe(ref);
  if (!description?.configured) {
    throw Object.assign(
      new Error(`No Devin API key is configured. Add one to the credential service under the name "${ref}".`),
      { code: 'DEVIN_NO_CREDENTIAL' },
    );
  }
  const resolved = await credentials.resolve(ref);
  const value = resolved?.value;
  if (typeof value !== 'string' || value === '') {
    throw Object.assign(new Error(`The credential "${ref}" resolved to an empty value.`), {
      code: 'DEVIN_EMPTY_CREDENTIAL',
    });
  }
  return value;
}

/**
 * 起一次运行。start() 必须在返回 run 之前把失败时创建的一切都关掉。
 */
async function startRun(ctx, config, request, activeSessions) {
  const text = promptText(request.prompt);
  if (text.trim() === '') {
    throw Object.assign(new Error('The Devin subagent received no text prompt.'), { code: 'DEVIN_EMPTY_PROMPT' });
  }
  const apiKey = await resolveApiKey(ctx, config);
  const args = ['acp'];
  if (typeof config.model === 'string' && config.model.trim() !== '') args.push('--model', config.model.trim());

  const session = await openAcpSession({
    command: config.command,
    args,
    cwd: request.cwd,
    env: childEnvironment({ WINDSURF_API_KEY: apiKey }),
    permission: config.permission,
    signal: request.signal,
    requestTimeoutMs: config.requestTimeoutMs,
    eofGraceMs: config.disposeEofGraceMs,
    graceMs: config.disposeGraceMs,
    requestedModel: config.model,
    log: (message, detail) => {
      try {
        ctx.logger?.info?.(`devin-subagent: ${message}`, detail ?? '');
      } catch { /* 日志失败不影响运行 */ }
    },
  });

  // 模型以 `--model` 为准；会话报告的当前值不符时再试一次会话级设置（形态未实测，失败不阻断）。
  if (config.model && session.model.actual && session.model.actual !== config.model) {
    await session.trySetConfig('model', config.model);
  }

  activeSessions.add(session);
  const id = randomUUID();

  const result = (async () => {
    try {
      const turn = await session.prompt(text);
      const actual = session.model.actual;
      if (config.model && actual && actual !== config.model) {
        try {
          ctx.logger?.warn?.(`devin-subagent: 模型 "${config.model}" 未被采用，实际使用 "${actual}"`);
        } catch { /* 忽略 */ }
      }
      const output = turn.text === '' ? [] : [{ type: 'text', text: turn.text }];
      const stopReason = turn.stopReason === 'cancelled' ? 'aborted' : 'end_turn';
      return { output, stopReason };
    } catch (error) {
      const cancelled = request.signal?.aborted === true;
      const detail = session.diagnostics;
      const message = cancelled ? 'Devin subagent was cancelled.' : describeFailure(error, detail);
      return {
        output: [],
        stopReason: cancelled ? 'aborted' : 'error',
        ...(cancelled ? {} : { diagnostic: message }),
      };
    }
  })();

  return {
    id,
    result,
    async dispose() {
      await session.close();
      activeSessions.delete(session);
    },
  };
}

/**
 * 把协议失败折成一句可读诊断。秘值不进这里：env 从未被打印。
 */
function describeFailure(error, stderr) {
  const code = error?.code;
  const base =
    code === 'DEVIN_EXITED' ? 'Devin CLI 在回答前退出了。'
      : code === 'DEVIN_TIMEOUT' ? 'Devin 超时未回答。'
        : code === 'DEVIN_SPAWN_FAILED' ? '无法启动 Devin CLI，请检查可执行文件路径。'
          : code === 'DEVIN_RPC_ERROR' ? `Devin 拒绝了请求：${error.message}`
            : `Devin 运行失败：${error?.message ?? String(error)}`;
  const tail = (stderr ?? '').trim();
  return tail === '' ? base : `${base}\n--- devin stderr ---\n${tail}`;
}

export function apply(ctx, config) {
  const activeSessions = new Set();

  ctx.effect(() => {
    const unregister = ctx.subagents.registerProvider({
      name: PROVIDER_NAME,
      capabilities: NO_CAPABILITIES,
      inheritsParentContext: false,
      start: (request) => startRun(ctx, config, request, activeSessions),
    });
    return unregister;
  }, 'devin-subagent: provider');

  // 插件卸载时收掉所有还活着的子进程，避免留下孤儿。
  ctx.effect(() => () => {
    for (const session of activeSessions) void session.close();
    activeSessions.clear();
  }, 'devin-subagent: close sessions');
}
