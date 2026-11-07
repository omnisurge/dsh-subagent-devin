/**
 * 与本机 Devin CLI 打交道的只读面：账号、凭据文件位置、从凭据文件导入密钥。
 *
 * 约定：本文件产生的密钥值只用于写入官方凭据服务，不返回给浏览器、不写日志、
 * 不进错误消息。所有解析函数都是纯函数，便于单独测试。
 */
import { execFile } from 'node:child_process';
import { access, constants, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

/** CLI 子命令的超时：它只读本地状态，正常在一秒内返回。 */
const CLI_TIMEOUT_MS = 8_000;

/** 各平台已知的默认位置；优先用 `auth status` 报出来的真实路径。 */
function defaultCredentialPaths() {
  return [
    join(homedir(), '.local', 'share', 'devin', 'credentials.toml'),
    join(homedir(), 'Library', 'Application Support', 'devin', 'credentials.toml'),
    join(homedir(), '.config', 'devin', 'credentials.toml'),
  ];
}

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
 * @param {{candidates?: string[]}} [options] 候选路径（测试用）
 * @returns {Promise<{value: string, path: string, loosePermissions: boolean}
 *   | {reason: 'cli-not-logged-in' | 'cli-no-key'}>}
 */
export async function readCredentialFromCli(command, options = {}) {
  const status = await readCliStatus(command);
  if (status.loggedIn !== true) return { reason: 'cli-not-logged-in' };
  const candidates = options.candidates
    ?? (status.credentialFile === undefined
      ? defaultCredentialPaths()
      : [status.credentialFile, ...defaultCredentialPaths()]);
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
  return { reason: 'cli-no-key' };
}

/** Devin 桌面版内部的可执行文件相对路径（三平台结构一致）。 */
const APP_TAIL = ['resources', 'app', 'extensions', 'windsurf', 'devin', 'bin', 'devin'];

/**
 * 按 Windows 规则拼路径：`path.join` 用的是**本机**分隔符，
 * 在 macOS 上拼 Windows 路径会得到混合分隔符，所以这里自己拼。
 */
function winJoin(...parts) {
  return parts.filter((part) => part !== '').join('\\');
}

/**
 * 各平台可能的可执行文件位置。只用于自动发现，用户显式配置永远优先。
 * @returns {string[]}
 */
export function candidateCommands(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') {
    const macTail = ['Contents', 'Resources', 'app', 'extensions', 'windsurf', 'devin', 'bin', 'devin'];
    return [
      join('/Applications', 'Devin.app', ...macTail),
      join(home, 'Applications', 'Devin.app', ...macTail),
    ];
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? '';
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const exe = `${winJoin(...APP_TAIL)}.exe`;
    return [
      local === '' ? '' : winJoin(local, 'Programs', 'Devin', exe),
      winJoin(programFiles, 'Devin', exe),
      local === '' ? '' : winJoin(local, 'Programs', 'Devin', 'Devin.exe'),
    ].filter((path) => path !== '');
  }
  return [
    '/usr/share/devin/resources/app/extensions/windsurf/devin/bin/devin',
    '/opt/Devin/resources/app/extensions/windsurf/devin/bin/devin',
    join(home, '.local', 'bin', 'devin'),
  ];
}

/**
 * 在 PATH 里找可执行文件（纯文件系统探测，不 spawn 进程）。
 * @returns {Promise<string | undefined>}
 */
export async function findOnPath(name, { pathEnv = process.env.PATH ?? '', platform = process.platform, pathext } = {}) {
  const exts = platform === 'win32'
    ? ['', ...(pathext ?? process.env.PATHEXT ?? '.EXE').split(';').filter((ext) => ext !== '')]
    : [''];
  // 分隔符按**目标平台**取，不受测试机影响。
  const separator = platform === 'win32' ? ';' : ':';
  for (const dir of pathEnv.split(separator)) {
    if (dir === '') continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch { /* 试下一个 */ }
    }
  }
  return undefined;
}

/**
 * 决定实际执行的命令：配置 > PATH > 各平台候选。
 *
 * 显式配置但文件不存在时仍返回它（并在 `missing` 里说明），因为那多半是用户
 * 装到别处了，静默换一个二进制比直接报错更难排查。
 *
 * @returns {Promise<{command: string, source: 'config'|'path'|'candidate'|'none', missing?: boolean}>}
 */
export async function resolveDevinCommand({ configured, platform, env, home } = {}) {
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  if (trimmed !== '') {
    try {
      await access(trimmed, constants.X_OK);
      return { command: trimmed, source: 'config' };
    } catch {
      const fallback = await findOnPath(platform === 'win32' ? 'devin.exe' : 'devin', { platform });
      return fallback === undefined
        ? { command: trimmed, source: 'config', missing: true }
        : { command: fallback, source: 'path', missing: true };
    }
  }
  const onPath = await findOnPath(platform === 'win32' ? 'devin.exe' : 'devin', { platform });
  if (onPath !== undefined) return { command: onPath, source: 'path' };
  for (const candidate of candidateCommands(platform, env, home)) {
    try {
      await access(candidate, constants.X_OK);
      return { command: candidate, source: 'candidate' };
    } catch { /* 试下一个 */ }
  }
  const [first] = candidateCommands(platform, env, home);
  return { command: first ?? 'devin', source: 'none', missing: true };
}

/**
 * 打开凭据文件所在位置的系统命令（纯函数，便于按平台断言）。
 * @returns {{command: string, args: string[]}}
 */
export function revealCommand(platform, file) {
  if (platform === 'darwin') return { command: 'open', args: ['-R', file] };
  if (platform === 'win32') return { command: 'explorer', args: [`/select,${file}`] };
  return { command: 'xdg-open', args: [dirname(file)] };
}

/**
 * 在系统文件管理器里定位凭据文件（不打开文件本身，避免密钥上屏）。
 *
 * @returns {Promise<{ok: true, path: string} | {ok: false, reason: 'no-credential-location'}>}
 */
export async function revealCredentialLocation(command, options = {}) {
  const platform = options.platform ?? process.platform;
  const status = await readCliStatus(command).catch(() => ({ loggedIn: false }));
  const candidates = options.candidates ?? [
    ...(status.credentialFile === undefined ? [] : [status.credentialFile]),
    ...defaultCredentialPaths(),
  ];
  // 真正执行系统命令的部分可注入，测试里不弹文件管理器。
  const open = options.open ?? ((reveal) => new Promise((resolve) => {
    execFile(reveal.command, reveal.args, { timeout: CLI_TIMEOUT_MS }, () => resolve());
  }));
  for (const path of candidates) {
    try {
      await access(path, constants.F_OK);
      await open(revealCommand(platform, path));
      return { ok: true, path };
    } catch { /* 试用下一个候选（含目录不存在） */ }
  }
  // 文件还没生成（没登录过）时，退一步打开它将来会出现的目录。
  for (const path of candidates) {
    const directory = dirname(path);
    try {
      await access(directory, constants.F_OK);
      await open(revealCommand(platform, path));
      return { ok: true, path };
    } catch { /* 继续 */ }
  }
  return { ok: false, reason: 'no-credential-location' };
}
