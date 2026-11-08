# C-5 路径白名单与桌面 token 收口（2026-11-09）

## 目标

把工程/工作区/桌面桥的读写统一到显式根目录白名单；桌面 token 不再出现在 URL 查询串；
`--no-token` 只允许调试构建。

## 路径白名单

- 允许根：`NETLAB_ALLOWED_ROOTS`（`os.pathsep` 分隔）；未设置时默认 `Path.home()`、
  进程当前目录、系统临时目录。
- 判定：先 `Path.resolve(strict=False)` 再 `os.path.commonpath` 比较；`..` 与符号链接
  逃逸都会被解析后拒绝；Windows 不同盘符 `commonpath` 抛 `ValueError` 时视为不在根内。
- 入口：`netlab/core/model/path_guard.py::ensure_allowed_path`；`project.py` 的
  `atomic_write`/`load_project`/`load_project_raw` 也走同一入口，避免绕过 workspace 直接写盘。
- 错误：`ValidationError("...不在允许的根目录内：<path>")`，接口层统一返回 4xx。

## 桌面会话 token

- 外壳生成 token 与一次性 `bootstrap` nonce；`ServerHost.start(token=..., bootstrap=...)`
  写入 `NETLAB_DESKTOP_TOKEN` / `NETLAB_DESKTOP_BOOTSTRAP`。
- 打开 `http://127.0.0.1:<port>/__desktop_session__/<nonce>`；中间件校验 nonce 后种
  `netlab_desktop_token`（HttpOnly、SameSite=Strict、Path=/），303 跳回 `/`。
- token 不再进入 URL 查询串；`/?token=...` 不再种 cookie，API 仍需 header 或 cookie。
- `--no-token` 需要 `NETLAB_DEBUG=1`，否则启动直接返回 2；Qt 旧壳同样处理。

## 验收

- 绝对路径、`..`、目录联接/符号链接逃逸均被拒（`test_workspace.py`）。
- bootstrap 路径种 cookie、错误 nonce 不种、query token 不种（`test_plotkit_frontend_auth.py`）。
- `_session_url` 不含 token、无 bootstrap 时报错、`--no-token` 调试开关（`test_desktop_session.py`）。
- 全量 `pytest netlab/tests -q` → 745 passed / 1 skipped；覆盖率 81.19%（门限 81）；
  变更行覆盖率 8/8 = 100%。
