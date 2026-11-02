# -*- coding: utf-8 -*-
"""生成 docs/assets/netlab-structure.svg（结构图，纯标准库，无第三方依赖）。"""
W,H=1400,900
FONT="Microsoft YaHei UI, Segoe UI, sans-serif"
def esc(t): return t.replace('&','&amp;').replace('<','&lt;')
parts=[]
def box(x,y,w,h,fill,stroke,label,sub="",ls=18,fs=15,rx=10,dash=None):
    d=f' stroke-dasharray="{dash}"' if dash else ''
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"{d}/>')
    ty=y+h/2-(6 if sub else 0)
    parts.append(f'<text x="{x+w/2}" y="{ty}" text-anchor="middle" font-family="{FONT}" font-size="{ls}" font-weight="600" fill="#22282b">{esc(label)}</text>')
    if sub:
        for i,line in enumerate(sub.split("\n")):
            parts.append(f'<text x="{x+w/2}" y="{y+h/2+16+i*15}" text-anchor="middle" font-family="{FONT}" font-size="{fs}" fill="#5d666b">{esc(line)}</text>')
def arrow(x1,y1,x2,y2,color="#6b757a",dash=None):
    d=f' stroke-dasharray="{dash}"' if dash else ''
    parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.8" marker-end="url(#ah)"{d}/>')
def label(x,y,text,size=12.5,anchor="start",fill="#6b757a",weight="400"):
    parts.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{fill}">{esc(text)}</text>')
parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
parts.append('<defs><marker id="ah" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#6b757a"/></marker></defs>')
parts.append(f'<rect width="{W}" height="{H}" fill="#fbfbfa"/>')
parts.append(f'<text x="40" y="46" font-family="{FONT}" font-size="26" font-weight="700" fill="#1f2528">Netlab 代码结构（2026-11-02 重构后）</text>')
parts.append(f'<text x="40" y="72" font-family="{FONT}" font-size="14" fill="#6b757a">前端只经 HTTP 访问后端；后端计算 / 模型 / 公共三层；旧 netlab/&lt;mod&gt;.py 为转发 shim</text>')
box(40,110,600,150,"#eef3f6","#8fb3c4","frontend/  前端（HTML/CSS/JS）","index.html · style.css · app.js\ndesktop-shim.js")
box(680,110,320,150,"#f5efe6","#c9a678","desktop/  桌面壳（pywebview）","webview_app · webview_bridge\nserver_host · 无边框窗控")
box(1040,110,320,150,"#eaf2ea","#8fae8f","PlotKit（独立子应用）","/plotkit/ · ?embed=1 iframe")
box(360,310,660,90,"#e8eef7","#7f97c0","netlab/server.py   HTTP API 层","/api/* 路由 · Pydantic 模型 · 前端目录解析")
box(1040,310,320,90,"#eaf2ea","#8fae8f","netlab/plotkit_bridge.py","ensure_plotkit_importable · mount()")
parts.append('<rect x="40" y="450" width="1320" height="360" rx="14" fill="#f7f7f5" stroke="#c8c8c2" stroke-width="1.6"/>')
parts.append(f'<text x="64" y="482" font-family="{FONT}" font-size="18" font-weight="700" fill="#22282b">netlab/core/   后端内核（不 import server / desktop / frontend）</text>')
box(70,505,500,140,"#e9f1f4","#7fa3b5","model/  连接与场景模型（12）","graph · scene · networks · project\nworkspace · blocks/blocklib · templates")
box(600,505,340,140,"#f0ece4","#bda98d","compute/  计算内核（20）","simulation · nodal · linalg · fem\ncomputes · methods · digital · magnetics")
box(960,505,370,140,"#f2f2ef","#a9a9a2","common/  公共（1）","limits（输入边界 / 异常 / 校验）")
box(70,680,500,110,"#ffffff","#9fb8c4","compute/ 其余","waveform · params · safeexpr · statespace\naccel · analysis · introspection · profiling · timers")
box(600,680,730,110,"#ffffff","#bda98d","依赖方向（单向，无环）","server → model.networks → model.workspace → compute.simulation/fem\n→ model.scene → model.graph / compute.nodal / compute.params")
arrow(340,262,400,310)
label(300,300,"HTTP /api/*",11.5)
arrow(560,400,560,450,dash="5,4")
arrow(1200,260,1200,310)
arrow(1040,355,1000,400,dash="5,4")
arrow(340,192,676,192,dash="4,4")
arrow(1140,180,1004,180,dash="4,4")
parts.append('</svg>')
open('docs/assets/netlab-structure.svg','w',encoding='utf-8').write("\n".join(parts))
print("wrote docs/assets/netlab-structure.svg")
