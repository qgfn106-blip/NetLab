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
- **前端** `frontend/index.html`（`#vscodeWin`）、`style.css`（`.vscode-*`）、`app.js`（`openVscode/ensureVscodeFrame/closeVscode`，菜单「工具 → 代码工作区（VS Code）」）。

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
node.exe out/server-main.js --host 127.0.0.1 --port <自动空闲端口> \
  --without-connection-token --server-base-path /code/ \
  --disable-telemetry --accept-server-license-terms --default-folder <NETLAB_VSCODE_FOLDER>
```

- 端口由 `socket.bind(127.0.0.1, 0)` 动态分配；就绪判定 = 轮询 `GET /code/` 返回 200（超时 40s）。
- 子进程 `CREATE_NO_WINDOW`，stdout/stderr 写 `%TEMP%/netlab-vscode-server.log`。
- `atexit` + `server.py` lifespan 的 `finally` 调用 `vscode_bridge.shutdown()`，随 netlab 退出而终止。

## 3. 使用

启动 netlab（桌面壳 `python -m netlab.desktop` 或 `python -m uvicorn netlab.server:app`）后：

1. 顶部菜单 **工具 → 代码工作区（VS Code）**
2. 浮窗打开，状态条显示「正在启动 VS Code Server…」，首次启动约 1–3s
3. 加载完成即得到完整 VS Code（左侧 Explorer 指向 `NETLAB_VSCODE_FOLDER`，终端 / 扩展 / 调试可用）
4. 浮窗支持拖动、双击标题最大化、右下角缩放、关闭

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

## 6. 已知限制 / 待办

- **首次打开是 Restricted Mode**：VS Code 对未信任文件夹默认受限；点「信任」即可用终端等功能。可在 server 目录写入 workspace trust 以自动化（未做）。
- **打包**：当前 server 目录位于 `NetlabExtras/`，随仓库分发体积约 614MB；正式发布需决定是否随包、或首启按需下载（zip 在 `NetlabExtras/scratch/vscode-server-win/vscode-server-win32-x64-web.zip`，207MB）。
- 每次启动动态端口，多实例互不干扰；同一 `~/.vscode-server` 被多实例共享，扩展目录可能竞争（低概率）。
- 资源版本号已从 `?v=3.15.6` 升到 `?v=3.15.7`（style.css / app.js）。
