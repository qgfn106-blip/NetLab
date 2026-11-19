// 统一导出窗口：只负责表单状态、选项约束、预览摘要与结果呈现。
// 真正的导出动作由 app.ts 的 orchestrator 注入，避免 UI 层重复拼请求。
import { el, div, button } from './ui.js';
import { ui } from './state.js';
import { closeModal } from './dialogs_build.js';

export type ExportStyle = 'follow-project' | 'gb' | 'classic';
export type ExportMode = 'schematic' | 'scene-data';
export type ExportFormat = 'svg' | 'json';
export type ExportDestination = 'desktop-save-dialog' | 'browser-download';

export interface ExportChoice {
  renderer: 'schemdraw';
  style: ExportStyle;
  mode: ExportMode;
  format: ExportFormat;
  destination: ExportDestination;
}

export interface ExportDialogOptions {
  /** 工程当前符号风格，用于「跟随工程」的预览说明。 */
  projectStyle: 'gb' | 'classic';
  /** 入口预设的渲染模式；不传按原理图。 */
  initialMode?: ExportMode;
  /** 桌面壳是否提供原生保存对话框。 */
  desktopAvailable: boolean;
  /** 统一导出执行器；抛错即表示失败，窗口会保留并显示原因。 */
  run: (choice: ExportChoice) => Promise<void>;
}

interface SelectField {
  select: HTMLSelectElement;
  row: HTMLElement;
}

function selectField(label: string, values: Array<[string, string]>, current: string): SelectField {
  const select = el('select', 'export-select') as HTMLSelectElement;
  for (const [value, text] of values) {
    const option = el('option', null, text) as HTMLOptionElement;
    option.value = value;
    select.appendChild(option);
  }
  select.value = current;
  const row = div('export-row');
  row.append(el('span', 'export-row-label', label), select);
  return { select, row };
}

function styleText(style: ExportStyle, projectStyle: 'gb' | 'classic'): string {
  if (style === 'follow-project') return `跟随工程（当前 ${projectStyle === 'classic' ? '经典' : 'GB'}）`;
  return style === 'classic' ? '经典' : 'GB';
}

function modeText(mode: ExportMode): string {
  return mode === 'schematic' ? '原理图' : '场景数据';
}

function destinationText(destination: ExportDestination): string {
  return destination === 'desktop-save-dialog' ? '桌面保存对话框' : '浏览器下载';
}

export function openExportDialog(options: ExportDialogOptions): Promise<void> {
  return new Promise((resolve) => {
    closeModal();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      ui.modal.classList.add('hidden');
      ui.modalCard.replaceChildren();
      resolve();
    };
    const cancel = () => finish();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };

    const heading = el('h3', null, '导出');
    const help = el('p', 'help', '渲染器、样式、渲染模式与目标彼此独立；原理图只输出 SVG，场景数据只输出 JSON。');
    const form = div('export-form');

    const renderer = selectField('渲染器', [['schemdraw', 'SchemDraw']], 'schemdraw');
    renderer.select.dataset.role = 'renderer';
    renderer.select.disabled = true;
    const style = selectField('样式', [
      ['follow-project', '跟随工程'],
      ['gb', 'GB'],
      ['classic', '经典'],
    ], 'follow-project');
    style.select.dataset.role = 'style';
    const initialMode: ExportMode = options.initialMode === 'scene-data' ? 'scene-data' : 'schematic';
    const mode = selectField('渲染模式', [
      ['schematic', '原理图'],
      ['scene-data', '场景数据'],
    ], initialMode);
    mode.select.dataset.role = 'mode';
    const initialFormats: Array<[string, string]> = initialMode === 'schematic' ? [['svg', 'SVG']] : [['json', 'JSON']];
    const format = selectField('格式', initialFormats, initialFormats[0][0]);
    format.select.dataset.role = 'format';
    const destination = selectField('目标', options.desktopAvailable
      ? [['desktop-save-dialog', '桌面保存对话框'], ['browser-download', '浏览器下载']]
      : [['browser-download', '浏览器下载']], options.desktopAvailable ? 'desktop-save-dialog' : 'browser-download');
    destination.select.dataset.role = 'destination';
    destination.select.disabled = !options.desktopAvailable;

    const syncFormat = () => {
      const wanted: Array<[string, string]> = mode.select.value === 'schematic'
        ? [['svg', 'SVG']]
        : [['json', 'JSON']];
      format.select.replaceChildren();
      for (const [value, text] of wanted) {
        const option = el('option', null, text) as HTMLOptionElement;
        option.value = value;
        format.select.appendChild(option);
      }
      format.select.value = wanted[0][0];
    };
    mode.select.addEventListener('change', () => { syncFormat(); refresh(); });
    style.select.addEventListener('change', () => refresh());
    destination.select.addEventListener('change', () => refresh());

    const preview = div('export-preview');
    const errorBox = div('export-error hidden');
    const refresh = () => {
      const styleValue = style.select.value as ExportStyle;
      const modeValue = mode.select.value as ExportMode;
      const formatValue = format.select.value as ExportFormat;
      const destinationValue = destination.select.value as ExportDestination;
      preview.textContent = `SchemDraw · ${styleText(styleValue, options.projectStyle)} · ${modeText(modeValue)} · ${formatValue.toUpperCase()} · ${destinationText(destinationValue)}`;
    };
    refresh();

    form.append(renderer.row, style.row, mode.row, format.row, destination.row);
    const actions = div('modal-actions');
    const cancelBtn = button('取消', 'btn', cancel);
    const exportBtn = button('导出', 'btn primary', () => { void submit(); });
    actions.append(cancelBtn, exportBtn);

    async function submit() {
      const choice: ExportChoice = {
        renderer: 'schemdraw',
        style: style.select.value as ExportStyle,
        mode: mode.select.value as ExportMode,
        format: format.select.value as ExportFormat,
        destination: destination.select.value as ExportDestination,
      };
      errorBox.classList.add('hidden');
      exportBtn.disabled = true;
      exportBtn.textContent = '导出中…';
      try {
        await options.run(choice);
        finish();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorBox.textContent = `导出失败：${message}`;
        errorBox.classList.remove('hidden');
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = '导出';
      }
    }

    ui.modalCard.append(heading, help, form, preview, errorBox, actions);
    ui.modal.classList.remove('hidden');
    setTimeout(() => exportBtn.focus(), 30);
    ui.modal.onclick = (event: MouseEvent) => {
      if (event.target === ui.modal) cancel();
    };
    document.addEventListener('keydown', onKey, true);
  });
}
