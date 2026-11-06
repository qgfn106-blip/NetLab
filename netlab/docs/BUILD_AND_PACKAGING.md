# 前端构建与桌面打包（BUILD & PACKAGING）

> 适用：netlab 前端（`NetlabHome/frontend`）与 PlotKit 前端静态脚本（`PlotKit/src/plotkit/static`）。
> 最后更新：2026-11-06

## 1. 为什么保留 `.ts` 源 + 提交 `.js` 产物

项目红线是**运行时零构建、零第三方运行时依赖、离线可用**：浏览器 / pywebview / Python 打包只认 `.js`，页面用原生 `<script>` / ES Module 加载。

因此采用「双文件」模型（D100/D101）：

- `*.ts` = 类型化源码，人只改 `.ts`；
- `*.js` = **开发期**用构建脚本生成的产物，**提交入库**，随包发布，运行期不需要 node / npm。

> 这样既能享受 TypeScript 的类型检查与 IDE 体验，又不在运行时引入任何构建步骤。

## 2. 构建工具链

- Node：见各项目根 `.nvmrc`（当前 `24`）；`package.json` 声明 `engines.node >= 20`。
- 构建器：**esbuild**（仅 devDependency，不进运行时）。类型检查：`typescript`（`tsc --noEmit`）。

### netlab 前端（`NetlabHome/frontend`）

```bash
cd NetlabHome/frontend
npm ci            # 首次或依赖变更后（package-lock.json 已提交，可复现）
npm run typecheck # tsc -p tsconfig.json --noEmit（strict）
npm run build     # esbuild 生成 app.js / app.utils.js / desktop-shim.js
npm run test      # node --test tests/*.test.mjs（纯函数单测）
```

- `app.ts` 与 `app.utils.ts` 以 **ESM** 输出（`import ... from "./app.utils.js"`）；
- `desktop-shim.ts` 以 **IIFE** 输出（`desktop-shim.js`）；
- 产物 `*.js` 提交入库；CI 用 `git diff --exit-code` 做**漂移守卫**（提交的产物必须等于一次干净构建）。

### PlotKit 静态脚本（`PlotKit`）

```bash
cd PlotKit
npm ci
npm run typecheck # tsc -p tsconfig.json --noEmit
npm run build     # esbuild 6 个 ts -> ESM js（app/render2d/view3d/nsview/plot2d.utils/plot3d.utils）
npm run test:utils
```

> `app.ts` 顶部 `import "./view3d.js"; import "./render2d.js";`，`index.html` 用单个 `<script type="module" src="static/app.js">` 加载。

## 3. 持续集成（CI）

- `.github/workflows/frontend-ts-build.yml`（netlab）、`.github/workflows/frontend-static-build.yml`（PlotKit）：
  `npm ci → typecheck → build → test → git diff --exit-code`（产物漂移守卫）。
- 若构建产物与提交的 `.js` 不一致，CI 直接失败，防止「只改 `.ts` 忘了重新 build」。

## 4. 运行时侧的 PlotKit 内置副本（vendor）

netlab 运行期 import 的是包内副本 `netlab/_vendor/plotkit`（非外部 PlotKit）。**改了 PlotKit 静态脚本后必须重装 vendor**：

```bash
cd NetlabHome
python -m netlab.plotkit_vendor install --src ../PlotKit/src/plotkit --force
```

`netlab/plotkit_vendor.py` 的 IGNORE 已排除 `*.ts` / `*.tsbuildinfo`，vendor 只随包 `.js`。

## 5. 单 exe 桌面分发（POC 已验证，2026-11-06）

把程序交给普通用户可打包为单安装器（与上面的前端构建正交，B 方案下先 `npm run build` 再打包）：

1. **PyInstaller / Nuitka** 打 `netlab.desktop`（onedir 最稳）：内含 Python 解释器、依赖、`frontend/`、`_vendor/plotkit` —— 用户无需装 Python。
2. **Inno Setup / NSIS** 生成单文件 `NetlabSetup-x.y.z.exe`，可集成 WebView2 Evergreen Bootstrapper。
3. CI（GitHub Actions windows runner）打 tag 时自动出包并上传 Release。

注意：体积数百 MB、Windows-only、需代码签名（SmartScreen）、PyInstaller `hiddenimports` 需按插件/后端补齐。

## 6. POC 结果（2026-11-06，Windows / anaconda base）

- **入口脚本**：`tools/packaging/netlab_entry.py`（frozen 时把 `NETLAB_FRONTEND_DIR` 指到 `_MEIPASS/frontend`，再 `from netlab.desktop.webview_app import main`）。
- **构建**（在 `NetlabHome/` 下）：`python -m PyInstaller netlab.spec`（spec 已提交）。关键点：
  - `--add-data frontend;frontend`、`--add-data extensions;extensions`、`--add-data netlab/_vendor;netlab/_vendor`（vendor 运行时副本必须打进包）；
  - `--collect-all webview`、`--collect-all pythonnet`（WebView2 需要 pythonnet/clr）、`--collect-submodules netlab`、`--exclude-module netlab.tests`；
  - **排除 `PyQt5/PySide6/PyQt6/PySide2`**（anaconda 同时装多个 Qt 绑定会导致 `multiple Qt bindings` 构建失败）、补 `uvicorn.*` hidden-imports。
- **产物**：`dist/netlab/netlab.exe`（onedir）。
- **冒烟（真窗口）**：`dist\netlab\netlab.exe --probe` → exit 0，`has_bridge=true / has_win_ctl=true / has_command=true / has_autosave_roundtrip='true' / drag_region=29 / rss_tree_mb≈712`；即打包后 WebView2 壳、JS↔Python 桥接、前端（含 PlotKit vendor）均正常。
- **体积**：本次用 anaconda base，`dist/netlab` ≈ **1.63 GB**（含大量无关包如 torch/notebook），**不代表最终体积**；正式出包应在干净 venv（仅装运行依赖 + pyinstaller + pywebview + pythonnet）下构建，预期可压到数百 MB。
- **单文件安装器**：`tools/packaging/netlab.iss`（Inno Setup 6）。本机未装 Inno Setup（`iscc` 不在 PATH），故**未产出单 exe 安装器**，属下一步（装 Inno 后 `ISCC netlab.iss`，或试 PyInstaller onefile）。
- **建议**：PyInstaller onefile 启动需解压、且 pythonnet/WebView2 对路径敏感，**推荐 onedir + Inno** 而非 onefile。
