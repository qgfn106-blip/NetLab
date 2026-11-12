# NetLab ADR 索引

本目录记录架构决策。历史 ADR `0001/0002/0003` 属于旧编号线，保留不动；V2 架构决策使用本目录的 `ADR-001..ADR-008` 文件标识。

| ADR | 标题 | 状态 |
|---|---|---|
| ADR-001 | Description / Runtime 分离 | Proposed |
| ADR-002 | 三型 Edge 语义分离 | Proposed |
| ADR-003 | Typed Port 类型检查策略 | Proposed |
| ADR-004 | Engine 生命周期接口 | Proposed |
| ADR-005 | Presentation 外观归属（ADR-005-lite） | **Accepted（2026-11-11，lite）** |
| ADR-006 | Equation 与 Numerical Backend 分离 | Proposed |
| ADR-007 | Control Flow 与计算依赖分离 | Proposed |
| ADR-008 | 阶段 4 三项待决问题（Runtime 快照/Plugin 权限/v6 兼容） | Proposed（Open Decision） |

说明：

- `Accepted` 表示用户 2026-11-11 正式裁决确认的原则；`Proposed` 表示设计提案，尚未经过实现验证。
- ADR 不是实施授权；是否进入对应阶段，仍以 `PROJECT_STATUS.md` 与用户当次授权为准。
- 历史 ADR：`0001-schematic-layer.md`（已接受 2026-10-26）、`0002-plugin-extension-architecture.md`、`0003-appearance-engine.md`（Accepted 2026-11-07）。
