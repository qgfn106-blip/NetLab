; Netlab 单文件安装器 —— Inno Setup 6 脚本（POC）
; 用法：先在 NetlabHome/ 下用 PyInstaller 生成 dist\netlab（onedir），
;       再安装 Inno Setup 6 并执行：ISCC tools\packaging\netlab.iss
; 说明：本机未装 Inno Setup 时此脚本不会被执行；它只是可复现的打包定义。

#define AppName "Netlab"
#define AppVer "3.20.1"

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
OutputBaseFilename=NetlabSetup-{#AppVer}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
DisableProgramGroupPage=yes

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式"

[Files]
Source: "..\..\dist\netlab\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\netlab.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\netlab.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\netlab.exe"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent
