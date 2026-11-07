/**
 * 连接探测：只做握手与认证，不发 prompt，因此不产生模型调用费用。
 *
 * 结果直接写回插件配置的 volatile 字段，设置页通过官方 `remote.settings` 读它；
 * 这条链上没有自造的 RPC。
 */
import { homedir } from 'node:os';
import { childEnvironment, openAcpSession } from './acp.js';

/** 探测结果里模型列表的上限：防止畸形后端把配置撑大。 */
const MAX_MODELS = 50;

/**
 * 跑一次探测。
 * @param {object} options
 * @param {string} options.command CLI 绝对路径
 * @param {string} options.apiKey 已解析的密钥（调用方负责解析凭据）
 * @param {number} [options.timeoutMs] 单步超时
 * @returns {Promise<{at: string, ok: boolean, models: {value: string, name: string}[], current: string, authenticated: boolean, error: string}>}
 */
export async function probeDevin({ command, apiKey, timeoutMs = 30_000 }) {
  const at = new Date().toISOString();
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
    return {
      at,
      ok: false,
      models: [],
      current: '',
      authenticated: false,
      error: error?.code === 'DEVIN_SPAWN_FAILED'
        ? '无法启动 Devin CLI，请检查可执行文件路径。'
        : (error?.message ?? String(error)),
    };
  }
  try {
    const models = session.offeredModels.slice(0, MAX_MODELS);
    const authenticated = session.authError === undefined;
    return {
      at,
      ok: true,
      models,
      current: session.model?.actual ?? '',
      authenticated,
      // 认证失败但仍能开会话时，模型列表会是空的：把原因带给页面，不假装成功。
      error: authenticated ? '' : `认证未成功：${session.authError ?? '未知原因'}`,
    };
  } finally {
    await session.close().catch(() => {});
  }
}
