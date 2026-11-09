# C-3 / N-14 绘图语义单一真源

## 问题
netlab 同时存在老 canvas 时序/示波器/李萨如/相图、SchemDraw→SVG、PlotKit iframe 三套绘图语义；线宽、时间轴字段、降采样与配色各自硬编码，容易漂移。

## 决策
`docs/canonical/contracts/plot_semantics.yaml` 是唯一真源，`tools/gen_contracts.py` 生成：

- `netlab/contracts/generated.py`：`PLOT_TIME_FIELD`、`PLOT_VALUE_FIELD`、`PLOT_LINE_WIDTH`、`PLOT_GRID_WIDTH`、`PLOT_MAX_POINTS`、`PLOT_SYNC_PULL_LIMIT`、`PLOT_MAX_CHANNELS`、`PLOT_DOWNSAMPLE`
- `frontend/app/contracts.ts`：`PLOT_SEMANTICS`

两侧消费：

- 老 canvas `drawWbSubplot`：使用 `frameSeriesToPoints()` 映射 `t/values`，线宽取 `PLOT_SEMANTICS.lineWidth/gridWidth`。
- 内嵌 `PlotKitRenderer`：`buildPlotLineLayers()` 生成图层，`data.x = PLOT_SEMANTICS.timeField`，线宽同源。
- 后端 `plotkit_bridge`：`MAX_POINTS`/`SYNC_PULL_LIMIT`/`MAX_CHANNELS`/`LINE_STYLE.width` 全部来自生成常量。

## 验收
1. `python tools/gen_contracts.py --check` 零漂移。
2. `netlab/tests/test_plot_semantics_contract.py`：生成常量、bridge 常量、frame/plot_spec 字段一致。
3. `frontend/tests/plot_semantics.test.mjs`：同一份帧数据两路径的 x/y、线宽、颜色映射一致。
4. 全量 pytest + 前端 typecheck/build/parity/check:sections 全绿。
