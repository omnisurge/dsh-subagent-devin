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

import { parseAuthStatus, parseCredentialFile, readCredentialFromCli, readCliStatus } from '../lib/cli.js';

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
