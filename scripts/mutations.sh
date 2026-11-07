#!/bin/sh
# 撤回验证门禁：把每个机制改坏，指定用例必须变红。全绿说明测试没有牙。
#
#   sh scripts/mutations.sh
#
# 每个变异在临时副本里跑，不动工作树；副本里只挂官方运行时包（node_modules 软链）。
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROFILE_NM=${PROFILE_NM:-$HOME/.dsh/profiles/desktop/node_modules}
FAILED=0

mutate() {
  name=$1; file=$2; from=$3; to=$4; expect=$5
  dir=$(mktemp -d "${TMPDIR:-/tmp}/devin-mut-XXXXXX")
  cp -a "$ROOT/lib" "$ROOT/test" "$ROOT/locale" "$ROOT/package.json" "$ROOT/cordis.patch.yml" "$ROOT/icon.svg" "$dir"/ || { echo "复制失败"; exit 2; }
  mkdir -p "$dir/node_modules"
  ln -sfn "$PROFILE_NM/@deepseek-ai" "$dir/node_modules/@deepseek-ai"

  if ! node -e '
    const {readFileSync, writeFileSync}=require("node:fs");
    const [file, from, to]=process.argv.slice(1);
    const s=readFileSync(file,"utf8");
    if (!s.includes(from)) { console.error("ANCHOR-MISS"); process.exit(3); }
    writeFileSync(file, s.replace(from, to));
  ' "$dir/$file" "$from" "$to"; then
    echo "✘ $name：锚点失效（$file）"
    FAILED=1; rm -rf "$dir"; return
  fi

  out=$(cd "$dir" && node --test --test-timeout=20000 test/provider.test.mjs test/probe.test.mjs test/cli.test.mjs test/client-contract.test.mjs 2>&1)
  if printf '%s' "$out" | grep -q "fail [1-9]"; then
    echo "✔ $name → 变红：$expect"
  else
    echo "✘ $name → 仍绿，测试无效"
    printf '%s\n' "$out" | tail -12
    FAILED=1
  fi
  rm -rf "$dir"
}

mutate "权限策略写死 allow" lib/acp.js \
  "const pattern = permission === 'allow' ? /allow/i : /reject|cancel|deny/i;" \
  "const pattern = /allow/i;" \
  "「权限答复 reject」用例"

mutate "跳过凭据检查" lib/index.js \
  "  if (!description?.configured) {" "  if (false) {" \
  "「没有凭据」用例"

mutate "不传 --model" lib/index.js \
  "  if (typeof config.model === 'string' && config.model.trim() !== '') args.push('--model', config.model.trim());" \
  "" \
  "「模型真的传到后端」用例"

mutate "不收集消息分片" lib/acp.js \
  "      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {" \
  "      if (false) {" \
  "「成功回答」用例"

mutate "空引号当密钥" lib/cli.js \
  "  return value === undefined || value === '' ? undefined : value;" \
  "  return value;" \
  "「空值不当密钥」用例"

mutate "不解析账号名" lib/cli.js \
  "  if (name) result.account = name[1];" \
  "  if (false) result.account = name[1];" \
  "「账号名」用例"

mutate "打开位置不去重" lib/index.js \
  "  return typeof requested === 'number' && Number.isFinite(requested) && requested > handled;" \
  "  return true;" \
  "「打开位置的请求判定」用例"

mutate "取消不接线" lib/acp.js \
  "    else signal.addEventListener('abort', onAbort, { once: true });" \
  "    else void 0;" \
  "「取消」用例"

if [ "$FAILED" -ne 0 ]; then
  echo "结论：有变异未被用例发现"
  exit 1
fi
echo "结论：全部变异按预期变红"
