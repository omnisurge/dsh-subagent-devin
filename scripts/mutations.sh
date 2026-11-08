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

  out=$(cd "$dir" && node --test --test-timeout=20000 test/provider.test.mjs test/probe.test.mjs test/cli.test.mjs test/client-contract.test.mjs test/client-render.test.mjs 2>&1)
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

mutate "页面永远显示未连接" lib/client.js \
  "      const connected = keyConfigured && probe.ok === true && probe.authenticated === true;" \
  "      const connected = false;" \
  "「已连接态」渲染用例"

mutate "CLI 的 stdin 接成管道" lib/cli.js \
  "      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });" \
  "      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });" \
  "stdin 必须接成 /dev/null"

mutate "不归一化 configOptions" lib/acp.js \
  "      sessionConfigOptions = normalizeConfigOptions(created?.configOptions);" \
  "      sessionConfigOptions = created?.configOptions ?? {};" \
  "「认证成功后拿到账号可用模型」"

mutate "把平台密钥当成可用密钥" lib/index.js \
  "  if (typeof stored === 'string' && stored !== '' && !isPlatformApiKey(stored)) {" \
  "  if (typeof stored === 'string' && stored !== '') {" \
  "「库里存的是平台接口密钥」用例"

mutate "认证失败都算握手失败" lib/probe.js \
  "        : (looksLikeAuth ? 'auth-failed' : 'handshake-failed')," \
  "        : 'handshake-failed'," \
  "「开会话时密钥被拒」用例"

mutate "页面不自动刷新" lib/client.js \
  "        const timer = setInterval(() => { void load(); }, 2000);" \
  "        const timer = 0;" \
  "「页面会自己刷新过来」用例"

mutate "没结果时冒充未连接" lib/client.js \
  "      const checking = busy === 'check' || waiting;" \
  "      const checking = busy === 'check';" \
  "「明说在检查」用例"

mutate "把信封当裸值读" lib/client.js \
  "      if (answer === null || typeof answer !== 'object' || !('ok' in answer)) return answer;" \
  "      return answer;" \
  "「已连接态」用例"

mutate "volatile 引用不解成值" lib/index.js \
  "  if (isVolatile(value)) return plainConfig(value.get());" \
  "  if (false) return plainConfig(value.get());" \
  "「volatile 快照」用例"

mutate "只看文件权限不看目录" lib/cli.js \
  "  if (readableByOther && await traversable(0o001)) return 'other';" \
  "  if (readableByOther) return 'other';" \
  "「凭据暴露判定」用例"

mutate "收回的模型不显示" lib/client.js \
  "savedModelMissing ? h(" \
  "false ? h(" \
  "「收回的模型」用例"

mutate "没探测成功也标不提供" lib/client.js \
  "savedModelMissing && models.length > 0;" \
  "savedModelMissing;" \
  "「还没探测成功」用例"

mutate "模型不设上去只靠 --model" lib/index.js \
  "    await session.trySetConfig('model', config.model.trim());" \
  "    // 变异：不设，指望 --model 生效" \
  "「后端忽略 --model」用例"

mutate "改完模型不更新会话当前值" lib/acp.js \
  "        if (sessionConfigOptions?.[configId] !== undefined) sessionConfigOptions[configId] = { ...sessionConfigOptions[configId], currentValue: value };" \
  "        // 变异：不更新缓存" \
  "「后端忽略 --model」用例"

mutate "档位不提交" lib/client.js \
  "onClick: () => { if (entry.value !== value) void patchSettings({ [field]: entry.value }); }," \
  "onClick: () => {}," \
  "「点一下就把档位写进设置」用例"

mutate "没探测也允许点" lib/client.js \
  "disabled: levelLocked(block) || busy === 'settings'," \
  "disabled: busy === 'settings'," \
  "「档位控件禁用」用例"

mutate "档位不传给后端" lib/index.js \
  "    const applied = await session.trySetConfig(configId, wanted);" \
  "    const applied = true;" \
  "「档位也走 set_config_option」用例"

mutate "取消不接线" lib/acp.js \
  "    else signal.addEventListener('abort', onAbort, { once: true });" \
  "    else void 0;" \
  "「取消」用例"

if [ "$FAILED" -ne 0 ]; then
  echo "结论：有变异未被用例发现"
  exit 1
fi
echo "结论：全部变异按预期变红"
