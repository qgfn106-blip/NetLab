#!/usr/bin/env node
/* P3-05 分析图与分析工作台四层结构守卫。
 *
 * model（纯数据/数值/规格）→ render（绘制适配）→ interaction（命中与框选）
 * → facade（AnalysisChart / AnalysisWorkbench 公共入口，只编排委托）。校验：
 *  1) 各模块行数不超过 800；
 *  2) import 只能指向本层或更低层，禁止反向依赖；
 *  3) 所有 analysis_chart_/analysis_workbench_ 模块必须登记并归层；
 *  4) 在登记模块之间做真实环检测（同层环也会被拦截）。
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
const IMPORT_RE = /(?:from\s*|import\s*|export\s*[^;]*?from\s*)(['"])(\.\/[^'"]+\.js)\1/g;

const isAnalysisModule = (file) =>
  /^analysis_(?:chart|workbench)(?:_[A-Za-z0-9_]+)?\.ts$/.test(file);
const familyOf = (file) => (file.startsWith('analysis_chart') ? 'chart' : 'workbench');

const errors = [];
const graph = new Map();
for (const file of LAYERS.keys()) graph.set(file, []);

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
    const target = path.posix.basename(match[2]).replace(/\.js$/, '.ts');
    if (!isAnalysisModule(target)) continue;
    if (!LAYERS.has(target)) {
      errors.push(`${file} 引用未登记分析模块 ${target}`);
      continue;
    }
    const targetLayer = LAYERS.get(target);
    if (familyOf(file) !== familyOf(target)) {
      // 跨子系统只允许依赖对方 facade 入口或对方 model 层共享纯工具，禁止穿透到 render/interaction 内部。
      if (target !== 'analysis_chart.ts' && target !== 'analysis_workbench.ts' && targetLayer !== 'model') {
        errors.push(`${file} 跨子系统依赖 ${target}（只允许对方 facade 或 model 共享层）`);
      }
    } else if (RANK[targetLayer] > RANK[layer]) {
      errors.push(`${file}(${layer}) 反向依赖 ${target}(${targetLayer})`);
    }
    graph.get(file).push(target);
  }
}

// 未在 LAYERS 中登记、但目录里实际存在的 analysis_* 模块也视为漏登记。
for (const name of fs.readdirSync(APP)) {
  if (isAnalysisModule(name) && !LAYERS.has(name)) {
    errors.push(`模块未登记分层映射: ${name}`);
  }
}

// 真实环检测：任何长度的有向环都报告，不再只看层秩差。
const state = new Map();
const stack = [];
function dfs(node) {
  state.set(node, 1);
  stack.push(node);
  for (const next of graph.get(node) || []) {
    if (state.get(next) === 1) {
      const at = stack.indexOf(next);
      errors.push('循环依赖: ' + stack.slice(at).concat(next).join(' -> '));
    } else if (!state.has(next)) {
      dfs(next);
    }
  }
  stack.pop();
  state.set(node, 2);
}
for (const file of graph.keys()) if (!state.has(file)) dfs(file);

if (errors.length) {
  console.error('analysis layers FAIL');
  for (const item of errors) console.error(' - ' + item);
  process.exit(1);
}
console.log('analysis layers OK: model/render/interaction/facade, max ' + MAX_MODULE_LINES + ' lines, ' + LAYERS.size + ' modules, 0 cycles');