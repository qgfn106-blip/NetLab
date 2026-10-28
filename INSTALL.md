# 安装与部署

Netlab 是一个纯本地 Web 应用：装好 Python 依赖后，`python -m netlab.run` 会在本机起服务，用浏览器打开 `http://127.0.0.1:8010/` 即可。**不需要联网也能运行**，安装阶段才需要网络（或预先准备的 wheels）。

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| Python | 3.11 及以上（开发与验证覆盖 3.11 / 3.12 / 3.13） |
| 操作系统 | Windows 10/11、macOS、Linux |
| 浏览器 | Chrome / Edge / Firefox 等现代浏览器（Canvas 2D + ES2020） |
| 依赖 | `fastapi`、`uvicorn`、`numpy`、`scipy`（见 `netlab/requirements.txt`） |
| 可选 | `PySide6`（仅桌面窗口版需要） |

## 2. 在线安装（本机有网）

```bash
git clone https://github.com/qgfn106-blip/netlab.git
cd netlab

python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

python -m pip install -r netlab/requirements.txt
python -m netlab.run
```

浏览器会自动打开 <http://127.0.0.1:8010/>。也可以不自动打开：

```bash
python -m netlab.run --no-browser --port 8020
```

不建 venv、直接用系统 Python 也可以，只是依赖会装进全局环境。

### 桌面窗口版（可选）

```bash
python -m pip install -r netlab/requirements-desktop.txt
python -m netlab.desktop
```

桌面壳只监听 `127.0.0.1`，窗口关闭即退出。Windows 也可双击 `netlab/start_desktop.bat`。

### 自检

```bash
python -m netlab.desktop --selftest     # 期望输出里 "ok": true
```

没有安装 PySide6 时可以用下面的方式做最基本的导入检查：

```bash
python -c "import netlab, numpy, scipy, fastapi, uvicorn; print(netlab.__version__)"
```

## 3. 完全离线的电脑

思路：**在联网机器上下载依赖，拷到目标机器上离线安装**。

> wheels 与操作系统、CPU 架构、Python 版本绑定。目标机器是 Windows x64 + Python 3.12，就要在同样的环境里下载；最好两边的 Python 小版本一致。

### 3.1 联网机器：下载 wheels

```bash
mkdir wheels
python -m pip download -d wheels -r netlab/requirements.txt
# 如需桌面版，再补一份：
python -m pip download -d wheels -r netlab/requirements-desktop.txt
```

把整个项目目录（含 `wheels/`）拷到 U 盘。

### 3.2 目标机器：离线安装

```bash
cd netlab
python -m pip install --no-index --find-links wheels -r netlab/requirements.txt
python -m netlab.run
```

`--no-index` 强制 pip 不访问网络，`--find-links wheels` 只从本地目录取包。只要 wheels 齐全，这一步不需要任何网络。

### 3.3 目标机器没有 Python

两个办法：

1. 先装 Python（安装包可离线拷过去），再按 3.2 做；
2. 用 PyInstaller 把应用打成独立包（需要额外构建，体积几十 MB，不是本仓库的默认交付方式）：

```bash
python -m pip install pyinstaller
python -m PyInstaller --noconfirm --onefile --name netlab ^
  --add-data "netlab/static;netlab/static" netlab/run.py
```

打包产物可能仍需要显式指定端口/关闭自动开浏览器，具体以构建结果为准。

## 4. 端口与网络

- 默认端口 **8010**。被占用时换一个：`python -m netlab.run --port 8021`。
- 默认**只监听 `127.0.0.1`**：只有本机能访问，不需要放行防火墙。
- Netlab 没有账号体系，也不会主动对外暴露。**不建议**用 `--host 0.0.0.0` 把编辑与文件接口开放给局域网；如果确实需要共享，请只在可信网络中短暂开启，用完立即关闭。
- 跨公网访问需要端口转发或内网穿透，风险更高，本仓库不提供该配置。

## 5. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `端口 8010 已被占用` | 旧进程未退出：换 `--port`，或在任务管理器结束残留的 `python.exe` |
| 浏览器打开是空白/旧界面 | 强制刷新（Ctrl+F5）；静态资源带 `?v=` 版本键，正常刷新即可 |
| 启动时出现 `gmpy2` 相关警告 | 可选的加速库在部分环境导入失败，不影响运行；可忽略 |
| `ModuleNotFoundError: netlab` | 请回到仓库根目录（含 `netlab/` 的目录）再执行 `python -m netlab.run` |
| 桌面窗口版报 PySide6 缺失 | `python -m pip install -r netlab/requirements-desktop.txt` |
| macOS 提示“无法验证开发者” | 系统设置 → 隐私与安全性 → 仍要打开；或用 `python -m netlab.run` 网页版 |
| 保存工程提示校验和不匹配 | 工程文件被外部程序改过；请用界面「另存为」重建，或恢复备份 |

## 6. 卸载

删除项目目录即可。依赖装在虚拟环境里时，删掉 `.venv/` 就干净了；装在全局时按需 `python -m pip uninstall fastapi uvicorn numpy scipy`。Netlab 不写注册表、不装服务、不在 `~` 下留数据。
