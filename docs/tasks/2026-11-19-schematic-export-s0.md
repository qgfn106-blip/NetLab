# 任务卡：Schematic Export S0–S1

- 任务名称：原理图导出 S0 契约与 S1 SchematicExportIR
- 希望解决的问题：现有 `scene_to_svg()` 直接按节点中心画线，忽略 `route/waypoints/anchors/layout/source_pin/target_pin`，且无法稳定处理旧元件边场景与 device+wire 场景。
- 允许修改的范围：`NetlabHome/docs/SCHEMATIC_EXPORT_CONTRACT.md`、`NetlabHome/docs/tasks/2026-11-19-schematic-export-s0.md`、`NetlabHome/netlab/core/compute/schematic_export_ir.py`、`NetlabHome/netlab/tests/test_schematic_export_contract.py`、`NetlabHome/netlab/tests/test_schematic_export_ir.py`、`NetlabHome/netlab/tests/fixtures/schematic_export/`。
- 明确不做什么：不修改 `scene_to_svg()` 的公共输出（S4 才收口）、不修改前端、不引入 SchemDraw 符号渲染、不写回 scene、不改用户工程文件。
- 验收标准：39 个 kind 的 PINS 与 ELEMENT_SPECS 对齐；旧/新 fixture 迁移等价且幂等；IR 从两种输入得到同一结构；route/waypoints/source_pin/target_pin 可被读取；wire 不产生文字标签；未知器件进入 `unsupported[]` 并有 warning；scene 不被修改。
- 验证命令：`python -m pytest netlab/tests/test_schematic_export_contract.py netlab/tests/test_schematic_export_ir.py -q`；随后跑 `python -m pytest netlab/tests/test_schematic_export.py -q` 做兼容回归。

状态：S0–S1 已完成（用户 m01120/m01124 已授权按 `docs/SCHEMATIC_EXPORT_GB_PLAN.md` 实施）。
