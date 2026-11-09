# 决策索引（生成，勿手改）

| ID | 主题 | 决策摘要 |
| --- | --- | --- |
| D1 | 模块存在形式 | 每个模块一个独立文件（`*.block`），可单独拷贝；不做"只在内存里"的模块（Q1） |
| D2 | 目录结构 | **工程目录**（`project.netlab` + `blocks/` + `extensions/` + `exports/` + `backups/`）+ 项目根 **`library/`** |
| D3 | 通用资源归属 | 母版/场景模板/可复用模块/全局设置只在父目录存一份，**不在每个工程重复生成**（Q3） |
| D4 | 库与工程关系 | **引用式**：工程只记 `block_id + version`，不存正文；库改了工程行为跟着变；库丢失工程打不开（Q3 选 a） |
| D5 | 版本机制 | 库内按 `blocks/<id>/v<N>.block` 存多版本；工程锁版本；旧版本永不自动删除（Q5 选 b） |
| D6 | 破坏性操作 | 删除/改名/覆盖前**扫描所有工程**引用，列出受影响清单，默认拒绝，需显式确认（Q5 选 c） |
| D7 | 缺失/损坏 | **降级只读**：工程能开、缺块标出、**禁用运行**；给"用 default 占位块替换"与"重新定位文件"，**必须确认**；占位块打标记，确认端口映射后才允许运行（Q6 选 d） |
| D8 | 库读取时机 | **打开工程时读一次并按版本缓存**；运行中不读盘；有显式"重新载入库"（运行中需暂停+重置+确认）（Q7 选 a） |
| D9 | 双模型 | 每个块/元件声明 `model: behavioral ／ structural`，**默认 behavioral**；structural 才可看/可改内部（Q8） |
| D10 | 改内部/升版本 | 改内部 → **另存为副本（新 id）**；**版本号只由导入更高 version 产生**；同 id 同 version 内容不同 → 拒绝（Q9/Q10 选 a） |
| D11 | 跨模式 | `signal ↔ vector` 互通；`signal/vector ↔ circuit` **必须经显式接口块**，不做隐式换算（Q11 选 c） |
| D12 | 导入前校验 | 分**阻断级**（解析失败/端口对不上/引用缺失/干跑失败/版本冲突）与**警告级**（缺公式、缺描述、缺单位、命名不规范）；干跑 1 步；报告可复制（Q12 选 c） |
| D13 | 信息架构 | 顶级菜单 8 项；「场景」拆为 **工程/网络/层 + 设置**；「规格」拆为 **节点函数/连接函数**（Q13/Q29） |
| D14 | 时间与循环 | 播放器式；`T_step` 独立可配（默认=`dt`）；循环=手动+推荐（五步流水线）；**时间归零**与**重置**分开；循环只作用于回放（Q27/Q28） |
| D15 | 分析窗口 | 时间窗口可改、存进工程；可一键恢复"上次计算/推荐得到的窗口" |
| D16 | 自动保存 | **快照式**（只写 `backups/`，不动正本）、默认 60 s 可关、有改动才写、保留最近 10 份 + 每天 1 份、只保存工程（Q15 选 c） |
| D17 | 性能 | 开发期 `@timed` + 开关；产品级性能面板；**单拍超时保护**（超阈值暂停并定位节点）；**不做自适应降步**（Q14） |
| D18 | 多网络 | 一工程 = 多 Scene；编辑单层只算当前层；"全局运行"才算全部；跨层输入可冻结/手填/加调试输入源；分析允许单层但给提示（Q16/Q17） |
| D19 | 左侧栏 | 平铺列表 + 状态点；点击切换、双击改名、拖拽排序；新建/复制/删除（删除前查引用）；并行开关；宽度可拖、拖到最小自动收起（Q39 选 a） |
| D20 | 频域 | 两级：**轨迹近似**（FFT/自相关）与**运行点线性化**（真 Bode/Nyquist/根轨迹/裕度）；结论标来源（Q18 选 c） |
| D21 | 关键值 | 时域指标 + 模型指标，标注来源；**参数反解单独立项、不做承诺**（Q20 选 c） |
| D22 | 数学形式 | **旁路分析层**，不进求解器；首选 sympy，失败则数值线性化并**说明原因**；sympy 可选依赖；L1 不强制、L2 要做、L3 后续尝试、L4 不做（Q34/Q35） |
| D23 | CSV 导出 | 列名 `层.节点.字段`；头部元数据（工程/模式/dt/积分法/时间窗/版本）；时间窗裁剪与抽稀、流式；只写 `exports/`，同名加序号（Q19 选 b） |
| D24 | 连线与外观 | 路由 `auto/straight/orthogonal` + `manual` 锁定 + 尽量避让；锚点 auto 默认、逐边可改**且可拖**；尺寸可调（联动端点）；网格吸附可配（`Alt` 暂停 |
| D25 | 交互 | 标准选择手势；撤销覆盖结构与参数、不覆盖运行状态与库变更；剪贴板含连接+参数+绑定；跨层粘贴**保留绑定但必须确认**；跨工程走片段文件（Q21/Q22/Q23） |
| D26 | 搜索 | 全局搜索（节点/连接/kind/模块/文档），可按网络/层限定；分组跳转；**不搜数值**（Q32） |
| D27 | 帮助体系 | `?` 就地卡片（取值规则/映射/书写规范/示例 + 跳转实现）；内置文档中心（离线、非模态独立窗口、全文搜索）；术语统一 + 术语表；顶部信息条（Q30/Q31/Q33） |
| D28 | 快捷键 | 固定表（`Ctrl+S`=保存工程、`Ctrl+Shift+E`=导出场景、`Ctrl+Alt+S`=另存为）；**自定义推迟**（Q37） |
| D29 | 电路元件 | 三批 + 不做区；GB 与同批交付；双模型给第二批（Q38） |
| D30 | 模块 UI | 入口=「模块库」面板（拖拽实例化、右键封装）；进入内部=**独立打开为临时网络**，不做面包屑栈；模块本体用**矩形**（Q36） |
| D31 | 分期 | P0 地基（含热修）→ P1 模块闭环 → P2 画布 → P3 分析 → P4 元件 → P5 帮助 → P6 后续（Q40） |
| D35 | 布局策略 | **放弃自动布局作为主路径**：元件位置由显式 `layout{x,y,rot}` 决定（agent/用户摆位），符号沿导线方向、导线从引脚直线接入；`/api/schematic/layout` 仅 |
| D36 | 电路元件节点化 | 电路**器件 = 节点**（引脚声明在元件定义里），网络节点保留；**边 = 导线**，带 `source_pin`/`target_pin`，只允许 pin↔net；MNA 未知量仍按网络节点编号（ |
| D37 | 引脚契约 | 每个元件声明 `PinSpec`（name/role/required/顺序/几何）；`required` 引脚必须恰好接一条导线；未声明引脚、重复接线、缺接均为阻断级（Q6） |
| D38 | 组件黑盒与内部网络 | 组件 = 引脚 + 计算函数，运行时**不建中介节点**；内部网络定义保存为 structural，默认黑盒，模块化后才显示/展开；内置 structural 只读随程序发布（库缺失不影响打开），用户 |
| D39 | 求解与信号侧端口 | 电路统一 PinMap：装配层生成 `pins{引脚名: 网络 id}`，元件用 `self.pin(...)`，`a/b` 变别名，参数端口改引脚，旧参数走兼容垫片；信号/矢量边显式 `source |
| D40 | 节点化迁移与交付 | v3→v4 **自动迁移**（元件边→器件节点+引脚导线，迁移前备份、幂等、旧字段读成引脚）；先模型（只电路层）→ 再 UI → 信号/矢量端口随后；每阶段全绿+新测试封口；兼容问题在 §8.1 专节 |
| D32 | 控制理论导向 | L1 术语/图形对齐（不强制）；L2 自动求闭环传递函数与数学形式；均为呈现层，不影响求解器（Q34） |
| D33 | 图纸规范 | 采用 GB/T 4728 风格**矢量线稿**：位号+参数+汇合点+符号处断线+正交；不做国标尺寸公差/完整图框（后续可加图纸模式） |
| D34 | 图纸模型 | **电气拓扑层与图纸布局层分离**：引脚=几何+电气绑定（两端 source/target，多端 `pins{引脚:节点}`）；元件 `layout{x,y,rot}`，旋转 30° 步长；电节点=网 |
| D41 | 比较器/运放端口 | 二者统一改 **推挽单端 5 脚** `IN+ / IN− / V+ / V− / OUT`；`V+/V−` 为**可选引脚**：未接线时用参数 `VCC/VEE`（默认 +15/−15），接了线按引 |
| D42 | 电路语义迁移 | v4→v5 **自动迁移**：`OUT+`→`OUT`；`OUT−` 的导线断开（不删其他器件）；`vmax`→`VCC=+vmax`、`VEE=−vmax`；`V+/V−` 保持未接（走参数默认）； |
| D43 | 接线放宽 | **未接齐的器件不参与求解**：运行不再因必接引脚缺失而阻断，画布在运行中给红色辉光并列出"未参与"；被跳过的器件所形成的孤立网络一并忽略；`vsource/isource` 只接一端时，另一端**自 |
| D44 | 多接地 | 放开"电路只能一个接地"：可任意添加接地符号，**全部自动合并为同一 0V 参考**（引擎已 union）；状态显示"共 N 个接地，已合并"；用导线连两个地允许但冗余（Q4） |
| D45 | 右键动作集 | 全量动作集（空白/器件/网络节点/导线/多选五类上下文，含引脚右键、对齐分布、显示开关、拐点、快捷键提示），分两批交付；菜单支持子菜单与分组（Q13） |
| D46 | 元件分类 | catalog `ElementSpec.group` 为**唯一分类来源**，固定 10 组：基础无源/电源/受控源/二极管/开关/放大与比较/晶体管/数字与逻辑/计时与电源管理/磁性；"导线"作为 |
| D47 | 测量仪表 | **探针式仪表**：电压表/电流表/示波器/李萨如均为旁路观察，不进入 MNA、不改变电路；示波器 1–4 通道时域，李萨如取 X/Y 两通道；读数与波形集中于"仪器"面板（Q15） |
| D48 | 时间轴与回放 | 时间轴**只回放记录、不改变电路状态**；拖动看历史帧并标注"回放中"，继续从最新时刻向前算；电路改动后旧记录**保留并标过期**（红色角标+横幅+水印），提供"重新求解"；循环只在回放窗口内；波形显 |
| D49 | 电路模块端口 | 端口 = **网络**；两种标记入口：① 1 引脚"模块端口"符号（名称/方向 in/out/inout）；② 右键网络节点"设为模块端口"；封装以标记为准，未标记的跨界网络自动补端口并警告（Q7）。 |
| D50 | 模块内部视图 | 内部网络以**页面内浮动窗口**打开，可**收起为可折叠侧边栏**（不销毁未保存改动），关闭后可再打开；模块本体仍是 `.block` 库文件，打开内部只是编辑视图（D30 修订）（Q9/Q10）。* |
| D51 | 电路模块求解 | 模块 = 外部输入/输出节点 + **独立内部网络层** + 端口映射；电路模式求解时**电气直连展开**（内外端口合并同一 MNA 节点，内部器件进父矩阵），封装前后节点电压逐点一致；信号流仍走数据 |
| D52 | 内置内部结构 | 运放/比较器/触发器/计数器/移位寄存器/555/LDO/ADC/DAC 提供**只读内置结构**（随程序发布，库缺失不影响打开）；"另存为副本"后可编辑为普通模块；"按内部结构仿真"开关默认关，开启 |
| D53 | DC 工作点 | `CircuitSolver.operating_point()`：time=0、不调 `prepare`、源取 t=0 波形值；电容开路、电感用 `DC_CONDUCTANCE=1e5`（≈10 µ |
| D54 | AC 小信号与 Bode | `ac_sweep()` 先求工作点线性化，再逐频点复数 MNA：电容 `jωC`、电感 `1/(jωL)`、独立源取 1 V/1 A 激励；探针支持节点电压、R/C/L 电流、压源支路电流；只支持  |
| D55 | Gear2（BDF2） | `integration` 增加 `"gear2"`：固定步长二阶，C `g=1.5C/dt`、L `g=dt/(1.5L)`，历史项 `(2v_n−0.5v_{n−1})/1.5`；历史不足或 dt |
| D56 | 稀疏矩阵 | `SolverOptions.sparse=auto/on/off` + `sparse_threshold=200`；auto 仅在矩阵尺寸超阈值时用 scipy.sparse（lil 装配 → c |
| D57 | 录制帧投递与顶栏时间轴 | 录制端不再「只留最后 limit 帧」，改为等间隔降采样（保留首尾，帧间隔差 ≤1 帧），避免极速模式把被跳过的区间连成一条直线；`precompute` 按 `RECORDER_CAPACITY`  |
| D58 | 浏览器内演示（Pyodide） | 应用本体仍是 Python 后端，GitHub Pages 只托管一个**演示页**：浏览器用 Pyodide（CPython→WASM）加载 `web/netlab.zip`（`netlab/*.p |
| D59 | 回放速度语义 | 回放速度用**帧/秒**表示（5–240，默认 60），一个滑块直控，独立于仿真 `fps`；播放用固定 16 ms 定时器按 `elapsed×speed` 累积推进，速度只改每次推进的帧数、不改定 |
| D60 | 外观与交互偏好的存储分层（2026-10-28） | **全局跟人走**（`%APPDATA%/Netlab/settings.json`）：`theme`（system/light/dark）、`ui_accent`（强调色 hex，空=内置琥珀）、` |
| D61 | 顶级菜单 9 项（2026-10-28，修订 D13） | 原 D13 的 8 项（文件/编辑/视图/工程·网络/仿真/分析/工具/帮助）扩为 9 项：在「帮助」之前插入「设置」；「设置」打开右侧非模态设置抽屉（工程/视图/交互三组），原先散落在右栏「工程」页 |
| D62 | 设置改为内部浮窗（2026-10-29，修订 D61/R30-3） | 用户原话：「这里的设置可以不是侧边栏，而是独立出来的窗口」。设置从**右侧非模态抽屉**改为与文档中心同类的**非模态内部浮窗** `#settingsWin`（居中、`min(760px,92vw) |
| D63 | 并网逆变器能力分层（2026-10-29，承接 R31） | 三层推进，不一次做全：**L1 平均模型**（零框架改动，纯信号流：`state_space` 做 dq 下的 LCL+电网、`sum/gain/integrate/clip` 做 PI、`oscil |
| D64 | 跨域桥接口（2026-10-29，承接 D63-L2） | 桥只有两种元素，都在 **circuit 场景**里出现：`sensor`（读节点电压/支路电流 → 写信号字段）与 `actuator`（受控电压/电流源，参考值来自信号字段）。步内顺序固定为「解  |
| D66 | 绘图子系统接入（2026-10-30，承接 R32/D11/D13） | PlotKit 独立成包（`ProjectPoint/PlotKit/`，`pip install -e`），netlab **只经 `netlab/plotkit_bridge.py` 单向依赖** |
| D67 | 绘图窗口与老画布能力对齐（2026-10-30 23:20，承接 R32/D66） | 用户要求「补齐老画布能力」后再谈删旧。分工：**时间窗进 spec**（`figure.window`，静态导出与交互共用同一口径）、**回放游标属前端 L3**（`?t=` 只是查询参数，永不回写  |
| D68 | 绘图子系统与原生绘图并存（2026-10-31，承接 R32/D13/D37） | 用户决定「先不要将原生绘图分析删掉」：netlab 的时间序列 `#chart`（`drawChart()` + `state.frames`）、示波器、李萨如、相图与分析面板**长期保留**，Plo |
| D65 | 模块库按名字存盘（2026-10-30，修订 D1/D4/D5，承接 R02） | 用户原话：「library 里的模块命名明显不合理，请按名字命名不要分割那么多子文件夹」。布局从 `library/blocks/<id>/v<N>.block` 改为 **`library/bloc |
| D69 | 迁移范围：只改 netlab（2026-11-02，承接 R33） | 用户原话：「那我决定只改netlab」。**netlab 显示层换 Qt Widgets；PlotKit 保持 web 原样，一行不改**。求解器、工程格式、checksum 不动。详见 `QT_NA |
| D70 | PlotKit 面板形态（2026-11-02） | **懒加载 `QWebEngineView`**（方案 B）：启动不 import `QtWebEngineWidgets`、不创建控件，首次打开才加载；子进程与端口由 netlab 托管（启动→探活 |
| D71 | 主画布实现（2026-11-02） | 保持**立即模式** `QPainter`，不换 `QGraphicsScene`；绘制函数（吃视图模型）与事件处理（改状态）分离。理由：现有几何/命中逻辑就是立即模式的，换场景图等于重写两遍。 |
| D72 | 图表实现（2026-11-02） | 5 个图表（时域/FEM/相图/示波器/李萨如）自绘 `QWidget`；**不引入 pyqtgraph**，也不用 matplotlib 做实时图。理由：要与 web 版像素一致，且不加新依赖。 |
| D73 | 数据通路（2026-11-02） | 控制面保留 `SERVICE`（HTTP 仍可用，测试仍走 TestClient）；数据面直连：SERVICE 产出**不可变快照** → `QueuedConnection` → UI。UI 永不持 |
| D74 | 旧前端处置（2026-11-02；D77 曾取代、**D78 起恢复本决策**） | `frontend/app.js` **冻结**（不再更新、不再修 bug），但保留 `/` 入口可用（不删）。删除需另开决策。`server.py` 的 `/api` 保留。 |
| D75 | 主题来源（2026-11-02） | 一份 token（JSON）→ 生成 CSS vars 与 QSS，单一来源；切换即时生效。禁止两套主题各写一遍。 |
| D76 | 验收手段（2026-11-02） | 像素 diff 工具（`QWidget.grab()` vs 浏览器截图，<1% 差异）+ 20 项交互清单，共同作为 P3 闸门。 |
| D77 | 原 web 前端退役（2026-11-02；**已被 D78 取代，已撤销**） | 用户原话：「请把原web界面打包到github备份，后在本地删掉」。执行：①备份三份——Git 分支 `backup/web-ui-static-2026-11-02`、标签 `web-legacy- |
| D78 | **恢复 web 前端、Qt 原生界面整体备份后删除**（2026-11-02，取代 D77） | 用户原话：「停止，请回撤至netlab的网页版，并把qt全部备份在git上后删掉，我觉得还是用html的ui，请复原」。执行：①Qt 原生界面全部提交到 Git 分支 `backup/qt-nativ |
| D79 | **代码结构整理：前后端分目录 + 后端 core 分层**（2026-11-02，用户要求「将代码按功能分好类，前端后端隔离在不同文件夹，底层计算、连接、网络代码在后端子文件夹中单独隔离」） | ①前端整体移到 `NetlabHome/frontend/`（index.html/style.css/app.js/desktop-shim.js），`server.py` 用 `_resolve_ |
| D80 | **数据结构与数据通路审计 + 优化**（2026-11-02，用户要求「检查当前数据结构，数据传递路径，分析并优化，这些也写在之前的原理架构文档中」） | ①大响应改走 `server.fast_json()`（跳过 FastAPI `jsonable_encoder` 逐字段编码，紧凑分隔符）：600 帧×7 探针 10.6→1.6 ms、字节 132 |
| D81 | **修 PlotKit 面板卡顿（2026-11-02，用户原话「继续完成，并且检查解决plotkit卡顿的问题」）** | 根因三条并全修：①中途出现的探针从 0 长度追加，与 `t` 错位 → `render` 抛「x/y 长度不一致」，曲线永久卡死 → `_ensure_channels` 用 `np.full(len |
| D86 | 2026-11-02 | PlotView：PlotKit 只登记数据、前端 canvas 自绘（23 种 2D kind）、接入前强制预计算、matplotlib 只用于定格导出；PlotKit 与 netlab 共用 de |
| D87 | 2026-11-02 | 性能减负：网格 CanvasPattern 化、帧上限按探针数自适应、不可见面板跳 DOM 更新、页面隐藏降频、PlotKit 采样按可见性开关 ／ 用户原话：「继续检查优化代码，提升性能，完成需求， |
| D88 | 2026-11-02 | PlotKit 接入修复（列出场景探针 `available`、`/api/plotkit/diag`、运行时 `remount` 自愈、面板「重试」按钮）+ 缓存体检与安全清理（三档 safe/ca |
| D89 | 2026-11-02 | 点「运行」先弹「建议先预计算」对话框：可设预计算时间窗（1–120 s，快捷 1/5/10/30）、「预计算并接入」直接跑 0→T 并跳到绘图页、「直接运行」照旧、可勾「以后不再提示」（localSt |
| D90 | 2026-11-03 | **s 域传递函数节点与分析**：新增 `transfer_function` 节点（`form=expr／coeff／zpk`，表达式支持隐式乘法/整数幂/负指数），连续 TF 转可控标准型后复用  |
| D91 | 2026-11-04 | **输入字段自动匹配 + value 优先**：新增 `core/compute/fields.py`（`resolve_field` 显式键优先，否则数值型 `value`→`voltage`→唯一 |
| D92 | 2026-11-04 | **非线性 / 非定常求解器路线：状态断点优先 + SCC 线性解 + Newton，暂不上全 DAE**：有状态节点作断点，直接馈通子图求 SCC；线性环解 `(I-A)y=b`，非线性 / 时变环 |
| D93 | 2026-11-04 | **线性网络总传函走网络节点方程消元（与全局状态空间等价），不靠纯符号梅森**：纯线性网络节点方程求 `G(s)`，Bode 幅值 + 相位；`domain='z'` 支持纯 `gain`/`sum` |
| D94 | 2026-11-04 | **相平面从网络状态直接预计算，不从总传函反推**：暴露 `state:<node>:<index>` 状态通道，预计算轨迹；独立播放条与数据分析；线性系统可选规范型坐标并标注；2026-11-05  |
| D95 | 2026-11-05 | **R25 内置结构用代码虚拟注册表，先宏模型后电路级**：9 个内置 structural 块固定 id、`builtin=True`、metadata `r25`；`blocklib` 合并扫描、 |
| D96 | 2026-11-05 | **R25 行为快速模型 + `internal_sim` 双路径**：每个内置块带 `metadata["behavior"]`，默认走纯 Python 快速路径；块节点 `internal_sim |
| D97 | 2026-11-05 | **复数分析层采用边界适配，不做全量 `complex` 迁移**：新增 `complex_support.py` 纯函数与 `analysis.frequency_response()` 统一入口； |
| D98 | 2026-11-05 | **R31 P11-01…P11-07 按 L1 平均模型 → L2 跨域桥 → 开关级趋势验证交付**：新增 `abc_dq`、`pll`、`pi` 三个 compute；`sensor`/`act |
| D99 | 2026-11-06 | **全栈扩展采用“插件包 + `netlab.plugin_api.v1` 稳定门面 + 声明式 UI”，不改变 NodeRecord/EdgeRecord 核心结构**：插件 manifest 声明 |
| D100 | 运行时形态 | TS 仅开发期编译，产物 `.js` 提交并随包发布，运行时纯 `.js`、零构建 / 零第三方运行时 / 离线；原「不引入打包器（webpack/vite/esbuild）」的绝对表述由 D119  |
| D101 | 分期 | 一期 P16 只加类型（`.js→.ts` 1:1，结构/行为零变化）；二期 P17 模块化（ESM/拆文件/纯函数单测）已完成 2026-11-06。 |
| D102 | 范围 | 纳入 netlab `app.js`+`desktop-shim.js`、PlotKit 四静态文件、vscode 扩展 `extension.js`；排除 `netlab/tools/*.mjs`、 |
| D103 | 严格度（棘轮） | tsconfig 直接开全套 strict；极少数文件可显式临时豁免（每条挂 TODO + 登记清单）；一期收尾门禁=豁免清零、`tsc --strict` 全绿。 |
| D104 | 验收 | e2e 行为等价比对优先：迁移前用 `netlab/tools/cdp_*.mjs` 录基线（DOM 快照/截图/控制台零报错/关键 `/api` 往返），迁移后逐条 diff 须空（仅白名单差异登记 |
| D105 | 打样顺序 | 由小到大：vscode 扩展 → PlotKit `render2d`→`view3d`→`app`→`nsview` → netlab `desktop-shim` → netlab `app.js |
| D106 | 代码规范 | 风格/语言特性以 Google TypeScript 风格指南为准，类型建模/迁移以 TypeScript 手册为准；`eslint`+`@typescript-eslint`+`prettier`  |
| D107 | 版号对齐 | 每个文件 DoD 含版号三处同步：`frontend/index.html` 的 `?v=`、`frontend/app.js` 的 `UI_BUILD`、`netlab/server.py` 的 ` |
| D108 | 分支与回测 | 两仓库从 main 拉 `feat/ts-migration`，main 打基线 tag `ts-baseline-YYYYMMDD`，每文件一 commit；全绿且用户确认后才谈合并，规划阶段不合并 |
| D109 | 扩展兼容 | `netlab.plugin_api.v1` 纯 Python，前端只消费 `/api/extensions*` JSON 与 `netlab-ui/1`；迁移只保证 JSON 契约不变、不改插件代码 |
| D110 | Python 规范 | TS 全量重构（P16/P17）完成后，对 netlab + PlotKit 全部 Python 代码按 PEP 8 规范化；`flake8`/`pycodestyle` 检查、`black`/`au |
| D111 | Python 门禁 | PEP 8 阶段验收 = 全量测试全绿 + `flake8` 0 error（豁免清零）+ e2e 基线一致 + 无 API/功能/数值变化；纯格式改动独立提交，不与功能混提。 |
| D112 | P17 加载方式 | 改用原生 ESM：每页面一个入口 `index.html` 用 `<script type="module">`；保留 `window.Plot2D/PK3D/NS` 全局挂载作为兼容层。 |
| D113 | P17 拆文件边界 | 按「纯函数 / 渲染核心 / UI 胶水」三层拆分；纯函数单独 `*.utils.ts`（无 DOM 依赖，可被 node 直接测）。 |
| D114 | P17 类型共享 | 抽 `plotkit.types.ts` / `app.types.ts`（纯类型、编译期擦除），各模块 `import type`，避免重复定义与全局冲突。 |
| D115 | P17 单元测试 | 用 Node 内置 `node --test`（Node ≥22）+ 编译后的 ESM `.js`，测试文件 `*.test.mjs`，零第三方；只测纯函数。 |
| D116 | P17 兼容与回归 | 模块化后必须过：`tsc` 0、现有 parity 脚本全等价、`pytest` 全绿、`tools/gui_smoke.py` 与基线 drift=false、PlotKit→vendor 重装后  |
| D117 | P17 灰度/回滚 | 按 P17.1–P17.4 小步推进，每步独立提交；任一步回归失败即回滚该步，不连带后续。 |
| D118 | 数学成果接入 | 第一波 = P1 稀疏排序评测 + P3 AC 扫频双参数仿射族 Woodbury + P5 遥测只读诊断层；统一影子模式 `NETLAB_MATH_ACCEL=off／shadow／on`（默认 o |
| D119 | 构建策略（B 方案，2026-11-06） | 引入**开发期**构建：用 `esbuild` 将 `.ts` 编译/打包为**提交的 `.js` 产物**（netlab `npm run build`；PlotKit `npm run build |
| D120 | 数据结构优化 P0（2026-11-08） | `sparse="auto"` 的默认阈值由 `sparse_threshold=200` 调整为 **512**（`SolverOptions` 与 `SimConfig` 同步）；依据：390 节 |
| D121 | 审计 A-1/A-2 拓扑与代数开关（2026-11-08） | 信号流新增边默认 `auto_delay=False`；未显式 `auto_delay=True` 且未启用 `solve_algebraic` 的成环连接抛 `ConflictError` 并列出环 |
| D122 | 审计 A-3 共享时钟与采样语义（2026-11-08） | `Scene.clock` 是唯一 `SimClock`；`Network`/`CircuitSolver`/`FemModel` 只代理同一时钟，`Simulation` 不再重复 `time += |
| D123 | 审计 A-4/A-6 数值基准与 CI（2026-11-08） | 新增 `netlab/tests/benchmarks/test_numerical_benchmarks.py`（RC 解析终值、后向 Euler 收敛阶、瞬态稳态↔DC、低频 AC↔DC、RL 解 |
| D124 | PlotKit 接入方式收口（2026-11-08，C-4） | 记录当前 `netlab/_vendor/plotkit` 内置副本为实际运行来源（**过渡态，非目标态**）：保留 `plotkit_bridge.py` 作为单向适配层，不再要求 `pip ins |
| D125 | PlotKit 插件化封装（2026-11-08，m04438） | 在 `extensions/plugins/netlab.plotkit/` 增加官方插件声明（`plugin.json` + `plugin.py`），向插件管理器注册 `PanelSpec(id= |
| D126 | 打包与发布元数据（2026-11-08，D-2） | 新增根 `pyproject.toml`（setuptools 构建、`netlab` 包发现、基础依赖 fastapi/uvicorn/numpy/scipy，可选 `dev`/`desktop`  |
| D127 | 通道键稳定化（2026-11-08，A-5/N-08） | `Scene.probes(by_id=True)` 使用节点/连接 id 作为录制器内部键，`Scene.channel_display_name()` 将 id 键映射为当前显示名；`Simula |
| D128 | 版本单一来源与缓存路径守卫（2026-11-08，N-21/N-22） | `netlab/server.py` 的 `APP_BUILD` 改为导入 `netlab.__version__`，不再复制版本字符串；`NetworkContainer.set_project_d |
| D129 | 测试运行配置与覆盖率入口（2026-11-08，N-20/C-3） | 根目录新增 `pytest.ini`（`testpaths=netlab/tests`、`python_files=test_*.py`、`addopts=-ra`）与 `.coveragerc`（` |
| D130 | 步骤事务替代全量 Scene 深拷贝（2026-11-08，A-3/N-36 第一步） | `Simulation._advance_locked()` 不再调用 `Scene.capture_checkpoint()`；`Network` 保存/恢复最近一步快照，`CircuitSolve |
| D131 | 记录类型拆分出 scene（2026-11-08，C-1/N-10 第一步） | 将 `NodeRecord`/`EdgeRecord` 从 `netlab/core/model/scene.py` 移到新模块 `netlab/core/model/records.py`；`sce |
| D132 | 文档隐私信息清理与回归护栏（2026-11-08，D-3/N-30 第一步） | 删除 `PROGRESS.md` 中的本机用户目录与私有会话路径；在 `netlab/tests/test_structure_layout.py` 增加 `test_docs_do_not_cont |
| D133 | 二阶控制系统端到端实验（2026-11-08，D-4/N-28） | 新增 `tools/e2e_control_experiment.py`：一条命令完成建工程、连线、仿真、对照解析解、输出 CSV/SVG 与误差表；默认输出到临时目录，支持 `--out/--ste |
| D134 | 文档分层与会话日志（2026-11-08，D-3/N-24/N-30） | 新增 `docs/sessions/README.md` 与 `docs/sessions/2026-11-08-audit-repair.md`，把用户文档、开发者文档与逐轮会话日志分开；`DOCS |
| D135 | 求解器影子验证门（2026-11-08，D-5/N-19） | 新增 `netlab/core/compute/shadow.py`：`off/shadow/on` 三模式与 `ShadowComparison`/`shadow_gate`/`assert_sha |
| D136 | 影子门 CI 接入（2026-11-08，D-5/N-19） | 新增 `tools/solver_shadow_check.py`：对 390 节点 RC 梯形执行 dense vs sparse `shadow_gate`，`--json` 输出 `max_ab |
| D137 | 插件路由拆分（2026-11-08，C-1/N-10 第二步） | 将 `/api/plugins`、`/api/plugins/scan`、`/api/plugins/{plugin_id}`、`/api/plugins/{plugin_id}/enable`、`/ |
| D138 | 帮助检索路由拆分（2026-11-08，C-1 第二步） | 将 `/api/help/search` 与 `/api/help/doc` 从 `netlab/server.py` 移到 `netlab/server_help/__init__.py` 包，由  |
| D139 | 二维有限元路由拆分（2026-11-08，C-1 第三步） | 将 `/api/fem/state`、`/api/fem/live`、`/api/fem/control`、`/api/fem/config` 从 `netlab/server.py` 移到 `net |
| D140 | 块库路由拆分（2026-11-08，C-1 第四步） | 将 13 个 `/api/blocks` 路由与请求模型从 `netlab/server.py` 移到 `netlab/server_blocks/__init__.py`，由 `build_rout |
| D141 | 分析路由拆分（2026-11-08，C-1 第五步） | 将 `/api/analysis/metrics`、`/spectrum`、`/period`、`/math`、`/transfer`、`/tf`、`/phase`、`/frequency`、`/ex |
| D142 | 文档基线同步（2026-11-08，D-3） | 仅同步 5 个文档的过时基线：`AGENT_GUIDE.md`、`ARCHITECTURE.md`、`FRAMEWORK_CHEATSHEET.md`、`UI_SPEC.md`、`PROGRESS.m |
| D143 | 偏好/布局路由拆分（2026-11-08，C-1 第六步） | 将 `/api/schematic/layout`（GET/POST）、`/api/schematic/validate`、`/api/profile`（GET/PATCH）、`/api/settin |
| D144 | BACKLOG 基线清理（2026-11-08，D-3） | 仅改 `BACKLOG.md`：`D1–D138`→`D1–D143`，最后修改日期 2026-11-08 09:55，“能用的产品”测试基线 `627 passed`→`678 passed / 1 |
| D145 | 缓存/文档/加速路由拆分（2026-11-08，C-1 第七步） | 将 `/api/cache/status`、`/api/cache/clean`、`/api/docs`、`/api/docs/{slug}`、`/api/accel`（GET/PATCH）六个路由及 |
| D146 | 应用内扩展路由拆分（2026-11-08，C-1 第八步） | 将 `/api/extensions`、`/api/extensions/validate`、`/api/extensions/activate`、`/api/extensions/deactivat |
| D147 | 仿真控制路由拆分（2026-11-08，C-1 第九步） | 将 `/api/control`、`/api/solve-window`、`/api/operating-point`、`/api/ac-sweep`、`/api/config`（PATCH）、`/a |
| D148 | 工作区路由拆分（2026-11-08，C-1 第十步） | 将 `/api/workspace`、`/api/workspace/create`、`/api/workspace/save`、`/api/workspace/open`、`/api/workspa |
| D149 | 多网络管理路由拆分（2026-11-08，C-1 第十一步） | 将 `/api/networks` GET/POST、`/api/networks/{network_id}` PATCH/DELETE、`/api/networks/{network_id}/act |
| D150 | PlotKit 接入/预计算路由拆分（2026-11-08，C-1 第十二步） | 将 `/api/plotkit/diag`、`/api/plotkit/channels`（GET/POST）、`/api/plotkit/active`、`/api/plotkit/analysis |
| D151 | 场景/模板路由拆分（2026-11-08，C-1 第十三步） | 将节点/边/位置/模板/场景导入导出等 15 个路由与 8 个请求模型从 `netlab/server.py` 移到 `netlab/server_scene/__init__.py`，由 `buil |
| D152 | 页面/UI/状态/诊断路由拆分（2026-11-08，C-1 第十四步） | 将 `/`、`/api/catalog`、`/api/ui`、`/api/analysis/plugin`、`/api/state`、`/api/live`、`/api/health` 与诊断路由共  |
| D153 | 工程文件路由拆分（2026-11-08，C-1 第十五步） | 将 `/api/project`、`/api/project/export`、`/api/project/validate`、`/api/project/retry`、`/api/project/im |
| D154 | 审计剩余项治理与路线拍板（2026-11-08，用户拍板，承接 D120–D153） | 用户确认按推荐方案全开，把剩余工作拆成 **12 / 20 / 14** 三轮目标（目标一 W0 收口 + C-4 + N-08；目标二 C-1/C-2 结构拆分；目标三 治理/文档/覆盖率/打包）。 |
