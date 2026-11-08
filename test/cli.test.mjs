/**
 * 与本机 Devin CLI 打完气的解析面：账号、凭据文件位置、密钥字段。
 * 这些都是纯函数或只读文件操作，断言里不出现真实密钥。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  candidateCommands,
  credentialExposure,
  findOnPath,
  parseAuthStatus,
  parseCredentialFile,
  readCredentialFromCli,
  readCliStatus,
  resolveDevinCommand,
  revealCommand,
  revealCredentialLocation,
} from '../lib/cli.js';

const FAKE = fileURLToPath(new URL('./fake-devin.mjs', import.meta.url));

test('解析 auth status：登录态、凭据文件位置、账号名', () => {
  const text = [
    'Logged in (via Devin).',
    '',
    'Credentials:',
    '  File:              /home/x/.local/share/devin/credentials.toml',
    '',
    'User:',
    '  Name:              Example Account',
    '  Email:             someone@example.invalid',
  ].join('\n');
  const parsed = parseAuthStatus(text);
  assert.equal(parsed.loggedIn, true);
  assert.equal(parsed.credentialFile, '/home/x/.local/share/devin/credentials.toml');
  assert.equal(parsed.account, 'Example Account');
});

test('解析 auth status：未登录时不臆造账号', () => {
  const parsed = parseAuthStatus('Not logged in.');
  assert.equal(parsed.loggedIn, false);
  assert.equal(parsed.account, undefined);
  assert.equal(parsed.credentialFile, undefined);
});

test('解析凭据文件：只认 windsurf_api_key，带不带引号都行', () => {
  assert.equal(parseCredentialFile('windsurf_api_key = "devin-abc"\n'), 'devin-abc');
  assert.equal(parseCredentialFile("windsurf_api_key = 'devin-abc'\n"), 'devin-abc');
  assert.equal(parseCredentialFile('windsurf_api_key = devin-abc\n'), 'devin-abc');
  assert.equal(parseCredentialFile('other_key = "x"\n'), undefined);
  assert.equal(parseCredentialFile('windsurf_api_key = ""\n'), undefined);
});

test('从 CLI 导入：读到密钥，并报出偏宽的文件权限', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devin-cli-'));
  const file = join(dir, 'credentials.toml');
  try {
    await writeFile(file, 'windsurf_api_key = "devin-test-value"\n', { mode: 0o644 });
    await chmod(file, 0o644);
    const found = await readCredentialFromCli(FAKE, { candidates: [file] });
    assert.ok(found, '应读到密钥');
    assert.equal(found.value, 'devin-test-value');
    assert.equal(found.path, file);
    // 临时目录本身别人进不去，所以 644 在这里其实读不到——这正是要区分
    // “文件权限宽”和“真的暴露”的原因（见下面 credentialExposure 的用例）。
    assert.equal(found.exposure, 'none', '上级目录进不去就不算暴露');
    assert.equal(found.loosePermissions, false, '读不到就不该吓用户');

    await chmod(file, 0o600);
    const tight = await readCredentialFromCli(FAKE, { candidates: [file] });
    assert.equal(tight.loosePermissions, false, '600 不应告警');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('从 CLI 导入：候选都不存在时给出原因码，不抛', async () => {
  const found = await readCredentialFromCli(FAKE, { candidates: ['/nonexistent/credentials.toml'] });
  assert.equal(found.value, undefined);
  assert.equal(found.reason, 'cli-no-key');
});

test('读 CLI 状态：真二进制之外的路径不会假装登录', async () => {
  const status = await readCliStatus('/nonexistent/devin-binary');
  assert.equal(status.loggedIn, false);
});

test('候选路径按平台拼：Windows 用反斜杠、macOS 指 App 内、Linux 有本地 bin', () => {
  const win = candidateCommands('win32', {
    LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
  }, 'C:\\Users\\someone');
  assert.ok(win[0].endsWith('devin.exe'), 'Windows 候选必须是 exe');
  assert.ok(win[0].includes('\\Programs\\Devin\\'), 'Windows 路径必须用反斜杠');
  assert.equal(win[0].includes('/'), false, '不能在 Windows 路径里混进正斜杠');

  const mac = candidateCommands('darwin', {}, '/Users/someone');
  assert.equal(mac[0], '/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin');
  assert.equal(mac[1], '/Users/someone/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin');

  const linux = candidateCommands('linux', {}, '/home/someone');
  assert.ok(linux.includes('/home/someone/.local/bin/devin'));
  assert.ok(linux.some((path) => path.startsWith('/usr/share/devin/')));
});

test('PATH 探测：只在可执行文件存在时命中', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devin-path-'));
  const file = join(dir, 'devin');
  try {
    await writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await chmod(file, 0o755);
    assert.equal(await findOnPath('devin', { pathEnv: dir, platform: 'linux' }), file);
    assert.equal(await findOnPath('devin', { pathEnv: '/nonexistent-dir', platform: 'linux' }), undefined);
    await chmod(file, 0o644);
    assert.equal(await findOnPath('devin', { pathEnv: dir, platform: 'linux' }), undefined, '不可执行就不算找到');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('命令解析：显式配置优先，且按它执行', async () => {
  const resolved = await resolveDevinCommand({ configured: FAKE });
  assert.equal(resolved.command, FAKE);
  assert.equal(resolved.source, 'config');
});

test('命令解析：配置指向不存在的文件时不静默换掉，标记 missing', async () => {
  const resolved = await resolveDevinCommand({ configured: '/nonexistent/devin-binary' });
  assert.equal(resolved.missing, true, '必须让人知道配置的路径是坏的');
});

test('命令解析：留空时自动发现（本机应指到 Devin 桌面版自带的 CLI）', async () => {
  const resolved = await resolveDevinCommand({ configured: '' });
  assert.ok(['path', 'candidate'].includes(resolved.source), `实际来源：${resolved.source}`);
  assert.match(resolved.command, /devin$/);
  assert.equal(resolved.missing, undefined);
  assert.ok(resolved.command.includes('Devin'), '本机应解析到 Devin 桌面版内的 CLI');
});

test('打开位置的系统命令按平台给：macOS 选中文件、Windows 选中文件、Linux 开目录', () => {
  assert.deepEqual(revealCommand('darwin', '/Users/a/.local/share/devin/credentials.toml'),
    { command: 'open', args: ['-R', '/Users/a/.local/share/devin/credentials.toml'] });
  assert.deepEqual(revealCommand('win32', 'C:\\a\\credentials.toml'),
    { command: 'explorer', args: ['/select,C:\\a\\credentials.toml'] });
  assert.deepEqual(revealCommand('linux', '/home/a/.local/share/devin/credentials.toml'),
    { command: 'xdg-open', args: ['/home/a/.local/share/devin'] });
});

test('打开位置：命中文件时只定位不打开，且不把内容读出来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devin-reveal-'));
  const file = join(dir, 'credentials.toml');
  const calls = [];
  try {
    await writeFile(file, 'windsurf_api_key = "devin-secret"\n', { mode: 0o600 });
    const result = await revealCredentialLocation(FAKE, {
      platform: 'darwin',
      candidates: [file],
      open: async (reveal) => { calls.push(reveal); },
    });
    assert.equal(result.ok, true);
    assert.equal(result.path, file);
    assert.deepEqual(calls, [{ command: 'open', args: ['-R', file] }], '只定位文件，不打开它');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('打开位置：文件还没生成时给出原因，不假装成功', async () => {
  const result = await revealCredentialLocation(FAKE, {
    platform: 'darwin',
    candidates: ['/nonexistent-dir/credentials.toml'],
    open: async () => { throw new Error('不该被调用'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-credential-location');
});

test('打开位置的请求判定：只处理新请求，重载不重复弹', async () => {
  const { shouldReveal } = await import('../lib/index.js');
  assert.equal(shouldReveal(1700000000000, 0), true, '新请求要处理');
  assert.equal(shouldReveal(1700000000000, 1700000000000), false, '处理过就不再弹');
  assert.equal(shouldReveal(5, 9), false, '计数回退时不能重复弹');
  assert.equal(shouldReveal(undefined, 0), false, '没有请求时不动');
});

test('读取 CLI 状态：stdin 必须接成 /dev/null，否则会被误判成未登录', async () => {
  // 复现真实 Devin CLI 的行为：它会等 stdin 关闭才退出。用管道当 stdin 就会一直等。
  const dir = await mkdtemp(join(tmpdir(), 'devin-stdin-'));
  const fake = join(dir, 'devin');
  try {
    await writeFile(fake, [
      '#!/bin/sh',
      'if [ "$1" = "auth" ]; then',
      '  read -r _ || true',
      '  echo "Logged in (via Devin)."',
      '  echo ""',
      '  echo "Credentials:"',
      '  echo "  File: /nonexistent/credentials.toml"',
      '  echo "  Name: Blocking Fake"',
      'fi',
      '',
    ].join('\n'), { mode: 0o755 });
    await chmod(fake, 0o755);
    const started = Date.now();
    const status = await readCliStatus(fake);
    const elapsed = Date.now() - started;
    assert.equal(status.loggedIn, true, '接通 stdin 之后应当立刻读到登录状态');
    assert.ok(elapsed < 5_000, `不该等到超时（用了 ${elapsed}ms）`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('库里存的是平台接口密钥时，不把它当可用密钥，改从本机 CLI 导入并替换', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devin-platform-'));
  const file = join(dir, 'credentials.toml');
  const sets = [];
  const previous = process.env.FAKE_CREDENTIAL_FILE;
  try {
    await writeFile(file, 'windsurf_api_key = "devin-imported-by-test"\n', { mode: 0o600 });
    process.env.FAKE_CREDENTIAL_FILE = file;
    const { resolveProbeKey, isPlatformApiKey } = await import('../lib/index.js');

    assert.equal(isPlatformApiKey('apk_user_abc'), true);
    assert.equal(isPlatformApiKey('devin-abc'), false);
    assert.equal(isPlatformApiKey(''), false);
    assert.equal(isPlatformApiKey(undefined), false);

    const ctx = {
      get: (key) => (key === 'credentials'
        ? {
          describe: async () => ({ configured: true }),
          resolve: async () => ({ value: 'apk_user_unusable' }),
          set: async (ref, value) => { sets.push([ref, value]); },
        }
        : undefined),
      logger: { info: () => {}, warn: () => {} },
    };
    const resolved = await resolveProbeKey(ctx, { credentialRef: 'WINDSURF_API_KEY', importFromCli: true }, FAKE);
    assert.equal(resolved.source, 'cli', '平台密钥不能算作可用密钥');
    assert.ok(resolved.value.startsWith('devin-'));
    assert.equal(sets.length, 1, '要把能用的密钥写回凭据库');
    assert.ok(sets[0][1].startsWith('devin-'));
  } finally {
    if (previous === undefined) delete process.env.FAKE_CREDENTIAL_FILE;
    else process.env.FAKE_CREDENTIAL_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('库里是平台密钥且关掉自动导入时，明确说是平台密钥而不是“导入已关闭”', async () => {
  const { resolveProbeKey } = await import('../lib/index.js');
  const ctx = {
    get: (key) => (key === 'credentials'
      ? {
        describe: async () => ({ configured: true }),
        resolve: async () => ({ value: 'apk_user_unusable' }),
        set: async () => {},
      }
      : undefined),
    logger: { info: () => {}, warn: () => {} },
  };
  const resolved = await resolveProbeKey(ctx, { credentialRef: 'WINDSURF_API_KEY', importFromCli: false }, FAKE);
  assert.equal(resolved.reason, 'platform-key-unusable');
});

test('凭据暴露判定：看文件权限，也要看上级目录能不能走进去', async () => {
  const file = '/home/someone/.local/share/devin/credentials.toml';
  const dirs = ['/home/someone/.local/share/devin', '/home/someone/.local/share', '/home/someone/.local', '/home/someone', '/home', '/'];
  const statWith = (dirMode) => async (p) => (p === file ? 0o100644 : (dirs.includes(p) ? dirMode : 0o40755));

  assert.equal(await credentialExposure(file, 0o100644, statWith(0o755)), 'other', '全链路都能进、文件 644 → 谁都能读');
  assert.equal(await credentialExposure(file, 0o100644, statWith(0o750)), 'group', '主目录 750 → 同组能读（macOS 上就是每个普通账号）');
  assert.equal(await credentialExposure(file, 0o100644, statWith(0o700)), 'none', '主目录 700 → 别人进不来，644 也不暴露');
  assert.equal(await credentialExposure(file, 0o100600, statWith(0o755)), 'none', '文件 600 → 只有本人');
  assert.equal(await credentialExposure(file, 0o100640, statWith(0o755)), 'group', '文件 640 → 同组可读');
});
