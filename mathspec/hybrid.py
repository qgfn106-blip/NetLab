"""混合自动机 + 零穿越事件检测/定位 + 状态重置（规范 §4）。

参考实现用固定 RK4 推进 + 事件函数符号变化检测 + 时间二分定位。
真实工程应用应按规范换成后向欧拉/BDF + Illinois/Brent 定位。
"""
from __future__ import annotations

import numpy as np


class Guard:
    """离散迁移守卫：from_mode --(event_func 过零)--> to_mode，可带 reset。"""

    def __init__(self, from_mode, to_mode, event_func, reset=None):
        self.from_mode = from_mode
        self.to_mode = to_mode
        self.event_func = event_func  # (t, x) -> scalar
        self.reset = reset            # (t, x) -> new x，或缺省


class HybridAutomaton:
    def __init__(self, modes):
        self.modes = modes  # name -> f(t, x)
        self.guards = []

    def add_guard(self, guard: Guard) -> None:
        self.guards.append(guard)

    @staticmethod
    def _rk4_step(f, t, x, h):
        k1 = np.asarray(f(t, x), float)
        k2 = np.asarray(f(t + h / 2, x + h / 2 * k1), float)
        k3 = np.asarray(f(t + h / 2, x + h / 2 * k2), float)
        k4 = np.asarray(f(t + h, x + h * k3), float)
        return x + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)

    def _locate(self, gfunc, f, t0, x0, h, tol):
        """在 [t0, t0+h] 内二分定位 gfunc=0 的时刻（保证收敛到 tol）。

        前提：gfunc 在该步内连续且端点异号；仅一个切换守卫被处理。
        端点同号但内部相切/双穿越的事件不会被发现，端点同为非零值时
        也不做切触点检测。
        """
        def xtau(tau):
            return self._rk4_step(f, t0, x0, tau)

        def gtau(tau):
            return gfunc(t0 + tau, xtau(tau))

        lo, hi = 0.0, h
        glo = gtau(lo)
        for _ in range(200):
            if hi - lo < tol:
                break
            mid = 0.5 * (lo + hi)
            gm = gtau(mid)
            if glo * gm <= 0.0:
                hi = mid
            else:
                lo = mid
                glo = gm
        tau = 0.5 * (lo + hi)
        return t0 + tau, xtau(tau)

    def simulate(self, x0, mode0, t0, t1, dt, event_tol=1e-9, max_events=1000):
        t = t0
        x = np.asarray(x0, float).copy()
        q = mode0
        ts, xs, qs = [t], [x.copy()], [q]
        events = 0
        while t < t1 - 1e-15:
            h = min(dt, t1 - t)
            active = [g for g in self.guards if g.from_mode == q]
            g0 = [g.event_func(t, x) for g in active]
            x_next = self._rk4_step(self.modes[q], t, x, h)
            t_next = t + h
            hit = None
            for g, val0 in zip(active, g0):
                if val0 == 0.0:
                    hit = (g, t, x)
                    break
                val1 = g.event_func(t_next, x_next)
                if val0 * val1 < 0.0:
                    te, xe = self._locate(g.event_func, self.modes[q], t, x, h, event_tol)
                    hit = (g, te, xe)
                    break
            if hit is not None:
                g, te, xe = hit
                events += 1
                if g.reset is not None:
                    xe = np.asarray(g.reset(te, xe), float)
                x, t, q = xe, te, g.to_mode
                ts.append(t); xs.append(x.copy()); qs.append(q)
                if events >= max_events:
                    break
            else:
                x, t = x_next, t_next
                ts.append(t); xs.append(x.copy()); qs.append(q)
        return np.array(ts), np.array(xs), qs
