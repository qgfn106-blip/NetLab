import { state, ui } from './state.js';
import { section } from './inspector_shell.js';
import { div, button, el } from './ui.js';
import { numberInput, fieldFor } from './ui_helpers.js';
import { trimNumber } from './fields.js';
import { modeLabel } from './model.js';
import { fmt } from '../app.utils.js';
import { markProjectDirty, updateProjectPanel, saveProject, openProject, recoverAutosave, AUTOSAVE_ENABLED_KEY, setProjectFileInput, importProjectText } from './project.js';
import { toast, desktopBridge, callBridge } from './desktop.js';
import { requestDraw } from './canvas_render.js';
import { normaliseAngleSet } from './grid_prefs.js';
import { C } from './colors.js';
import { $$, $ } from './dom.js';
import type { SimStats } from './types.js';
import { jsonRequest, api } from './net.js';
import type { ApiOptions } from './net.js';
import { openConfirmModal as confirmModal } from './dialogs_build.js';
import type { ExportDestination, ExportStyle, ExportChoice } from './export_dialog.js';
import { openExportDialog } from './export_dialog.js';
import { MAX_IMPORT_BYTES } from './constants.js';

export interface ScenePanelDeps {
  task: <T>(run: () => T | Promise<T>, options?: any) => Promise<T | null>;
  syncUI: (...args: any[]) => any;
  updateRunButton: (...args: any[]) => any;
  applySnapshot: (...args: any[]) => any;
  renderInspector: (...args: any[]) => any;
  renderSignalList: (...args: any[]) => any;
  fetchNetworks: (...args: any[]) => any;
  fitView: (...args: any[]) => any;
  snapSceneToGrid: (...args: any[]) => any;
  updateModeUI: (...args: any[]) => any;
}
let deps: ScenePanelDeps;
export function initScenePanel(d: ScenePanelDeps): void { deps = d; }

  function setStat(key: string, value: unknown) {
    const node = $(`[data-stat="${key}"]`, ui.scenePane);
    if (node) node.textContent = value as string;
  }

  export function updateScenePanelValues() {
    const pane = ui.scenePane;
    if (!pane || !pane.dataset.ready) return;
    const sim = state.sim;
    const config = sim?.config;
    if (config) {
      const setValue = (name: string, value: unknown) => {
        const input = $(`[data-sim="${name}"]`, pane);
        if (!input) return;
        if (document.activeElement === input) return;
        (input as HTMLInputElement).value = String(value);
      };
      setValue('fps', config.fps);
      setValue('steps', config.steps_per_frame);
      setValue('dt', config.dt);
      setValue('sample', config.sample_every);
      for (const key of ['reltol', 'vntol', 'abstol', 'max_iter', 'gmin_steps', 'src_steps', 'residual_tol']) {
        if (config[key] !== undefined) setValue(key, config[key]);
      }
      const lock = $('[data-sim="lock"]', pane);
      if (lock) (lock as HTMLInputElement).checked = Boolean(config.lock_dt);
      const realtime = $('[data-sim="realtime"]', pane);
      if (realtime) (realtime as HTMLInputElement).checked = Boolean(config.realtime);
      const algebraic = $('[data-role="algebraic"]', pane);
      if (algebraic) (algebraic as HTMLInputElement).checked = Boolean(state.scene?.solve_algebraic);
      const dtInput = $('[data-sim="dt"]', pane);
      if (dtInput) (dtInput as HTMLButtonElement).disabled = Boolean(config.lock_dt);

      const note = $('[data-role="sim-note"]', pane);
      if (note) {
        const perFrame = Number(config.dt) * Number(config.steps_per_frame);
        const perSecond = perFrame * Number(config.fps);
        let text = `每帧 ${fmt(perFrame, 4)} s · 每秒推进 ${fmt(perSecond, 4)} s`;
        if (config.realtime) {
          text += perSecond > 1.0001 ? ` · 加速 ${perSecond.toFixed(2)}×` : ' · 实时';
        } else {
          text += ' · 极速模式（不等待墙钟）';
        }
        text += config.lock_dt ? ' · dt 已锁定（每帧固定 1/fps，曲线采样也受此限制）' : '';
        note.textContent = text;
      }
    }

    const scene = state.scene;
    const stats = (sim?.scene || {}) as SimStats;
    setStat('nodes', String(scene?.nodes?.length ?? 0));
    setStat('edges', String(scene?.edges?.length ?? 0));
    const stepMs = Number((scene?.stats as SimStats)?.step_ms ?? stats.step_ms ?? 0);
    const stepEl = $('[data-stat="step"]', pane);
    if (stepEl) {
      stepEl.replaceChildren(
        document.createTextNode(fmt(stepMs, 3)),
        el('small', null, 'ms'),
      );
    }
    setStat('fps', String(Math.round(sim?.actual_fps ?? 0)));
    setStat('matrix', stats.kind === 'circuit' ? `${stats.matrix_size || 0}×${stats.matrix_size || 0}` : '—');
    setStat('iterations', stats.iterations !== undefined ? String(stats.iterations) : '—');
    setStat('frames', String(sim?.frames_recorded ?? state.frames.length));
    setStat('revision', String(scene?.revision ?? 0));

    const integration = $('[data-role="integration"]', pane);
    if (integration && scene) {
      (integration as HTMLInputElement).value = (scene.integration || 'trapezoidal') as string;
      (integration as HTMLButtonElement).disabled = state.mode !== 'circuit';
    }
    const note = $('[data-role="integration-note"]', pane);
    if (note) {
      note.textContent = state.mode === 'circuit'
        ? '梯形法精度高；后向欧拉更稳定，适合刚性电路。'
        : '仅电路模式使用；信号流由每条连接的离散化参数决定。';
    }
    const modeHost = $('[data-role="mode"]', pane);
    if (modeHost) {
      $$('button[data-mode]', modeHost).forEach((item) => {
        item.classList.toggle('active', item.dataset.mode === state.mode);
      });
    }
  }

  function readSimConfig() {
    const pane = ui.scenePane;
    const fpsInput = $('[data-sim="fps"]', pane);
    const stepsInput = $('[data-sim="steps"]', pane);
    const dtInput = $('[data-sim="dt"]', pane);
    const sampleInput = $('[data-sim="sample"]', pane);
    const lockInput = $('[data-sim="lock"]', pane);
    const realtimeInput = $('[data-sim="realtime"]', pane);
    if (!fpsInput || !stepsInput || !dtInput || !sampleInput) return null;

    const fps = Number((fpsInput as HTMLInputElement).value);
    const steps = Number((stepsInput as HTMLInputElement).value);
    const sample = Number((sampleInput as HTMLInputElement).value);
    const lock = Boolean((lockInput as HTMLInputElement)?.checked);
    let dt = Number((dtInput as HTMLInputElement).value);
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new Error('帧率必须是 1–240 的整数');
    if (!Number.isInteger(steps) || steps < 1 || steps > 200) throw new Error('每帧步数必须是 1–200 的整数');
    if (!Number.isInteger(sample) || sample < 1 || sample > 100) throw new Error('采样间隔必须是 1–100 的整数');
    if (lock) dt = 1 / (fps * steps);
    if (!Number.isFinite(dt) || dt < 1e-9 || dt > 10) throw new Error('dt 必须在 1e-9 到 10 s 之间');
    if (dt * steps > 10) throw new Error('每帧推进的仿真时间过大，请减小 dt 或步数');
    const readSolver = (name: string, label: string, lo: number, hi: number, integer = false) => {
      const input = $(`[data-solver="${name}"]`, pane);
      if (!input) return undefined;
      const value = Number((input as HTMLInputElement).value);
      if (!Number.isFinite(value) || value < lo || value > hi) {
        throw new Error(`${label}必须在 ${lo}–${hi} 之间`);
      }
      if (integer && !Number.isInteger(value)) throw new Error(`${label}必须是整数`);
      return value;
    };
    const payload: Record<string, number | boolean> = {
      fps,
      steps_per_frame: steps,
      dt,
      sample_every: sample,
      lock_dt: lock,
      realtime: Boolean((realtimeInput as HTMLInputElement)?.checked),
    };
    const solverFields = [
      ['reltol', '相对容差 reltol', 1e-15, 0.1, false],
      ['vntol', '电压容差 vntol', 1e-15, 1, false],
      ['abstol', '电流容差 abstol', 1e-15, 1, false],
      ['max_iter', 'Newton 迭代上限', 1, 500, true],
      ['gmin_steps', 'gmin 步数', 0, 100, true],
      ['src_steps', 'source 步数', 0, 100, true],
      ['residual_tol', '残差容差', 0, 1, false],
    ];
    for (const [key, label, lo, hi, integer] of solverFields) {
      const value = readSolver(key as string, label as string, lo as number, hi as number, integer as boolean);
      if (value !== undefined) payload[key as string] = value;
    }
    return payload;
  }

  export async function applySimConfig() {
    let payload;
    try {
      payload = readSimConfig();
    } catch (error) {
      toast((error as Error).message, 'error', 6000);
      updateScenePanelValues();
      return;
    }
    if (!payload) return;
    const response = await deps.task(() => jsonRequest('/api/config', 'PATCH', payload));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    state.sim = response.sim;
    deps.syncUI();
    updateScenePanelValues();
    deps.updateRunButton(Boolean(state.sim?.running));
    const solverKeys = ['reltol', 'vntol', 'abstol', 'max_iter', 'gmin_steps', 'src_steps', 'residual_tol'];
    toast('仿真设置已更新', 'ok', 1600);
  }

