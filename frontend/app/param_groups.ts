import { div, el } from './ui.js';
import type { ParamSpec } from './types.js';

interface ParamRowGroup {
  details: HTMLDetailsElement;
  body: HTMLElement;
  summary: HTMLElement;
  text: string;
  rows: Array<{ el: HTMLElement; text: string }>;
}

export interface ParamGroupTable {
  table: HTMLElement;
  addRow(objLabel: string, objKey: string, paramLabel: string, control: HTMLElement): void;
  applyFilter(query: string): void;
}

/** 工作台参数表：按对象分组为可折叠 <details>，并支持名字/参数过滤。 */
export function createParamGroupTable(): ParamGroupTable {
  const table = div('wb-param-table');
  const groupMap = new Map<string, ParamRowGroup>();
  const objectGroup = (objLabel: string, objKey: string): ParamRowGroup => {
    const groupKey = `${objLabel}||${objKey}`;
    let group = groupMap.get(groupKey);
    if (!group) {
      const details = document.createElement('details');
      details.className = 'wb-obj-group';
      details.open = groupMap.size < 3;
      const summary = document.createElement('summary');
      summary.className = 'wb-obj-summary';
      const body = div('wb-obj-body');
      details.append(summary, body);
      table.appendChild(details);
      group = { details, body, summary, text: `${objLabel} ${objKey}`.toLowerCase(), rows: [] };
      groupMap.set(groupKey, group);
    }
    return group;
  };
  const addRow = (objLabel: string, objKey: string, paramLabel: string, control: HTMLElement): void => {
    const group = objectGroup(objLabel, objKey);
    const row = div('wb-param-row');
    row.append(el('span', 'wb-key', paramLabel));
    const valCell = div('wb-val');
    valCell.appendChild(control);
    row.appendChild(valCell);
    group.body.appendChild(row);
    group.rows.push({ el: row, text: `${objLabel} ${objKey} ${paramLabel}`.toLowerCase() });
    group.summary.textContent = `${objLabel}（${group.rows.length} 项）`;
  };
  const applyFilter = (query: string): void => {
    for (const group of groupMap.values()) {
      let visible = false;
      for (const item of group.rows) {
        const hit = !query || item.text.indexOf(query) >= 0;
        item.el.classList.toggle('hidden', !hit);
        if (hit) visible = true;
      }
      group.details.classList.toggle('hidden', Boolean(query) && !visible);
      if (query) group.details.open = visible;
    }
  };
  return { table, addRow, applyFilter };
}

/** 没有元件 spec 时，用当前 params 的键合成最小可编辑字段。 */
export function fallbackParams(params?: Record<string, unknown>): ParamSpec[] {
  return Object.keys(params || {}).map((key) => ({
    key,
    label: key,
    type: typeof params![key] === 'number' ? 'number' : typeof params![key] === 'boolean' ? 'boolean' : 'text',
  }));
}
