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
  findOnPath,
  parseAuthStatus,
  parseCredentialFile,
  readCredentialFromCli,
  readCliStatus,
  resolveDevinCommand,
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
    assert.equal(found.loosePermissions, true, '644 应被判为偏宽');

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
