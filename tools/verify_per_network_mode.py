"""验证：每个 Network 独立保存工作模式（signal/circuit/vector）。

运行（在 NetlabHome 目录）：
    python tools/verify_per_network_mode.py

证明：
  1) 新建两个网络，分别指定 signal / circuit；
  2) 切换活动网络时，返回的 scene.mode 跟随该网络；
  3) 修改某网络模式只影响它自己；
  4) 导出工程 -> 重新导入后，各网络模式保持不变。
"""

from fastapi.testclient import TestClient

from netlab.server import app


def main() -> None:
    with TestClient(app) as client:
        base = client.get("/api/networks").json()
        print("初始网络:", [(n["name"], n["mode"]) for n in base["networks"]])

        a = client.post("/api/networks", json={"name": "信号层", "mode": "signal"}).json()
        aid = next(n["id"] for n in a["networks"] if n["name"] == "信号层")
        b = client.post("/api/networks", json={"name": "电路层", "mode": "circuit"}).json()
        bid = next(n["id"] for n in b["networks"] if n["name"] == "电路层")
        print("新建后:", [(n["name"], n["mode"]) for n in b["networks"]])

        sa = client.post(f"/api/networks/{aid}/activate").json()
        sb = client.post(f"/api/networks/{bid}/activate").json()
        print("切到信号层 scene.mode =", sa["scene"]["mode"])
        print("切到电路层 scene.mode =", sb["scene"]["mode"])
        assert sa["scene"]["mode"] == "signal" and sb["scene"]["mode"] == "circuit"

        # 仅把当前网络（电路层）改成 vector，信号层应保持不变
        patched = client.patch(f"/api/networks/{bid}", json={"mode": "vector"}).json()
        modes = {n["name"]: n["mode"] for n in patched["networks"]}
        print("电路层改为 vector 后:", modes)
        assert modes["信号层"] == "signal" and modes["电路层"] == "vector"

        project = client.get("/api/project").json()["project"]
        saved = {n["name"]: n["scene"]["mode"] for n in project["networks"]}
        print("导出工程 modes:", saved)
        assert saved["信号层"] == "signal" and saved["电路层"] == "vector"

        imported = client.post("/api/project/import", json={"project": project}).json()
        reloaded = {n["name"]: n["mode"] for n in imported["networks"]}
        print("重新导入后 modes:", reloaded)
        assert reloaded["信号层"] == "signal" and reloaded["电路层"] == "vector"

        re_act = client.post(f"/api/networks/{aid}/activate").json()
        print("重载后切到信号层 scene.mode =", re_act["scene"]["mode"])
        assert re_act["scene"]["mode"] == "signal"

        print("PASS: 每网络模式独立保存，切换活动网络随之载入，保存/重载后保持")


if __name__ == "__main__":
    main()
