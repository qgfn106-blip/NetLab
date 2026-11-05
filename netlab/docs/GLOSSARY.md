# Netlab 术语表（GLOSSARY）

> 只定义“词”，不写实现细节。电气图纸实现见 `SCHEMATIC_DRAWING_SPEC.md`；插件与扩展见
> `EXTENSIBILITY_ARCHITECTURE.md`、`adr/0002-plugin-extension-architecture.md`。
>
> 最后修改：2026-11-06 00:10

| 术语 | 定义 | 不要混淆 |
| --- | --- | --- |
| 电气拓扑层（electrical topology） | 求解器使用的唯一真相：电节点、元件、参数、端口连接关系、网络。 | 不是画布上的坐标或线形。 |
| 图纸布局层（schematic layout） | 元件位置/旋转、符号、引脚几何、导线路径、文字位置；只影响“怎么画”。 | 改动它不得改变电气连接。 |
| 元件（element） | 电气功能的载体（电阻、二极管、运放、触发器…），有类型与参数。 | 不是“电节点”，也不是一条“导线”。 |
| 符号（symbol） | 某一元件类型在图纸上的标准图形，属于符号库，版本化。 | 不是元件本身，不是任意图标。 |
| 引脚（pin） | 符号上的电气接口：局部坐标、方向、名称、电气绑定。 | 不是“端口点”这种纯视觉圆点。 |
| 电气绑定（pin binding） | 引脚到电气节点的映射：`source` / `target` / 命名节点（如 `vp`、`clk_node`）。 | 不是文本标签。 |
| 导线（wire） | 图纸上连接两个引脚的线段；只表达连接，不承担电气语义。 | 不是元件，不参与求解。 |
| 网络锚点（net anchor） | 电节点在图纸上的落点（小圆/接地符号），是导线汇聚的位置。 | 不是元件引脚。 |
| 汇合点（junction） | 同一电气网络上 ≥3 条导线相接处画的实心点；表示“确实相连”。 | 不是普通交叉点。 |
| 非连接交叉（crossing） | 两根导线在图纸上交叉但电气不相连；必须有明确视觉区分（跨线/断口），且数据模型没有连接。 | 不得自动合并为节点。 |
| 折点（waypoint） | 导线路径上的中间控制点，只影响路径形状。 | 不是节点，不是引脚。 |
| 位号（reference designator） | 元件的唯一标识（R1、C2、U1…）；图中唯一、自动生成、可校验冲突。 | 不是元件名称/型号。 |
| 标注（annotation） | 位号、参数值、极性/端子名等文字；不得遮挡符号、引脚、导线、汇合点。 | 不是图形符号的一部分。 |
| 自动布局（auto layout） | 从电气拓扑确定性生成图纸布局的算法：分层、网格锚点、lane 错开。 | 不是力导向随机布局。 |
| 手工布局（manual layout） | 用户/agent 对元件坐标、旋转、锚点、折点的显式调整；优先于自动布局。 | 不是“拖一下就不保存”。 |
| 极性（polarity） | 有方向元件（二极管、电解电容、电源、运放输入）的 +/− 或方向标记。 | 不是颜色。 |
| 图纸模式（drawing mode） | 隐藏网格/辅助点、统一白底、显示图框与标题栏的展示/导出状态。 | 不是编辑模式。 |
| 参照代号（reference designation） | 按 GB/T 5094 体系组织设备/部件的结构化代号；与位号相关但不等同。 | 不要用位号冒充完整参照代号体系。 |
| 端子号/线号（terminal / wire number） | 实际接线、端子与导体的标识（参考 GB/T 4026）。 | 不是网络名，也不是位号。 |
| 插件包（plugin package） | 放在 `extensions/plugins/<plugin_id>/` 的独立 Python 包，用 `plugin.json` 声明元数据、能力、依赖和入口。 | 不是单文件 `@node`/`@method` 旧扩展。 |
| 插件 manifest | 插件根目录的 `plugin.json`，是加载器读取的唯一元数据入口。 | 不是 Python 模块里的常量。 |
| 插件 API（plugin API） | 稳定门面 `netlab.plugin_api.v1`，插件唯一允许依赖的 Netlab 接口集合。 | 不是 `netlab` 内部模块的公开承诺。 |
| 插件注册表（plugin registry） | 由加载器暂存并在成功后合并的扩展项集合；失败时整包回滚。 | 不是四个内置注册表本身。 |
| 能力声明（capabilities） | manifest 中声明插件使用的扩展类型与权限，用于加载校验和管理页展示。 | 不是 OS 级权限隔离。 |
| 未解析节点（unresolved node） | 工程引用的插件缺失或版本不匹配时保留原记录、但无法实例化的节点状态。 | 不是空实现，也不是自动降级。 |
| 插件锁（plugin lock） | 工程 `plugins` 段保存的插件 id、版本和可选内容 hash。 | 不是 Python 依赖锁文件。 |
| 简单画布（simple canvas） | 与专业画布共用同一 Node/Edge 记录的紧凑视图，节点显示为卡片，连线以端口点操作。 | 不是新的场景模式或数据格式。 |
| 视图配置（UI profile） | `netlab-ui/1` 声明式配置：显示模式、密度、主题令牌、节点卡片字段、画布和面板布局。 | 不是任意 CSS/HTML。 |
| 视图设计（view design） | 在视图内直接拖拽/缩放节点、调整面板和外观并保存为项目或全局 UI 配置的模式。 | 不是改求解参数。 |
| 声明式面板（PanelSpec） | 由 sections/fields/table/chart/text 等声明式组件构成的面板描述。 | 不是插件提供的 DOM 或脚本。 |
| 分析结果信封（AnalysisResult） | `AnalysisSpec` 的统一返回值：`series` / `table` / `summary` 三类 JSON。 | 不是任意插件 JSON。 |
| 数据格式适配器（DataFormatSpec） | 插件实现的导入/导出适配器，读写统一 `Dataset` 信封。 | 不是直接操作工程文件。 |
| 引擎协议（EngineProtocol） | 自定义求解引擎必须实现的 `build/step/reset/probes/stats` 五个方法。 | 不是可替换的 Scene 生命周期。 |
| 自定义模式（plugin mode） | 插件注册的新求解 mode，使用统一 Node/Edge 记录，但不能替换 signal/circuit/vector。 | 不是内置模式的别名。 |
