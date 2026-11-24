# P2-03：analysis.py 结构拆分报告

## 概览

| 原问题 | 修改方式 | 验证命令与结果 | 未完成原因 |
|---|---|---|---|
| netlab/core/compute/analysis.py 单文件 2848 行、45 个顶层函数，异常定义、纯数值工具、编排逻辑与对外 facade 混在一起；异常/数值细节被编排代码淹没，阅读与维护成本高，改动易误伤无关逻辑 | 新增 analysis_errors.py（异常+常量）与 analysis_numerics.py（8 个纯数值辅助）两层，analysis.py 改为 import 后再导出，删除原位定义；公共签名/公式/阈值 0 改动；编排与 facade 保留 | 导入成功；API 面快照对照 0 不一致；`pytest netlab/tests/test_analysis*.py -q` → 169 passed, 7 skipped；2848→2771 行 | 无（共享闭包状态的编排逻辑按约定保留在 analysis.py，未硬拆属设计选择） |

## 背景 / 原问题
本项按 `docs/audit/NETLAB_ARCHITECTURE_CONVERGENCE.md` 第 5 节 P2-03 执行。`netlab/core/compute/analysis.py` 原为 2848 行、45 个顶层函数的巨型模块，把可复用的异常定义、纯数学辅助、业务编排与对外 facade 混于一处，定位与修改都需在长文件中穿行，且分层缺失使公共约定（异常类型、上限常量）也埋没在实现里。

## 修改方式
1. **异常层**：新增 `netlab/core/compute/analysis_errors.py`，迁出 `AnalysisError(Exception)`、`ANALYSIS_TIMEOUT=5.0`、`MAX_EXPORT_ROWS=200_000` 及 `__all__`。`analysis.py` 以 `from .analysis_errors import ANALYSIS_TIMEOUT, AnalysisError, MAX_EXPORT_ROWS` 继续导出，既有 `netlab.core.compute.analysis.AnalysisError` 等导入路径不变。
2. **数值层**：新增 `netlab/core/compute/analysis_numerics.py`，迁出 8 个纯数值辅助 `_uniform`、`_crossing`、`_shift_score`、`_period_windows`、`_number`、`_complex_pairs`、`_complex_list`、`_frequency_axis`（仅依赖 numpy/math/AnalysisError，不读仿真对象、不含编排状态）。`analysis.py` 以 `from .analysis_numerics import (...)` 重新导入，符号仍挂在 analysis 命名空间下。
3. **facade 保留**：`analysis.py` 删除上述原位定义，但共享闭包状态的编排函数与对外 facade 保留在原文件，未做硬拆；未改动任何公共函数签名、公式或阈值。
4. **回归护栏**：新增 `netlab/tests/test_analysis_api_surface.py` 与 `netlab/tests/fixtures/analysis_api_snapshot.json`（拆分前快照），断言 `__all__`、11 个公共符号、9 个外部额外可见符号签名逐字不变；8 个数值函数在 `analysis` 上可访问且与 `analysis_numerics` 为同一对象；`AnalysisError` 与两个常量再导出且同一。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `python -c "import netlab.core.compute.analysis"` | 导入成功，无报错 |
| API 面对照拆分前快照（公共 11 / 额外 9 / 私有数值 8 / 异常与常量） | 0 处不一致 |
| `python -m pytest netlab/tests/test_analysis*.py -q` | **169 passed, 7 skipped, 4 warnings in 15.62s** |
| `git show HEAD:netlab/core/compute/analysis.py \| wc -l` vs `wc -l` | 2848 → 2771（-77 行，逻辑外移至两新模块） |

> 7 项 skipped 全部位于 `netlab/tests/test_analysis_branch_loop.py:20`，原因是缺少示例工程夹具（"示例工程不存在"）而跳过；属环境缺数据导致的合理 skip，未跳过或削弱任何断言，其余用例全绿。

## 未完成原因
本次 P2-03 拆分（异常层 + 数值层）已全部完成。按任务约定，共享闭包状态的编排逻辑与对外 facade 刻意保留在 `analysis.py`、不做硬拆——这是设计上的有意选择，非遗留缺陷。
