// 分析窗与文档窗初始化（S5-41 从 app.ts 迁出）
import { activeTab } from './model.js';
import { closeAnalysis, drawAcChart, fillAcSources, runAcSweep, runOperatingPoint, selectAnalTab } from './ac_analysis.js';
import { closeDoc, searchDocs } from './docs.js';
import { closePlotkit, closeVscode, layoutPlotkitWindow, maybePrewarmVscode, placePlotkit, togglePlotkitDock } from './plotkit_frame.js';
import { initFloatWindow } from './float.js';
import { $, $$ } from './dom.js';
import { state, ui } from './state.js';

let windowActions = {
  renderCompareGrid: (..._args: any[]): void => {},
  setWbSignalDock: (..._args: any[]): void => {},
  syncProjectContext: (..._args: any[]): void => {},
  getWbComparePayload: (): any => null,
};

export function setWindowActions(actions: {
  renderCompareGrid: (...args: any[]) => void;
  setWbSignalDock: (...args: any[]) => void;
  syncProjectContext: (...args: any[]) => void;
  getWbComparePayload: () => any;
}): void {
  windowActions = actions;
}

export function initAnalWin() {
    const win = $('#analWin');
    if (!win) return;
    win.querySelector('#analWinClose')?.addEventListener('click', closeAnalysis);
    for (const btn of $$('.anal-tab')) {
      btn.addEventListener('click', () => {
        selectAnalTab(btn.dataset.anal || 'op');
        if (btn.dataset.anal === 'ac') fillAcSources();
      });
    }
    $('#analRunOp')?.addEventListener('click', () => void runOperatingPoint());
    $('#analRunAc')?.addEventListener('click', () => void runAcSweep());
    initFloatWindow(win, 'analGeo', { minWidth: 560, minHeight: 420 });
    window.addEventListener('resize', () => {
      if (!win.hidden && !(win.querySelector('.anal-pane[data-anal-pane="ac"]') as HTMLElement)?.hidden) {
        drawAcChart();
      }
    });
  }

export function initDocWin() {
    if (!ui.docWin) return;
    ui.docWin.querySelector('#docWinClose')?.addEventListener('click', closeDoc);
    ui.docSearch?.addEventListener('input', () => searchDocs(ui.docSearch.value));
    ui.docSearch?.addEventListener('keydown', (event: KeyboardEvent) => {
      if ((event as Event as KeyboardEvent).key === 'Enter') {
        const first = ui.docResults.querySelector('.doc-hit');
        if (first) (first as HTMLElement).click();
      }
      if ((event as Event as KeyboardEvent).key === 'Escape') {
        ui.docSearch.value = '';
        searchDocs('');
      }
    });
    initFloatWindow(ui.docWin, 'docGeo', { minWidth: 420, minHeight: 320 });
    const plotkitWin = $('#plotkitWin');
    if (plotkitWin) {
      initFloatWindow(plotkitWin, 'plotkitGeo', { minWidth: 720, minHeight: 480 });
      $('#plotkitWinClose')?.addEventListener('click', closePlotkit);
      $('#plotkitDock')?.addEventListener('click', togglePlotkitDock);
      window.addEventListener('resize', () => {
        if (state.plotkitDock && !plotkitWin.hidden) layoutPlotkitWindow();
      });
      $('#btnOpenPlotkit')?.addEventListener('click', () => placePlotkit('float'));
      $('#btnPlotkitInline')?.addEventListener('click', () => placePlotkit('inline'));
      $('#btnPlotkitPopup')?.addEventListener('click', () => placePlotkit('popup'));
      $('#plotkitPopout')?.addEventListener('click', () => {
        closePlotkit();
        placePlotkit('popup');
      });
    }
    const vscodeWin = $('#vscodeWin');
    if (vscodeWin) {
      initFloatWindow(vscodeWin, 'vscodeGeo', { minWidth: 720, minHeight: 520 });
      $('#vscodeWinClose')?.addEventListener('click', closeVscode);
      maybePrewarmVscode();
    }
    const wbSignalWin = $('#wbSignalWin');
    if (wbSignalWin) {
      initFloatWindow(wbSignalWin, 'wbSignalGeo', { minWidth: 280, minHeight: 320 });
      $('#wbSignalWinClose')?.addEventListener('click', () => windowActions.setWbSignalDock(true));
      $('#wbSignalDockBtn')?.addEventListener('click', () => windowActions.setWbSignalDock(true));
      window.addEventListener('resize', () => {
        if (activeTab() === 'wb-analysis' && windowActions.getWbComparePayload()) windowActions.renderCompareGrid();
      });
    }
    void windowActions.syncProjectContext();
  }

  // ---- 参数 ? 卡片 -----------------------------------------------------------

