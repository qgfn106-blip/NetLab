import { api, jsonRequest } from "./net.js";
import { button, div, el } from "./ui.js";
import { placeDocWindow } from "./float.js";
import { state, ui } from "./state.js";
import { syncPrefControls } from "./appearance.js";
import { toast } from "./desktop.js";
let docsActions = { loadTemplate: async (_name, _label) => {
} };
function setDocsActions(actions) {
  docsActions = actions;
}
async function ensureDocs() {
  if (state.docs && state.docs.length) return state.docs;
  try {
    const response = await jsonRequest("/api/docs", "GET");
    state.docs = Array.isArray(response.docs) ? response.docs : [];
  } catch (error) {
    state.docs = [];
    toast(`\u6587\u6863\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`, "warn", 4200);
  }
  return state.docs;
}
function docBySlug(slug) {
  return (state.docs || []).find((doc) => doc.slug === slug) || null;
}
async function openDoc(slug = "quickstart") {
  if (!ui.docWin) return;
  await ensureDocs();
  const doc = docBySlug(slug) || state.docs[0];
  if (!doc) {
    toast("\u6587\u6863\u76EE\u5F55\u4E3A\u7A7A\uFF0C\u8BF7\u68C0\u67E5\u540E\u7AEF\u5B89\u88C5", "warn", 4e3);
    return;
  }
  state.docSlug = doc.slug;
  ui.docWin.hidden = false;
  ui.docWin.classList.remove("min");
  document.body.classList.add("doc-open");
  ui.docTitle.textContent = `NETLAB \xB7 ${doc.title}`;
  renderDocNav();
  renderDocBody(doc);
  ui.docContent.parentElement.scrollTop = 0;
  ui.docSearch.value = "";
  ui.docResults.replaceChildren();
  placeDocWindow();
}
function closeDoc() {
  if (!ui.docWin) return;
  ui.docWin.hidden = true;
  ui.docWin.classList.remove("minimized", "maximized");
  document.body.classList.remove("doc-open");
  state.docGeo = null;
  if (state.guideShown && !ui.guide.hidden) syncPrefControls();
}
function renderDocNav() {
  if (!ui.docNav) return;
  ui.docNav.replaceChildren();
  for (const doc of state.docs) {
    const node = button(doc.title, "docnav-item", () => {
      state.docSlug = doc.slug;
      ui.docTitle.textContent = `NETLAB \xB7 ${doc.title}`;
      renderDocNav();
      renderDocBody(doc);
      ui.docResults.replaceChildren();
      ui.docSearch.value = "";
    });
    node.classList.toggle("active", doc.slug === state.docSlug);
    ui.docNav.appendChild(node);
  }
}
function renderDocBody(doc) {
  if (!ui.docContent) return;
  const fragment = renderMarkdown(doc.text || "");
  ui.docContent.replaceChildren(fragment);
}
function renderInline(text, target) {
  const source = String(text || "");
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match;
  while (match = pattern.exec(source)) {
    if (match.index > cursor) target.appendChild(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("**")) {
      target.appendChild(el("b", null, token.slice(2, -2)));
    } else if (token.startsWith("`")) {
      target.appendChild(el("code", null, token.slice(1, -1)));
    } else {
      const label = token.slice(1, token.indexOf("]"));
      target.appendChild(el("span", "doc-link", label));
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) target.appendChild(document.createTextNode(source.slice(cursor)));
  return target;
}
function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  let blockId = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      const pre = el("pre", "doc-code");
      pre.textContent = code.join("\n");
      fragment.appendChild(pre);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const node = el(level === 1 ? "h1" : level === 2 ? "h2" : "h3", "doc-h");
      node.id = `doc-h-${blockId++}`;
      renderInline(heading[2], node);
      fragment.appendChild(node);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const list = el("ul", "doc-list");
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const item = el("li");
        renderInline(lines[index].replace(/^\s*[-*]\s+/, ""), item);
        list.appendChild(item);
        index += 1;
      }
      fragment.appendChild(list);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const list = el("ol", "doc-list");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = el("li");
        renderInline(lines[index].replace(/^\s*\d+\.\s+/, ""), item);
        list.appendChild(item);
        index += 1;
      }
      fragment.appendChild(list);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = el("blockquote", "doc-quote");
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        renderInline(lines[index].replace(/^\s*>\s?/, ""), quote);
        quote.appendChild(document.createElement("br"));
        index += 1;
      }
      fragment.appendChild(quote);
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraph = el("p", "doc-p");
    const parts = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[index])) {
      parts.push(lines[index]);
      index += 1;
    }
    renderInline(parts.join(" "), paragraph);
    fragment.appendChild(paragraph);
  }
  return fragment;
}
let docSearchSeq = 0;
async function searchDocs(query) {
  if (!ui.docResults) return;
  const text = String(query || "").trim().toLowerCase();
  const seq = ++docSearchSeq;
  ui.docResults.replaceChildren();
  if (!text) {
    ui.docMain.classList.remove("searching");
    return;
  }
  ui.docMain.classList.add("searching");
  const hits = [];
  for (const doc of state.docs) {
    const blocks = String(doc.text || "").split(/\n{2,}/);
    for (const block of blocks) {
      if (block.toLowerCase().includes(text)) {
        hits.push({
          slug: doc.slug,
          title: doc.title,
          snippet: block.replace(/[#>*`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150)
        });
        break;
      }
    }
  }
  let extra = [];
  try {
    const response = await api(`/api/help/search?q=${encodeURIComponent(text)}&limit=12`);
    extra = (response?.items || []).filter((item) => item.kind !== "doc");
  } catch {
    extra = [];
  }
  if (seq !== docSearchSeq) return;
  if (!hits.length && !extra.length) {
    ui.docResults.appendChild(div("doc-empty", "\u6CA1\u6709\u5339\u914D\u7684\u6BB5\u843D\uFF1B\u8BD5\u8BD5\u300C\u8282\u70B9\u300D\u300C\u6C42\u89E3\u5668\u300D\u300C\u5FEB\u6377\u952E\u300D\u7B49\u5173\u952E\u8BCD\u3002"));
    return;
  }
  if (hits.length) {
    ui.docResults.appendChild(el("div", "doc-sec", `\u6587\u6863\u6BB5\u843D \xB7 ${hits.length}`));
  }
  for (const hit of hits) {
    const node = button("", "doc-hit", () => {
      void openDoc(hit.slug);
      ui.docSearch.value = query;
      void searchDocs(query);
    });
    node.appendChild(el("b", null, hit.title));
    node.appendChild(el("span", null, hit.snippet));
    ui.docResults.appendChild(node);
  }
  if (extra.length) {
    const order = ["element", "circuit_node", "compute", "method", "template", "doc"];
    const buckets = /* @__PURE__ */ new Map();
    for (const item of extra) {
      const key = String(item.kind || "other");
      if (!buckets.has(key)) {
        buckets.set(key, { label: String(item.kind_label || key), items: [] });
      }
      buckets.get(key).items.push(item);
    }
    const keys = [
      ...order.filter((key) => buckets.has(key)),
      ...[...buckets.keys()].filter((key) => !order.includes(key))
    ];
    for (const key of keys) {
      const bucket = buckets.get(key);
      ui.docResults.appendChild(
        el("div", "doc-sec", `${bucket.label} \xB7 ${bucket.items.length}`)
      );
      for (const item of bucket.items) {
        const node = button("", "doc-hit", () => {
          if (item.kind === "template") {
            closeDoc();
            void docsActions.loadTemplate(item.ref || "", item.title || "");
          } else if (item.kind === "doc" && item.ref) {
            window.open(
              `/api/help/doc?path=${encodeURIComponent(item.ref)}&line=${Number(item.line) || 1}`,
              "_blank",
              "noopener"
            );
          } else {
            toast(`${item.title}\uFF1A${item.text || "\u65E0\u66F4\u591A\u8BF4\u660E"}`, "info", 4200);
          }
        });
        const head = el("b", null, item.title || item.ref || "");
        const badge = el("i", "doc-kind", item.kind_label || item.kind || "");
        head.appendChild(badge);
        node.appendChild(head);
        node.appendChild(el("span", null, item.text || item.subtitle || ""));
        ui.docResults.appendChild(node);
        node.title = `${item.title} \xB7 ${item.subtitle}`;
      }
    }
  }
}
export {
  closeDoc,
  docBySlug,
  docSearchSeq,
  ensureDocs,
  openDoc,
  renderDocBody,
  renderDocNav,
  renderInline,
  renderMarkdown,
  searchDocs,
  setDocsActions
};
