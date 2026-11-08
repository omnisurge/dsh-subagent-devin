/**
 * ACP（Agent Client Protocol）客户端：一个子进程 = 一次子代理运行。
 *
 * 只实现本项目需要的面：initialize / session/new / session/prompt / cancel /
 * 权限请求应答 / 释放阶梯。形态来自对本机 Devin ACP 的实测（见 docs/evidence）。
 *
 * 不导出协议类型：本文件是唯一的协议实现处，provider 只消费它的结果。
 */
import { spawn } from 'node:child_process';

/** 每个子进程的 stderr 尾部保留量；用于失败诊断，不写日志、不外传。 */
const STDERR_KEEP = 8192;
/** initialize 之后到这里仍未返回，视为后端不可用。 */
const HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * 父环境里被擦掉的凭据形状变量名。与 dsh-subprocess 的规则一致：
 * 子进程只拿显式传入的凭据，不隐式继承宿主的任何 KEY/TOKEN/SECRET。
 */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;

/**
 * 构造子进程环境：擦掉凭据形状与 DSH_ 前缀，再叠加显式条目。
 * @param {Record<string, string>} extra 显式传入的变量（例如 API key）
 * @returns {Record<string, string>}
 */
/**
 * 归一化 `configOptions`。
 *
 * 真实后端返回的是**数组**，每项形如 `{id:'model', currentValue, options:[…]}`；
 * 早期替身返回的是按 id 索引的对象。两种都收敛成对象，调用方只认 `configOptions.model`。
 *
 * @param {unknown} raw
 * @returns {Record<string, {id?: string, currentValue?: unknown, options?: unknown[]}>}
 */
export function normalizeConfigOptions(raw) {
  if (Array.isArray(raw)) {
    const map = {};
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : undefined;
      if (id !== undefined) map[id] = entry;
    }
    return map;
  }
  if (raw !== null && typeof raw === 'object') return raw;
  return {};
}

export function childEnvironment(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PATTERN.test(key)) continue;
    if (key.toUpperCase().startsWith('DSH_')) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * 打开一个 ACP 会话。失败时自己把进程收干净再抛。
 * @param {object} options
 * @param {string} options.command 可执行文件绝对路径
 * @param {string[]} options.args 命令参数
 * @param {string} options.cwd 子代理工作目录（绝对且已存在）
 * @param {Record<string, string>} options.env 子进程环境
 * @param {AbortSignal} [options.signal] 父侧取消信号
 * @param {'allow'|'reject'} options.permission 权限请求的自动答复策略
 * @param {number} options.requestTimeoutMs 单次 prompt 上限
 * @param {number} options.eofGraceMs 关 stdin 后等退出的宽限
 * @param {number} options.graceMs TERM→KILL 的宽限
 * @param {(message: string, detail?: unknown) => void} [options.log] 诊断回调
 */
export async function openAcpSession(options) {
  const {
    command, args = [], cwd, env, signal,
    permission = 'reject',
    requestTimeoutMs = 600_000,
    eofGraceMs = 6_000,
    graceMs = 3_000,
    log = () => {},
  } = options;

  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const session = createSession({
    child, permission, requestTimeoutMs, eofGraceMs, graceMs, log, signal,
    requestedModel: options.requestedModel,
    preSessionAuth: options.preSessionAuth,
  });
  try {
    await session.handshake(cwd);
    return session;
  } catch (error) {
    await session.close().catch((closeError) => {
      throw new AggregateError([error, closeError], 'devin acp handshake failed and cleanup also failed');
    });
    throw error;
  }
}

function createSession(params) {
  const { child, permission, requestTimeoutMs, eofGraceMs, graceMs, log, signal, requestedModel, preSessionAuth } = params;

  let nextId = 1;
  let stdoutBuffer = '';
  let stderrTail = '';
  let closed = false;
  let closing;
  let sessionId;
  let exited = false;
  const pending = new Map();
  const textParts = [];
  const thoughts = [];
  let modelReport = { requested: requestedModel, actual: undefined };
  let sessionConfigOptions = {};
  let authMethodId;
  let authError;

  const send = (message) => {
    if (child.stdin.destroyed || child.stdin.writableEnded) return false;
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  };

  const request = (method, requestParams, timeout = requestTimeoutMs) =>
    new Promise((resolve, reject) => {
      if (exited) {
        reject(Object.assign(new Error(`devin acp exited before ${method}`), { code: 'DEVIN_EXITED' }));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`timeout after ${timeout}ms waiting for ${method}`), { code: 'DEVIN_TIMEOUT' }));
      }, timeout);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      if (!send({ jsonrpc: '2.0', id, method, params: requestParams })) {
        clearTimeout(timer);
        pending.delete(id);
        reject(Object.assign(new Error(`cannot write to devin acp stdin for ${method}`), { code: 'DEVIN_STDIN_CLOSED' }));
      }
    });

  const settleAll = (error) => {
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(error);
    }
  };

  const onAbort = () => { void close(); };

  const handleAgentRequest = (message) => {
    const reply = (result) => send({ jsonrpc: '2.0', id: message.id, result });
    const replyError = (code, text) => send({ jsonrpc: '2.0', id: message.id, error: { code, message: text } });
    switch (message.method) {
      case 'session/request_permission': {
        const offered = message.params?.options ?? [];
        const pattern = permission === 'allow' ? /allow/i : /reject|cancel|deny/i;
        const choice = offered.find((option) => pattern.test(option.kind ?? '') || pattern.test(option.optionId ?? ''));
        log('permission', { policy: permission, matched: Boolean(choice), offered: offered.length });
        reply(choice ? { outcome: { outcome: 'selected', optionId: choice.optionId } } : { outcome: { outcome: 'cancelled' } });
        return;
      }
      // 文件与终端能力不代理：子代理在自己的进程里改动工作目录，
      // 我们不把宿主的文件服务借给外部进程。
      case 'fs/read_text_file':
      case 'fs/write_text_file':
      case 'terminal/create':
      case 'terminal/output':
      case 'terminal/wait_for_exit':
      case 'terminal/kill':
      case 'terminal/release':
        replyError(-32601, `${message.method} is not provided by the Devin subagent host`);
        return;
      default:
        replyError(-32601, `method not supported: ${message.method}`);
    }
  };

  const handleNotification = (message) => {
    if (message.method === 'session/update') {
      const update = message.params?.update ?? {};
      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
        textParts.push(update.content.text);
      } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
        thoughts.push(update.content.text);
      } else if (update.sessionUpdate === 'current_mode_update') {
        log('mode', update.currentModeId);
      }
      return;
    }
    if (message.method === 'session/request_permission') {
      // 少数实现把它当通知发；没有 id 就无法应答，只记录。
      log('permission-without-id', { policy: permission });
    }
  };

  const handleLine = (line) => {
    if (line.trim() === '') return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      log('non-json-stdout', line.slice(0, 200));
      return;
    }
    if (message.id !== undefined && message.id !== null && (message.error !== undefined || message.result !== undefined)) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) {
        entry.reject(Object.assign(new Error(message.error.message ?? 'acp error'), {
          code: 'DEVIN_RPC_ERROR',
          rpcCode: message.error.code,
        }));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (message.method === undefined) return;
    if (message.id !== undefined && message.id !== null) {
      handleAgentRequest(message);
      return;
    }
    handleNotification(message);
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let index;
    while ((index = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, index);
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      handleLine(line);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_KEEP);
  });

  let resolveExit;
  const exitedPromise = new Promise((resolve) => { resolveExit = resolve; });
  child.on('exit', (code, exitSignal) => {
    exited = true;
    settleAll(Object.assign(new Error(`devin acp exited (code=${code ?? 'null'}, signal=${exitSignal ?? 'none'})`), {
      code: 'DEVIN_EXITED',
    }));
    resolveExit({ code, signal: exitSignal });
  });
  child.on('error', (error) => {
    // 起不来时不会有 exit 事件：这里也要让等待方立刻落定，否则释放阶梯会白等三档宽限。
    exited = true;
    settleAll(Object.assign(error, { code: 'DEVIN_SPAWN_FAILED' }));
    resolveExit({ code: null, signal: null, error });
  });

  const waitExit = (ms) =>
    Promise.race([
      exitedPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), ms).unref?.()),
    ]);

  async function close() {
    if (closing !== undefined) return closing;
    closing = (async () => {
      if (closed) return;
      closed = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!exited && sessionId !== undefined) {
        send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      }
      if (!child.stdin.destroyed) child.stdin.end();
      if (await waitExit(eofGraceMs)) return;
      child.kill('SIGTERM');
      if (await waitExit(graceMs)) return;
      child.kill('SIGKILL');
      await waitExit(graceMs);
    })();
    return closing;
  }

  if (signal) {
    if (signal.aborted) void close();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    get diagnostics() { return stderrTail.trim(); },
    /**
     * 当前生效的模型。
     *
     * 握手时记下的只是“开设会话那一刻”的值；之后用 set_config_option 改过模型，
     * 必须反映会话里的当前值，否则调用方会误判“没生效”并重复设置或发出错误告警。
     */
    get model() {
      const current = sessionConfigOptions?.model?.currentValue;
      return { requested: modelReport.requested, actual: typeof current === 'string' ? current : modelReport.actual };
    },
    get configOptions() { return sessionConfigOptions; },
    get authError() { return authError; },
    get offeredModels() {
      const options = sessionConfigOptions?.model?.options;
      return Array.isArray(options)
        ? options.map((option) => ({ value: option.value, name: option.name ?? option.value }))
        : [];
    },

    /** initialize + session/new：任何一步失败都要让调用方拿到可读原因。 */
    async handshake(workspace) {
      const init = await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }, HANDSHAKE_TIMEOUT_MS);
      log('initialize', init?.agentInfo ?? null);
      authMethodId = init?.authMethods?.[0]?.id;
      if (typeof preSessionAuth === 'string' && preSessionAuth !== '') {
        // 认证放在 session/new 之前：会话的可用模型列表只有认证之后才会出现。
        try {
          await request('authenticate', { methodId: authMethodId ?? 'devin-browser', _meta: { api_key: preSessionAuth } }, HANDSHAKE_TIMEOUT_MS);
        } catch (error) {
          authError = error?.message ?? String(error);
          log('authenticate-failed', authError);
        }
      }
      const created = await request('session/new', { cwd: workspace, mcpServers: [] });
      sessionId = created?.sessionId;
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw Object.assign(new Error('devin acp returned no session id'), { code: 'DEVIN_NO_SESSION' });
      }
      sessionConfigOptions = normalizeConfigOptions(created?.configOptions);
      modelReport = { requested: requestedModel, actual: sessionConfigOptions?.model?.currentValue };
      return { sessionId, configOptions: sessionConfigOptions };
    },

    /** 读取本次会话的当前模式（未提供时为 undefined）。 */
    currentMode(configOptions) {
      return configOptions?.mode?.currentValue;
    },

    /**
     * 设置一个会话配置项。
     *
     * 形态已实测（2026-11-08，本机 Devin 0.2.x）：`{sessionId, configId, value}` 被接受，
     * 不在这台账号可用表里的值会被拒（`Invalid params: Invalid value ...`）。
     * 因此失败只记录、不阻断运行——被拒时后端会继续用账号当前值。
     */
    async trySetConfig(configId, value, configOptions = sessionConfigOptions) {
      if (value === undefined || value === null || value === '') return false;
      const current = configOptions?.[configId]?.currentValue;
      if (current === value) return true;
      try {
        await request('session/set_config_option', { sessionId, configId, value }, 15_000);
        // 记住新值：否则后续比较仍按旧值判断，会一直重复设置或误报“没生效”。
        if (sessionConfigOptions?.[configId] !== undefined) sessionConfigOptions[configId] = { ...sessionConfigOptions[configId], currentValue: value };
        return true;
      } catch (error) {
        log('set_config_option-failed', { configId, message: error?.message ?? String(error) });
        return false;
      }
    },

    /** 发送一轮 prompt，返回文本与停止原因。 */
    async prompt(text) {
      const result = await request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      });
      return {
        text: textParts.join(''),
        thoughts: thoughts.join(''),
        stopReason: result?.stopReason ?? 'end_turn',
      };
    },

    /** 主动取消（父侧 abort 时使用）。 */
    cancel() {
      if (exited || sessionId === undefined) return;
      send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    },

    close,
  };
}
