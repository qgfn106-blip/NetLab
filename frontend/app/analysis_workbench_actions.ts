/* 分析工作台动作层：工具栏、导出、状态栏与运行参数（从主模块拆出以满足 S5 模块行数约束）。 */
import { transferSummaryHtml } from './analysis_workbench_results.js';
import type { LayoutMode, WorkbenchCanvasRec } from './analysis_workbench_layout.js';
import { AnalysisCanvasWorkspace } from './analysis_workbench_canvas.js';
import { workbenchExportRequest } from './analysis_client.js';
import { toast } from './desktop.js';
import type { RunResponse, WorkbenchSessionRec, WorkbenchStateRec } from './analysis_workbench_types.js';
import {
  KIND_LABELS, describeRunStatus, escapeHtml, optionHtml, shortFingerprint, loopFeedbackOutput, type AnalysisKind,
} from './analysis_workbench_meta.js';

const LAYOUT_OPTIONS: Array<[LayoutMode, string]> = [['grid', '网格'], ['tile', '平铺'], ['split', '分割'], ['max', '最大化']];

export abstract class WorkbenchActions {
  protected host!: HTMLElement;
  protected workspace: AnalysisCanvasWorkspace | null = null;
  protected navHost!: HTMLElement;
  protected toolbarHost!: HTMLElement;
  protected transferHost!: HTMLElement;
  protected statusHost!: HTMLElement;
  protected session: WorkbenchSessionRec | null = null;
  protected sessionId = '';
  protected params = { f_start: 1, f_stop: 1e5, points: 121, step_dt: 1e-5, step_duration: 5e-3, feedback_sign: 1 };
  protected frequencyPath = 'descriptor_linearized';
  protected loopCandidates: Array<Record<string, unknown>> = [];
  protected busy = false;
  protected compareMode = false;
  protected compareSelection = new Set<string>();
  protected layout: LayoutMode = 'grid';
  protected lastRuns: Record<string, RunResponse> = {};
  protected exportFormat = 'png';
  protected exportScope: 'subcanvas' | 'canvas' = 'subcanvas';
  protected lastCursor: { frequency: number; unit: string; canvasId: string } | null = null;

  protected abstract selectedCanvas(): WorkbenchCanvasRec | null;
  protected abstract currentKind(): AnalysisKind;
  protected abstract activeState(): WorkbenchStateRec | undefined;
  protected abstract loadLoopCandidatesIfNeeded(): Promise<void>;
  protected abstract run(targetKind?: AnalysisKind): Promise<void>;
  protected abstract runCompare(): Promise<void>;
  protected abstract persist(): void;
  protected abstract applyLayout(): void;

  protected renderToolbar(): void {
    const active = this.activeState();
    const kind = this.currentKind();
    const selected = this.selectedCanvas();
    const hasCanvas = Boolean(selected);
    const cache = this.runForCanvas(this.workspace?.activeCanvas?.canvas_id)?.cache;
    const stale = cache && cache['stale'] === true;
    this.toolbarHost.innerHTML = [
      '<div class="awb-toolbar-title"><b>' + (hasCanvas ? KIND_LABELS[kind] : '未选择画布') + '</b><span>' + escapeHtml(hasCanvas ? (selected?.title || active?.label || '—') : '请选择或新建画布') + '</span></div>',
      '<div class="awb-toolbar-meta">' + this.cacheBadge() + '</div>',
      '<div class="awb-toolbar-actions">',
      this.compareMode ? '<button type="button" class="btn tiny" data-awb="compare-run">对比选中状态</button>' : '',
      '  <select class="awb-select tiny" data-awb="layout" title="画布布局">' +
        LAYOUT_OPTIONS.map(([mode, label]) => optionHtml(mode, label, this.layout === mode)).join('') +
        '</select>',
      '  <select class="awb-select tiny" data-awb="export-format" title="导出格式">' +
        ['png', 'svg', 'pdf', 'spec', 'csv', 'json', 'zip'].map((fmt) => optionHtml(fmt, fmt.toUpperCase(), fmt === this.exportFormat)).join('') +
        '</select>',
      '  <select class="awb-select tiny" data-awb="export-scope" title="导出范围">' +
        optionHtml('subcanvas', '当前画布', this.exportScope === 'subcanvas') +
        optionHtml('canvas', '全部状态', this.exportScope === 'canvas') +
        '</select>',
      '  <button type="button" class="btn tiny" data-awb="export"' + (hasCanvas ? '' : ' disabled') + '>导出</button>',
      '  <button type="button" class="btn tiny primary" data-awb="run"' + (hasCanvas ? '' : ' disabled') + '>运行' + (stale ? '（结果已过期）' : '') + '</button>',
      '</div>',
    ].join('');
    this.toolbarHost.querySelector('[data-awb="run"]')?.addEventListener('click', () => { void this.run(); });
    (this.toolbarHost.querySelector('[data-awb="layout"]') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
      this.layout = ((event.target as HTMLSelectElement).value || 'grid') as LayoutMode;
      this.applyLayout();
      this.persist();
    });
    this.toolbarHost.querySelector('[data-awb="compare-run"]')?.addEventListener('click', () => { void this.runCompare(); });
    (this.toolbarHost.querySelector('[data-awb="export-format"]') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
      this.exportFormat = String((event.target as HTMLSelectElement).value || 'png');
    });
    (this.toolbarHost.querySelector('[data-awb="export-scope"]') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
      this.exportScope = (event.target as HTMLSelectElement).value === 'canvas' ? 'canvas' : 'subcanvas';
    });
    this.toolbarHost.querySelector('[data-awb="export"]')?.addEventListener('click', () => { void this.exportResult(); });
  }


  protected async exportResult(): Promise<void> {
    if (!this.sessionId) {
      toast('分析会话尚未就绪，无法导出', 'error', 4000);
      return;
    }
    const active = this.activeState();
    if (!active) {
      toast('请先快照并选择一个分析状态', 'error', 4000);
      return;
    }
    const kind = this.currentKind();
    const canvas = this.selectedCanvas();
    if (this.exportScope === 'subcanvas' && !canvas) {
      toast('请选择一个画布后再导出', 'error', 4000);
      return;
    }
    if (!this.runForCanvas(canvas?.canvas_id) && !this.session?.results?.length) {
      toast('请先运行分析再导出', 'error', 4000);
      return;
    }
    const allIds = this.session?.states?.map((item) => item.state_id) || [active.state_id];
    const compared = this.compareMode && this.compareSelection.size >= 2 ? [...this.compareSelection] : allIds;
    const stateIds = this.exportScope === 'canvas' ? compared : [active.state_id];
    // 仅“当前画布”导出绑定单画布结果 key；多状态导出不应被单个画布结果过度过滤。
    const resultIds = this.exportScope === 'subcanvas'
      ? (canvas?.result_keys?.length ? canvas.result_keys : canvas?.result_key ? [canvas.result_key] : undefined)
      : undefined;
    try {
      this.toolbarHost.classList.add('busy');
      const response = await workbenchExportRequest({
        session_id: this.sessionId,
        scope: this.exportScope,
        canvas_id: this.exportScope === 'subcanvas' ? (canvas?.canvas_id || kind) : undefined,
        state_ids: stateIds,
        kind: kind === 'metrics' ? undefined : kind,
        format: this.exportFormat,
        ...(resultIds ? { result_ids: resultIds } : {}),
        source_path: undefined,
      });
      const disposition = response.headers.get('Content-Disposition') || '';
      const matched = /filename="?([^";]+)"?/.exec(disposition);
      const fallback = `netlab-analysis.${this.exportFormat === 'spec' ? 'plotkit.json' : this.exportFormat}`;
      const filename = matched ? matched[1] : fallback;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('已导出 ' + filename, 'success', 3000);
    } catch (error) {
      toast('导出失败：' + (error as Error).message, 'error', 5000);
    } finally {
      this.toolbarHost.classList.remove('busy');
    }
  }


  protected runForCanvas(canvasId?: string | null): RunResponse | null {
    if (!canvasId) return null;
    return this.lastRuns[canvasId] || null;
  }


  protected cacheBadge(): string {
    if (!this.workspace?.activeCanvas) return '<span class="awb-badge">未选择画布</span>';
    const run = this.runForCanvas(this.workspace.activeCanvas.canvas_id);
    const cache = run?.cache;
    if (!cache) return '<span class="awb-badge">尚未运行</span>';
    if (cache['stale'] === true) return '<span class="awb-badge stale">结果已过期</span>';
    return '<span class="awb-badge">' + (cache['cached'] === true ? '缓存命中' : '已计算') + ' · ' + shortFingerprint(run?.fingerprint) + '</span>';
  }


  protected renderStatus(): void {
    if (!this.workspace?.activeCanvas) {
      if (this.transferHost) this.transferHost.innerHTML = '';
      this.statusHost.textContent = '未选择画布';
      return;
    }
    const active = this.activeState();
    const run = this.runForCanvas(this.workspace.activeCanvas.canvas_id);
    const summary = describeRunStatus(run?.envelope);
    if (this.transferHost) this.transferHost.innerHTML = transferSummaryHtml(run?.raw);
    const lines = [
      '状态：' + (active?.label || '—'),
      '指纹：' + shortFingerprint(active?.fingerprint),
      '来源：' + summary.source,
      '稳定：' + summary.stability,
    ];
    if (this.lastCursor) {
      lines.push('光标：' + this.lastCursor.frequency.toPrecision(7) + (this.lastCursor.unit ? ' ' + this.lastCursor.unit : ''));
    }
    this.statusHost.textContent = lines.join(' · ');
  }


  protected async runParams(kind: AnalysisKind = this.currentKind()): Promise<Record<string, unknown> | null> {
    const input = (this.navHost.querySelector('[data-awb="input"]') as HTMLSelectElement | null)?.value || '';
    const output = (this.navHost.querySelector('[data-awb="output"]') as HTMLSelectElement | null)?.value || '';
    if (!input || !output) {
      toast('请选择输入源与输出节点', 'error', 4000);
      return null;
    }
    const params: Record<string, unknown> = {
      input_source: input,
      output,
      f_start: this.params.f_start,
      f_stop: this.params.f_stop,
      points: Math.round(this.params.points),
      step_dt: this.params.step_dt,
      step_duration: this.params.step_duration,
    };
    if (kind === 'bode' || kind === 'poles') params.frequency_path = this.frequencyPath;
    const loopKind = kind === 'loop' || kind === 'loop_closed' || kind === 'loop_step';
    if (loopKind || kind === 'nyquist') {
      const select = this.navHost.querySelector('[data-awb="element"]') as HTMLSelectElement | null;
      let element = select?.value || '';
      if (element === '__virtual__' && !loopKind) element = '';
      if (!element && this.loopCandidates.length) element = String(this.loopCandidates[0].element || '');
      if (!element && !loopKind) {
        await this.loadLoopCandidatesIfNeeded();
        element = String(this.loopCandidates[0]?.element || '');
      }
      if (!element && loopKind) element = '__virtual__';
      if (!element) {
        toast('Nyquist 分析需要选择一个受控源作为断环点（VCVS/VCCS）', 'error', 5000);
        return null;
      }
      params.element = element;
      params.feedback_sign = this.params.feedback_sign;
      const feedbackOutput = loopFeedbackOutput(this.loopCandidates, element, output);
      if (feedbackOutput && feedbackOutput !== output) {
        params.output = feedbackOutput;
        const outputSelect = this.navHost.querySelector('[data-awb="output"]') as HTMLSelectElement | null;
        if (outputSelect) outputSelect.value = feedbackOutput;
        toast(`闭环分析输出已自动改为反馈节点 ${feedbackOutput}（避免取到监测级导致环路一致性告警）`, 'warn', 6000);
      }
    }
    return params;
  }

}
