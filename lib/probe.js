/**
 * 连接探测：只做握手与认证，不发 prompt，因此不产生模型调用费用。
 *
 * 结果直接写回插件配置的 volatile 字段，设置页通过官方 `remote.settings` 读它；
 * 这条链上没有自造的 RPC。
 */
import { homedir } from 'node:os';
import { childEnvironment, openAcpSession } from './acp.js';
import { readCliStatus } from './cli.js';

/** 探测结果里模型列表的上限：防止畸形后端把配置撑大。 */
const MAX_MODELS = 50;

/**
 * 跑一次探测。
 * @param {object} options
 * @param {string} options.command CLI 绝对路径
 * @param {string} options.apiKey 已解析的密钥（调用方负责解析凭据）
 * @param {number} [options.timeoutMs] 单步超时
 * @returns {Promise<{
 *   at: string, account: string, ok: boolean, authenticated: boolean,
 *   models: {value: string, name: string}[], current: string,
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
    return {
      at,
      account,
      ok: true,
      models,
      current: session.model?.actual ?? '',
      authenticated,
      // 认证失败但仍能开会话时模型列表为空：给原因码，不假装成功，也不写成品句子。
      reason: authenticated ? '' : 'auth-failed',
      error: authenticated ? '' : (session.authError ?? ''),
    };
  } finally {
    await session.close().catch(() => {});
  }
}
