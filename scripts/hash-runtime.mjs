#!/usr/bin/env node
/**
 * 算出「随包运行的字节」的 SHA-256，用于验收记录里的 candidate-sha256。
 *
 * 为什么不是 `git archive`：冻结时验收记录要先写进仓库，记录里又要写这个哈希，
 * 用 commit 哈希就成了循环依赖。所以这里只哈希**运行时真实会加载的字节**：
 *   lib/ · cordis.patch.yml · locale/ · icon.svg · package.json
 * docs/ 不计入——文档不进运行时，改文档不该让候选字节变样。
 *
 * 用法：node scripts/hash-runtime.mjs
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILES = ['cordis.patch.yml', 'icon.svg', 'package.json'];
const DIRS = ['lib', 'locale'];

async function walk(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

const all = FILES.map((file) => join(ROOT, file));
for (const dir of DIRS) await walk(join(ROOT, dir), all);

// 路径参与哈希：改文件名也算换字节。排序保证与文件系统枚举顺序无关。
const sorted = all.map((file) => relative(ROOT, file)).sort();
const hash = createHash('sha256');
for (const rel of sorted) {
  hash.update(rel.replaceAll('\\', '/'));
  hash.update('\0');
  hash.update(await readFile(join(ROOT, rel)));
  hash.update('\0');
}
console.log(hash.digest('hex'));
