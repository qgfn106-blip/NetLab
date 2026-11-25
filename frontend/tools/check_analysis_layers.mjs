#!/usr/bin/env node
/* P3-05 分析图与分析工作台四层结构守卫。
 *
 * model（纯数据/数值/规格）→ render（绘制适配）→ interaction（命中与框选）
 * → facade（AnalysisChart / AnalysisWorkbench 公共入口，只编排委托）。校验：
 *  1) 各模块行数不超过 800；
 *  2) import 只能指向本层或更低层，禁止反向依赖；
 *  3) 所有目标模块存在且被归层。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', 'app');
const MAX_MODULE_LINES = 800;
const LAYERS = new Map([
  ['analysis_chart_types.ts', 'model'],
  ['analysis_chart_utils.ts', 'model'],
  ['analysis_chart_spec.ts', 'render'],
  ['analysis_chart_appearance.ts', 'model'],
  ['analysis_chart_model.ts', 'model'],
  ['analysis_chart_plot.ts', 'render'],
  ['analysis_chart_detail.ts', 'render'],
  ['analysis_chart_interaction.ts', 'interaction'],
  ['analysis_chart.ts', 'facade'],
  ['analysis_workbench_types.ts', 'model'],
  ['analysis_workbench_meta.ts', 'model'],
  ['analysis_workbench_menu.ts', 'model'],
  ['analysis_workbench_canvas_ids.ts', 'model'],
  ['analysis_workbench_layout_tree.ts', 'model'],
  ['analysis_workbench_layout.ts', 'model'],
  ['analysis_workbench_loops.ts', 'render'],
  ['analysis_workbench_chart_settings.ts', 'render'],
  ['analysis_workbench_chart.ts', 'render'],
  ['analysis_workbench_results.ts', 'render'],
  ['analysis_workbench_canvas.ts', 'interaction'],
  ['analysis_workbench_actions.ts', 'interaction'],
  ['analysis_workbench_chrome.ts', 'interaction'],
  ['analysis_workbench.ts', 'facade'],
  ['analysis_workbench_panel.ts', 'facade'],
]);
const RANK = { model: 0, render: 1, interaction: 2, facade: 3 };
const IMPORT_RE = /from\s+'\.\/(analysis_(?:chart|workbench)_[A-Za-z0-9_]+\.js)'/g;

const errors = [];
for (const [file, layer] of LAYERS) {
  const full = path.join(APP, file);
  if (!fs.existsSync(full)) {
    errors.push(`缺少模块 ${file}`);
    continue;
  }
  const source = fs.readFileSync(full, 'utf8');
  const lines = source.replace(/\r?\n$/, '').split(/\r?\n/).length;
  if (lines > MAX_MODULE_LINES) errors.push(`${file} 行数 ${lines} 超过 ${MAX_MODULE_LINES}`);
  for (const match of source.matchAll(IMPORT_RE)) {
    const target = match[1].replace(/\.js$/, '.ts');
    const targetLayer = LAYERS.get(target);
    if (!targetLayer) continue;
    if (RANK[targetLayer] > RANK[layer]) {
      errors.push(`${file}(${layer}) 反向依赖 ${target}(${targetLayer})`);
    }
  }
}

if (errors.length) {
  console.error('analysis layers FAIL');
  for (const item of errors) console.error(' - ' + item);
  process.exit(1);
}
console.log('analysis layers OK: model/render/interaction/facade, max ' + MAX_MODULE_LINES + ' lines');
