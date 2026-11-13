# NetLab GitHub 贡献规范与隐私安全门禁

**面向 Agent、开发者与维护者的统一工作规程**

文档版本：v1.0

基准日期：2026-11-13

适用仓库：https://github.com/qgfn106-blip/NetLab

文档定位：可直接交给 Agent 执行的项目级提示词，同时作为 NetLab GitHub 贡献与提交安全规范的草案。

> **最高优先级** 本地开发不等于远程上传授权。Agent 可以在授权边界内分析、修改和测试项目，但默认不得持有 GitHub 写入凭证，不得自行 Push、Merge 或通过其他渠道上传文件。


## 0. Agent 执行摘要（先读本节）

每次开发任务必须遵循“限定工作区 → 独立分支 → 明确文件清单 → 暂存区扫描 → 本地验证 → 提交审批 → 推送审批 → PR 审查”的流程。任何检查失败、无法验证或文件来源不明，都必须停止。

| 事项 | 默认规则 |

| --- | --- |

| 工作区 | 只在用户授权的 NetLab 仓库和指定文件范围内操作；不得扫描仓库外私人目录。 |

| GitHub 权限 | Agent 默认只读；不向 Agent 提供 SSH 私钥、PAT、OAuth Token 或可写 Git Credential。 |

| 文件添加 | 禁止全量添加；只允许按审查通过的明确路径逐个暂存。 |

| 敏感信息 | 密钥、账号、私人数据、浏览器数据、本地配置和未经脱敏的日志默认禁止上传。 |

| 自动防护 | 使用 .gitignore、本地 excludes、Pre-commit、Pre-push 和本地 Secret Scanner。 |

| Commit | 先扫描暂存区并生成报告；只有本次范围获得明确批准后才能本地 Commit。 |

| Push | 默认由用户本人执行；Agent 不得使用用户本机已有凭证代替用户推送。 |

| Contribution | 功能/修复使用独立分支和 PR；main 不直接开发、不强推、不绕过检查。 |

| 项目治理 | 遵循 NetLab 阶段审批、ADR 和 FEM 冻结要求；CI 通过不等于架构验收。 |



## 1. 目标、适用范围与安全边界

本规范覆盖本地文件读取、代码修改、暂存、Commit、Push、Pull Request、GitHub API、Git LFS、Release、Issue、Actions Artifact 和其他远程上传通道。它同时规定 NetLab 的贡献流程、代码评审和分支治理。

本规范是 Agent 行为约束和仓库治理建议，不是操作系统安全隔离本身。提示词和 Git Hook 都可能被具有足够权限的程序绕过，因此必须优先从权限、凭证和工作区隔离入手。

> **安全原则** 不确定时默认不上传；无法完成检查时标记 NOT VERIFIED；NOT VERIFIED 不得当作 PASS。


## 2. 权限隔离：最重要的技术防线

### 2.1 Agent 默认权限

- 允许：读取已授权的 NetLab 项目文件、修改已授权范围内的项目文件、运行本地测试、查看必要的 Git 状态、创建获准的本地工作分支、生成审查报告。

- 禁止：扫描整个 Windows 用户目录；读取桌面、下载、文档、OneDrive、浏览器配置、其他项目目录或用户级 Agent 配置。

- 禁止：获取或读取 SSH 私钥、GitHub Token、浏览器登录信息、Git Credential Manager 凭证、云平台凭证及其他认证秘密。

- 禁止：未经授权通过 GitHub API、Gist、Release、Actions Artifact、Git LFS 或第三方网盘上传任何文件。

- 发现仓库外符号链接、未知挂载点或不属于当前任务的文件时，停止读取其内容并报告。



### 2.2 GitHub 权限

| 主体 | 推荐权限 | 限制 |

| --- | --- | --- |

| 用户本人 | 仓库管理、写入、Push、Merge | 保留最终远程发布决策权。 |

| Agent | 只读仓库权限 | 不持有 Contents: write、PAT、SSH 私钥或可复用写入凭证。 |

| CI 工作流 | 按任务最小权限 | GITHUB_TOKEN 默认只读；需要写入时逐个 Job 明确授权。 |

| 第三方工具 | 默认无写入权限 | 仅在有明确需求时提供最小范围、短期凭证。 |



推荐做法是 Agent 只完成本地开发、测试和提交准备；用户本人完成 Push 与 Merge。若用户确需临时委托写入，应使用单仓库、最小权限、短有效期的凭证，并在任务结束后撤销；不得把该例外变成 Agent 的永久权限。

### 2.3 本机环境隔离

- 优先使用独立工作区、受限容器或专用操作系统账户运行 Agent。

- 只挂载 NetLab 仓库及确需使用的只读依赖目录；不挂载用户文档、桌面、浏览器、SSH 和其他项目目录。

- 不向 Agent 暴露用户级环境变量中的密钥，不共享含认证信息的配置目录。

- 如果 Agent 在用户桌面会话中拥有完整文件与凭证访问权，必须如实标记为“权限隔离未完成”，不能声称仅靠提示词已实现安全保证。



## 3. 禁止上传的数据与文件分类

### 3.1 绝对禁止：凭证和认证秘密

- 真实 API Key、GitHub Token、PAT、OAuth Token、Access Token、Refresh Token、密码、认证 Header 和含凭证的 URL。

- SSH/TLS 私钥、云服务凭证、数据库密码、真实连接字符串、证书私钥、PFX/P12/JKS/Keystore。

- 包含真实凭证的 .env、.npmrc、.pypirc、.netrc、.git-credentials、credentials*、secrets*、token*、auth* 等文件。

- 模板文件（如 .env.example）也必须检查，不能因文件名含 example 就自动放行。



```text
# 高风险文件名/模式示例（按实际项目结构调整）
.env
.env.*
!.env.example
.npmrc
.pypirc
.netrc
.git-credentials
id_rsa
id_ed25519
*.pem
*.key
*.p12
*.pfx
*.jks
```

### 3.2 绝对禁止：个人和本地软件数据

- 私人姓名、电话、邮箱、住址、证件、财务数据、私人聊天和邮件、私人照片、个人账号标识。

- 浏览器 Cookies、Login Data、Web Data、History、Local State、缓存、Local Storage、Session Storage 和扩展数据。

- 本地 Agent 会话、工具认证配置、用户级 IDE 配置、API 调用历史及其他项目的工作区状态。

- 本地路径中包含的用户名、私人目录名、机器名、网络共享位置或其他环境标识；确需记录时必须先脱敏。



```text
# 本地 Agent / 用户配置目录示例
.dsh/
.codex/
.config/
.ssh/
.aws/
.azure/
.kube/
.gnupg/

```

### 3.3 默认阻止：运行数据与未知二进制

- 日志、缓存、临时文件、崩溃转储、数据库、真实用户数据集、私有训练数据、模型权重和本地运行结果。

- 未经审查的 ZIP/7z/RAR、图片、截图、PDF、Office、数据库、MAT/NPY/NPZ/Parquet、模型文件和大文件。

- 二进制文件不能仅凭扩展名放行；必须核实来源、用途、内部内容、元数据、文件大小和许可证。



可提交内容的默认范围是：明确属于 NetLab 的源代码、测试代码、脱敏测试夹具、必要项目文档、经审查的配置模板和 CI 配置。任何超出此范围的文件都应进入人工审核。

## 4. 仓库边界与本地文件保护

1. 操作前确认仓库根目录、当前分支和当前任务授权范围。

2. 只读取完成当前任务必需的文件，不做全盘扫描或无目的目录枚举。

3. 禁止递归跟随指向仓库外部的符号链接；发现时报告链接路径，不读取目标内容。

4. 不复制桌面、下载、文档、OneDrive 或其他项目中的文件进入 NetLab。

5. 不因文件被 Git 跟踪而推断其允许上传；跟踪状态不构成授权。

6. 不得为清理隐私数据而擅自删除用户文件；优先只从索引/暂存区移除，并保留工作区原件。



## 5. 第一层技术防护：.gitignore 与本地排除规则

先检查现有 .gitignore、.git/info/exclude 和 tracked files，再提出最小修改。不得覆盖现有规则，也不得将以下示例不加判断地全部粘贴进去。

```text
# 候选规则：必须结合 NetLab 实际目录审查
# Local secrets
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
*.jks
.git-credentials

# Local Agent configuration (only if these can appear inside the repo)
.dsh/
.codex/

# Python environments and caches
.venv/
venv/
__pycache__/
*.py[cod]
.pytest_cache/
.mypy_cache/
.ruff_cache/
.cache/

# Local runtime data
*.log
*.tmp
*.sqlite
*.sqlite3

# Local test/build outputs (verify project-specific paths first)
.coverage
htmlcov/

```

机器专属隐私文件优先放入 .git/info/exclude；该文件通常不提交到仓库。全局 excludes 只允许在用户明确授权后配置。

> **关键限制** .gitignore 不会自动取消已跟踪文件。若发现已跟踪的敏感文件，先阻止后续提交并报告；只有得到授权后，才可对明确路径执行 git rm --cached。


```text
# 仅在用户明确批准后，对单个路径取消 Git 跟踪：
git rm --cached -- <明确的文件路径>
```

## 6. 第二层技术防护：Pre-commit / Pre-push Hooks

### 6.1 Pre-commit 必须检查什么

- 读取 Git 暂存区中的真实 Blob 内容，而不是只扫描工作区当前文件。

- 检查路径、文件类型、大小、符号链接、敏感内容、私人路径、二进制元数据和未知文件。

- 若发现高风险内容、扫描器报错或结果无法判定，拒绝 Commit。

- 输出必须脱敏，只报告路径、风险类型和检测规则编号，不输出完整密钥或私人数据。



### 6.2 Pre-push 必须检查什么

- 检查即将推送的全部提交范围，而非只检查最新一次提交。

- 检查每个提交中的文件路径、内容变化、历史中新增的秘密，以及 Git LFS 实际对象。

- 确认目标远程、分支和提交范围；不能确定基准分支或推送范围时拒绝 Push。

- 即使用户默认亲自 Push，也保留 Pre-push Hook，作为防止误操作的最后一道本地防线。



### 6.3 Hook 部署和绕过规则

```text
# 推荐的仓库内结构
.githooks/
    pre-commit
    pre-push

# 安装到当前本地仓库（须经用户批准）
git config --local core.hooksPath .githooks
```

- Hook 必须经过代码审查，并通过“测试秘密应阻断、正常项目文件应通过”的本地测试。测试秘密必须是虚构值。

- Agent 禁止使用 --no-verify、HUSKY=0、SKIP 等方式绕过 Hook；也不得擅自修改 Hook 以放宽规则。

- Git Hook 可被本地有权限的程序绕过，不能替代权限隔离和用户审批。

- Hook 在每个工作区都需要单独验证；不能因为仓库中存在 .githooks 就声称所有克隆已安装。



## 7. 第三层技术防护：本地 Secret Scanner 与隐私检查

推荐评估 Gitleaks 或 detect-secrets 等本地工具。具体版本和命令参数必须先在当前环境核实，不能假设不同版本 CLI 完全一致。优先扫描暂存区和待推送历史。

- Secret Scanner 用于识别常见密钥、Token、密码和凭证模式；它不能完整识别个人隐私、文件元数据或业务数据泄漏。

- 另行检查邮箱、电话、用户目录路径、用户名、机器名、内部服务器地址、私人目录名和真实测试数据。

- 图片检查 EXIF/GPS；PDF 检查作者和元数据；Office 检查作者、修订记录、隐藏内容和嵌入对象；压缩包检查内部清单和内容。

- 不允许把项目文件发送到在线第三方扫描服务；所有扫描优先在本地完成。

- 扫描器缺失、崩溃、超时或无法访问暂存 Blob 时，必须标记 NOT VERIFIED 并阻止提交。

- 误报只能逐项确认和记录，不得通过关闭全局扫描规则解决。



## 8. Git 命令安全规则

### 8.1 禁止默认使用的批量/破坏性命令

```text
# 未经明确授权不得执行
# 批量暂存 / 强制添加
git add .
git add -A
git add --all
git add -f
git commit -a

# 强推 / 删除 / 清空 / 覆盖工作区
git push --force
git push -f
git clean -fd
git clean -fdx
git reset --hard
git checkout -- .
git restore .
```

上述命令不是所有场景下都不合法，而是默认不允许 Agent 在未审查范围时使用。尤其不得为了清理工作区而删除用户本地文件。

### 8.2 推荐检查命令

```text
git status --short --branch
git branch --show-current
git diff --name-status
git diff --cached --name-status
git diff --cached --check
git ls-files --others --exclude-standard
```

检查结果可能包含个人目录名或敏感文件名。报告必须脱敏，不得把原始输出无差别粘贴到远程 Issue、PR 或 Agent 外部日志。

### 8.3 逐文件暂存

```text
# 只添加已经进入本次批准白名单的明确文件
git add -- path/to/file_a path/to/file_b

# 暂存后重新审查
git diff --cached --name-status
git diff --cached --check
```

暂存区文件列表必须与本次审查白名单完全一致。若文件清单改变、出现额外路径或暂存内容发生变化，必须重新检查。

## 9. Commit 前隐私门禁

1. 核实仓库路径、分支、HEAD、工作区状态和本次任务授权范围。

2. 分别列出已修改、已暂存、未跟踪、删除、重命名和二进制文件；不得将其他 Agent 的变更纳入本次提交。

3. 逐个确定文件用途、来源、是否属于项目交付，以及是否包含敏感信息。

4. 检查暂存区 Blob 的实际内容，运行本地 Secret Scanner 和隐私检查。

5. 检查图片、PDF、Office、压缩包、数据库、模型文件和 Git LFS 对象。

6. 形成提交白名单，并确认暂存区与白名单完全一致。

7. 检查 Git 作者/提交者身份。不得未经用户确认将私人邮箱、真实姓名或其他身份信息公开到提交元数据；必要时由用户配置已验证的 GitHub noreply 邮箱。不得擅自修改全局 Git 身份配置。

8. 生成安全审查报告，等待用户对本次分支、文件清单和操作明确批准。



> **Commit 授权规则** 本地 Commit 也会将内容写入 Git 历史，因此仍需审批。批准仅针对本次明确列出的文件、当前分支和当前提交范围；任一内容变化都必须重新审查。


## 10. Push 与其他远程上传门禁

### 10.1 默认由用户本人 Push

Agent 默认不持有 GitHub 写入凭证，也不调用用户现有 SSH/GCM 认证能力。Agent 可以提供待推送提交清单和报告；用户本人在确认后执行 Push。

### 10.2 Push 前必须重新检查

- 目标仓库、目标分支、当前 HEAD 和待推送提交列表。

- 从远程基准到 HEAD 的所有提交和文件差异，不得只检查最后一个提交。

- 完整提交历史中的新增秘密、二进制对象、Git LFS 对象和大文件。

- 远程 URL 必须脱敏；不得把含用户名、密码或 Token 的 remote URL 输出到报告。

- 待推送范围无法确认、历史检查未完成或扫描失败时，禁止 Push。



### 10.3 禁止绕过 Git Push 的其他上传方式

- 未经授权不得使用 GitHub API、Gist、Release 附件、Actions Artifact、GitHub Pages、PR 附件或其他网盘上传项目文件。

- 不得将完整环境变量、配置文件、认证信息、私人测试数据写入 CI 日志或 Artifact。

- 不得利用 Git LFS、压缩包或改扩展名规避文件审查。

- 任何第三方服务扫描、托管或传输项目文件都必须获得用户明确授权。



## 11. GitHub Contribution 规范（NetLab 项目规则）

GitHub 并没有强制所有仓库采用同一种分支命名或 Commit 前缀。以下内容是 NetLab 推荐采用的仓库级贡献规范，参考 GitHub 官方 GitHub Flow、贡献指南、PR、分支保护和 CODEOWNERS 文档制定。

### 11.1 推荐的仓库社区文件

| 文件/目录 | 目的 | NetLab 建议 |

| --- | --- | --- |

| README.md | 项目介绍、安装、使用和入口导航 | 保持准确；不要写入私人环境信息。 |

| LICENSE | 明确项目授权 | 必须由仓库所有者确认许可证，Agent 不得自行选择。 |

| CONTRIBUTING.md | 贡献流程与开发要求 | 建议放仓库根目录，作为贡献者入口。 |

| CODE_OF_CONDUCT.md | 社区行为规范 | 项目公开接受外部贡献时建议提供。 |

| SECURITY.md | 漏洞报告与支持版本 | 明确安全问题的私下报告渠道；不要求在公开 Issue 暴露漏洞。 |

| .github/ISSUE_TEMPLATE/ | Issue 模板 | 至少规范 Bug、功能建议和安全问题的处理入口。 |

| .github/PULL_REQUEST_TEMPLATE.md | PR 模板 | 要求说明变更、测试、风险和隐私检查。 |

| .github/CODEOWNERS | 代码归属与评审请求 | 对计算核心、文件格式、插件权限、工作流等高风险目录指定维护者。 |

| .github/workflows/ | CI 工作流 | 最小权限、固定 Actions 来源/版本策略、避免打印秘密。 |



GitHub 可以从仓库根目录、docs 或 .github 目录读取 CONTRIBUTING 指南；若存在多份同名指南，GitHub 有自己的展示优先级。NetLab 建议只维护一份根目录 CONTRIBUTING.md，避免版本分叉。[1]

### 11.2 Issue 贡献规范

- 开始工作前先搜索现有 Issue 和 PR，避免重复问题或重复实现。

- Bug Issue 必须提供 NetLab 版本/Commit、操作系统与 Python 环境、复现步骤、预期结果、实际结果和经过脱敏的最小日志。

- 功能建议应说明使用场景、问题、目标、非目标、兼容性影响和验收标准。

- 禁止在公开 Issue 中粘贴 API Key、用户数据、完整配置、日志原文或可利用的未披露安全漏洞。

- 涉及安全漏洞时优先按照 SECURITY.md 的私下披露渠道处理。



### 11.3 分支规范

所有开发任务都从最新 main 的明确基线创建独立分支。分支名应简短、可识别、对应单一任务。

```text
feat/<short-topic>       # 新功能
fix/<short-topic>        # 缺陷修复
docs/<short-topic>       # 文档
test/<short-topic>       # 测试
refactor/<short-topic>   # 重构
perf/<short-topic>       # 性能优化
security/<short-topic>  # 安全修复
build/<short-topic>      # 构建/依赖/工具链

```

- 禁止直接在 main 上进行开发提交。

- 一个分支只承载一个主要目标；不相关修复应拆分。

- 不得未经批准把多个整改分支批量合并。

- 不得 force-push、重写公共分支历史或删除其他 Agent 的分支。

- 需要集成多个已批准修复时，从最新 main 新建 integration/* 分支，逐项集成并验证。



该工作方式与 GitHub Flow 的核心做法一致：用分支隔离工作，通过 PR 讨论、评审和合并，而不是直接修改默认分支。[2, 3]

### 11.4 Commit message 规范

NetLab 推荐使用 Conventional Commits 风格，作为项目约定，而不是声称这是 GitHub 强制标准。标题应简短、清楚、使用祈使式表达，描述变更而不是个人感受。

```text
<type>(<scope>): <imperative summary>

[可选正文：说明原因、方案、影响和迁移注意事项]
[可选脚注：Refs #123 / Closes #123]

示例：
fix(graph): prevent repeated stateful edge evaluation
test(solver): cover state-space breakpoint recurrence
docs(security): add staged-content review policy
refactor(project): isolate runtime checkpoint restoration
```

| type | 用途 |

| --- | --- |

| feat | 新增功能 |

| fix | 缺陷修复 |

| docs | 文档 |

| test | 测试 |

| refactor | 重构且不改变外部功能 |

| perf | 性能优化 |

| build | 构建、依赖或工具链 |

| ci | CI 工作流 |

| chore | 维护性任务 |

| security | 安全修复 |



- 一个 Commit 尽量只包含一个逻辑完整、可单独理解和回滚的变更。

- 避免“update”“fix bug”“misc”等不可追溯标题。

- Commit message、作者字段和提交正文不得包含真实密钥、私人邮箱、个人路径或聊天内容。

- 需要关联 Issue 时使用准确编号；只有 PR 确实完成该 Issue 时才使用 Closes #N。



GitHub 官方文档建议提交保持小而聚焦、消息清晰且具有描述性；NetLab 的具体 type/scope 约定由本规范定义。[3]

### 11.5 Pull Request 规范

所有进入 main 的修改必须通过 PR。PR 应保持单一主题、可审查、可测试；较大的工作拆成有依赖关系的多个 PR 或集成 PR。

```text
PR 标题：<type>(<scope>): <summary>

PR 正文至少包含：
1. 背景 / 问题
2. 本次变更
3. 设计理由与非目标
4. 测试命令及真实结果
5. 兼容性、迁移与回滚影响
6. 风险与未解决事项
7. 相关 Issue / ADR / 阶段任务
8. 隐私与安全检查结论

Checklist：
- [ ] 变更范围符合授权
- [ ] 没有无关文件或本地隐私文件
- [ ] 新增/修改逻辑有对应测试
- [ ] 相关测试和 CI 已完成
- [ ] 文档与行为一致
- [ ] 未弱化测试门槛或绕过检查
- [ ] 无秘密、个人数据或未经批准的二进制文件
```

- 未完成的工作使用 Draft PR；准备评审后再标记 Ready for review。

- PR 必须解释为什么修改、修改了什么、如何验证、有哪些风险。不能只写“完成修复”。

- 评审意见必须逐条回应；新增 Commit 后需重新检查对应 CI 和变更差异。

- 审批后如果又推送了新的实质性变更，必须重新确认评审有效性。

- PR 不得附带本地日志、私人截图、真实配置或敏感数据。



GitHub 支持 PR 模板帮助贡献者提供背景、关联 Issue、测试结果和 Checklist；NetLab 应使用模板固定这些信息。[4]

### 11.6 Code Review 与 Merge 规则

- 作者先完成自审：检查完整 diff、误改、调试代码、无用文件、测试覆盖和文档一致性。

- 审查者重点检查正确性、边界条件、数据安全、向后兼容、异常处理和是否超出授权范围。

- 核心计算、项目持久化/迁移、插件权限、Runtime、CI/发布工作流等高风险变更必须由维护者重点审查。

- 不得用 CI 通过代替人工审查；不得通过删除测试、放宽断言或增加跳过来制造绿色 CI。

- 合并前解决所有阻断性 Review conversation，并确认所需 CI 状态通过。



### 11.7 GitHub main 保护建议

| 设置 | 推荐策略 |

| --- | --- |

| Require pull request | main 必须通过 PR 更新；禁止日常直接 Push。 |

| Required status checks | 要求当前有效的 test、desktop-l2、build、e2e-l1、docker 等检查；配置前先核实 GitHub 实际检查名。 |

| Required approvals | 有独立协作者时建议至少 1 个有效审批；单人维护场景不能伪造独立审批，应由维护者进行正式自审并保留限制说明。 |

| Dismiss stale approvals | 重要代码变更后要求重新审查，防止审批后追加未审内容。 |

| Require conversation resolution | 合并前解决 Review 对话。 |

| Restrict force pushes/deletions | 禁止对 main 强推和删除。 |

| Restrict bypass | 尽可能禁止绕过规则；管理员例外应最少化并可追溯。 |

| Code Owner review | 对配置的高风险目录要求 CODEOWNER 审批。 |



GitHub 的 Branch Protection / Rulesets 可要求 PR 审批、状态检查、对话解决、Code Owner 审查，并限制强推或删除。实际可用功能取决于仓库类型和账户计划，必须在仓库 Settings 中核实。[5, 6]

### 11.8 CODEOWNERS 建议

```text
# 示例：必须替换为真实维护者账号，不能虚构账号
/.github/                         @<repo-owner>
/.github/workflows/               @<repo-owner>
/netlab/core/compute/             @<solver-maintainer>
/netlab/core/graph/               @<graph-maintainer>
/netlab/project/                  @<persistence-maintainer>
/netlab/plugin_api/               @<plugin-maintainer>

```

CODEOWNERS 中的账号必须是实际存在且具备相应仓库权限的用户或团队。将 CODEOWNERS 文件本身也纳入所有者保护，避免未经审查修改审查规则。[6]

### 11.9 依赖和第三方代码贡献规范

- 新增运行时依赖必须说明必要性、替代方案、维护状态、许可证和安全影响。

- 不得提交未知来源的二进制、闭源组件或未经许可的第三方代码。

- 依赖升级应使用独立分支/PR，附版本变化和测试结果。

- 不得为了方便关闭依赖安全告警；无法修复时必须记录影响和风险接受依据。

- 锁文件必须与项目实际包管理工具一致，不能包含认证 Token 或私人包源凭证。



## 12. NetLab 项目特有的贡献边界

通用 GitHub 规范不能覆盖 NetLab 自身的项目审批制度。所有贡献还必须遵守当前有效的项目计划、ADR 和阶段授权。

- 以最新 main、当前项目执行计划和用户最近一次明确授权为准；每次任务开始前重新核实，不得沿用过期 HEAD 或旧状态报告。

- 生产代码修改在独立 fix/*、feat/* 等分支进行；不得直接修改 main。多项修改需要集成时，先逐项审查，再在 integration/* 分支集成。

- 严格遵守项目阶段顺序与审批门禁；已接受 ADR 决策不等于相关功能的生产实施已经获批。

- Stage 6 及后续阶段、P0-2 全链路迁移等事项，只有在当前项目计划和用户明确授权允许时才可实施。

- FEM 硬冻结：不得修改 FEM 生产代码、数据模型、文件格式、测试或产品功能；不得以重构、统一接口或迁移为名绕过冻结。

- 不能因为整改分支 CI 通过就直接合并；必须检查语义正确性、真实执行路径、集成测试、历史范围和用户授权。

- 不重写公共分支历史，不强制推送，不覆盖其他 Agent/并行会话的工作。



## 13. GitHub 安全治理功能建议

| 功能 | 建议 | 注意事项 |

| --- | --- | --- |

| Secret scanning / Push protection | 在当前仓库类型和计划支持时开启。 | 确认覆盖范围和告警接收人；不能替代本地扫描。 |

| Dependabot alerts | 开启依赖漏洞告警。 | 按实际依赖和升级风险处理，不盲目自动合并。 |

| Rulesets / Branch protection | 保护 main，强制 PR、检查和审查。 | 检查管理员 bypass 权限与实际生效规则。 |

| CODEOWNERS | 为核心代码和安全配置指定负责人。 | 账号/团队必须真实有效；保护 CODEOWNERS 自身。 |

| SECURITY.md | 写明受支持版本和私下报告漏洞的方式。 | 不要将未披露漏洞细节放入公开 Issue。 |

| Private vulnerability reporting | 若仓库类型和账户功能支持，建议开启。 | 先核实可用性；否则在 SECURITY.md 中提供安全联系流程。 |

| Actions permissions | 默认只读，逐 Job 最小授权。 | 禁止日志输出环境变量或凭证。 |



GitHub 官方建议使用 README、许可证、贡献指南和行为规范明确仓库预期，并使用仓库安全功能保护代码。漏洞报告可通过 SECURITY.md 指引；公开仓库若支持，可启用 Private vulnerability reporting。[7, 8, 9]

## 14. 泄露事件的处置规则

| 发现位置 | 必须采取的动作 |

| --- | --- |

| 仅在工作区 | 阻止暂存和提交；保留原文件；必要时在本地忽略；不擅自删除。 |

| 已暂存但未 Commit | 阻止 Commit；仅在授权后对明确路径执行 restore --staged；保留工作区文件。 |

| 已本地 Commit、未 Push | 阻止 Push；报告提交和风险；未经授权不改写历史。 |

| 已 Push 到远程 | 立即报告；优先吊销/轮换凭证；评估影响；经授权再清理历史和检查 Fork、Release、Artifact、缓存。 |



删除当前文件不等于清除 Git 历史。若真实密钥已公开，优先使凭证失效并轮换；不能只靠改写提交历史解决。不得未经授权执行 git filter-repo、强制推送或历史重写。

## 15. 多 Agent 与并行工作区规则

- 每次提交必须确认修改来源和所属任务。

- 不得暂存其他 Agent、子会话或用户未授权的变更。

- 不得覆盖其他会话正在维护的文档或配置。

- 共享工作区出现来源不明文件、变更或暂存内容时，必须暂停提交。

- 审查后文件再发生变化，必须重新扫描和审批。

- 不得把“都属于 NetLab”作为合并不同任务变更的理由。



## 16. 安全审查报告与放行状态

### 16.1 统一报告模板

```text
NetLab Git 安全审查报告

Repository: <脱敏后的 owner/repo>
Branch: <当前分支>
HEAD: <SHA>
Target: COMMIT / PUSH / PR
Review scope: <本次提交或推送范围>

文件清单：
- <path> | 新增/修改/删除 | 项目用途 | 允许/禁止/待审查

安全检查：
- 仓库边界：PASS / FAIL / NOT VERIFIED
- 文件来源：PASS / FAIL / NOT VERIFIED
- 暂存区内容：PASS / FAIL / NOT VERIFIED
- Secret Scan：PASS / FAIL / NOT VERIFIED
- 个人信息/本地路径：PASS / FAIL / NOT VERIFIED
- 二进制/元数据：PASS / FAIL / NOT VERIFIED / N/A
- Git LFS：PASS / FAIL / NOT VERIFIED / N/A
- 提交历史：PASS / FAIL / NOT VERIFIED
- 远程目标：PASS / FAIL / NOT VERIFIED

风险摘要：只报告路径、风险类型和建议，不输出敏感值。
结论：PASS / BLOCKED / NOT VERIFIED / NEEDS REVIEW
```

### 16.2 放行状态定义

| 状态 | 含义 | 允许的下一步 |

| --- | --- | --- |

| PASS | 全部适用检查已完成，未发现未处置风险。 | 可以申请本次操作的用户授权；PASS 本身不是授权。 |

| BLOCKED | 发现明确的隐私、凭证、范围或完整性风险。 | 停止 Commit/Push；先处理风险。 |

| NOT VERIFIED | 检查未执行、失败或结果不确定。 | 不得放行；补齐检查或保持阻断。 |

| NEEDS REVIEW | 存在需用户判断的文件、数据或范围。 | 等待用户明确判断；不得自行推断。 |



## 17. 分阶段落地计划（先保护，再自动化）

| 优先级 | 工作 | 验收标准 |

| --- | --- | --- |

| P0：权限先行 | 撤销/避免 Agent 的 GitHub 写入凭证；确认 Agent 不可访问 SSH/GCM 等本机认证；为 Agent 设置受限工作区。 | Agent 只能读远程仓库；不能自行 Push；仓库外私人目录不可访问或至少未挂载。 |

| P1：现状审计 | 只读检查 .gitignore、跟踪文件、远程目标、Hooks、Secret Scanner、LFS、Actions 权限和 main 保护。 | 形成脱敏风险报告；不读取仓库外私人文件，不修改仓库。 |

| P2：本地文件防护 | 经用户批准，最小化更新 .gitignore、.git/info/exclude；清理跟踪规则但保留用户文件。 | 未知本地文件默认不会进入候选提交；已跟踪敏感文件得到单独处置。 |

| P3：自动门禁 | 经用户批准建立并安装 Pre-commit / Pre-push；使用本地 Secret Scanner。 | 虚构秘密测试会阻断；正常项目文件通过；扫描器失败即阻断；输出脱敏。 |

| P4：GitHub 治理 | 配置 main Ruleset/Branch Protection、PR 模板、CODEOWNERS、SECURITY.md、Secret scanning / Push protection（若支持）。 | main 不可直接改写；PR、检查和审查要求生效；高风险文件有明确所有者。 |

| P5：贡献文档 | 完善根目录 CONTRIBUTING.md、Issue/PR 模板及项目贡献约定。 | 新贡献者能按文档创建分支、提交、测试和 PR；不会误将私密数据公开。 |

| P6：端到端验收 | 用虚构密钥、模拟隐私路径、可疑二进制、历史提交和正常变更做门禁测试。 | 所有阻断路径有效；正常流程可用；绕过风险有清晰记录。 |



实施顺序不可倒置：先限制 Agent 权限，再做文件规则和扫描器，最后配置远程治理。不能先给 Agent 写权限再依赖提示词保护。

## 18. 本轮 Agent 初始化指令（必须先只读执行）

> **本轮任务模式** 只读审计与方案设计。未经用户批准，不得修改仓库、Git 配置或 GitHub 设置，不得 Commit、Push、Merge 或上传文件。


1. 确认实际 NetLab 仓库根目录、当前分支、HEAD 和工作区状态；远程 URL 只允许脱敏显示。

2. 检查现有 .gitignore、.git/info/exclude、已跟踪文件类型、符号链接和 Git LFS 配置；不得读取仓库外目标。

3. 检查本地 Hook 是否存在、core.hooksPath 当前值、Secret Scanner 是否安装及其版本；只读查询，不自动安装。

4. 在可见权限范围内检查 GitHub 仓库 Actions 默认权限、main 保护/Rulesets、PR 模板、CODEOWNERS、SECURITY.md、Secret scanning 与 Push protection 状态。不能查看的项目标记 NOT VERIFIED。

5. 对仓库当前跟踪文件及 Git 历史执行本地、脱敏的秘密风险审计；不把发现的敏感值写入日志或报告。若扫描工具缺失，明确报告未完成。

6. 结合 NetLab 的真实目录结构，提出最小化 .gitignore、Hooks、Scanner、GitHub 设置和 CONTRIBUTING 内容方案。

7. 报告当前 Agent 是否具备 GitHub 写权限，是否能访问本机凭证，以及这些权限如何收敛。

8. 输出风险清单、改造计划、验收测试和需要用户批准的事项，然后停止。



## 19. 最终强制规则

1. 本地开发和远程上传严格分离；本地文件不因处于仓库内而获得上传资格。

2. Agent 默认没有 GitHub 写入凭证；用户本人负责 Push 和 Merge。

3. Commit 前扫描暂存区真实内容；Push 前检查完整待推送历史和 LFS 对象。

4. .gitignore、Hook、Scanner、权限隔离和人工审批必须组合使用，不能依赖单一措施。

5. Commit、Push、Merge 分开授权；任何授权只对本次明确范围生效。

6. 不确定、未验证、扫描失败或文件来源不明时，一律停止。

7. 禁止使用 --no-verify、强制添加、强制推送、历史重写或其他方式绕过安全门禁。

8. 遵循 GitHub Contribution 流程和 NetLab 阶段治理；任何 CI 绿灯都不能替代审查、验收和用户授权。



> **最终原则** Agent 可以在授权范围内开发 NetLab，但不能自行决定将哪些本地信息上传到 GitHub。用户的本地隐私、认证凭证和数据安全优先于开发进度、自动化效率与 CI 结果。


## 20. 官方参考资料

以下链接用于说明 GitHub 平台现有功能和通用工作流。NetLab 的具体分支命名、Conventional Commits 类型、审批门禁和权限策略是本项目自行制定的规则，不应误称为 GitHub 全站强制标准。资料核查日期：2026-11-13。

- [1] GitHub Docs — Setting guidelines for repository contributors: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors

- [2] GitHub Docs — GitHub flow: https://docs.github.com/en/get-started/using-github/github-flow

- [3] GitHub Docs — Writing code for a project: https://docs.github.com/en/pull-requests/concepts/writing-code-for-a-project

- [4] GitHub Docs — Managing and standardizing pull requests: https://docs.github.com/en/pull-requests/reference/managing-and-standardizing-pull-requests

- [5] GitHub Docs — About protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

- [6] GitHub Docs — About code owners: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners

- [7] GitHub Docs — Best practices for repositories: https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories

- [8] GitHub Docs — Adding a security policy to your repository: https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/add-security-policy

- [9] GitHub Docs — Coordinated disclosure of security vulnerabilities: https://docs.github.com/en/code-security/concepts/vulnerability-reporting-and-management/coordinated-disclosure

- [10] GitHub Docs — Quickstart for securing your repository: https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository
