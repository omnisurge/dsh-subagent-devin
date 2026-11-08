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
import { isVolatile } from '@deepseek-ai/cosmokit';
import { childEnvironment, openAcpSession } from './acp.js';
import { probeDevin } from './probe.js';
import { readCliStatus, readCredentialFromCli, resolveDevinCommand, revealCredentialLocation } from './cli.js';

/** 外部进程无法兑现宿主强加的启动特性，全部声明为不支持。 */
const NO_CAPABILITIES = Object.freeze({
  agentOptions: false,
  agentPreset: false,
  outputSchema: false,
  depthLimit: false,
});

/**
 * 把一份配置解成普通值。
 *
 * 声明为 volatile 的字段在运行时不是值，而是宿主维护的引用对象（带 `.get()`）；
 * 直接比较或当字符串用会静默得到错误结果——`revealToken > lastRevealToken` 就永远为假，
 * 于是“打开位置”永不触发。每次操作开始时先取一份快照，之后的读取都用快照。
 *
 * @param {unknown} value 运行时配置值，可能含 volatile 引用。
 * @returns {unknown} 同样形状、但全部是普通值的配置。
 */
export function plainConfig(value) {
  if (isVolatile(value)) return plainConfig(value.get());
  if (Array.isArray(value)) return value.map(plainConfig);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child)]));
  }
  return value;
}

/** provider 在 ctx.subagents 上的名字；工具行的 `provider` 必须与它一致。 */
const PROVIDER_NAME = 'devin';

export const name = 'subagent-devin';
export const inject = ['subagents'];

export const Config = z.object({
  command: z.string().default('')
    .description('Devin CLI 的绝对路径；留空表示自动查找（先查 PATH，再查各平台常见安装位置）。'),
  // model 与 permission 声明为 volatile：设置页要能读到当前值并就地修改，
  // 改完下一次运行即生效，不需要重载插件。运行时读它们的唯一入口是 plainConfig()。
  model: z.string().default('').volatile()
    .description('模型名；留空表示跟随账号默认。写错的名字会被 Devin 静默换成默认模型。'),
  // 思考强度与速度同样是 volatile：设置页要能读当前值、就地修改，改完下一次运行生效。
  // 留空表示跟随账号默认（探测里读到的 current 是账号自己的值）。
  thought: z.string().default('').volatile()
    .description('思考强度：medium / high / max；留空表示跟随账号默认。'),
  speed: z.string().default('').volatile()
    .description('速度：standard / fast；留空表示跟随账号默认。'),
  permission: z.union([z.const('allow'), z.const('reject')]).default('allow').volatile()
    .description('子代理的权限请求如何答复：allow 直接放行（可改文件），reject 一律拒绝。'),
  credentialRef: z.string().default('WINDSURF_API_KEY')
    .description('保存 Devin API key 的凭据引用名；插件的行配置里只存引用，不存密钥。'),
  requestTimeoutMs: z.natural().default(600000)
    .description('单次子代理运行的上限毫秒数。'),
  disposeEofGraceMs: z.natural().default(6000)
    .description('关闭 stdin 后等待子进程自行退出的宽限毫秒数。'),
  disposeGraceMs: z.natural().default(3000)
    .description('终止信号升级（TERM→KILL）之间的宽限毫秒数。'),
  importFromCli: z.boolean().default(true)
    .description('凭据库里还没有密钥时，尝试从本机 Devin CLI 的登录凭据导入一次（只导入，不覆盖已有值）。'),
  refreshToken: z.natural().default(0)
    .description('设置页递增它来要求重新检查连接；不需要手动修改。'),
  revealToken: z.natural().default(0)
    .description('设置页递增它来要求打开凭据文件所在位置；不需要手动修改。'),
  lastRevealToken: z.natural().default(0).volatile()
    .description('由插件维护，记录已经处理过的打开位置请求；不需要编辑。'),
  probe: z.object({
    at: z.string().default(''),
    account: z.string().default(''),
    source: z.string().default(''),
    command: z.string().default(''),
    credentialPath: z.string().default(''),
    keyPrefix: z.string().default(''),
    revealReason: z.string().default(''),
    // 机器可读的原因码；用户读到的句子由页面按语言渲染，Host 不写成品句子。
    reason: z.string().default(''),
    loosePermissions: z.boolean().default(false),
    // 'other' | 'group' | 'none'：谁能真的读到凭据文件（已把目录可达性算进去）
    exposure: z.string().default(''),
    permissionMode: z.string().default(''),
    ok: z.boolean().default(false),
    models: z.array(z.object({ value: z.string().default(''), name: z.string().default('') })).default([]),
    current: z.string().default(''),
    // 档位类配置项：账号当前的取值与可选项（机器可读，句子归 Client）
    thought: z.object({
      current: z.string().default(''),
      options: z.array(z.object({ value: z.string().default(''), name: z.string().default('') })).default([]),
    }).default({}),
    speed: z.object({
      current: z.string().default(''),
      options: z.array(z.object({ value: z.string().default(''), name: z.string().default('') })).default([]),
    }).default({}),
    authenticated: z.boolean().default(false),
    error: z.string().default(''),
  }).default({}).volatile()
    .description('由插件维护的连接检查结果，不需要编辑。'),
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
    command: (await createCommandResolver(config)()).command,
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

  // `--model` 实测会被 acp 子命令忽略（2026-11-08 验：传 swe-2-high 后会话仍是默认模型），
  // 真正生效的是协议里的 session/set_config_option。所以只要用户指定了模型就显式设一次；
  // 被后端拒绝时只记录，运行继续用账号默认模型（不假装成功）。
  // 只负责“设上去”；没设上不在这里再报一次——运行结束处按实际生效值统一给一条回落事实，
  // 同一事实只出现一次。
  if (typeof config.model === 'string' && config.model.trim() !== '') {
    await session.trySetConfig('model', config.model.trim());
  }
  // 档位同理：`--model` 那种命令行参数它们也没有，只有 set_config_option 生效。
  // 被拒时记一条事实（这次用的是账号当前值），不阻断运行。
  for (const [configId, raw] of [['thought_level', config.thought], ['speed', config.speed]]) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const wanted = raw.trim();
    const applied = await session.trySetConfig(configId, wanted);
    if (!applied) {
      const effective = session.configOptions?.[configId]?.currentValue ?? '';
      try {
        ctx.logger?.warn?.(`devin-subagent: ${configId} "${wanted}" 未被接受，本次使用 "${effective || '账号默认'}"`);
      } catch { /* 日志失败不影响运行 */ }
    }
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

/**
 * 解析一次实际要执行的命令并缓存。三平台路径差异只在这里收口：
 * 运行子代理、探测连接、读 CLI 状态都用同一个解析结果。
 *
 * @returns {() => Promise<{command: string, source: string, missing?: boolean}>}
 */
function createCommandResolver(config) {
  let pending;
  return () => {
    pending ??= resolveDevinCommand({ configured: config.command });
    return pending;
  };
}

/**
 * 库里存的是不是**已知不能用于子代理**的密钥。
 *
 * Devin 有两个密钥面：`devin-` 开头的 CLI 凭据能用；`apk_user_` 开头的是平台
 * REST 接口密钥，ACP 不认。用户早期很可能把后者粘进来，那样自动导入就永远不触发
 * （它只在库为空时跑），页面会卡在「未连接」。
 */
export function isPlatformApiKey(value) {
  return typeof value === 'string' && value.startsWith('apk_');
}

/**
 * 取一次可用于探测的密钥。
 *
 * 顺序：凭据库 -> （库里没有时）本机 Devin CLI 的登录凭据。
 * CLI 导入只在库为空时发生，绝不覆盖用户已经保存的值；导入的密钥直接写进
 * 官方凭据服务，不经过页面、日志或错误消息。
 *
 * 失败时必须说清楚**为什么**，否则用户面对一个「未配置」不知道下一步做什么。
 * 这里只返回原因码，句子由页面渲染。
 *
 * @returns {Promise<
 *   {value: string, source: 'store'|'cli', path?: string, loosePermissions?: boolean}
 *   | {reason: string}>}
 */
export async function resolveProbeKey(ctx, config, command) {
  const credentials = ctx.get('credentials');
  if (credentials === undefined) return { reason: 'no-credential-service' };

  const description = await credentials.describe(config.credentialRef).catch(() => undefined);
  const resolved = description?.configured === true
    ? await credentials.resolve(config.credentialRef).catch(() => undefined)
    : undefined;
  const stored = resolved?.value;
  if (typeof stored === 'string' && stored !== '' && !isPlatformApiKey(stored)) {
    return { value: stored, source: 'store', keyPrefix: stored.slice(0, 6) };
  }
  // 走到这里只有三种情况：库为空、库里的值读不出来、库里是平台接口密钥（用不了）。
  const replacingPlatformKey = isPlatformApiKey(stored);
  if (config.importFromCli !== true) {
    return { reason: replacingPlatformKey ? 'platform-key-unusable' : 'import-disabled' };
  }

  const found = await readCredentialFromCli(command).catch(() => ({ reason: 'cli-no-key' }));
  if (found.value === undefined) {
    return { reason: replacingPlatformKey ? 'platform-key-unusable' : (found.reason ?? 'cli-no-key') };
  }
  try {
    await credentials.set(config.credentialRef, found.value);
  } catch (error) {
    try {
      ctx.logger?.warn?.(`devin-subagent: 从 CLI 导入密钥失败：${error?.message ?? String(error)}`);
    } catch { /* 忽略 */ }
    return { reason: 'import-failed' };
  }
  try {
    ctx.logger?.info?.(`devin-subagent: 已从本机 Devin CLI 导入密钥（${found.path}）`);
  } catch { /* 忽略 */ }
  return {
    value: found.value,
    source: 'cli',
    keyPrefix: found.value.slice(0, 6),
    path: found.path,
    loosePermissions: found.loosePermissions,
    exposure: found.exposure ?? '',
    permissionMode: found.mode ?? '',
  };
}

/**
 * 是否有一个尚未处理的「打开位置」请求。
 * 只有请求计数大于已处理计数时才算——否则插件每次重载都会弹文件管理器。
 */
export function shouldReveal(requested, handled) {
  return typeof requested === 'number' && Number.isFinite(requested) && requested > handled;
}

/**
 * 处理一次「打开凭据文件位置」请求。
 *
 * 用两个计数比较来判断是否有新请求：设置页递增 `revealToken`，插件处理完把
 * 值抄进 `lastRevealToken`。这样插件重载不会每次都弹文件管理器。
 */
async function handleRevealRequest(ctx, config, command) {
  if (!shouldReveal(config.revealToken, config.lastRevealToken)) return;
  const editor = ctx.get('configEditor');
  const entry = ctx.fiber?.entry;
  const result = await revealCredentialLocation(command).catch(() => ({ ok: false, reason: 'no-credential-location' }));
  try {
    ctx.logger?.info?.(`devin-subagent: 打开凭据位置 ${result.ok === true ? result.path : result.reason}`);
  } catch { /* 忽略 */ }
  if (editor === undefined || entry === undefined) return;
  try {
    // 顺手记下「有没有打开成功」，页面才能如实告诉用户，而不是一律说成功。
    await editor.edit(entry, (current) => ({
      ...current,
      lastRevealToken: config.revealToken,
      probe: { ...(current.probe ?? {}), revealReason: result.ok === true ? '' : (result.reason ?? '') },
    }));
  } catch { /* 记录失败不影响已经打开的位置 */ }
}

/**
 * 启动时探测一次连接，把结果写回 volatile 配置（设置页读它）。
 *
 * 这里只写机器可读的事实：`source`（密钥来源）、`reason`（为什么不能跑）、
 * `loosePermissions`。要展示给用户的句子属于 Client（AGENTS §5.10）。
 */
async function runProbeInBackground(ctx, config) {
  const editor = ctx.get('configEditor');
  const entry = ctx.fiber?.entry;
  if (editor === undefined || entry === undefined) return;

  const at = new Date().toISOString();
  const resolved = await createCommandResolver(config)();
  await handleRevealRequest(ctx, config, resolved.command);
  const status = await readCliStatus(resolved.command).catch(() => ({ loggedIn: false }));
  const key = await resolveProbeKey(ctx, config, resolved.command);

  let probe;
  if (key.value === undefined) {
    probe = {
      at, account: status.account ?? '', source: 'none', command: resolved.command,
      credentialPath: status.credentialFile ?? '', keyPrefix: '', revealReason: '', reason: key.reason, loosePermissions: false,
      ok: false, models: [], current: '', thought: { current: '', options: [] }, speed: { current: '', options: [] },
      authenticated: false, error: '',
    };
  } else {
    let usedKey = key;
    let result = await probeDevin({ command: resolved.command, apiKey: key.value });
    // 自愈一次：库里那把被拒，而本机 CLI 有一把不同的、能用的，就换掉它再探一次。
    // 有界（只重试一次），且不覆盖内容相同的值。
    if (result.authenticated !== true && usedKey.source === 'store' && config.importFromCli === true) {
      const fresh = await readCredentialFromCli(resolved.command).catch(() => ({}));
      if (fresh.value !== undefined && fresh.value !== usedKey.value) {
        const credentials = ctx.get('credentials');
        const replaced = await credentials?.set(config.credentialRef, fresh.value).then(() => true).catch(() => false);
        if (replaced === true) {
          const retried = await probeDevin({ command: resolved.command, apiKey: fresh.value });
          if (retried.authenticated === true) {
            result = retried;
            usedKey = {
              value: fresh.value,
              source: 'cli',
              keyPrefix: fresh.value.slice(0, 6),
              path: fresh.path,
              loosePermissions: fresh.loosePermissions,
            };
            try {
              ctx.logger?.info?.('devin-subagent: 库里那把密钥被拒，已换成本机 CLI 的登录凭据');
            } catch { /* 忽略 */ }
          }
        }
      }
    }
    probe = {
      ...result,
      source: usedKey.source,
      command: resolved.command,
      credentialPath: status.credentialFile ?? usedKey.path ?? '',
      keyPrefix: usedKey.keyPrefix ?? '',
      reason: result.reason ?? '',
      loosePermissions: usedKey.loosePermissions === true,
    };
  }

  try {
    await editor.edit(entry, (current) => ({ ...current, probe }));
  } catch (error) {
    try {
      ctx.logger?.warn?.(`devin-subagent: 写回连接检查结果失败：${error?.message ?? String(error)}`);
    } catch { /* 忽略 */ }
  }
}

export function apply(ctx, config) {
  const activeSessions = new Set();

  ctx.effect(() => {
    const unregister = ctx.subagents.registerProvider({
      name: PROVIDER_NAME,
      capabilities: NO_CAPABILITIES,
      inheritsParentContext: false,
      start: (request) => startRun(ctx, plainConfig(config), request, activeSessions),
    });
    return unregister;
  }, 'devin-subagent: provider');

  // 连接探测放在激活之外，不拖慢插件启动；没有密钥时它自己退出。
  ctx.effect(() => {
    const timer = setTimeout(() => { void runProbeInBackground(ctx, plainConfig(config)); }, 0);
    return () => clearTimeout(timer);
  }, 'devin-subagent: probe');

  // 插件卸载时收掉所有还活着的子进程，避免留下孤儿。
  ctx.effect(() => () => {
    for (const session of activeSessions) void session.close();
    activeSessions.clear();
  }, 'devin-subagent: close sessions');
}
