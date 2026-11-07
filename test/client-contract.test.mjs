/**
 * 页面与 Host 的契约静态检查（不需要渲染器）。
 *
 * 这里守的是三类真实漂移：词典漏键、中英文不齐、Host 给了原因码但页面没有对应
 * 文案（用户就会看到空白或原始码）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFile(fileURLToPath(new URL(path, ROOT)), 'utf8');

/** 从 `const EN = {...}` 这一段里取出顶层键。 */
function dictKeys(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `找不到 ${name} 词典`);
  const end = source.indexOf('\n    };', start);
  assert.ok(end > start, `${name} 词典没有正常结束`);
  const block = source.slice(start, end);
  return new Set([...block.matchAll(/^\s{6}([a-zA-Z][\w]*):/gm)].map((match) => match[1]));
}

test('中英文词典键完全一致', async () => {
  const source = await read('lib/client.js');
  const en = dictKeys(source, 'EN');
  const zh = dictKeys(source, 'ZH');
  const onlyEn = [...en].filter((key) => !zh.has(key));
  const onlyZh = [...zh].filter((key) => !en.has(key));
  assert.deepEqual(onlyEn, [], `只有英文有：${onlyEn.join(', ')}`);
  assert.deepEqual(onlyZh, [], `只有中文有：${onlyZh.join(', ')}`);
  assert.ok(en.size > 40, `词典规模异常：${en.size}`);
});

test('页面用到的每个键都在词典里', async () => {
  const source = await read('lib/client.js');
  const zh = dictKeys(source, 'ZH');
  const used = new Set([...source.matchAll(/t\('([a-zA-Z][\w]*)'\)/g)].map((match) => match[1]));
  const missing = [...used].filter((key) => !zh.has(key));
  assert.deepEqual(missing, [], `缺文案：${missing.join(', ')}`);
});

test('Host 会给出的原因码，页面都有文案', async () => {
  const client = await read('lib/client.js');
  const host = `${await read('lib/index.js')}\n${await read('lib/cli.js')}`;
  const hostCodes = new Set([...host.matchAll(/reason: '([a-z-]+)'/g)].map((match) => match[1]));
  hostCodes.add('cli-not-logged-in'); // 由 readCredentialFromCli 返回
  const clientCodes = new Set([...client.matchAll(/'(reason-[a-z-]+)'/g)].map((match) => match[1].slice('reason-'.length)));
  const missing = [...hostCodes].filter((code) => !clientCodes.has(code));
  assert.deepEqual(missing, [], `页面缺这些原因码的文案：${missing.join(', ')}`);
});

test('Client 工厂 id 与包名一致，且声明了 web 平台与 ./client 导出', async () => {
  const client = await read('lib/client.js');
  const manifest = JSON.parse(await read('package.json'));
  assert.ok(client.includes(`id: '${manifest.name}'`), '工厂 id 必须等于包名');
  assert.equal(manifest.exports?.['./client'], './lib/client.js');
  assert.equal(manifest.dsh?.client?.platform, 'web');
  assert.ok(Array.isArray(manifest.dsh?.client?.inject), 'inject 必须是数组');
});

test('设置页注册使用官方 slot 与稳定 id', async () => {
  const client = await read('lib/client.js');
  assert.ok(client.includes("const SECTION = 'settings.section'"));
  assert.ok(client.includes("const SECTION_ID = 'devin-subagent'"));
  assert.ok(client.includes('ctx.slots.inject(SECTION'));
  assert.ok(client.includes('order: 25'));
});
