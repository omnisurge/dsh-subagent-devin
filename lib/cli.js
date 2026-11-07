/**
 * 与本机 Devin CLI 打交道的只读面：账号、凭据文件位置、从凭据文件导入密钥。
 *
 * 约定：本文件产生的密钥值只用于写入官方凭据服务，不返回给浏览器、不写日志、
 * 不进错误消息。所有解析函数都是纯函数，便于单独测试。
 */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** CLI 子命令的超时：它只读本地状态，正常在一秒内返回。 */
const CLI_TIMEOUT_MS = 8_000;

/** 各平台已知的默认位置；优先用 `auth status` 报出来的真实路径。 */
const DEFAULT_CREDENTIAL_PATHS = [
  join(homedir(), '.local', 'share', 'devin', 'credentials.toml'),
  join(homedir(), 'Library', 'Application Support', 'devin', 'credentials.toml'),
  join(homedir(), '.config', 'devin', 'credentials.toml'),
];

/** 跑一次 CLI 子命令并拿文本输出；失败返回 undefined，不抛。 */
function runCli(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: CLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error === null ? stdout : undefined);
    });
  });
}

/**
 * 解析 `devin auth status` 的输出。
 * @param {string} text
 * @returns {{loggedIn: boolean, credentialFile?: string, account?: string}}
 */
export function parseAuthStatus(text) {
  if (typeof text !== 'string' || text === '') return { loggedIn: false };
  const result = { loggedIn: /^Logged in/m.test(text) };
  const file = /^\s*File:\s*(\S+)\s*$/m.exec(text);
  if (file) result.credentialFile = file[1];
  const name = /^\s*Name:\s*(.+?)\s*$/m.exec(text);
  if (name) result.account = name[1];
  return result;
}

/**
 * 从凭据文件内容里取出密钥。只认 Devin CLI 自己用的那个字段。
 * @param {string} text
 * @returns {string | undefined}
 */
export function parseCredentialFile(text) {
  if (typeof text !== 'string') return undefined;
  const quoted = /^\s*windsurf_api_key\s*=\s*"([^"]+)"/m.exec(text)
    ?? /^\s*windsurf_api_key\s*=\s*'([^']+)'/m.exec(text)
    ?? /^\s*windsurf_api_key\s*=\s*([^\s#]+)/m.exec(text);
  // 空引号（"" 或 ''）落在这里，去掉引号后按空值处理，不能当成密钥。
  const value = quoted?.[1]?.trim().replace(/^["']|["']$/g, '').trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * 账号与凭据文件位置。
 * @param {string} command CLI 绝对路径
 */
export async function readCliStatus(command) {
  const output = await runCli(command, ['auth', 'status']);
  return parseAuthStatus(output);
}

/**
 * 从本机 CLI 凭据文件读密钥（只读，不改文件）。
 *
 * @param {string} command CLI 绝对路径
 * @returns {Promise<{value: string, path: string, loosePermissions: boolean} | undefined>}
 */
export async function readCredentialFromCli(command, options = {}) {
  const status = await readCliStatus(command);
  if (status.loggedIn !== true) return undefined;
  const candidates = options.candidates
    ?? (status.credentialFile === undefined
      ? DEFAULT_CREDENTIAL_PATHS
      : [status.credentialFile, ...DEFAULT_CREDENTIAL_PATHS]);
  for (const path of candidates) {
    try {
      const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
      const value = parseCredentialFile(text);
      if (value === undefined) continue;
      // 权限比 600 宽时照常导入，但把事实带出去，让页面能提示用户收紧。
      const loosePermissions = (info.mode & 0o077) !== 0;
      return { value, path, loosePermissions };
    } catch { /* 下一个候选 */ }
  }
  return undefined;
}
