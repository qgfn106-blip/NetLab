# Netlab 文档体系重构计划（2026-11-06）

> 目标：让读者只读一页就能找到**当前有效**的文档；让架构、数学、操作、扩展四类文档与代码/测试/需求台账一致。
> 本文是执行计划与验收口径，不是新的功能需求；功能需求的单一事实源仍是 [REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md)。

## 1. 当前事实基线

| 项 | 值 |
| --- | --- |
| 静态版本 | 3.19.0 |
| 全量回归 | 581 passed / 3 warnings / 114.21 s（2026-11-06 文档变更后） |
| 需求/决策 | R01–R40 / D1–D99 |
| 已完成主线 | R31 P11-01…P11-07、R39 Complex Bridge、R40 全栈扩展架构设计 |
| 待后续 | R40 代码实现（§14 P0–P6）、R25 完整电路级、R19 参考级图纸 |

## 2. 文档分层

| 层 | 文档 | 读者 | 维护规则 |
| --- | --- | --- | --- |
| 入口 | `README.md` | 第一次接触项目的人 | 只放定位、能力、快速开始、演示、文档导航 |
| 使用 | `OPERATION.md`、`INSTALL.md`、`netlab/docs/user/*` | 使用者 | 每个界面区块配图；快捷键与当前 UI 对齐 |
| 架构 | `ARCHITECTURE.md`、`netlab/docs/ARCHITECTURE.md` | 维护者/集成者 | 分层、数据流、扩展点、失败模式；随代码同步 |
| 数学 | `netlab/docs/MATH.md` | 算法维护者 | 每个公式标注实现位置：文件 + 函数名；不写未实现算法 |
| 开发 | `netlab/docs/CODE_GUIDE.md`、`FRAMEWORK_CHEATSHEET.md`、`MODULES_HOWTO.md` | 贡献者 | 模块/调用链/踩坑；行数只作导航，不手动猜 |
| 扩展 | `netlab/docs/EXTENDING.md`、`EXTENSIBILITY_ARCHITECTURE.md`、`adr/0002-*` | 插件作者 | 稳定门面 `netlab.plugin_api.v1`；旧扩展标 legacy |
| 需求/进度 | `REQUIREMENTS_AND_RULES.md`、`PROGRESS.md`、`BACKLOG.md` | 项目管理者 | 需求六段式；决策 D 编号；证据可追溯 |
| 术语 | `GLOSSARY.md`、`netlab/docs/user/glossary.md` | 所有人 | 同一术语只保留一个定义，用户文档用通俗解释 |
| 历史 | `QT_NATIVE_SPEC.md`、`IMPLEMENTATION_PLAN.md`、`SOLVER_OPTIMIZATION_*`、`docs/specs/*` | 追溯者 | 标注 historical/superseded，不参与当前实现判断 |

完整索引见 [DOCS_INDEX.md](DOCS_INDEX.md)。

## 3. 本轮工作流

| 阶段 | 工作 | 产物 | 验收 |
| --- | --- | --- | --- |
| D0 | 盘点与分层 | `DOCUMENTATION_PLAN.md`、`DOCS_INDEX.md` | 每份 Markdown 有归属/状态 |
| D1 | 架构层 | 根 `ARCHITECTURE.md`、`netlab/docs/ARCHITECTURE.md`、结构图 | 含 frontend/server/core/PlotKit/plugin-api 五层与数据流图 |
| D2 | 数学层 | `netlab/docs/MATH.md` | 新增频域复数层、Padé、abc_dq/PLL/PI、LCL 平均模型、跨域桥、时域指标 |
| D3 | UI/R40 | `UI_SPEC.md`、`EXTENSIBILITY_ARCHITECTURE.md` | iro.js 颜色选择器、视图内设计、`netlab-ui/1` 完整 |
| D4 | 使用层 | `README.md`、`OPERATION.md`、`INSTALL.md`、`user/*` | 至少 3 张演示图；每节可独立操作 |
| D5 | 演示资产 | `docs/assets/*` | 结构图 SVG/PNG、UI 演示图、README 视频与封面 |
| D6 | 台账 | `REQUIREMENTS/PROGRESS/BACKLOG/LESSONS` | R41/D100 登记；备份/测试/推送记录完整 |

## 4. 具体编辑清单

1. **README**：增加 R31/R39/R40 能力摘要、演示视频、结构图、文档导航；保留离线安装入口。
2. **根 ARCHITECTURE**：重写为“五层 + 双域 + 插件/UI 扩展”的短架构；补 Mermaid 结构与运行时数据流。
3. **详细 ARCHITECTURE**：保留现有章节，补 R31 跨域桥、R39 复数层、R40 插件/UI；统一版本与测试数。
4. **MATH**：新增 §12–§17：
   - §12 复数分析层与精确延迟；§13 Padé 有理近似与稳定性边界；
   - §14 Park 变换、SRF-PLL、dq 电流环与 LCL 平均模型；
   - §15 跨域桥的一拍延迟与状态一致性；
   - §16 时域动态性能指标（上升/峰值/超调/调节）；
   - §17 频域/复数 API 的数据契约与数值限制。
5. **UI_SPEC / EXTENSIBILITY**：新增 iro.js 颜色选择器接入说明：离线 vendored、`color` token、HEX/RGB/HSL 格式、实时预览、撤销/重做；颜色值仍落入 `netlab-ui/1` 声明式 token。
6. **OPERATION**：每节配图；至少加入信号流、电路、相图、FEM、AC 频响、插件/UI 设计界面截图或现有资产。
7. **README 视频**：10–15 秒、1920×1080、无语音；展示画布→运行→曲线→FEM/频响→UI 主题色；输出 MP4 + 封面，README 用 `<video>` 或链接。
8. **历史清理**：所有历史文档顶部加 `> 状态：historical/superseded`；不删除原文，不把它们当当前口径。

## 5. 验收命令

```powershell
cd NetlabHome
python -m pytest netlab/tests -q
python -m compileall -q netlab
node --check frontend/app.js
python -m netlab.desktop --selftest
python tools/check_docs.py   # 若尚未创建，先用脚本校验相对链接/资产引用
```

文档验收还要人工检查：

- 每份 active 文档都有标题、适用版本、最后更新时间；
- 相对链接与图片路径全部存在；
- 结构图与 `netlab/core/{compute,model,common}`、`frontend/`、`plotkit_bridge.py`、`plugin_api` 一致；
- 数学公式与 `MATH.md` 的“文件:函数”索引一致；
- README/OPERATION 的演示图不引用历史截图；
- Git 推送后远端 `main` 的 tree 与本地一致。

## 6. 非目标

- 本轮不实现 R40 插件代码；只更新设计、架构、使用文档与演示资产。
- 不改求解器/前端行为；不改 Node/Edge 数据结构。
- 不重写历史 spec 的技术结论；只加历史状态标注与索引。
