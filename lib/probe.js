/**
 * 连接探测：只做握手与认证，不发 prompt，因此不产生模型调用费用。
 *
 * 结果直接写回插件配置的 volatile 字段，设置页通过官方 `remote.settings` 读它；
 * 这条链上没有自造的 RPC。
 */
import { homedir } from 'node:os';
import { childEnvironment, openAcpSession } from './acp.js';
import { readCliStatus } from './cli.js';

/** 档位类配置项（思考强度、速度）最多记几项：只防畸形后端，不做产品裁剪。 */
const MAX_LEVELS = 12;

/**
 * 读一个「少量档位」配置项。
 * @param {Record<string, any> | undefined} configOptions 归一化后的会话配置
 * @param {string} id ACP 的配置项 id
 * @returns {{current: string, options: {value: string, name: string}[]}}
 */
export function readLevels(configOptions, id) {
  const entry = configOptions?.[id];
  const options = Array.isArray(entry?.options)
    ? entry.options
      .filter((option) => option !== null && typeof option === 'object' && typeof option.value === 'string' && option.value !== '')
      .map((option) => ({ value: option.value, name: typeof option.name === 'string' && option.name !== '' ? option.name : option.value }))
      .slice(0, MAX_LEVELS)
    : [];
  return { current: typeof entry?.currentValue === 'string' ? entry.currentValue : '', options };
}

/** 探测结果里模型列表的上限：防止畸形后端把配置撑大。 */
// 账号能用的模型实测可达 132 个（2026-11-08）；上限只防异常膨胀，不做产品裁剪。
const MAX_MODELS = 400;

/**
 * 跑一次探测。
 * @param {object} options
 * @param {string} options.command CLI 绝对路径
 * @param {string} options.apiKey 已解析的密钥（调用方负责解析凭据）
 * @param {number} [options.timeoutMs] 单步超时
 * @returns {Promise<{
 *   at: string, account: string, ok: boolean, authenticated: boolean,
 *   models: {value: string, name: string}[], current: string,
 *   thought: {current: string, options: {value: string, name: string}[]},
 *   speed: {current: string, options: {value: string, name: string}[]},
 *   reason: 'cli-not-runnable'|'auth-failed'|'', error: string,
 * }>} 只含机器可读原因码与原始诊断，不含给用户看的句子。
 */
export async function probeDevin({ command, apiKey, timeoutMs = 30_000 }) {
  const at = new Date().toISOString();
  // 账号名只从 CLI 的本地状态读；读不到就留空，不影响探测本身。
  const account = (await readCliStatus(command).catch(() => ({ loggedIn: false }))).account ?? '';
  let session;
  try {
    session = await openAcpSession({
      command,
      args: ['acp'],
      cwd: homedir(),
      env: childEnvironment({ WINDSURF_API_KEY: apiKey }),
      permission: 'reject',
      requestTimeoutMs: timeoutMs,
      eofGraceMs: 3_000,
      graceMs: 2_000,
      preSessionAuth: apiKey,
    });
  } catch (error) {
    const message = error?.message ?? String(error);
    // 「握手失败」和「密钥不被接受」要让用户看到不同的下一步，所以分开归类。
    const looksLikeAuth = /api[ _-]?key|authenticat|unauthoriz|unauthorized|401/i.test(message);
    return {
      at,
      account,
      ok: false,
      models: [],
      current: '',
      thought: { current: '', options: [] },
      speed: { current: '', options: [] },
      authenticated: false,
      reason: error?.code === 'DEVIN_SPAWN_FAILED'
        ? 'cli-not-runnable'
        : (looksLikeAuth ? 'auth-failed' : 'handshake-failed'),
      error: message,
    };
  }
  try {
    const models = session.offeredModels.slice(0, MAX_MODELS);
    const authenticated = session.authError === undefined;
    // 没通过认证就不报档位：那时后端给的是兜底默认值，不是这个账号的真实可选集，
    // 报了会让页面拿“没认证的猜测”冒充账号设置。
    const levels = (id) => (authenticated ? readLevels(session.configOptions, id) : { current: '', options: [] });
    return {
      at,
      account,
      ok: true,
      models,
      current: session.model?.actual ?? '',
      // 档位是会话级设置：页面要能显示“账号当前值”和“可选项”，所以一起带回去。
      thought: levels('thought_level'),
      speed: levels('speed'),
      authenticated,
      // 认证失败但仍能开会话时模型列表为空：给原因码，不假装成功，也不写成品句子。
      reason: authenticated ? '' : 'auth-failed',
      error: authenticated ? '' : (session.authError ?? ''),
    };
  } finally {
    await session.close().catch(() => {});
  }
}
