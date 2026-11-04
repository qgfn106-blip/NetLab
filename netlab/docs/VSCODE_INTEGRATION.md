# VS Code 集成（内嵌完整 IDE）

> 2026-11-02 实现。在 netlab HTML UI 内以浮窗承载完整 VS Code Web（终端 / 扩展 / 调试可用）。
> 采用 **官方 `code serve-web` 服务器 + 直接跨源 iframe**，不使用 code-server、不做反向代理。

## 1. 架构

```
netlab 页面 (http://127.0.0.1:<netlabPort>/)
  └─ #vscodeWin (floatwin)  ──iframe src──▶  http://127.0.0.1:<vscodePort>/code/
                                                    （VS Code Server，同源于自身 WebSocket）
```

- **后端** `netlab/vscode_bridge.py`：按需拉起 / 复用 VS Code Server 子进程。
- **路由** `netlab/server.py`：`GET /api/vscode/status?start=1` 返回 `{available, running, url, port, error}`。
- **前端** `frontend/index.html`（`#vscodeWin`）、`style.css`（`.vscode-*`）、`app.js`（`openVscode/ensureVscodeFrame/closeVscode/openVscodeWindow`，菜单「工具 → 代码工作区（VS Code）」及「代码工作区（独立窗口）」）。
- **独立窗口外壳** `frontend/code-host.html`：复用 netlab 页眉的 slim 外壳页，整屏 iframe 承载 VS Code（见 §6）。

**为什么直接 iframe 而不反代**：workbench 页面实测无 `X-Frame-Options`、无 CSP `frame-ancestors`；且页面资源与 WebSocket 都指向 VS Code Server 自身 origin，自洽同源。反代只会增加 HTTP 流式响应 + WS 双向转发的复杂度，没有收益。

## 2. 目录与配置

VS Code Server 目录（内含 `node.exe`、`out/server-main.js`）：

```
NetlabExtras/vscode-server/server/vscode-server-win32-x64-web/   # 约 614 MB
```

`vscode_bridge.find_server_dir()` 的查找顺序：

1. 环境变量 `NETLAB_VSCODE_SERVER_DIR` 指向的目录
2. `%LOCALAPPDATA%/netlab/vscode-server/vscode-server-win32-x64-web`
3. 仓库内 `NetlabExtras/vscode-server/server/vscode-server-win32-x64-web`

其它环境变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `NETLAB_VSCODE_SERVER_DIR` | 覆盖 server 目录 | 见上 |
| `NETLAB_VSCODE_FOLDER` | VS Code 打开的默认文件夹 | `NetlabHome/` |
| `NETLAB_VSCODE_PORT` | VS Code Server 固定端口（固定 origin 才能命中前端包缓存） | `8790`（被占用才退化随机端口） |

启动参数（`vscode_bridge.start()`）：

```
node.exe out/server-main.js --host 127.0.0.1 --port <8790 优先，占用才随机> \
  --without-connection-token --server-base-path /code/ \
  --disable-telemetry --accept-server-license-terms \
  --disable-workspace-trust --default-folder <NETLAB_VSCODE_FOLDER>
```

- 端口优先固定 8790（`NETLAB_VSCODE_PORT` 可改）；被占用才退化为随机空闲端口。
- 就绪判定 = 轮询 `GET /code/` 返回 200（超时 40s）。
- 子进程 `CREATE_NO_WINDOW`，stdout/stderr 写 `%TEMP%/netlab-vscode-server.log`。
- `atexit` + `server.py` lifespan 的 `finally` 调用 `vscode_bridge.shutdown()`，随 netlab 退出而终止。
- `--disable-workspace-trust` 是**必须**的：否则 workbench 进入 Restricted Mode，内置扩展（Netlab 侧栏）不会加载。

## 3. 使用

启动 netlab（桌面壳 `python -m netlab.desktop` 或 `python -m uvicorn netlab.server:app`）后：

1. 顶部菜单 **工具 → 代码工作区（VS Code）**
2. 浮窗打开，状态条显示「正在启动 VS Code Server…」，首次启动约 1–3s
3. 加载完成即得到完整 VS Code（左侧 Explorer 指向 `NETLAB_VSCODE_FOLDER`，终端 / 扩展 / 调试可用）
4. 浮窗支持拖动、双击标题最大化、右下角缩放、关闭
5. 需要独立窗口时：点浮窗标题栏的 **⧉（在独立窗口中打开）**，或菜单 **工具 → 代码工作区（独立窗口）**

## 4. 性能（实测，2026-11-02）

| 阶段 | 耗时 | 说明 |
| --- | --- | --- |
| 服务器冷启动 → `/code/` 200 | 0.6–0.9s | node 进程 + 扩展宿主，很快 |
| 浏览器 **冷缓存** 导航 → workbench 出现 | 5.1–8.4s | 下载/解析/执行 ~21.5MB 前端包（workbench.js），首帧慢的主因 |
| 浏览器 **热缓存** 二次加载 | ~1.7s | 同 origin 命中磁盘缓存 |

**关键**：WebView2 磁盘缓存按 origin（含端口）分区。早期每次随机端口 → 每次都是新 origin → 每次冷启动。现已固定端口 8790，跨应用启动也能命中缓存。另外：曾经打开过 VS Code 的用户，下次应用启动后会在后台静默预热（拉起 server + 预载 iframe），点开接近瞬时；首次用户不预载（省内存）。

## 5. 验证

- `/api/health` → 200
- `/api/vscode/status?start=1` → `{"available":true,"running":true,"url":"http://127.0.0.1:<port>/code/","port":<port>,"error":null}`
- `/code/` → 200（workbench.html），无 X-Frame-Options / frame-ancestors
- 视觉：Edge CDP 截图（真实加载 + 真实点菜单）见
  `NetlabExtras/scratch/shots/vscode_cdp.png`、`netlab_vscode_embed.png`、`netlab_vscode_menu.png`

## 6. 独立窗口（detach）

把 VS Code 从浮窗升级成一个**独立原生窗口**，但仍复用 netlab 的页眉外壳。

```
netlab 页面 ──(点 ⧉ / 菜单)──▶  pywebview.create_window(新建原生窗口)
                                     └─ url = /static/code-host.html?vscode=<vscodeUrl>
                                              └─ #topbar（NETLAB 页眉）+ iframe ──▶ VS Code
```

- **前端** `app.js`：`openVscodeWindow()` —— 先取 `/api/vscode/status?start=1` 拿 `url`，拼 `href = /static/code-host.html?vscode=<encodeURIComponent(url)>`；桌面壳里调 `window.pywebview.api.open_vscode_window(href)`，纯浏览器里退回 `window.open(href)`。入口：①浮窗标题栏 `⧉` 按钮 `#vscodeWinPopout`；②菜单「工具 → 代码工作区（独立窗口）」。
- **桌面壳** `netlab/desktop/webview_bridge.py`：新增 `WebviewBridge.open_vscode_window(href)`，用 `self.url` 作 base 把相对路径拼成绝对地址，再 `webview.create_window("Netlab · 代码", target, js_api=_CodeWindowApi(), width=1280, height=860, min_size=(720,520))`。pywebview 在 `start()` 之后从 js_api 回调线程调用 `create_window` 会立即建窗（见 pywebview 源码 `create_window` 尾部：非 MainThread 且 guilib 就绪 → `guilib.create_window`）。
- **子窗口桥** `_CodeWindowApi`：只暴露 `close()`（销毁本窗口）与 `focus_main()`（`restore()` 主窗口），供外壳页的「关闭 / 回到工作台」按钮调用。
- **外壳页** `frontend/code-host.html`：复用 `#topbar` + `.brand` 样式（同一 `style.css`）；`?vscode=` 指定 VS Code 地址；`刷新` 重载 iframe，`关闭` 调 `pywebview.api.close()`，`回到工作台` 调 `focus_main()` 后关窗；非桌面环境 `window.close()` 兜底。

**验证（浏览器路径，Edge CDP）**：点击「代码工作区（独立窗口）」菜单项 → `window.open` 捕获到 `href = /static/code-host.html?vscode=http%3A%2F%2F127.0.0.1%3A8790%2Fcode%2F`（编码正确）；直接打开该页 → 页眉（NETLAB 代码 · 独立工作区）+ 完整 VS Code workbench 渲染。截图 `NetlabExtras/scratch/shots/code_host_detach.png`。pywebview 原生建窗路径用假 `create_window` 单测过（URL join、js_api、close 均正确），**真机桌面壳待实跑一次**。

## 7. 侧边栏扩展（骨架）

源码 `NetlabHome/vscode-extensions/netlab-sidebar/`（`package.json` / `extension.js` / `media/netlab.svg`），发布物同目录 `netlab-sidebar-0.0.1.vsix`。

贡献点：

| 类型 | id | 内容 |
| --- | --- | --- |
| 活动栏容器 | `netlab` | 标题 Netlab，图标 `media/netlab.svg`（同心圆+准星） |
| 视图（webview） | `netlab.sidebar.home` | 「工作区」：显示当前工作台 URL，按钮 打开工作台 / 刷新 |
| 视图（TreeView） | `netlab.sidebar.tools` | 「一键插件」：打开工作台 / 刷新状态 / 示例动作（占位） |
| 命令 | `netlab.openWorkbench` / `netlab.refreshSidebar` / `netlab.oneClickDemo` | 在 `extension.js` 里注册 |
| 配置 | `netlab.workbenchUrl` | 默认 `http://127.0.0.1:8767` |

**安装机制**：`vscode_bridge._install_bundled_extensions()` 首次启动时用官方 CLI

```
node.exe out/server-main.js --install-extension <repo>/vscode-extensions/netlab-sidebar-0.0.1.vsix \
  --extensions-dir ~/.vscode-server/extensions --accept-server-license-terms
```

成功后写 marker `.netlab-ext-netlab-sidebar-0.0.1`，后续启动跳过。

**两个必须记住的坑**：

1. **必须走 vsix 安装**。纯目录复制进 `~/.vscode-server/extensions/` 只会被当成 "external source"，`extensions.json` 条目缺 `metadata`，VS Code 不加载它（活动栏没有 Netlab 图标）。vsix 安装写出的条目才带 `metadata`。
2. **必须传 `--disable-workspace-trust`**。否则 workbench 处于 Restricted Mode，扩展被禁用，活动栏同样没有 Netlab 图标。

**验证（Edge CDP）**：活动栏出现第 6 个 Netlab 图标；点击后侧栏显示「工作区 / 一键插件」，webview 与 TreeView 均渲染，右下角 toast「Netlab 工作区扩展已加载」。截图 `NetlabExtras/scratch/shots/netlab_sidebar_open.png`、`vscode_en.png`。

## 8. 已知限制 / 待办

- **中文语言包乱码**：中文 Windows 下 workbench 会自动安装 `ms-ceintl.vscode-language-pack-zh-hans`；若网络/代理导致下载不完整，会出现「串词」乱码（语言包版本与 server 版本不匹配）。规避：删掉 `~/.vscode-server/extensions/ms-ceintl.vscode-language-pack-zh-hans-*` 后按英文使用；后续可打包匹配版本的语言包或强制 `locale=en`。
- **打包**：当前 server 目录位于 `NetlabExtras/`，随仓库分发体积约 614MB；正式发布需决定是否随包、或首启按需下载（zip 在 `NetlabExtras/scratch/vscode-server-win/vscode-server-win32-x64-web.zip`，207MB）。
- 固定端口 8790（`NETLAB_VSCODE_PORT` 可改）；同一 `~/.vscode-server` 被多实例共享，扩展目录可能竞争（低概率）。
- 资源版本号已从 `?v=3.15.6` 升到 `?v=3.15.9`（style.css / app.js）。
- 独立窗口：真机 pywebview 桌面壳需实跑确认（浏览器路径已 CDP 验证；原生建窗逻辑单测过）。
- 侧栏内容仍是骨架：`一键插件` 的 `示例动作` 是占位；后续在 `extension.js` 的 `registerCommand` 里补真实动作。
