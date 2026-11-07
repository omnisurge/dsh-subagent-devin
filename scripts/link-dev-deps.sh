#!/bin/sh
# 开发期把官方运行时包挂到本仓 node_modules，只为本地跑测试与语法检查。
# 安装到 profile 后由宿主安装目录解析这些包，不需要本脚本。发布产物不含 node_modules。
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROFILE_NM=${PROFILE_NM:-$HOME/.dsh/profiles/desktop/node_modules}
mkdir -p "$ROOT/node_modules/@deepseek-ai"
for pkg in schemastery; do
  if [ -d "$PROFILE_NM/@deepseek-ai/$pkg" ]; then
    ln -sfn "$PROFILE_NM/@deepseek-ai/$pkg" "$ROOT/node_modules/@deepseek-ai/$pkg"
    echo "linked @deepseek-ai/$pkg"
  else
    echo "missing $PROFILE_NM/@deepseek-ai/$pkg" >&2
    exit 1
  fi
done
