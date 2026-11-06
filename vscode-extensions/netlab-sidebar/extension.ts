// Netlab 工作区 · VS Code 扩展骨架
// 侧边栏：webview 视图（netlab.sidebar.home）+ 树视图（netlab.sidebar.tools）
// 一键插件：contributes.commands 的占位命令，后续在 registerCommand 里接具体动作。
//
// 说明：本文件为 TypeScript 源码；extension.js 由 `npm run compile`（tsc）生成并随包提交，
// 运行期仍为 CommonJS，VS Code 通过 package.json 的 "main": "./extension.js" 加载。
import vscode = require('vscode');

function workbenchUrl(): string {
  const cfg = vscode.workspace.getConfiguration('netlab');
  return String(cfg.get<string>('workbenchUrl') || 'http://127.0.0.1:8767');
}

class HomeViewProvider {
  private view: vscode.WebviewView | null = null;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'openWorkbench') {
        vscode.commands.executeCommand('netlab.openWorkbench');
      } else if (msg.type === 'refresh') {
        this.refresh();
      } else if (msg.type === 'demo') {
        vscode.commands.executeCommand('netlab.oneClickDemo');
      }
    });
  }

  refresh(): void {
    if (this.view) this.view.webview.html = this.html();
  }

  html(): string {
    const url = workbenchUrl();
    const nonce = String(Math.random()).slice(2);
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px 12px; }
  h3 { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; margin: 4px 0 10px; }
  .card { border: 1px solid var(--vscode-panel-border, #3a3a3a); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; background: var(--vscode-editorWidget-background, transparent); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  button { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  code { font-family: var(--vscode-editor-font-family); opacity: .8; word-break: break-all; }
  .muted { opacity: .6; font-size: 12px; }
</style></head>
<body>
  <h3>NETLAB 工作区</h3>
  <div class="card">
    <div class="muted">当前工作台</div>
    <div style="margin:6px 0 10px"><code>${url}</code></div>
    <div class="row">
      <button id="open">打开工作台</button>
      <button id="refresh" class="secondary">刷新</button>
    </div>
  </div>
  <div class="card">
    <div class="muted">一键插件（骨架）</div>
    <div style="margin-top:8px" class="row">
      <button id="demo" class="secondary">示例动作</button>
    </div>
    <p class="muted" style="margin:10px 0 0">后续在 package.json 的 contributes.commands 与 extension.js 的 registerCommand 里补充具体能力。</p>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'openWorkbench' }));
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('demo').addEventListener('click', () => vscode.postMessage({ type: 'demo' }));
  </script>
</body></html>`;
  }
}

interface NetlabTreeItem extends vscode.TreeItem {
  children?: NetlabTreeItem[];
}

class ToolsProvider {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NetlabTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: NetlabTreeItem): NetlabTreeItem[] {
    if (element) return element.children || [];
    return [
      this.item('打开工作台', 'netlab.openWorkbench', 'link-external'),
      this.item('刷新状态', 'netlab.refreshSidebar', 'refresh'),
      this.item('示例动作（占位）', 'netlab.oneClickDemo', 'beaker'),
    ];
  }

  item(label: string, command: string, icon: string): NetlabTreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.command = { command, title: label };
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const home = new HomeViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('netlab.sidebar.home', home, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const tools = new ToolsProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('netlab.sidebar.tools', tools));

  context.subscriptions.push(
    vscode.commands.registerCommand('netlab.openWorkbench', () => {
      vscode.env.openExternal(vscode.Uri.parse(workbenchUrl()));
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('netlab.refreshSidebar', () => {
      home.refresh();
      tools.refresh();
      vscode.window.showInformationMessage('Netlab: 状态已刷新');
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('netlab.oneClickDemo', () => {
      vscode.window.showInformationMessage('Netlab 一键插件占位：后续在此接入具体动作');
    })
  );

  vscode.window.showInformationMessage('Netlab 工作区扩展已加载');
}

export function deactivate(): void {
  // 无资源需要释放
}
