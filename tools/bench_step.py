"""步进性能基准：python tools/bench_step.py [n]
在 NetlabHome 目录下运行；输出每个模板每步微秒数与每秒步数。
"""
import sys, time
sys.path.insert(0, ".")
from netlab.core.model.scene import Scene
from netlab.core.model.templates import build_template

DT=0.01

def bench(scene, n=1500, warm=100):
    for _ in range(warm): scene.step(DT)
    t0=time.perf_counter()
    for _ in range(n): scene.step(DT)
    return (time.perf_counter()-t0)/n*1e6

def main():
    n=int(sys.argv[1]) if len(sys.argv)>1 else 1500
    names=["rlc_series","rc_step","diode_rectifier","controlled_source","signal_chain","nonlinear_control","opamp_inverting","common_collector"]
    for name in names:
        try:
            s=Scene(); s.load_payload(build_template(name))
        except Exception as e:
            print(f"{name:20s} skip: {type(e).__name__} {e}"); continue
        us=bench(s,n)
        print(f"{name:20s} nodes={len(s.nodes):3d} edges={len(s.edges):3d}  {us:8.1f} us/step  {1e6/us:7.0f} steps/s")

if __name__=="__main__": main()
