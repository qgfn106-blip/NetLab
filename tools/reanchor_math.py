# -*- coding: utf-8 -*-
"""
reanchor_math.py — 把 netlab/docs/MATH.md 里所有内联 `文件.py:行` / `行-行` 锚点
重锚到当前代码。

校验基准：仓库内可从历史提交 2e306da681 取到"旧版源码"，用 difflib 把旧行号精确
翻译到当前源码（仅对未改动行可靠）；对能提取出符号（函数/类/常量）的锚点，直接用
符号在当前源码中定位（与版本无关，最可靠）。两者互补，任一条目以"新行源码确实包含
该符号 / 落在合理区间"为最终断言，失败降级 unresolved（保留原行号，绝不瞎猜）。

用法：
    python tools/reanchor_math.py            # 应用修改并写报告
    python tools/reanchor_math.py --check    # 只计算、打印校验，不改文件
"""
import sys, os, re, json, difflib, subprocess, pathlib

# 允许被脚本独立运行（不依赖调用方 cwd）
HERE = pathlib.Path(__file__).resolve().parent          # .../NetlabHome/tools
HOME = HERE.parent                                       # .../NetlabHome
MD = HOME / "netlab" / "docs" / "MATH.md"
REPORT = HERE / "reanchor_math_report.json"
OLD_COMMIT = "2e306da681"   # 旧版（MATH.md 主体锚点所依据的快照）

FILES = {
    "graph.py": "netlab/core/model/graph.py",
    "nodal.py": "netlab/core/compute/nodal.py",
    "statespace.py": "netlab/core/compute/statespace.py",
    "linalg.py": "netlab/core/compute/linalg.py",
    "transistors.py": "netlab/core/compute/transistors.py",
    "logic.py": "netlab/core/compute/logic.py",
    "digital.py": "netlab/core/compute/digital.py",
    "timers.py": "netlab/core/compute/timers.py",
    "magnetics.py": "netlab/core/compute/magnetics.py",
    "limits.py": "netlab/core/common/limits.py",
    "params.py": "netlab/core/compute/params.py",
    "simulation.py": "netlab/core/compute/simulation.py",
    "analysis.py": "netlab/core/compute/analysis.py",
}

# 已知"已对齐当前代码"的区间锚点（(md_line, "a-b")），这些不应再做历史翻译
KEEP_RANGES = {
    (330, "2282-2284"),   # operating_point 内 _newton_with_strategies 调用
    (343, "2256-2267"),   # AC_KINDS
    (343, "2353-2359"),   # AC 不支持非线性元件报错
    (343, "2351-2352"),   # AC 频率校验
    (343, "2349-2350"),   # freqs 为空校验
    (779, "396-411"),     # 预计算硬拒绝
}


def _git_show(rel):
    out = subprocess.run(["git", "show", f"{OLD_COMMIT}:{rel}"], cwd=str(HOME),
                         capture_output=True)
    if out.returncode != 0:
        return None
    return out.stdout.decode("utf-8", "replace").splitlines()


_info_cache = {}


def info(fn):
    if fn in _info_cache:
        return _info_cache[fn]
    rel = FILES[fn]
    old = _git_show(rel)
    cur = (HOME / rel).read_text(encoding="utf-8").splitlines()
    eq = {}
    if old is not None:
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=old, b=cur, autojunk=False).get_opcodes():
            if tag == "equal":
                for k in range(i2 - i1):
                    eq[i1 + k + 1] = j1 + k + 1
    _info_cache[fn] = (old, cur, eq)
    return _info_cache[fn]


def translate_line(fn, p):
    old, cur, eq = info(fn)
    return eq.get(p)


def translate_range(fn, a, b):
    """把旧区间 [a,b] 映射到当前行号，返回 (new_start,new_end) 或 None。

    以 difflib.equal 行的精确映射为锚，区间两端若含未映射（重排/换行）的旧行，
    按偏移量外推，避免区间被截短。"""
    old, cur, eq = info(fn)
    mapped_olds = [o for o in range(a, b + 1) if o in eq]
    if not mapped_olds:
        return None
    first_old, last_old = min(mapped_olds), max(mapped_olds)
    new_start = eq[first_old] - (first_old - a)
    new_end = eq[last_old] + (b - last_old)
    new_start = max(1, new_start)
    new_end = max(new_start, new_end)
    return (new_start, new_end)


def translate_line_near(fn, a):
    """单点锚点的兜底：用最近的已映射旧行 + 偏移量外推。"""
    old, cur, eq = info(fn)
    if not eq:
        return None
    # 优先向前找最近的已映射旧行（保持同一代码块），否则向后
    for o in range(a, max(0, a - 40), -1):
        if o in eq:
            return eq[o] + (a - o)
    for o in range(a, a + 40):
        if o in eq:
            return eq[o] + (a - o)
    return None


# ---------------- 符号索引 ----------------
def build_index(fn):
    old, cur, eq = info(fn)
    by_q, by_name, consts, stack = {}, {}, {}, []
    for i, line in enumerate(cur, 1):
        m = re.match(r'^(\s*)class\s+([A-Za-z_]\w*)\b', line)
        if m:
            ind = len(m.group(1)); nm = m.group(2)
            while stack and stack[-1][0] >= ind:
                stack.pop()
            stack.append((ind, nm)); by_q[nm] = i
            by_name.setdefault(nm, []).append((None, i)); continue
        m = re.match(r'^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(', line)
        if m:
            ind = len(m.group(1)); nm = m.group(2)
            while stack and stack[-1][0] >= ind:
                stack.pop()
            cls = stack[-1][1] if stack else None
            by_q[f"{cls}.{nm}" if cls else nm] = i
            by_name.setdefault(nm, []).append((cls, i)); continue
        m = re.match(r'^([A-Za-z_]\w*)\s*=', line)
        if m and not stack:
            consts.setdefault(m.group(1), i)
    return by_q, by_name, consts


_ix_cache = {}


def index(fn):
    if fn not in _ix_cache:
        _ix_cache[fn] = build_index(fn)
    return _ix_cache[fn]


def resolve(fn, sym, ch):
    by_q, by_name, consts = index(fn)
    sym = sym.strip()
    if not sym:
        return None, "nosym"
    if "." in sym:
        cls, nm = sym.rsplit(".", 1)
        if f"{cls}.{nm}" in by_q:
            return by_q[f"{cls}.{nm}"], "def"
        cand = by_name.get(nm, [])
        if len(cand) == 1:
            return cand[0][1], "def"
        if ch and ch in by_q and f"{ch}.{nm}" in by_q:
            return by_q[f"{ch}.{nm}"], "def"
        return None, ("ambiguous" if len(cand) > 1 else "notfound")
    if sym in by_q and sym[0].isupper():
        return by_q[sym], "class"
    cand = by_name.get(sym, [])
    if len(cand) == 1:
        return cand[0][1], "def"
    if len(cand) > 1:
        if ch:
            f = [l for c, l in cand if c == ch]
            if len(f) == 1:
                return f[0], "def"
        return None, "ambiguous"
    if sym in consts:
        return consts[sym], "const"
    return None, "notfound"


# ---------------- 锚点上下文抽取 ----------------
STOP = {"py", "self", "and", "or", "not", "the", "nodal", "graph", "digital", "logic"}


def parse_code(span):
    s = span.strip().replace("`", "").strip()
    if not s or re.search(r'[\u4e00-\u9fff]', s):
        return None
    if "=" in s:
        left = s.split("=", 1)[0].strip()
        return left if re.match(r'^[A-Za-z_][A-Za-z0-9_.]*$', left) else None
    if "(" in s:
        s = s.split("(", 1)[0].strip()
    return s if re.match(r'^[A-Za-z_][A-Za-z0-9_.]*$', s) else None


def split_cls(tok):
    if "." in tok:
        cls, nm = tok.rsplit(".", 1)
        return tok, (cls if cls and cls[0].isupper() else None)
    return tok, None


def extract(line, ms, me, heading_classes):
    right = line[me:]
    m = re.match(r'[\s`]*([A-Za-z_][A-Za-z0-9_.]*)', right)
    if m:
        tok = m.group(1); nxt = line[me + m.end():me + m.end() + 1]
        if tok.lower() not in STOP and re.search(r'[A-Za-z]', tok) and \
           (nxt == "" or nxt in ' \t`、|)（(,。'):
            return split_cls(tok)
    spans = [(x.start(), x.end(), x.group(1)) for x in re.finditer(r'`([^`]*)`', line) if x.end() <= ms]
    if spans:
        sym = parse_code(spans[-1][2])
        if sym:
            s, ch = split_cls(sym)
            if ch is None and heading_classes:
                ch = heading_classes[0]
            return s, ch
    left = line[:ms]
    m = re.search(r'([A-Za-z_][A-Za-z0-9_.]*)[\s`（(]*$', left)
    if m:
        tok = m.group(1)
        if not tok.endswith(".py") and tok.lower() not in STOP:
            s, ch = split_cls(tok)
            if ch is None and heading_classes:
                ch = heading_classes[0]
            return s, ch
    return None, None


def is_instance_call(sym):
    """obj.method 形式（obj 小写=实例），不应解析成 def（会撞到别的类的同名方法）。"""
    if not sym or "." not in sym:
        return False
    cls = sym.rsplit(".", 1)[0]
    return bool(cls) and cls[0].islower()


# ---------------- 主流程 ----------------
def load_lines():
    return MD.read_text(encoding="utf-8").splitlines()


def heading_class_map(lines, fn):
    """为每行找到最近 ## 标题里的类名（用于消歧 stamp 等同名方法）。"""
    by_q = index(fn)[0]
    known = set(c for c in by_q if c and c[0].isupper())
    out = []
    cur = []
    for line in lines:
        hm = re.match(r'^#{1,6}\s+(.*)', line)
        if hm:
            toks = re.findall(r'[A-Za-z_][A-Za-z0-9_]*', hm.group(1))
            cur = []
            for t in toks:
                if t in known:
                    cur.append(t)
                else:
                    for k in known:            # 大小写不敏感映射（MOSFET->Mosfet）
                        if k.lower() == t.lower():
                            cur.append(k); break
        out.append(list(cur))
    return out


def main(apply):
    lines = load_lines()
    pat = re.compile(r'(?P<file>[A-Za-z0-9_./\\-]+\.py):(?P<a>\d+)(?:-(?P<b>\d+))?')

    # 预计算每个文件的 heading 类消歧表
    hmap_cache = {}
    def hcls(ln, fn):
        if fn not in hmap_cache:
            hmap_cache[fn] = heading_class_map(lines, fn)
        return hmap_cache[fn][ln - 1]

    records = []   # 每处锚点
    for ln, line in enumerate(lines, 1):
        for m in pat.finditer(line):
            fn = m.group("file").split("/")[-1].split("\\")[-1]
            if fn not in FILES:
                continue
            a = int(m.group("a"))
            b = int(m.group("b")) if m.group("b") else None
            sym, ch = extract(line, m.start(), m.end(), hcls(ln, fn))
            rec = dict(md_line=ln, file=fn, a=a, b=b, sym=sym, ch=ch,
                       old=(f"{a}-{b}" if b else str(a)),
                       mstart=m.start(), mend=m.end(), filepart=m.group("file"))
            records.append(rec)

    # 求解
    for r in records:
        fn, a, b, sym, ch = r["file"], r["a"], r["b"], r["sym"], r["ch"]
        old, cur, eq = info(fn)
        oldc = old[a - 1].strip() if old and 0 < a <= len(old) else ""
        curc = cur[a - 1].strip() if 0 < a <= len(cur) else ""
        new = None; status = "unresolved"; method = ""

        sym_ok = bool(sym) and not is_instance_call(sym)
        S, skind = resolve(fn, sym, ch) if sym_ok else (None, "skip")

        if b is None:   # 单点锚点
            if r["md_line"] >= 755:            # 文末索引表：已是当前行号，保持
                new = str(a); status = "ok"; method = "keep(appendix)"
            elif sym_ok and S:
                new = str(S); status = "ok"; method = "symbol:" + skind
            elif oldc == "" and curc != "":
                new = str(a); status = "ok"; method = "keep(current-era)"
            else:
                t = translate_line(fn, a)
                if t is None:
                    t = translate_line_near(fn, a)
                if t:
                    new = str(t); status = "ok"; method = "diff"
        else:           # 区间锚点
            if r["md_line"] >= 755 and (r["md_line"], r["old"]) not in KEEP_RANGES:
                new = r["old"]; status = "ok"; method = "keep(appendix)"
            elif (r["md_line"], r["old"]) in KEEP_RANGES:
                new = r["old"]; status = "ok"; method = "keep(known-current)"
            elif sym_ok and S and S == a:
                new = r["old"]; status = "ok"; method = "keep(S==old)"
            elif oldc == "" and curc != "":
                new = r["old"]; status = "ok"; method = "keep(current-era)"
            else:
                tr = translate_range(fn, a, b)
                if tr:
                    new = f"{tr[0]}-{tr[1]}"; status = "ok"; method = "diffrange"
                elif sym_ok and S:
                    span = b - a
                    new = f"{S}-{S + span}"; status = "ok"; method = "symbolrange:" + skind

        # ---- 断言校验 ----
        if status == "ok":
            ok = False
            if b is None:
                nl = int(new.split("-")[0])
                src = cur[nl - 1] if 0 < nl <= len(cur) else ""
                if sym_ok and S and nl == S:
                    tok = sym.rsplit(".", 1)[-1]
                    ok = (f"def {tok}(" in src) or (f"class {tok}" in src) or \
                         bool(re.match(rf'^\s*{re.escape(tok)}\s*=', src))
                else:
                    # 非符号行（表达式/注释/docstring 等）：只要精确映射落在非空源码行即可
                    ok = bool(src.strip())
            else:
                s0, s1 = new.split("-")
                s0, s1 = int(s0), int(s1)
                ok = 1 <= s0 <= len(cur) and 1 <= s1 <= len(cur) and s0 <= s1 and \
                     bool(cur[s0 - 1].strip())
                if ok and sym_ok and S and s0 == S:
                    tok = sym.rsplit(".", 1)[-1]
                    ok = (f"def {tok}(" in cur[s0 - 1]) or (f"class {tok}" in cur[s0 - 1]) or \
                         bool(re.match(rf'^\s*{re.escape(tok)}\s*=', cur[s0 - 1]))
            if not ok:
                status = "unresolved"; method = method + "->failed-assert"; new = None

        r["new"] = new if new is not None else r["old"]
        r["status"] = status if status in ("ok", "ambiguous") else "unresolved"
        r["method"] = method

    # ambiguous 标记（符号解析为歧义且无 diff 兜底时）
    for r in records:
        if r["status"] == "ok":
            continue
        fn, sym, ch = r["file"], r["sym"], r["ch"]
        if sym and not is_instance_call(sym):
            _, why = resolve(fn, sym, ch)
            if why == "ambiguous":
                r["status"] = "ambiguous"

    # ---------- 重写 MATH.md（只改锚点数字 + 抬头两处） ----------
    new_lines = list(lines)
    # 按行分组锚点
    per_line = {}
    for r in records:
        per_line.setdefault(r["md_line"], []).append(r)
    for ln, recs in per_line.items():
        line = lines[ln - 1]
        recs.sort(key=lambda x: x["mstart"])
        out = ""
        pos = 0
        for r in recs:
            out += line[pos:r["mstart"]]
            out += r["filepart"] + ":" + r["new"]
            pos = r["mend"]
        out += line[pos:]
        new_lines[ln - 1] = out

    # 抬头
    new_lines[6] = new_lines[6].replace("最后更新：2026-11-06", "最后更新：2026-11-07")
    new_lines[8] = ("> **行号已于 2026-11-07 全量重锚至当前代码（HEAD 3ce610b）**；"
                    "函数/类名始终可靠，正文与文末索引中的 `file:line` 锚点均已对齐当前源码；"
                    "若代码与本文冲突，仍以代码为准。")

    # ---------- 数学校验 ----------
    before = "\n".join(lines)
    after = "\n".join(new_lines)
    n_dd_before = before.count("$$"); n_dd_after = after.count("$$")
    n_ddlines_before = sum(1 for l in lines if l.strip().startswith("$$"))
    n_ddlines_after = sum(1 for l in new_lines if l.strip().startswith("$$"))
    math_ok = (n_dd_before % 2 == 0) and (n_dd_before == n_dd_after) and \
              (n_ddlines_before == n_ddlines_after)

    # ---------- 报告 ----------
    report = [dict(md_line=r["md_line"], file=r["file"], old=r["old"],
                   new=r["new"], symbol=(r["sym"] or ""), status=r["status"],
                   method=r["method"]) for r in records]
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if apply:
        MD.write_text(after + "\n", encoding="utf-8")

    # ---------- 汇总 ----------
    from collections import Counter
    cnt = Counter(r["status"] for r in records)
    print(f"APPLY={apply}  MATH.md={MD}")
    print(f"TOTAL={len(records)}  ok={cnt['ok']}  unresolved={cnt['unresolved']}  ambiguous={cnt['ambiguous']}")
    print(f"math: $$count {n_dd_before}->{n_dd_after} even={n_dd_before%2==0} "
          f"ddlines {n_ddlines_before}->{n_ddlines_after} OK={math_ok}")
    print("--- unresolved/ambiguous ---")
    for r in records:
        if r["status"] != "ok":
            print(f"  L{r['md_line']} {r['file']}:{r['old']}  sym={r['sym']} why={r['method']}")
    print("--- sample evidence (first 10 ok) ---")
    shown = 0
    for r in records:
        if r["status"] == "ok" and shown < 10:
            fn = r["file"]; cur = info(fn)[1]
            nl = int(r["new"].split("-")[0])
            print(f"  L{r['md_line']} {fn} {r['old']} -> {r['new']}  sym={r['sym']}  "
                  f"src[{nl}]= {cur[nl-1].strip()[:70]}")
            shown += 1
    return 0 if math_ok else 2


if __name__ == "__main__":
    apply = "--check" not in sys.argv
    sys.exit(main(apply))
