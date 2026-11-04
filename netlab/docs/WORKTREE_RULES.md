# 多工作树与多会话规范（2026-11-04）

> 适用：多个 agent 会话 / 多个人同时改 netlab。仓库根是 `ProjectPoint/NetlabHome`。
> 目的：避免共用一棵工作树时，未提交改动互相覆盖、半套改动被误提交、一次 checkout 删掉别人的文件。

## 为什么

2026-11-03 至 11-04 期间，同一棵工作树里同时存在多个会话的未提交改动（前端、server、PlotKit vendor、文档、测试交叉修改）。
虽然最终没有丢文件，但 `git status` 无法区分归属，提交与回滚都只能人工逐文件判断，风险很高。

## 原则

1. **一个会话 = 一个工作树**：长任务开工前先建独立工作树，不要直接在主工作树上改。
2. **工作树只归一个会话**：不要进入别人的工作树改文件；需要协作时让对方提交后你合并。
3. **不执行 `git reset --hard` / `git checkout -- .` / `git clean`**：主工作树随时可能有别人的半成品。
4. **提交小而完整**：一个提交只做一件事，提交前跑该范围的定向测试；全量测试与文档同步放收尾提交。
5. **合并由 owner 做**：工作树分支合并回 `main` 前，由该分支的 owner 先 rebase 并解决冲突。
6. **工作树不是备份**：高风险改动仍按 `AGENT_GUIDE.md` 备份到 `NetlabExtras/backups/ProjectPoint_backups/` 并生成 `MANIFEST.sha256`。

## 创建

```bash
cd NetlabHome
git status --short          # 有未提交改动 → 先提交或 stash（新工作树只从提交点开始）
bash tools/new_worktree.sh plotkit-auth
cd ../ProjectPoint-worktrees/plotkit-auth   # 工作树根 = NetlabHome 的等价物
python -m pytest netlab/tests -q
```

- 默认路径 `../ProjectPoint-worktrees/<名称>`，分支 `wt/<名称>`，基线默认 `HEAD`；需要从别的提交/分支开始时把基线作为第二个参数。
- 用 `PROJECTPOINT_WORKTREES=<目录>` 可改父目录。
- 并行跑桌面实例时显式指定端口（`python -m netlab.desktop --port 0` 自动选择，或给一个固定值避免冲突）。

## 共享数据

`MyProject/`、`library/`、`extensions/`、`layout.json` 不入库，每个工作树各有一份：

- 需要打开同一个工程时，从主工作树复制过去，**不要两个实例同时写同一份工程文件**。
- `extensions/` 里的个人扩展同理；验证完再合并回主工作树。

## 收尾与清理

```bash
git -C /path/to/NetlabHome worktree list
git -C /path/to/NetlabHome worktree remove ../ProjectPoint-worktrees/<名称>
git -C /path/to/NetlabHome branch -d wt/<名称>
```

删除前确认该工作树已提交或已备份；`git worktree remove` 会拒绝有未提交改动的工作树（除非 `--force`）。
