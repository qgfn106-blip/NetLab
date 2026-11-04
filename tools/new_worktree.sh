#!/usr/bin/env bash
# 为单个会话/任务创建独立 git 工作树。规范见 netlab/docs/WORKTREE_RULES.md。
set -euo pipefail

usage() {
  echo "用法: bash tools/new_worktree.sh <名称> [基线，默认 HEAD]"
  echo "示例: bash tools/new_worktree.sh plotkit-auth"
}

name="${1:-}"
base="${2:-HEAD}"
if [ -z "$name" ]; then
  usage
  exit 1
fi

repo="$(git rev-parse --show-toplevel)"
parent="${PROJECTPOINT_WORKTREES:-$(dirname "$repo")/ProjectPoint-worktrees}"
path="$parent/$name"
branch="wt/$name"

if [ -e "$path" ]; then
  echo "已存在: $path" >&2
  exit 1
fi
if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
  echo "分支已存在: $branch" >&2
  exit 1
fi

if [ -n "$(git -C "$repo" status --porcelain)" ]; then
  echo "注意：当前工作树有未提交改动，它们不会带进新工作树。"
  echo "      请先提交（或 git stash），否则新工作树从 $base 开始、与当前改动分叉。"
fi

mkdir -p "$parent"
git -C "$repo" worktree add -b "$branch" "$path" "$base"

echo "已创建: $path（分支 $branch）"
echo "下一步:"
echo "  cd \"$path\" && python -m pytest netlab/tests -q"
echo "  python -m netlab.desktop --port 0   # 并行实例建议显式 --port"
