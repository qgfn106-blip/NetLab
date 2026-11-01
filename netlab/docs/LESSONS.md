# Netlab 经验与踩坑手册（避免重复错误 / 少花 token）

> 最后修改：2026-11-01 20:08
> 用途：动手前先扫一遍相关小节；遇到同样的报错直接照「处理」执行，**不要再从头调试一遍**。
> 每条都是实测过的现象；标 ⚠ 的是容易反复踩的坑。

---

## 0. 排错顺序（先便宜后昂贵）

1. `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8010/api/health` — 服务活着吗？
2. 直接用 `curl` 打目标 API — 后端逻辑对不对？
3. `node netlab/tools/cdp_eval.mjs "..."` 看 DOM / 网络 — 前端有没有接上？
4. 最后才读代码。

跳过 1、2 直接就去看前端，是最常见的浪费时间方式。

---

## 1. 环境与工具

### 1.1 ⚠ bash 完全起不来：`workspace root ... does not meet the sandbox prerequisite (needs WRITE_OWNER)`

- **现象**：`ops_bash` / `pwsh` 直接失败，连 `pwd` 都不执行；文件读写工具却正常。
- **原因**：工作区目录的 owner 不是当前用户，DSH 在 `workspace-write` 模式下拒绝自动准备 ACL。这是**目录权限问题**，不是授权拒绝。
- **处理**：切到 `danger-full-access`（或修正目录 owner）后重试；不要反复重试同一命令。

### 1.2 ⚠ 会话日志 `.zstd` 只解出第一行

- **现象**：`zstdDecompressSync` 只得到 session 头部那一行。
- **原因**：日志是**多帧拼接**，一次性解压只处理第一帧。
- **处理**：按 magic `28 B5 2F FD` 切帧，逐帧解压再拼接；或直接 `grep` 记忆库/SQLite。

### 1.3 临时文件路径

- **现象**：Node 里写 `/tmp/x.json` 报 `ENOENT C:\tmp`。
- **原因**：Git Bash 的 `/tmp` ≠ Windows `C:\tmp`，Node 按 Windows 语义解析。
- **处理**：用项目内临时目录（如 `.tmp_extract/`），用完删掉，别留在工程里。

### 1.4 ⚠ 上一个窗口的后台服务已经不在了

- **现象**：CDP 页面变成浏览器错误页（`title: 127.0.0.1`），`/api/health` 连不上。
- **原因**：前一个会话的后台作业随会话结束被清理。
- **处理**：先 `netstat -ano | grep :8010` + `/api/health` 确认，再决定重启；不要假设服务还在。

### 1.5 中文输出乱码

- **现象**：pytest 里中文断言失败信息显示成 `���`，看起来「两边都乱码却不相等」。
- **原因**：Windows 控制台编码（cp936）与 UTF-8 源码/响应混合。
- **处理**：别用终端里的汉字判断断言内容；要精确比对就把结果写成 UTF-8 文件再用 `read` 工具看。

### 1.6 ⚠ 新建工程路径被判成「不是 Netlab 工程路径」

- **现象**：`POST /api/workspace/create` 传一个**还不存在**的目录（如 `<tmp>/lab/proj`），返回 422「不是 Netlab 工程路径」。
- **原因**：`Path(target).is_dir()` 对不存在的路径返回 `False`，于是代码接着按「文件」判定后缀，`.proj`/无后缀的新目录被拒。
- **处理**：路径判定按「后缀优先」——`.netlab` 结尾才是文件；已存在目录或无扩展名的新路径都是工程目录；其余才拒绝（见 `workspace.project_file_for`）。新建场景永远不要依赖 `is_dir()` 判断目录意图。
- **相关**：设置目录在测试里必须隔离，否则会写进真实 `%APPDATA%`；用 `monkeypatch.setenv("NETLAB_SETTINGS_DIR", tmp)`（`workspace.settings_dir()` 已支持该覆盖）。

### 1.7 ⚠ 文档被静默回退（第二次）

- **现象**：REQUIREMENTS 顶部「最后修改」行、R01「现状」、§9 新增行在写入后消失，`ls` 的 mtime 退回到写入前的时刻；PROGRESS 的 §7.2/§7.3 也整段消失。写入工具当时都返回成功。
- **处理**：改完文档**立即** `grep` 校验关键行（如「最后修改」「票 xx 完成」），再复制到 `NetlabExtras/backups/ProjectPoint_backups/docs_<时间戳>/`；发现回退直接从备份 `cp` 回来，再补差异。
- **别做**：不要重写整篇文档来「修复」——先用备份比对，确认丢了哪几段再补。

---

### 1.8 sympy/gmpy2 导入时的 "Windows fatal exception"

- **现象**：跑 `test_analysis.py` 或全量测试时 stderr 出现 `Windows fatal exception: code 0xc0000139`
  与 gmpy2 导入栈，但测试仍全绿（2026-10-26 实测）。
- **原因**：本机 gmpy2 的 DLL 入口点问题，sympy 的 mpmath 后端触发；与项目代码无关（只跑 analysis 测试也复现）。
- **处理**：不影响结果，不要为此改依赖；报告里说明"环境告警、非本次改动引入"即可。

## 2. 测试与断言

### 2.1 ⚠ 断言中文提示语 → 措辞一变就红

- **实例**：测试断言 `"信任" in detail`，服务端实际写的是「确认来源**可信**后…使用 `trust_extensions=true`」，于是永远失败。
- **处理**：断言**稳定 ASCII 标记**（如 `trust_extensions=true`）+ 一两个不会被改写的短词；不要断言整句。

### 2.2 ⚠ 写死数量断言

- **现象**：加一个节点 kind，`test_catalog_and_health` 就红。
- **处理**：与注册表比对（`len(COMPUTE_SPECS)`），或断言「至少包含关键 kind」，不要写死 13/11/9/12。

### 2.3 定位单个失败

```bash
python -m pytest netlab/tests/test_project.py::test_xxx -q     # 单条 + 完整 traceback
python -m pytest netlab/tests -q -x                            # 首个失败即停
```

### 2.4 导入路径

- 在项目根跑 `pytest netlab/tests` 依赖 `netlab/tests/conftest.py` 把项目根塞进 `sys.path`；不要改成 `cd netlab && pytest tests` 后又忘了包内相对导入。

### 2.5 ⚠ 断言里的数值可能编码了「错误物理」

- **实例**：`test_nmos_switch` 曾断言 `drain < 1.5`（旧模型只有饱和平方律，给出 0.5 V）。补上线性区后物理正确解是 1.55 V，断言反而失败。
- **判断**：先手算/独立推导期望值，确认是**模型变准了**而不是回归；再按物理改期望（`1.0 < drain < 2.0` 并写注释说明旧值），**不要**为了保住旧断言去调参数或放宽模型。
- **记录**：这类「既有断言随物理模型修正而更新」必须写进 PROGRESS 与报告，别让后来者以为是删测试换通过率。

### 2.6 ⚠ 测试电路本身可能是无解的

- **实例**：想给「电路引擎失败步回滚」造用例，用了「5 V 理想电压源与二极管并联」。电压源把节点钳死，二极管又被强制 5 V，电路无一致解 → 第 1 步解出 1e14 A，第 2 步发散发散。
- **判断**：先问「这个拓扑存在物理解吗」。理想电压源并联器件、两个不同值电压源并联，多数是病态拓扑，不是求解器缺陷。
- **替代**：造串联/带限流电阻的拓扑；或用 `monkeypatch` 让 `_newton_solve` 抛错（`test_solver_p0.py` 既有做法）。另外 `SolverOptions` 是 `frozen dataclass`，改配置走 `scene.set_solver_options(...)`（会重建引擎、时间归零）。

### 2.7 ⚠ AC 小信号只对线性元件成立

- **现象**：对含二极管的电路调 `ac_sweep()` 直接报「AC 分析暂不支持元件 …（kind）」。这不是 bug：工作点线性化只对 R/C/L、独立源、受控源、开关成立，二极管/MOS/BJT 需要真实小信号模型（gm 在工作点、结电容），本阶段不假装有。
- **处理**：需要非线性小信号时，先把器件在工作点线性化（或退化为等效 g 值），再放进 `AC_KINDS`；不要用瞬态扫频替代 Bode，相位对不上。
- **测试**：`test_solver_analysis.py` 同时锁「拒绝」与「线性电路正确」，避免以后悄悄放开却没人验证精度。

### 2.8 ⚠ 积分器测试要直接驱动引擎，别经 `Simulation` 默认 dt

- **现象**：给 `Simulation.apply_config({"integration":"gear2"})` 后测试值不符，因为 `SimConfig.dt` 默认会覆盖测试里想要的步长。
- **处理**：积分器精度/回退测试直接 `scene.ensure_engine().step(dt)`，节点电压从 `record.data["voltage"]` 读；`runtime_state()["integration"]` 是**字符串**不是列表。
- **数值参考**：RC 放电 5 V、C=1µF、R=1k、10×1e-4 s → 精确 1.839397；gear2 1.847744、BE 1.927716。首步和 dt 变化后与 BE 完全相同（回退规则见 D55），这是设计不是误差。

### 2.9 ⚠ DC 工作点里的「短路」是 1e5 S 近似

- **现象**：DC 分析中电感不是 0 Ω，串在理想源上的电感解出巨大电流（5e5 A 级），或电容开路让节点悬空。
- **处理**：测试 DC 电感短路用「V–R–L 串联 + 测 L 两端电压 ≈0」，不要用「理想源并联电感」（病态拓扑，见 §2.6）；电容开路时给节点留直流通路或期望 0 V。
- **记录**：近似值写在 `REQUIREMENTS_AND_RULES.md` D53 与报告 §6，别让用户以为 DC 电感真的 0 Ω。

### 2.10 ⚠ 校验函数自己会改内容，改完必须重算校验和

- **现象**：`MyProject/未命名工程.netlab` 用 `load_project` 能打开，随后 `project_scene_payload` 报「工程文件校验和不匹配」；浏览器/GUI 打开失败。原始文件 `verify_checksum(raw) == True`，文件并没有被篡改。
- **根因**：`validate_project()` 用 `Scene.to_payload()` 规范化场景时会补齐元件新增参数的默认值（本工程两个 opamp 缺 `gbw/slew_rate`，补成 `0.0`），但返回前没重算 `checksum`；打开工程会校验两次（`load_project` + `_apply_project`），第二次必红。
- **修复**：`validate_project()` 末尾 `project["checksum"] = compute_checksum(project)`；新增回归 `test_validate_normalizes_scene_without_breaking_checksum`（删旧参数 → 重算校验和 → 连续两次校验 + `project_scene_payload`）。
- **教训**：凡是「解析/迁移/规范化」函数，只要会写回内容，就必须同步派生字段（checksum、版本、摘要），并测「同一对象校验两次」；只测一次会把问题留给真实打开路径。

### 2.11 ⚠ 「接上电容就归零、然后一直涨」先查初值和直流通路，别先怀疑电容公式

- **现象**：`MyProject/未命名工程.netlab` 里 100 µF 电容一接到集电极网络，该节点从 0 起步并缓慢上升；耦合到运放 IN+ 的 10 µF 电容让 IN+ 爬到 +15 V 轨，看起来像“电容算错了”。
- **排查顺序**：① 隔离验证 companion：单 RC 充电与解析解对比（实测 4 位一致）；② 逐拍 KCL：t=3 s 一个周期内 R20 供 0.4268 mA、Q1 吸 0.4209 mA、电容净 0.0053 mA，残差 0；③ 才回到电路：`v0=0` 把节点钳到 0、充电时间常数 τ=RC、每周期被导通拉低；IN+ 无对地直流通路 + 正反馈 → 输出贴轨，IN+ 经反馈电阻充到轨。
- **教训**：电容“漂移”类现象先看两件事——初值 `v0` 和该节点的直流通路（谁在充、谁在放、反馈是否接反）；公式对不上解析解才去改代码。开关电路里梯形法的电容电流会出现与激励同周期的脉冲，属正常离散化行为。

### 2.12 ⚠ 图表出现直线段/断崖，先查录制帧投递是不是「整段跳过」

- **现象**：关掉实时节拍（极速模式）后，波形图里出现长直线段、相位跳变，像数据被削平；预计算的时间窗起点不是 0。
- **根因**：`Recorder.since(cursor, limit)` 在待投递帧超过 limit 时「只留最后 limit 帧」，丢掉中间段；前端把前后两段首尾相连就画成直线。极速模式每步录一帧、轮询约 8 次/s，必然超限。预计算则是 5 万帧塞进 1200 帧环形缓冲，只剩尾部。
- **修复**：投递端改等间隔降采样（保留首尾、帧间隔差 ≤1），不截尾；预计算按 `ceil(count/容量)` 抬高 `sample_every` 保证 0→T 装得下；`steps == 1` 强制录首帧。
- **2026-11-01 加固**：预计算另设 `MAX_PRECOMPUTE_STEPS = 200_000`，超过直接 `ValidationError`，不再 `min(200_000, ...)` 静默截断；且所有校验必须在 `scene.reset()` / `recorder.clear()` 之前完成，否则“拒绝一次预计算”会顺手清掉用户已有录制。测试要同时断言“抛错”和“状态未变”。
- **教训**：图表异常先分清「数据错」还是「投递错」——直接从 `/api/live` 看返回帧的 seq/t 是否连续、间隔是否均匀，比盯曲线快；凡是「环形缓冲 + 每次拉取上限」的双重截断，都要降采样而不是保留尾部。

### 2.13 ⚠ 静态站上跑 Pyodide：Pages 只认 `/` 或 `/docs`，git 被墙时走 Git Data API

> 注：该演示页已于 2026-10-28 21:15 按用户要求整体删除（Pages 关闭、`web/` 移除）；下面的部署/下线经验仍然有效。

- **现象**：想把 `web/` 发布成 Pages，`POST /repos/{o}/{r}/pages` 报 `Invalid property /source/path: /web is not a possible value. Must be one of: /, /docs`；同时 `git push` 反复 `Connection was reset`，而 `api.github.com` 正常。
- **处理**：① Pages 改用 `{"build_type": "workflow"}`，加 `.github/workflows/pages.yml` 用 `upload-pages-artifact`（path=web）+ `deploy-pages`，不再依赖分支目录；② git 协议走不通时用 Git Data API 直接提交（blobs → tree → commit → PATCH ref），token 从 `git-credential-manager get` 取（`protocol=https` + `host=github.com`）；③ 提交后本地与远程分叉，先 `git fetch` + `git reset --hard origin/main` 再重打 workflow，别直接 push。
- **教训**：Pyodide 首次加载受 CDN 影响可达 1–2 分钟（本机实测 wasm 96 s），页面必须有分阶段状态提示；`web/netlab.zip` 是快照，改 `netlab/*.py` 后要重跑 `python web/build_zip.py`，否则线上跑的是旧引擎。

---

## 3. 前端与浏览器验证（CDP）

工具：`node netlab/tools/cdp_eval.mjs "<js>"`（需要 9333 调试端口 + 8010 页面）。

### 3.1 ⚠ `Netlab page not found`

- **原因**：工具只认 `type=page` 且 URL 以 `http://127.0.0.1:8010` 开头的 target；页面变成错误页、被别的页面顶掉、或只剩 `about:blank` 都会命中这一条。
- **处理**：`curl /json/list` 看真实 target；`curl /json/close/<id>` 关掉废页；用 `PUT /json/new?url=http://127.0.0.1:8010/` 或 `Page.navigate` 重开。

### 3.2 ⚠ 页面 fetch 全部挂起（GET 也不返回），但 curl 正常

- **原因**：该标签页的 HTTP 连接已废（服务重启/断连后残留），DOM 还在、事件还能点，但网络不动。
- **判别**：`performance.getEntriesByType('resource')` 里没有新请求。
- **处理**：关旧 target 重开新页，别在死页上继续调。

### 3.3 ⚠ `awaitPromise` 会一直挂着

- **处理**：所有 CDP 调用都套 `timeout 25`；页面卡死时用 `job_kill` 收掉，不要干等。

### 3.4 ⚠ 改了 js/css 却没生效

- **原因**：`index.html` 里 `app.js?v=2.2.0` 缓存键没变。
- **处理**：每次改静态资源同时 bump 版本号（当前 2.2.0）。

### 3.5 内部函数不可直接调用

`app.js` 全部逻辑在 IIFE 内，外部只能：
- 触发 DOM 事件（`btn.click()`）走真实路径；
- 直接 `fetch` API 验后端；
- 注入桩（如 `window.netlabDesktop`）验桌面分支。

### 3.6 桌面流程用桥接桩验证

```js
window.__saved = null;
window.netlabDesktop = {
  setDirty(){}, saveProject(t,n,cb){window.__saved=t;setTimeout(()=>cb('C:/tmp/demo.netlab'),0);},
  saveProjectTo(p,t,cb){window.__saved=t;setTimeout(()=>cb(p),0);},
  openProject(cb){cb(null);}, openProjectPath(p,cb){setTimeout(()=>cb(window.__saved),0);},
  currentPath(cb){cb('C:/tmp/demo.netlab');}, hasAutosave(cb){cb(false);},
  autosave(t,cb){cb('C:/tmp/a.netlab');}, clearAutosave(){}
};
window.dispatchEvent(new Event('netlab-desktop-ready'));
```

注意：`window.__saved` 会被后续自动保存覆盖，比较前后场景时先取快照。

### 3.7 ⚠ 模态框确认按钮不是固定类名

`confirmModal(title, msg, label, danger)`：`danger=true` 时确认键是 `.btn.danger`，否则是 `.btn.primary`。选择器写死 primary 会「找不到按钮」。

---

### 3.9 ⚠ 在 Runtime.evaluate 里写 `location.reload()` 会卡死该标签页的后续求值

- **现象**：`cdp_eval "location.reload(), 1"` 之后，同一 target 的 `Runtime.evaluate` 不再返回（`1+1` 也挂起）。
- **处理**：重载用 `cdp_nav.mjs <url>`，或杀掉 headless 浏览器换一个 `--user-data-dir` 重启；不要在求值里导航。
- **环境变量**：`cdp_eval/cdp_nav/cdp_shot` 已支持 `NETLAB_CDP`（默认 `http://127.0.0.1:9333`）；本机 9333 可能被别的 Edge 聊天页占用，测试时另起 `--remote-debugging-port=9444 --user-data-dir=/tmp/edge-netlabN` 更稳。

### 3.10 ⚠ 合成 PointerEvent 调 `setPointerCapture` 必抛 NotFoundError

- **现象**：用 `canvas.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 7…}))` 测试拖拽时控制台报 `Failed to execute 'setPointerCapture'…`，看起来像选择失败。
- **原因**：合成事件没有真实 pointer 状态，`setPointerCapture` 不可能成功；选择本身往往已经生效。
- **处理**：判断"选中没有"看 `window.__netlabDebug.state.selection`（调试钩子），坐标用 `nodeRect/edgePathPoints` 算真实屏幕点；需要真实拖拽就用 CDP `Input.dispatchMouseEvent`。

### 3.8 ⚠ 用命令行给 `cdp_eval.mjs` 传中文会乱码

- **现象**：`node cdp_eval.mjs "...window.prompt=()=> '工艺层'..."` 执行后，接口里的网络名变成 `工艺�`。
- **原因**：Windows 控制台（cp936）→ Node argv 的编码链路把中文截断/替换；不是页面或后端问题。
- **处理**：需要中文测试数据时，用 Python/HTTP 直接调 API（UTF-8 字节）写入，或在页面内用 `String.fromCharCode`/转义构造；不要把中文当命令行参数传。
- **补充**：`cdp_shot.mjs` 在本机会挂住（等不到 Page.captureScreenshot 返回），静态截图改用 `msedge --headless=new --screenshot=...`，交互验证仍用 `cdp_eval.mjs`。

## 4. 数据格式与兼容

### 4.1 ⚠ 工程校验和浏览器/桌面必失配

- **原因**：Python 序列化 `-430.0` 与 `-0.0`，JS 只有一种 number，JSON 往返后变成 `-430` 与 `0`。
- **修法（已落地）**：`canonical_json` 先把「整数值浮点」归一成 int、`-0.0` 归零；`verify_checksum` 兼容旧算法以读旧文件。
- **测试**：`test_checksum_survives_javascript_number_roundtrip`。

### 4.2 ⚠ 两个工程接口的请求体形状不同

| 接口 | 请求体 |
| --- | --- |
| `POST /api/project/validate` | **裸工程对象** |
| `POST /api/project/import` | `{"project": {...}, "trust_extensions": bool}` |

混用会报「不是 Netlab 工程文件（缺少 format 字段）」，别误以为文件坏了。

### 4.3 工程文件顶层只存一份 `blocks`

场景载荷里剥离、导入时注入；重复存会出现两处不一致。

### 4.5 ⚠ 工程格式升级（v1→v2 多网络）两件事

1. **校验和别在迁移后才校验**：旧文件校验和是对 v1 内容算的，迁移会加 `networks`/`metadata`，直接 `verify_checksum(migrated)` 必红。正确顺序：先对**原始 payload** 验，通过后重算迁移结果的 `checksum`（自洽），否则报「校验和不匹配」。
2. 迁移必须**幂等**：`migrate_project(v2)` 再跑一次不能改变内容；`networks` 为空、id 重复都要在这里就拒绝，别等到 `validate_project` 才炸。

### 4.6 ⚠ 多网络容器与测试

- `NetworkContainer.__getattr__` 只代理 `Simulation` 的**公开成员**（`scene`/`snapshot`/`mutate`…），内部名字必须走显式方法，否则初始化期会递归。
- 服务里的 `SERVICE` 是**模块级单例**，`client` fixture 只重置当前场景、不会重置网络列表；新增网络的测试要自己清理，否则会污染后续用例（表现为「节点数/网络数对不上」）。

### 4.4 跨边界只传标量

节点 `data` 在引擎/功能块/HTTP 边界都要深拷贝 + 标量过滤，避免不同实例共享同一个 dict 导致状态串味（`BlockRuntime.step` 已按此实现）。

---

### 4.7 模块文件（.block）的三条硬规则

1. 校验和覆盖**整个 block payload**（不含外层 format/checksum）：手改文件后必须重算，否则读入即拒；
2. 同 id+version 内容不同 → 拒绝（D10）；内容相同 → 幂等返回；版本号只能由「导入更高版本」产生；
3. 库扫描只读文件、不执行、不建 Scene；结构校验只查「节点 id 唯一 + 边端点存在 + 无自引用」，干跑留给 R04。

### 4.8 ⚠ 刚实例化的模块不能直接参与计算（未接线输入）

- **现象**：模块面板点「实例化」后自动运行时，画布报「连接 'signal_path' 计算失败：节点 '__in_1_signal_path' 没有数据字段 'voltage'」。
- **原因**：父场景端口节点没有入边 → 块输入为空 → 内部接口节点没有数据 → 内部连接读字段失败。
- **处理**：`BlockRuntime.step` 对未接线的输入按端口 `fields` + `default` 补 0（已修，`test_blocks.py` 有回归）；新模块实例允许先摆放、后接线。
- **记住**：实例化 ≠ 接线；任何「块内连接读取输入」的路径都要假设输入可能缺失。

### 4.9 引用式工程（v3）的兼容点

- 工程 `blocks` 现在两种形态并存：`{id,version}` 引用（新保存）与完整 payload（旧文件/直接 build_project）。
  校验时用 `any(_is_block_ref(item))` 分流；引用必须给 `library`，否则报「工程使用模块引用，需要一个库路径才能打开」。
- 旧调用链会静默退回 payload 形态（`build_project` 不传 library 时），所以单测里没库也能过——**真实保存路径必须显式传 library**，否则又退回"正文存工程"。
- 缺失清单的文案包含 `id@vN`，测试与 UI 都依赖这个格式；换文案要同步 grep。

### 4.10 降级打开的四个实现坑

1. **加内存标记会破坏校验和**：`allow_degraded` 往 project 里塞 `degraded` 后，同一对象再次 `validate_project` 会报校验和不匹配；加完标记必须重算 `checksum`。
2. **占位块必须能装配引擎**：只有 ports 不够，`BlockRuntime._build` 要求每个端口有对应 `module_input/module_output` 内部接口节点；占位块要按场景映射生成这些节点，否则打开就报「端口没有对应的内部接口节点」。
3. **占位节点 id 要过 `check_id`**：只允许 `[0-9a-fA-F-]`；用 `pl...in` 这类可读 id 会直接 422「节点 id不合法」，改用 hex（如 `{index:04x}{block_id[:6]}a`）。
4. **降级门槛要放在容器入口，不能只放当前 Simulation**：`NetworkContainer.load_scene` 若先 `self.degraded = None` 再加载，切换模式/清空场景即可绕过只读；正确做法是先 `_require_writable()`，失败不碰状态。`add_network/rename_network/remove_network` 与 `/api/workspace/save` 也要共用同一门槛，否则仍能从结构编辑或保存侧改写降级工程。

### 4.11 模块校验的顺序与噪声

- 校验顺序必须是「结构 → 端口/映射 → 干跑」：`BlockDef.from_payload` 不查边端点，`validate_block_structure` 才查；
  自引用会被它报成 `structure` 而不是自定义的 `self_reference`，测试断言要容忍两者。
- 干跑用真实 `BlockRuntime` + 端口默认值，能抓到内部公式/连接错误；但嵌套子模块不在库时干跑必然失败，
  这时同时给「warning 子模块缺失 + blocking dry_run」，不要只报一条。
- 前端 JS 里拼报告文本别在模板字符串里塞 `
`（经脚本转义后变成真换行，直接 SyntaxError）；用 `'；'` 连接最稳。

### 4.12 打开内部会新增网络：测试要清理

- 「打开内部」按 D30 会新建一个临时网络并切过去；同进程跑的后续测试会被网络数/当前网络污染。
- 测试里用 autouse fixture 记录初始网络 id，结束删掉新增网络；否则表现为「网络数 3 != 2」「导入后网络不对」等连锁失败。

### 4.13 跨模式校验要覆盖三条入口

- `Scene.add_node`、`Scene.update_node`、`Scene.load_payload` 是节点进入场景的三条路径；
  load_payload 自己构造 NodeRecord、**不经过 add_node**，只改 add_node 会让「打开工程」漏掉校验。
- 新增接口类节点时，除了 `register(ComputeSpec(..., formula=...))`，还要在 `COMPUTE_FORMULAS` 登记公式，
  否则节点函数页显示空公式（V2-2 的坑再犯一次）。

### 4.14 拖拽与「当前工程」的测试要点

- 模块拖拽用 HTML5 DnD：`dragstart` 写 `text/netlab-block`，画布 `drop` 用 `screenToWorld` 算世界坐标。
  CDP 合成验证时 `new DataTransfer()` + `DragEvent('drop',{dataTransfer})` 即可；**必须传库里的 block id（hex）而不是显示名**，否则报「模块 'twice' 不在库中」。
- 「报告落 exports/」依赖进程级 `CURRENT_WORKSPACE`，由 workspace create/save/open 设置；测试里先建工程再校验，否则会落到 cwd/exports。

### 4.15 ⚠ `Scene.load_payload` 不清空块定义（测试隔离车祸）

- `load_payload` 只有在 payload **带 `blocks` 键**时才替换 BlockStore；模板场景不带你又不传，旧块会一直留在 `scene.blocks`，
  工程导出就会混入上一条用例的块引用，测试里表现为「project blocks 有 2 个、其中 1 个库里没有」。
- 修法：测试 fixture 的模板载荷显式 `payload["blocks"] = []`；产品侧「打开工程」必须带 blocks（引用或空数组），否则旧块残留。

### 4.16 合成 PointerEvent 也能测端点拖拽

- 端点拖拽只依赖 canvas 上的 pointerdown/move/up；合成 `new PointerEvent(...)` 时 `setPointerCapture` 会抛
  NotFoundError，但 drag 状态已写入，手动在 canvas 上补 pointermove/pointerup 就能完成拖拽并触发 PATCH。
- 锚点判定用「指针相对节点中心的归一化距离」最稳：`|dx|≥|dy|` 取左右、否则上下；超过 ~1.9r 回 `auto`，
  避免把「拖远一点」误判成某个固定边。

### 4.17 分析旁路的三个易错点

1. **边不按名字索引**：`EdgeRecord.source/target` 存的是节点 **id**，建邻接表要先 `nodes_by_id` 转成节点再按 name 索引；
   直接 `nodes.get(edge.source)` 会得到 None，传递函数静默变成 0。
2. **sympy 数字精度**：`sympify("2.0")` 的 `str()` 是 `2.00000000000000`；权重/增益先归一成 `sp.Integer`（整数用 int），
   表达式才干净、断言才稳。
3. **FFT 需要均匀采样**：录制帧可能不等间隔；先取中位 dt 用 `np.interp` 重采样，再做去均值 + 窗 + 幅度校正，
   否则峰值频率会偏。分析只读 `sim.recorder`，别碰求解器。

### 4.18 新电路元件的四个坑

1. **node 类型参数传 id 不传名字**：`ctx.index` 只认节点 id（模板里的 VCVS 就这么写）；传 name 时查找为 None，
   元件静默「无耦合」，输出恒 0。
2. **稳压管反向指数会让 Newton 发散**：直接用 exp 反向击穿在 60 次内不收敛；改成 softplus 平滑 + `ron`
   动态电阻后稳定钳位（本项目实测 5.1V 钳位误差 <0.3V）。
3. **不要用改 node.data 的办法切换比较器输入**：求解器每次从解覆盖节点电压；换输入要新建电路或改源参数。
4. **LED 参数别照抄小信号二极管**：`Is=1e-14,n=2` 会让 Newton 卡在「首次迭代即收敛」的假解；本项目的
   LED 默认改成 Is=1e-12,n=1，行为测试才稳定。

### 4.19 电路图纸感：正交 + 网格 + 符号底

- 电路场景里 `route=auto` 的平滑曲线看起来像信号流；在 `edgePathPoints` 里把电路 auto 直接映射成 orthogonal，
  并在新建连线时写 `route=orthogonal`，图纸才像常规电路软件（不必改数据模型）。
- GB 符号直接叠在导线上会看不清：先画纸色圆角底遮住线，再按 1.6–2.4×（随缩放）画符号，并用青绿主题色区分。
- 「整理到网格」要同时处理节点坐标和手动拐点，并先 `pushUndoSnapshot()`；一次操作=一步撤销。

### 4.20 正交折线上的符号方向

- 元件符号的方向要取**符号中点所在线段**的方向，不能取“最后一段”：正交路径末端可能有零长度段，
  `atan2(0,0)=0` 会把竖直导线上的电容/电源画成横的（本项目实测）。
- 电路图只允许 0/90/180/270：把角度量化到 `Math.round(angle/(π/2))*(π/2)`，符号引脚轴就始终与导线一致。
- 给参考图做“示意重建”时，先确认缺哪些元件（本项目缺变压器/BJT），截图与文档要标注“行为级示意”，
  不能声称逐器件复刻。

### 4.21 图纸标注与端口方向

- 元件标注按导线方向避让：横向线放上方、纵向线放右侧；只显示位号（名），参数会压住符号/连线（用户明确不要数值）。
- 电路小节点的端口点不能固定画在左右：按每条入边/出边在该节点处的 `anchorPoint` 去重绘制，端口自然随导线方向旋转。
- 新增“运放内部宏模型”这类示范电路时，用现有元件（VCVS/RC/负载）近似，并在模板描述里写明“简化/宏模型”，不要声称晶体管级复刻。

### 4.22 新电路元件：支路方程行不要复用 KCL 盖章

- KCL 盖章与支路方程行是两回事：节点行只写 `A[node, row]`（支路电流列），支路方程行 `A[row, node]` 的系数要按公式单独写。
  若两步混用同一个 helper（本项目 2026-10-26 的变压器首版），方程行会多出 +1，表现为**变比符号反/比例错**
  （n=0.5 输出 -5 V 而不是 +5 V）。判据：检查方程行里 `v_a` 的系数是否等于公式值。
- `branch_width` 可以在 `__init__` 里按参数改（变压器 `Lm>0` 时 3 条支路）：`_build_index` 读的是**实例**属性，
  不要写死在类属性上。
- 互感伴随模型：`i[k] − (dt/2)·L⁻¹·v[k] = i[k−1] + (dt/2)·L⁻¹·v[k−1]`；`k=1` 时 `L⁻¹` 奇异，
  参数上限卡 0.999，并在 `__init__` 里 `min(0.999, …)`。
- 副边/控制端是**参数绑定节点**：图上必须有直流通路（负载或 1 kΩ~1 MΩ 对地），否则 MNA 奇异；
  行为测试里显式给回流电阻，不要只靠「理想」假设。

### 4.23 前端接线层：`worldToScreen` 只收对象

- `worldToScreen(point)` 只接受 `{x, y}`：写 `worldToScreen(x, y)` 不会报错，但 `point.x` 是 `undefined`，
  返回 `{x: NaN, y: NaN}`，JSON 序列化后变 `null`。本项目因此**手动 waypoints 折线完全不显示**、
  **多引脚引脚引线坐标恒为 NaN（从未画出）**——两个 bug 同时存在了很久，靠截图才暴露。
- 多引脚引脚几何要与符号同缩放：`drawCircuitGlyph` 用 `symbolScalePx()`（k 夹 2–3 × symbolScale），
  引脚若按世界单位画会飘在符号外；统一用 `symbolScalePx()`，引脚坐标写成**符号本地单位**。
- 2 引脚但绑定参数端点（变压器副边）不能走 `circuitPinPath`，否则主线会被当作「引脚→引脚」重新走线；
  只有 pins 同时含 `source`/`target` bind 时才走引脚吸附。`route=manual` + `waypoints` 优先级最高（不被吸附改写）。
- 验证方法（不靠肉眼）：用 `#graph` 的 `getImageData` 采样前先确认坐标系（画布/页面/DOM 偏移不同会全透明），
  或者把中间量挂到 `window.__netlabDebug`（`elementPins` 已加入只读调试钩子）再读。

### 4.24 CDP 截图流程（本机实测可用）

- 起 headless：`msedge --headless=new --remote-debugging-port=9445 --user-data-dir=<临时目录>
  --window-size=1440,900 http://127.0.0.1:8010/`；9333/9444 常被别的 Edge 占用。
- 页面只在自己 boot 时读服务端场景：用 `/api/scene` 或 `/api/templates` 换场景后**必须重启浏览器**（或新开 target），
  不要指望 live 更新应用整份场景。
- `Page.navigate` 之后 `Runtime.evaluate` 在本机可能挂住（同类 §3.9）：截图脚本按「换场景 → 重启浏览器 → 截图」，
  不要在同一 target 里导航 + 求值。
- 切换 GB 符号：菜单项按钮已渲染在 DOM，用 `.menu-item strong` 按文本找并 click，比找状态栏开关稳。
- 截图前 `POST /api/control {"action":"reset"}` 清 `sim.error`，否则上一场景的红色错误横幅会一直留在页面上。

### 4.25 纯导线并网与共集电路

- **net↔net 纯导线要真的合并网络**：只把 wire 当图形画，MNA 仍按原节点编号会「导线接了但电压不一致」。做法：CircuitEngine 对 net 节点做 union-find，
  MNA 只建代表节点，元件端点/器件引脚先映射到根，`node_voltages` 再按根回填到每个场景节点。
- **耦合电容要预充到直流工作点**：共集模板里 CIN 若 `v0=0`，RC=0.15 s 的充电过程会让基极在几毫秒内仍是 0 V，看起来像「电路不工作」；
  把 `v0` 设为 `VIN_DC − V_B`（本例 -3.826 V）后立刻进入放大状态（EMIT≈3.07 V、p2p≈0.41 V）。
- **模板数量断言用 `>=`**：新增 `common_collector` 会撞 `== 15` 的旧断言；按 §2.2 改成 `>= 16`，否则每加模板都红。

### 4.26 右键菜单与元件分类（R22）

- **子菜单用「下钻 + 返回」而不是 hover 级联**：`openGenericMenu` 的 item 带 `children` 时，点击后重绘同一 popup（标题追加
  `› 子项`，children 末尾补「‹ 返回」）。这样键盘/触控都能用，也避免级联菜单在画布边缘被裁。返回项要加在 children 里，不要在
  外面单写逻辑。
- **分类唯一来源是后端 catalog**：`nodal.ELEMENT_GROUP_ORDER` 定顺序、`ELEMENT_GROUPS` 逐项登记 30 种元件，启动时
  `dataclasses.replace` 写回 `ElementSpec.group`；前端 `ELEMENT_GROUP_ORDER` 只负责显示顺序。新增元件忘了登记，
  `test_spec::test_element_groups_cover_all_kinds` 会报"未分类"，这是故意的。
- **右键事件可以纯合成测**：`canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX,clientY}))`；
  坐标 = canvas 的 `getBoundingClientRect()` + `nodeRect(node)`/`edgePathPoints(edge)` 的中点。菜单内容直接读
  `#linkMenu .popup-item strong`，比截图快且能断言项数（本次四类菜单 9/4/5/5 项、10 组子菜单）。
- **多选上下文目前挂在节点菜单里**：`state.multi.nodes.size > 1` 时右键任一选中节点才出现「对齐 / 分布」；空白处右键即使有多选
  也不出现——这是 P7-03 未做项，不是 bug，改之前先看 PROGRESS §7.5-A。
- **单位前缀会改变输入框里的数字**：`buildParamField` 对 F/H/Ω/V/A/s/Hz 自动选 p/n/µ/m/k/M，`collectParamValues` 必须乘 `[data-role="param-unit"]` 的因子才是 SI 值；只改显示不在提交时换算，会把 10 µF 存成 10 F。切单位时还要把 `step/min/max` 一起换算：旧 step（如 1e-9）留在新单位会让浏览器 stepMismatch 静默拦住表单提交，表现成「只能输入 1000 µF」；本项目改为 `step=any`。另：自动前缀每次重渲染都会按数值重选，保存 1 µF 会跳成 1000 nF——必须把用户选的因子存 localStorage 并优先使用，不能每次按 `bestUnitFactor` 重算。CDP 验证要「切单位→应用→读 `/api/state`」三步，不能只看输入框。
- **拐点手柄依赖选中态**：`addWireWaypoint` 后 `refreshState` 会丢 selection，导致手柄不画、拖不动；
  添加/命中后必须显式 `state.selection={type:"edge",id}` + `renderInspector()`，并把命中检测放宽到
  所有 `route==="manual"` 的边，否则用户只能去检查器输 x/y。坐标 HUD 用世界坐标（不是屏幕坐标）。
- **回放要只读录制帧**：`state.frames` 是唯一数据源，回放时图表用 `slice(0,index+1)`；不要为了“回放”去改 `scene`/`sim`，否则会改电路状态。过期标记用录制时 `scene.revision` 与当前 revision 对比；重置保留探针的关键是 `updateSignalKeyCache` 在 `probe_keys` 为空时**不要**裁剪 `chart.selected`（否则一重置就清空通道）。
- **画布工具（点两端导线）要拦截 pointerdown**：`state.wireTool` 激活时优先于选中/拖动分支；第一点存 `{kind:"pin"|"net",nodeId,pin}`，第二点按引脚↔网络/网络↔网络分别组装，Esc 取消，预览用虚线画到 `state.pointer`。
- **P0 求解参数要跟着 SimConfig 走**：`SolverOptions` 由 `Simulation.apply_config` 调 `scene.set_solver_options` 注入，靠 `_dirty` 重建引擎；新增字段必须同时加 allowed 集合，否则旧工程/PATCH 会报未知配置。
- **gmin/source stepping 只在失败后跑**：先原样 Newton，失败才 gmin（1e-3 递减）→ source（0→1 斜坡）→ 再 g=0；source 缩放放在源元件的 stamp 里（`source_scale`），不要改 params。
- **断点对齐用 Scene.next_breakpoint**：方波/脉冲按周期取 0.5/1.0（或 duty/1.0）候选，Simulation 在 `(time,time+dt]` 内取最近点缩短 dt；断点后下一次调用自然越过，不会死循环。
- **Windows 下不要用 PowerShell `Get-Content | Set-Content` 改含中文的源码/HTML**：默认编码会把 UTF-8 中文写成乱码，甚至把 `（S）">` 的引号写坏导致 DOM 解析截断（本次 `btnReset` 消失）。改文件统一用 Python `read_text/write_text(encoding="utf-8")` 或编辑器工具；出事后从 `NetlabExtras/backups/ProjectPoint_backups/` 恢复再重打补丁。
- **P7-05 预计算**：`Simulation.precompute` 会先 reset 场景再跑 0→T，前端必须清空本地 `frames/cursor` 后重新 `pollLive`；`api()` 默认 15 s 超时，预计算要传 `timeoutMs`（本次 180000），否则长任务会被 AbortController 中断。
- **电源参数不能一套表单通吃**：`wave=dc` 只取 `offset`，幅值/频率/相位/占空比/延迟都不参与；前端要用 `applyWaveFieldVisibility` 按 wave 隐藏无效字段，否则用户会以为「幅值 12」就是 12V，实际输出 0V（本次用户工程 +12V 轨就是这么变成 0V 的）。
- **奇异阈值不能太激进**：`diag <= 1e-14*scale` 会把条件数很大但可解的病态电路判成奇异（用户工程在 `dt=4.166e-5` 就被误杀）；改为 `1e-16*scale`（机器精度附近），真正零主元仍能报出；`dt=1e-6` 下用户工程可解。细 dt 下仍失败时要先查拓扑（正反馈/悬空），而不是继续缩 dt。
- **时间步长原位微调**：dt 输入框旁加「÷10 / ×10」按钮，直接改小/改大；预设按钮只是快捷方式，不是唯一入口。
- **锁定 dt 的语义**：`lock_dt=true` 时 `dt=1/(fps*steps)`，**每帧推进固定 1/fps**；增加 steps 只细化内部子步，不会改善曲线采样/回放分辨率。要更细的图必须关锁定、独立设 dt 与 steps。
- **改前端必须 bump 静态版本**：P7-03 改完 `app.js` 后 `index.html` 仍挂 `?v=3.7.2`，浏览器可能继续用旧缓存；收尾时统一
  bump（本次 3.7.2→3.7.3，两处：style.css 与 app.js）。

### 4.27 三极管型号预设（R22 追加）

- **不要给 BJT 盖章附加饱和电导**：用 Vce_sat/Ic_max 折算串联电阻（2N3904 约 1.5 Ω）会让共集模板在
  Newton 60 次内不收敛；datasheet 限值参数只做展示/记录，别为了「更像真实器件」破坏求解稳定性。
- **型号预设走 `ElementSpec.presets` + catalog**：后端 `presets={型号: {参数: SI 值}}`，前端在 `model`
  select 的 change 里按当前单位前缀换算后填表；不要在前后端各写一份型号表。
- **集成元件型号表要和参数同源**：逻辑门 `_make()` 会复制 and_gate 的 dict，若先给 and_gate 加 model 参数，
  后续门会复制到重复的 model；`_with_model` 要先判断首参是否已是 model 再替换。
- **新增参数必须带默认值**：旧工程/模板不会存新键，`validate_params` 用 spec 默认补齐即可，无需迁移；
  否则载入旧场景会报未知参数或 KeyError。

### 4.28 求解器事务与矩阵尺度（P0 加固，2026-10-28）

- **失败步必须整体可回滚**：`CircuitSolver.step` 现在先 `capture_checkpoint()`（时间/解/节点电压/元件 `state`/`iteration_guess`/`result`/`value`/`source_scale`），`_step_locked` 抛任何异常都恢复后重抛；`Scene`/`SignalEngine` 也各有检查点，`Simulation._advance_locked` 在异常与超时时恢复场景。新增会写状态的元件时，必须让它的状态落在这些字段里，否则回滚会漏。
- **猜测和已提交状态分两套字典**：`stamp` 读 `iteration_guess`，`update_guess` 只写猜测，`commit` 才写 `state`。LDO 的 `stamp` 曾直接写 `self.value`，导致 Newton 多轮盖章污染已提交值；修法是 `stamp` 只读/写猜测，`commit` 提交。
- **gmin stepping 的起点要来自配置**：旧代码硬编码 `1e-3`，`SolverOptions.gmin` 没被读；把默认值改成 `1e-12` 又会让 stepping 几乎不生效。最终默认对齐历史 `1e-3`（trial ×0.1 递减到 0），并有测试固定；改默认值前先想清楚“这是配置还是行为”。
- **残差必须尺度无关**：用 `max|Ax−b| / (max(|A||x|) + dt·max|b| + 1e-30)`，否则电压（V）、电流（A）、电导（S）混在同一判据里，细 `dt` 下 `2C/dt` 会把它推到误判区。线性电路也要过同一质量检查，别只查非线性。
- **行列均衡缩放后再分解**：`r_i=max_j|A_ij|`、`c_j=max_i|A_ij|`，解 `D_r A D_c y = D_r b`，`x = D_c y`；LU 缓存要连列尺度一起存，否则复用缓存会还原错解。缩放只改求解路径，不改方程，回归用解析解对照。
- **测试夹具别把 5 V 直接并在二极管上**：并联直挂源的二极管 `exp(5/0.0259)` 会给出 1e14 A 的“解”，第一步勉强收敛、第二步必发散；验证事务/重试要用串联限流电阻（如 1 kΩ）。
- **跨场景比较解不能直接比 `solution` 向量**：未知量按节点 id 排序，两个独立 `Scene` 的 id 不同，向量顺序也不同；按探针名（`engine.probes()`）或节点名比较，别用原始下标。

## 5. 扩展系统

1. ⚠ **不能 `import`**：AST 直接拒绝 `Import/ImportFrom`。`node`、`method`、`Param`、`math`、`np` 由执行命名空间注入，文件里直接写装饰器即可。
2. ⚠ **被装饰函数就是 handler，不是工厂**：写 `def f(params): ... return handler` 会在运行期炸 `'ComputeContext' object has no attribute 'get'`。
   正确写法是 `def f(ctx): ... return {"字段": 值}`，参数从 `ctx.params` 取（内置 `ComputeSpec.factory` 才是返回 handler 的工厂，两者不同）。
2. `validate_code` 在**没有声明任何 `@node/@method`** 时会抛错，不是返回空列表。
3. 启用成功后必须重建引擎（`SERVICE.mutate(lambda s: None)`），否则参数/源码错误要等下次才炸。
4. 停用前检查场景里是否还有节点/连接在用（在用返回 422）。
5. 扩展**不是沙箱**：同进程执行、无硬超时；对外文案必须写「不是沙箱」，前端启用前必须弹信任确认。

---

## 6. 代码约定（不遵守就会埋坑）

1. 改场景只在 `SERVICE.mutate(...)` 里做；前端只发请求。
2. 新增节点/连接 kind 时，除了 `register(...)`，还要在 `COMPUTE_FORMULAS`（或对应公式表）登记公式，否则规格页显示「没有登记公式」。
3. 新增面板 tab = 改 3 处：`index.html`（按钮 + `section#tab-x`）、`app.js` 的 `ui` 表、`switchTab()`；面板内容走 `renderXxx()` 懒渲染。
4. 颜色/边框用 CSS 变量（`--paper-2/--line/--accent/--red/--green`），别写死色值。
5. 桌面桥新增方法要 `@Slot` + 回调返回，前端统一走 `callBridge`。
6. 工程路径统一走 `workspace.project_file_for`；新建/保存/打开前先补目录树（`PROJECT_SUBDIRS`）与共享库（`ensure_library`），不要各写一份 `mkdir`。
10. 同一段 `form.append(identity, section(...))` 模板在节点与连接检查器里各有一份：批量替换会同时命中两边，出现「节点检查器引用未定义变量」这类只在渲染时炸的错误（async 里变成 unhandledrejection，界面只表现为一片空白）。改检查器模板要么带唯一上下文（`dataEditor`/`geometry`），要么改完用 CDP 监听 `unhandledrejection` 逐个点开节点/连线验证。
11. ⚠ **改元件引脚名 = 改旧工程可读性**：`Scene` 载入时用 `pins_for_device` 校验导线引脚名，旧数据里的 `OUT+/OUT−` 会在载入阶段直接 422，**迁移必须在 `load_payload` 之前完成**。做法：v3→v4 用 `LEGACY_PIN_BINDINGS`（旧引脚名）生成器件，v4→v5 的 `migrate_scene_rails` 再把 `OUT+→OUT`、删 `OUT−` 导线并补参数；`PIN_BINDINGS` 只给运行期用。迁移动手后必须跑「旧工程 → validate_project → Scene.load_payload → ensure_engine」这一条链，光跑单元测试不够。
7. 快照必须自包含：写入前 `migrate_project` + 补 `checksum`，否则恢复时报「缺少 format 字段」；用户可传的 `tag` 不能直接拼文件名，必须白名单（netlab 用 8 位 hex）。
8. 计时装饰器关闭时走属性快路径（`if not PROFILER._enabled: return func(...)`），不要读时钟；`zero_time`（只归零时间轴/录制）与 `reset`（清状态）必须是两个入口。
9. 改 `main` 的 `grid-template-columns` 时，**同步所有 `@media` 断点**：外壳加左栏后 1440/1180/920 三个断点仍写 3 列，4 个子项会被挤进 3 列，画布被压扁（本次靠截图才发现）。改完立刻在 1440 与 1000 宽度各截一张图。
12. ⚠ **元件 stamp 的自电导/互电导不能写在「两端都在节点表里」的分支内**：`StampContext.index` 不含 `gnd`，源极接地时 `si is None`，`A[di,di] += gds` 会被跳过。2026-10-28 的 MOSFET 就是这样丢 gds，Newton 在饱和↔线性区之间 0.5↔4.875 V 极限环，报「60 次不收敛但后向残差 0」。正确写法是：每个端子（漏/栅/源/体）各自 `if 下标 is not None` 独立累积。这类错误只有「解振荡 + 残差为 0」这个组合能指出，别先去调 `max_iter`。
13. ⚠ **非 trusted handler 的 `state` 必须传副本**：`Node.update` 直接把 `self.state` 交给 handler，handler 异常时已写入的字段会留在节点上，下一步/重试结果就跑偏（S-04）。现在传 `deepcopy` 并在成功后原地 `clear()+update()` 回写，保持 dict 身份不变（`NodeRecord` 共享引用）。
14. 多级事务（`Network.step` → `SignalEngine.step` → `CircuitSolver.step`）回滚时，**恢复要原地改 dict**（`d.clear(); d.update(saved)`），不能整体替换对象：节点注册表、探针、播放器都持有旧引用。`Connection.output` 是单值属性，可直接赋值。

15. ⚠ **稀疏路径没有 `.fill(0.0)`**：`_newton_solve` 每轮必须 `self._matrix = self._blank_matrix()` 新建，不能复用并清零；`_check_floating` 不能用 `np.any(matrix, axis=1)`（稀疏对象没有这个语义），要用 `matrix.getnnz(axis=1)`。稀疏 LU 缓存键要含 `indptr/indices/data` 字节与 dt，只比 `matrix != cached` 会漏判。
16. ⚠ **`StampContext.mode` 是瞬态/DC/AC 的分叉点**：元件 `stamp` 里凡是 `if mode == "dc": return` / `if mode == "ac": …` 的分支都必须显式写；默认 else 是瞬态 companion。新增分析类型时先 `grep "mode =="` 看全部元件是否都有明确行为，否则 DC 会悄悄盖上瞬态电导、AC 会漏掉 `jω` 项。

---

## 7. 流程纪律

1. 每阶段固定收尾：`pytest` → `compileall` → 桌面 `--selftest` → 更新 `PROGRESS.md` → 简报（做了什么 + 进度 + 耗时）；任务是否继续不需要批准，按票单推进（2026-10-26 授权）。
2. **不把计划写成已完成**：未接通的功能必须明确标「未接通/未验证」。
3. 项目不是 git 仓库：大改前先备份到 `NetlabExtras/backups/ProjectPoint_backups/<name>_<时间戳>` 并生成 `MANIFEST.sha256`。
4. 一次只推进一个阶段，避免半成品扩散。
5. 用户强调「计算顺序影响的数据安全」——涉及多实例/多线程/多步缓存时，先保证隔离与顺序，再谈性能。
6. 文档里的「最后修改 / 记录时间」**只能取系统当前时间**（`date '+%H:%M'` 或 Python `datetime.now()`），不能凭感觉估；写完立刻用 `date` 核对，发现未来时间当场改。
7. 文档改完立刻「grep 校验 + 备份」：本工作区出现过两次静默回退（见 §1.7），备份是唯一可靠证据。

---

## 8. 当前未验证 / 未完成（别误以为做完了）

| 项 | 状态 |
| --- | --- |
| 规格页（现名，将改为「节点函数/连接函数」）、扩展面板、信任弹窗 | ✅ 已完成并验证（`test_spec.py` 7 项 + 运行中服务上的数值端到端 + 信任/拒绝两条路径）；细节见 PROGRESS §6.3 |
| GPU 路径 | 未验证（本机无 CuPy），仅验证 CPU 回退 |
| 桌面真实窗口点击验收 | 未做，只有 `--selftest` 与 mock 桥验证 |
| R26 的 UI 入口（DC 工作点/AC 扫频图表、Gear2/稀疏选项面板） | 未接：目前只有 `Scene` 方法与 `GET /api/operating-point`、`GET /api/ac-sweep`；后端有测试 |
| 模块化文件化、模块库面板、内部编辑 | ✅ 已完成（R02–R05；证据见 PROGRESS §7 P1） |
| 电路元件三批 + 双模型 + GB 符号 | ✅ 元件三批完成（R15，catalog 30）；**内置结构双模型视图未做**（R25） |
| 连线路由、参数分组、撤销重做 | ✅ 已完成（P2 + P0；证据见 PROGRESS §7） |
| 相图轨迹与回放 | ✅ 已完成（R11 周期/归零 + R23/P7-05 时间轴回放/循环/过期标记/求解窗口；证据见 PROGRESS §7.2） |
| 右键/分类/导线工具（R22/P7-03） | ✅ 已完成（四类右键 + 10 组分类 + 对齐分布 + 引脚右键 + 显示开关 + 空白多选 + 点两端导线；证据见 PROGRESS §7.5-A） |
| 求解器加固（事务/矩阵均衡/断点/超时） | ✅ Phase A/B/C 完成；✅ Phase D/E 完成（元件契约 + 信号/矢量整步事务，292 passed）；✅ R26/Phase F 完成（DC 工作点、AC-Bode、Gear2、稀疏矩阵，315 passed；报告 `SOLVER_OPTIMIZATION_REPORT.md`，PROGRESS §7.8/§7.9）；未做自适应 dt（D17 明确不做）、AC 非线性小信号与 UI 入口 |
## 迁移用户数据前必须先整库备份（2026-10-30）

把 `library/blocks` 从「`<id>/v<N>.block`」迁到「`<模块名>.block`」时，我只备份了将被改写的 `blocklib.py`，没有复制 `library/` 整个目录；迁移脚本又只覆盖了被扫描到的部分，结果用户两个「加法」模块的文件永久丢失（重名合并时没有兜底拷贝，旧目录被直删）。

规则：

- 任何「重命名/压平/合并/删除」用户数据目录的操作，先 `shutil.copytree` 到 `NetlabExtras/backups/<name>_<时间戳>/`，再动；
- 迁移应「先复制、再删除」，且重名冲突时保留两份（加后缀），绝不覆盖；
- 迁移后立刻统计新旧文件数并断言 `新数 >= 旧数`，不等就中止并回滚。
## 2026-10-30 模块化这一批踩过的坑（汇总）

1. **`kind === 'device'` 硬编码**：模块实例是 `kind === 'module'`，凡「带引脚节点」的判据都要走 `isPinNode()`，否则连线不带 `source_pin`，后端只报「必须指定引脚」，看起来像校验太严，其实是前端漏字段。
2. **后端补默认值要回写返回值**：`_normalize_wire_pins` 原来只改循环里的局部 `pin`，`return source_pin, target_pin` 拿到的还是空值——「单端口自动补」白写。改成 `resolved = [source_pin, target_pin]` + `resolved[index] = ...`。凡「循环解析 + 最终 return」，都要确认写回的是返回值本身。
3. **`edit` 用整行当锚点会吞相邻行**：把 `D61 整行` 或 `## 9. 变更记录` 当 `old_string` 替换，会把紧邻的空行/下一行一起吃掉（D62 跑到别处、D61 消失）。改文档表格/流水账要用「唯一子串」当锚点，改完 `grep` 数一遍关键标题。
4. **改动落地的边界要一次说清**：后端（Python）必须重启进程；前端只刷新页面。用户在同一进程里操作时，我改的文件并未加载，用户看到的报错是旧代码的——先确认「跑的是哪份代码」再谈修没修。
5. **CDP 验收三件套**：永远 `PUT /json/new` 新开标签页（老页可能「连上但不回包」）；`Network.setCacheDisabled` 否则同版本号仍吃缓存；启动引导页 `#guide` 会盖住工作台，截图前先 `#guideClose`。
6. **不要长时间占着用户的浏览器**：我开过的十几个标签页把用户的会话/自动保存搞乱（还触发过「工程使用模块引用」弹框），验收完必须自己关掉。
7. **暗色主题下判断 canvas 有没有内容**不能用「非白像素数」（背景本来就深），用 distinct 颜色数 + 有内容行数。
8. **截图上的「残影」先核实再修**：`#moduleEmpty` 看似还显示，实际 `hidden + display:none`、`elementFromPoint` 命中 canvas；用 `getComputedStyle` / `getImageData` / 原图裁图确认，避免修不存在的 bug。
9. **迁移用户数据前整库备份**（见上一节）：先 `copytree`、先复制再删除、重名保留两份、迁移后断言文件数不减。

## 2026-10-30 PlotKit 接入与对齐这一批踩过的坑（汇总）

1. **子应用挂到 `/plotkit` 后，两个"前缀"假设同时失效**（⚠ 必踩）：
   - 前端绝对路径 `/api/...`、`/static/...` 会打到宿主的根，改**相对路径 + `<base href="./">`**；
   - `no-store` 中间件原来判 `path.startswith("/static")`，挂载后 `path` 变成 `/plotkit/static/app.css` → 判不中，改了 CSS 刷新还是旧的。判据改 `"/static/" in path or path.endswith("/static") or path.endswith("/")`。
   - 自检：`curl -D - http://127.0.0.1:PORT/plotkit/static/app.css | grep -i cache-control`。
2. **repeated CDP WebSocket 连接会拖死 headless 页面**（⚠ 反复踩）：连几次之后所有 `fetch` 挂起、`Page.captureScreenshot` 超时，看起来像"页面卡死/代码有 bug"。解法：`tools/cdp_flow.mjs` 一条连接里按 `[{eval},{sleep},{shot}]` 跑完整串动作，用完即断。
3. **`[hidden]` 会被 `display:flex` 盖掉**（⚠ 第三次踩）：`.layer .body { display: flex }` 让折叠的图层卡片照样展开。凡给元素写过 `display` 的，都要补一条 `.x[hidden] { display: none }`。
4. **事件回调里先"做会回写 UI 的事"、再读 `event.target.value`**：`playhead` 的 `input` 先 `stopPlaying()`（内部把滑杆值写回旧游标）再读，永远是旧值。规则：先读用户输入，再做会改 UI 的动作。
5. **`requestAnimationFrame` 在无头/后台页会被暂停**：用 rAF 驱动的回放"点了不动"。改用 `setTimeout` + 「真实经过时间 × 速度」推进，重绘被降频也不会失真。
6. **`mpl` 的 `inset_axes` 是子轴**：`len(fig.axes)` 仍是 1，判断 inset 是否存在要看 `parent.child_axes`，否则会误判"inset 没画出来"。
7. **plotly 的三处"静默忽略"**（⚠ 不报错，只是画错）：① 子图轴引用必须是 `x2`/`y2` 这类轴 id，写 `xaxis2` 会被忽略并回落到第一个轴（表现为所有子图叠在一起）；② 对数轴的 `range` 是**指数**不是数据值，传 `[1.3, 11]` 会把坐标轴压成 1.05~1.35；③ `layout.annotations` 里混进一个非法条目（如 shape 字典），**整组文字全不渲染**——文字改用 `mode:"text"` 的 trace，线/带用 `shapes`，箭头用「线 shape + 三角 marker trace」。
