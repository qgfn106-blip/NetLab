import { div, el } from "./ui.js";
function createParamGroupTable() {
  const table = div("wb-param-table");
  const groupMap = /* @__PURE__ */ new Map();
  const objectGroup = (objLabel, objKey) => {
    const groupKey = `${objLabel}||${objKey}`;
    let group = groupMap.get(groupKey);
    if (!group) {
      const details = document.createElement("details");
      details.className = "wb-obj-group";
      details.open = groupMap.size < 3;
      const summary = document.createElement("summary");
      summary.className = "wb-obj-summary";
      const body = div("wb-obj-body");
      details.append(summary, body);
      table.appendChild(details);
      group = { details, body, summary, text: `${objLabel} ${objKey}`.toLowerCase(), rows: [] };
      groupMap.set(groupKey, group);
    }
    return group;
  };
  const addRow = (objLabel, objKey, paramLabel, control) => {
    const group = objectGroup(objLabel, objKey);
    const row = div("wb-param-row");
    row.append(el("span", "wb-key", paramLabel));
    const valCell = div("wb-val");
    valCell.appendChild(control);
    row.appendChild(valCell);
    group.body.appendChild(row);
    group.rows.push({ el: row, text: `${objLabel} ${objKey} ${paramLabel}`.toLowerCase() });
    group.summary.textContent = `${objLabel}\uFF08${group.rows.length} \u9879\uFF09`;
  };
  const applyFilter = (query) => {
    for (const group of groupMap.values()) {
      let visible = false;
      for (const item of group.rows) {
        const hit = !query || item.text.indexOf(query) >= 0;
        item.el.classList.toggle("hidden", !hit);
        if (hit) visible = true;
      }
      group.details.classList.toggle("hidden", Boolean(query) && !visible);
      if (query) group.details.open = visible;
    }
  };
  return { table, addRow, applyFilter };
}
function fallbackParams(params) {
  return Object.keys(params || {}).map((key) => ({
    key,
    label: key,
    // ParamSpec 使用 float/int/bool/choice/text，而不是 TS 的 number/boolean；
    // 这里必须是 float，否则 buildParamField 会退化成文本框，后端收到字符串
    // 值时报「必须是数字」。
    type: typeof params[key] === "number" ? "float" : typeof params[key] === "boolean" ? "bool" : "text"
  }));
}
export {
  createParamGroupTable,
  fallbackParams
};
