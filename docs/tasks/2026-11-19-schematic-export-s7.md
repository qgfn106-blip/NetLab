# 任务卡：Schematic Export S7

- 任务名称：原理图导出 S7 参考图、结构 oracle、Playwright E2E 与人工签收
- 希望解决的问题：复杂场景缺少可自动核对的结构基准，SVG 只有视觉结果、无法验证每个器件 owner id / pin anchor / junction / crossing，也没有统一的符号对照与整图签收入口。
- 允许修改的范围：`NetlabHome/docs/schematic_reference/`、`NetlabHome/docs/tasks/2026-11-19-schematic-export-s7.md`、`NetlabHome/frontend/e2e/schematic_export_s7.mjs`、`NetlabHome/netlab/core/compute/schematic_export.py` 的结构层、`NetlabHome/netlab/tests/test_schematic_export_oracle.py`、`NetlabHome/netlab/tests/test_schematic_export_reference.py`、`NetlabHome/netlab/tests/fixtures/schematic_export/`。
- 明确不做什么：不改变 S0–S6 的公共 API 与视觉语义；不把结构层当可见图形；不自动覆盖用户工程；不生成不可复现的随机 SVG；不替用户完成人工签收。
- 验收标准：桥式整流与两级 BJT 稳压 fixture 的结构 JSON 可复现；SVG 可解析且 viewBox 完整；每个 supported device 有 symbol group、pin anchor、owner id；wire 无 text；manual waypoints 点数顺序可追踪；junction/crossing 坐标来自 IR；同一快照 SVG 完全一致；符号对照页覆盖全部 kind × 两种风格；Playwright E2E 走真实后端导出并通过；人工签收单可供用户勾选。
- 验证命令：`python -m pytest netlab/tests/test_schematic_export_oracle.py netlab/tests/test_schematic_export_reference.py -q`；`cd frontend && npm run build && npx tsc --noEmit && node e2e/schematic_export_s7.mjs`。

状态：S7 实施完成，待人工签收。
